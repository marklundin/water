import { RenderTarget, Vec3, Color, drawQuadWithShader, EnvLighting, Texture, TEXTUREPROJECTION_EQUIRECT, ADDRESS_CLAMP_TO_EDGE, ADDRESS_REPEAT, FILTER_LINEAR, PIXELFORMAT_RGBA16F, ShaderUtils, SEMANTIC_POSITION } from 'playcanvas';

// Physically based atmosphere after Hillaire 2020, "A Scalable and Production Ready Sky and
// Atmosphere Rendering Technique" — the model behind Unreal's SkyAtmosphere.
//
// Three passes, all run only when the sun or the atmosphere parameters change:
//
//   1. transmittance LUT   (256 x 64)   T(r, mu): light surviving from a point to the top of the
//                                        atmosphere. Rayleigh + Mie + ozone.
//   2. multi-scatter LUT   (64 x 32)    Psi_ms(r, mu_s): light arriving at a point after two or more
//                                        bounces, as an isotropic source term. This is what keeps a
//                                        twilight sky blue instead of black and the horizon bright
//                                        instead of dipping — single scattering alone cannot.
//   3. sky march                         the equirect the engine turns into skybox and light probe.
//
// Distances are in kilometres. Coefficients are Hillaire's Earth values at sea level; the
// `uRayleigh` / `uMie` / `uOzone` uniforms scale them.

const GLSL_COMMON = /* glsl */`
const float PI = 3.14159265358979;
const float RG = 6360.0;                                   // planet radius, km
const float RT = 6460.0;                                   // top of the atmosphere, km
const vec3  RAYLEIGH_S = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float MIE_S = 3.996e-3;
const float MIE_A = 0.444e-3; // extinction (4.440e-3) minus scattering
const vec3  OZONE_A = vec3(0.650e-3, 1.881e-3, 0.085e-3);
const float CAMERA_R = RG + 0.01;                          // ten metres up

uniform float uRayleigh;
uniform float uMie;
uniform float uOzone;
uniform float uGroundAlbedo;

void medium(float h, out vec3 sR, out float sM, out vec3 sT) {
    float dR = exp(-h / 8.0);
    float dM = exp(-h / 1.2);
    float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    float mie = uMie;
    sR = RAYLEIGH_S * uRayleigh * dR;
    sM = MIE_S * mie * dM;
    sT = sR + vec3(sM + MIE_A * mie * dM) + OZONE_A * uOzone * dO;
}

// nearest positive hit with a sphere of radius R about the origin, or -1
float raySphere(vec3 o, vec3 d, float R) {
    float b = dot(o, d);
    float c = dot(o, o) - R * R;
    float disc = b * b - c;
    if (disc < 0.0) return -1.0;
    float s = sqrt(disc);
    float t0 = -b - s;
    float t1 = -b + s;
    if (t0 > 0.0) return t0;
    if (t1 > 0.0) return t1;
    return -1.0;
}

// Bruneton's (r, mu) <-> uv mapping, which spends the LUT's precision along the horizon
vec2 transmittanceUv(float r, float mu) {
    float H = sqrt(max(RT * RT - RG * RG, 0.0));
    float rho = sqrt(max(r * r - RG * RG, 0.0));
    float disc = r * r * (mu * mu - 1.0) + RT * RT;
    float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
    float dMin = RT - r;
    float dMax = rho + H;
    vec2 uv = clamp(vec2((d - dMin) / (dMax - dMin), rho / H), 0.0, 1.0);
    return (uv * vec2(255.0, 63.0) + 0.5) / vec2(256.0, 64.0);
}
void uvToRMu(vec2 uv, out float r, out float mu) {
    uv = clamp((uv * vec2(256.0, 64.0) - 0.5) / vec2(255.0, 63.0), 0.0, 1.0);
    float H = sqrt(RT * RT - RG * RG);
    float rho = H * uv.y;
    r = sqrt(rho * rho + RG * RG);
    float dMin = RT - r;
    float dMax = rho + H;
    float d = dMin + uv.x * (dMax - dMin);
    mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
    mu = clamp(mu, -1.0, 1.0);
}
`;

const WGSL_COMMON = /* wgsl */`
const PI: f32 = 3.14159265358979;
const RG: f32 = 6360.0;
const RT: f32 = 6460.0;
const RAYLEIGH_S: vec3f = vec3f(5.802e-3, 13.558e-3, 33.1e-3);
const MIE_S: f32 = 3.996e-3;
const MIE_A: f32 = 0.444e-3;
const OZONE_A: vec3f = vec3f(0.650e-3, 1.881e-3, 0.085e-3);
const CAMERA_R: f32 = RG + 0.01;

uniform uRayleigh: f32;
uniform uMie: f32;
uniform uOzone: f32;
uniform uGroundAlbedo: f32;

struct Medium { sR: vec3f, sM: f32, sT: vec3f }
fn medium(h: f32) -> Medium {
    let dR = exp(-h / 8.0);
    let dM = exp(-h / 1.2);
    let dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    let mie = uniform.uMie;
    var m: Medium;
    m.sR = RAYLEIGH_S * uniform.uRayleigh * dR;
    m.sM = MIE_S * mie * dM;
    m.sT = m.sR + vec3f(m.sM + MIE_A * mie * dM) + OZONE_A * uniform.uOzone * dO;
    return m;
}

fn raySphere(o: vec3f, d: vec3f, R: f32) -> f32 {
    let b = dot(o, d);
    let c = dot(o, o) - R * R;
    let disc = b * b - c;
    if (disc < 0.0) { return -1.0; }
    let s = sqrt(disc);
    let t0 = -b - s;
    let t1 = -b + s;
    if (t0 > 0.0) { return t0; }
    if (t1 > 0.0) { return t1; }
    return -1.0;
}

fn transmittanceUv(r: f32, mu: f32) -> vec2f {
    let H = sqrt(max(RT * RT - RG * RG, 0.0));
    let rho = sqrt(max(r * r - RG * RG, 0.0));
    let disc = r * r * (mu * mu - 1.0) + RT * RT;
    let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
    let dMin = RT - r;
    let dMax = rho + H;
    let uv = clamp(vec2f((d - dMin) / (dMax - dMin), rho / H), vec2f(0.0), vec2f(1.0));
    return (uv * vec2f(255.0, 63.0) + 0.5) / vec2f(256.0, 64.0);
}
struct RMu { r: f32, mu: f32 }
fn uvToRMu(texUv: vec2f) -> RMu {
    let uv = clamp((texUv * vec2f(256.0, 64.0) - 0.5) / vec2f(255.0, 63.0), vec2f(0.0), vec2f(1.0));
    let H = sqrt(RT * RT - RG * RG);
    let rho = H * uv.y;
    let r = sqrt(rho * rho + RG * RG);
    let dMin = RT - r;
    let dMax = rho + H;
    let d = dMin + uv.x * (dMax - dMin);
    var mu = select((H * H - rho * rho - d * d) / (2.0 * r * d), 1.0, d == 0.0);
    mu = clamp(mu, -1.0, 1.0);
    return RMu(r, mu);
}
`;

const ATMOS_VS = /* glsl */`
attribute vec2 aPosition;
varying vec2 uv0;
void main(void) {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    uv0 = getImageEffectUV((aPosition + 1.0) * 0.5);
}
`;
const ATMOS_VS_WGSL = /* wgsl */`
attribute aPosition: vec2f;
varying uv0: vec2f;
@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4f(input.aPosition, 0.0, 1.0);
    output.uv0 = getImageEffectUV((input.aPosition + 1.0) * 0.5);
    return output;
}
`;

// ---------------------------------------------------------------- 1. transmittance
const TRANSMITTANCE_FS = /* glsl */`
${GLSL_COMMON}
varying vec2 uv0;
void main(void) {
    float r, mu;
    uvToRMu(uv0, r, mu);
    vec3 o = vec3(0.0, r, 0.0);
    vec3 d = vec3(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
    float tMax = max(raySphere(o, d, RT), 0.0);
    const int N = 64;
    float tPrev = 0.0;
    vec3 tau = vec3(0.0);
    for (int i = 0; i < N; i++) {
        float f = (float(i) + 1.0) / float(N);
        float t = tMax * f * f;
        float dt = t - tPrev;
        vec3 p = o + d * ((t + tPrev) * 0.5);
        tPrev = t;
        vec3 sR, sT; float sM;
        medium(length(p) - RG, sR, sM, sT);
        tau += sT * dt;
    }
    gl_FragColor = vec4(exp(-tau), 1.0);
}
`;
const TRANSMITTANCE_FS_WGSL = /* wgsl */`
${WGSL_COMMON}
varying uv0: vec2f;
@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let rm = uvToRMu(input.uv0);
    let o = vec3f(0.0, rm.r, 0.0);
    let d = vec3f(sqrt(max(1.0 - rm.mu * rm.mu, 0.0)), rm.mu, 0.0);
    let tMax = max(raySphere(o, d, RT), 0.0);
    let N = 64;
    var tPrev = 0.0;
    var tau = vec3f(0.0);
    for (var i = 0; i < N; i++) {
        let f = (f32(i) + 1.0) / f32(N);
        let t = tMax * f * f;
        let dt = t - tPrev;
        let p = o + d * ((t + tPrev) * 0.5);
        tPrev = t;
        let m = medium(length(p) - RG);
        tau += m.sT * dt;
    }
    output.color = vec4f(exp(-tau), 1.0);
    return output;
}
`;

// ---------------------------------------------------------------- 2. multiple scattering
// For every (sun angle, altitude): send rays over the whole sphere, integrate the light each one
// scatters back after one bounce (L2) and the fraction it would scatter again (f_ms), then sum the
// geometric series Psi = L2 / (1 - f_ms). The outer isotropic phase cancels the
// sphere integral's solid angle. The first bounce still needs its own 1/(4*pi) phase.
// Reference: sebh/UnrealEngineSkyAtmosphere, RenderSkyRayMarching.hlsl.
const MULTISCATTER_FS = /* glsl */`
${GLSL_COMMON}
uniform sampler2D uTransmittance;
varying vec2 uv0;
vec3 T_lut(float r, float mu) { return texture(uTransmittance, transmittanceUv(r, mu)).rgb; }
void main(void) {
    vec2 uv = clamp((uv0 * vec2(64.0, 32.0) - 0.5) / vec2(63.0, 31.0), 0.0, 1.0);
    // Concentrate samples on twilight sun angles and dense air near the ground.
    float signedAngle = uv.x * 2.0 - 1.0;
    float mus = sign(signedAngle) * signedAngle * signedAngle;
    float r = clamp(RG + uv.y * uv.y * (RT - RG), RG + 0.001, RT - 0.001);
    vec3 sunDir = vec3(sqrt(max(1.0 - mus * mus, 0.0)), mus, 0.0);
    vec3 o = vec3(0.0, r, 0.0);
    vec3 L2 = vec3(0.0), fms = vec3(0.0);
    const int NS = 8;
    const int N = 20;
    for (int i = 0; i < NS; i++) {
        for (int j = 0; j < NS; j++) {
            float ct = 1.0 - 2.0 * (float(i) + 0.5) / float(NS);
            float st = sqrt(max(1.0 - ct * ct, 0.0));
            float ph = 2.0 * PI * (float(j) + 0.5) / float(NS);
            vec3 w = vec3(st * cos(ph), ct, st * sin(ph));
            float tTop = raySphere(o, w, RT);
            float tG = raySphere(o, w, RG);
            float tMax = tG > 0.0 ? tG : tTop;
            float dt = tMax / float(N);
            vec3 T = vec3(1.0);
            for (int k = 0; k < N; k++) {
                vec3 p = o + w * ((float(k) + 0.5) * dt);
                float rp = length(p);
                vec3 sR, sT; float sM;
                medium(rp - RG, sR, sM, sT);
                vec3 sS = sR + vec3(sM);
                vec3 up = p / rp;
                float mup = dot(up, sunDir);
                float shadow = raySphere(p, sunDir, RG) > 0.0 ? 0.0 : 1.0;
                vec3 Tsun = T_lut(rp, mup) * shadow;
                vec3 Tstep = exp(-sT * dt);
                vec3 S = sS * Tsun / (4.0 * PI);
                L2 += T * (S - S * Tstep) / max(sT, vec3(1e-6));
                fms += T * (sS - sS * Tstep) / max(sT, vec3(1e-6));
                T *= Tstep;
            }
            if (tG > 0.0) {
                vec3 ng = normalize(o + w * tG);
                float ndl = max(dot(ng, sunDir), 0.0);
                L2 += T * (uGroundAlbedo / PI) * ndl * T_lut(RG, ndl);
            }
        }
    }
    L2 /= float(NS * NS);
    fms /= float(NS * NS);
    gl_FragColor = vec4(L2 / max(vec3(1.0) - fms, vec3(1e-4)), 1.0);
}
`;
const MULTISCATTER_FS_WGSL = /* wgsl */`
${WGSL_COMMON}
var uTransmittance: texture_2d<f32>;
var uTransmittanceSampler: sampler;
varying uv0: vec2f;
fn T_lut(r: f32, mu: f32) -> vec3f { return textureSampleLevel(uTransmittance, uTransmittanceSampler, transmittanceUv(r, mu), 0.0).rgb; }
@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let uv = clamp((input.uv0 * vec2f(64.0, 32.0) - 0.5) / vec2f(63.0, 31.0), vec2f(0.0), vec2f(1.0));
    let signedAngle = uv.x * 2.0 - 1.0;
    let mus = sign(signedAngle) * signedAngle * signedAngle;
    let r = clamp(RG + uv.y * uv.y * (RT - RG), RG + 0.001, RT - 0.001);
    let sunDir = vec3f(sqrt(max(1.0 - mus * mus, 0.0)), mus, 0.0);
    let o = vec3f(0.0, r, 0.0);
    var L2 = vec3f(0.0);
    var fms = vec3f(0.0);
    let NS = 8;
    let N = 20;
    for (var i = 0; i < NS; i++) {
        for (var j = 0; j < NS; j++) {
            let ct = 1.0 - 2.0 * (f32(i) + 0.5) / f32(NS);
            let st = sqrt(max(1.0 - ct * ct, 0.0));
            let ph = 2.0 * PI * (f32(j) + 0.5) / f32(NS);
            let w = vec3f(st * cos(ph), ct, st * sin(ph));
            let tTop = raySphere(o, w, RT);
            let tG = raySphere(o, w, RG);
            let tMax = select(tTop, tG, tG > 0.0);
            let dt = tMax / f32(N);
            var T = vec3f(1.0);
            for (var k = 0; k < N; k++) {
                let p = o + w * ((f32(k) + 0.5) * dt);
                let rp = length(p);
                let m = medium(rp - RG);
                let sS = m.sR + vec3f(m.sM);
                let up = p / rp;
                let mup = dot(up, sunDir);
                let shadow = select(1.0, 0.0, raySphere(p, sunDir, RG) > 0.0);
                let Tsun = T_lut(rp, mup) * shadow;
                let Tstep = exp(-m.sT * dt);
                let S = sS * Tsun / (4.0 * PI);
                L2 += T * (S - S * Tstep) / max(m.sT, vec3f(1e-6));
                fms += T * (sS - sS * Tstep) / max(m.sT, vec3f(1e-6));
                T *= Tstep;
            }
            if (tG > 0.0) {
                let ng = normalize(o + w * tG);
                let ndl = max(dot(ng, sunDir), 0.0);
                L2 += T * (uniform.uGroundAlbedo / PI) * ndl * T_lut(RG, ndl);
            }
        }
    }
    L2 /= f32(NS * NS);
    fms /= f32(NS * NS);
    output.color = vec4f(L2 / max(vec3f(1.0) - fms, vec3f(1e-4)), 1.0);
    return output;
}
`;

// ---------------------------------------------------------------- 3. the sky
const GLSL_SKY_BODY = /* glsl */`
uniform sampler2D uTransmittance;
uniform sampler2D uMultiScatter;
uniform vec3  uSunDir;
uniform float uSunIntensity;
uniform float uMieG;
uniform float uSunDisc;      // 0 = no disc (the light-probe variant)
varying vec2 uv0;

vec3 T_lut(float r, float mu) { return texture(uTransmittance, transmittanceUv(r, mu)).rgb; }
vec3 MS_lut(float r, float mu) {
    vec2 uv = vec2(sign(mu) * sqrt(abs(mu)) * 0.5 + 0.5, sqrt(clamp((r - RG) / (RT - RG), 0.0, 1.0)));
    return texture(uMultiScatter, (clamp(uv, 0.0, 1.0) * vec2(63.0, 31.0) + 0.5) / vec2(64.0, 32.0)).rgb;
}

vec3 march(vec3 dir) {
    vec3 o = vec3(0.0, CAMERA_R, 0.0);
    float tTop = raySphere(o, dir, RT);
    float tG = raySphere(o, dir, RG);
    float tMax = tG > 0.0 ? tG : tTop;
    float mu = dot(dir, uSunDir);
    float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g = uMieG;
    float phM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

    vec3 L = vec3(0.0), T = vec3(1.0);
    const int N = 40;
    float tPrev = 0.0;
    for (int i = 0; i < N; i++) {
        // quadratic spacing: fine steps in the dense air near the camera, coarse ones out at the top
        float f = (float(i) + 1.0) / float(N);
        float t = tMax * f * f;
        float dt = t - tPrev;
        vec3 p = o + dir * (0.5 * (t + tPrev));
        tPrev = t;
        float rp = length(p);
        vec3 sR, sT; float sM;
        medium(rp - RG, sR, sM, sT);
        vec3 up = p / rp;
        float mus = dot(up, uSunDir);
        float shadow = raySphere(p, uSunDir, RG) > 0.0 ? 0.0 : 1.0;
        vec3 Tsun = T_lut(rp, mus) * shadow;
        vec3 S = (sR * phR + vec3(sM * phM)) * Tsun + (sR + vec3(sM)) * MS_lut(rp, mus);
        vec3 Tstep = exp(-sT * dt);
        L += T * (S - S * Tstep) / max(sT, vec3(1e-7));
        T *= Tstep;
    }
    if (tG > 0.0) {
        vec3 ng = normalize(o + dir * tG);
        float ndl = max(dot(ng, uSunDir), 0.0);
        L += T * (uGroundAlbedo / PI) * ndl * T_lut(RG, ndl);
    }
    return L * uSunIntensity;
}

vec3 skyColor(vec3 dir) {
    vec3 col = march(dir);
    float theta = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
    // Earth solar angular radius. The surrounding aureole comes from Mie scattering.
    const float SUN_R = 0.00465;
    float edge = max(fwidth(theta), 0.0004);
    if (uSunDisc > 0.0 && raySphere(vec3(0.0, CAMERA_R, 0.0), dir, RG) < 0.0) {
        float limb = sqrt(max(1.0 - pow(min(theta / SUN_R, 1.0), 2.0), 0.0));
        float core = (1.0 - smoothstep(SUN_R - edge, SUN_R + edge, theta)) * (0.6 + 0.4 * limb) / 0.866667;
        col += core * uSunDisc * T_lut(CAMERA_R, dir.y);
    }
    // Preserve chromaticity when the physical solar radiance exceeds half-float range.
    float peak = max(max(col.r, col.g), col.b);
    return col * min(1.0, 40000.0 / max(peak, 1.0));
}

void main(void) {
    float phi = (uv0.x - 0.5) * 2.0 * PI;
    float theta = (0.5 - uv0.y) * PI;     // engine's toSphericalUv: "up" lives at v = 0
    vec3 dir = vec3(sin(phi) * cos(theta), sin(theta), cos(phi) * cos(theta));
    dir.x *= -1.0;
    gl_FragColor = vec4(skyColor(normalize(dir)), 1.0);
}
`;
const SKY_FS = GLSL_COMMON + GLSL_SKY_BODY;

const WGSL_SKY_BODY = /* wgsl */`
var uTransmittance: texture_2d<f32>;
var uTransmittanceSampler: sampler;
var uMultiScatter: texture_2d<f32>;
var uMultiScatterSampler: sampler;
uniform uSunDir: vec3f;
uniform uSunIntensity: f32;
uniform uMieG: f32;
uniform uSunDisc: f32;
varying uv0: vec2f;

fn T_lut(r: f32, mu: f32) -> vec3f { return textureSampleLevel(uTransmittance, uTransmittanceSampler, transmittanceUv(r, mu), 0.0).rgb; }
fn MS_lut(r: f32, mu: f32) -> vec3f {
    let uv = vec2f(sign(mu) * sqrt(abs(mu)) * 0.5 + 0.5, sqrt(clamp((r - RG) / (RT - RG), 0.0, 1.0)));
    return textureSampleLevel(uMultiScatter, uMultiScatterSampler, (clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(63.0, 31.0) + 0.5) / vec2f(64.0, 32.0), 0.0).rgb;
}

fn march(dir: vec3f) -> vec3f {
    let o = vec3f(0.0, CAMERA_R, 0.0);
    let tTop = raySphere(o, dir, RT);
    let tG = raySphere(o, dir, RG);
    let tMax = select(tTop, tG, tG > 0.0);
    let mu = dot(dir, uniform.uSunDir);
    let phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    let g = uniform.uMieG;
    let phM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

    var L = vec3f(0.0);
    var T = vec3f(1.0);
    let N = 40;
    var tPrev = 0.0;
    for (var i = 0; i < N; i++) {
        let f = (f32(i) + 1.0) / f32(N);
        let t = tMax * f * f;
        let dt = t - tPrev;
        let p = o + dir * (0.5 * (t + tPrev));
        tPrev = t;
        let rp = length(p);
        let m = medium(rp - RG);
        let up = p / rp;
        let mus = dot(up, uniform.uSunDir);
        let shadow = select(1.0, 0.0, raySphere(p, uniform.uSunDir, RG) > 0.0);
        let Tsun = T_lut(rp, mus) * shadow;
        let S = (m.sR * phR + vec3f(m.sM * phM)) * Tsun + (m.sR + vec3f(m.sM)) * MS_lut(rp, mus);
        let Tstep = exp(-m.sT * dt);
        L += T * (S - S * Tstep) / max(m.sT, vec3f(1e-7));
        T *= Tstep;
    }
    if (tG > 0.0) {
        let ng = normalize(o + dir * tG);
        let ndl = max(dot(ng, uniform.uSunDir), 0.0);
        L += T * (uniform.uGroundAlbedo / PI) * ndl * T_lut(RG, ndl);
    }
    return L * uniform.uSunIntensity;
}

fn skyColor(dir: vec3f) -> vec3f {
    var col = march(dir);
    let theta = acos(clamp(dot(dir, uniform.uSunDir), -1.0, 1.0));
    const SUN_R: f32 = 0.00465;
    let edge = max(fwidth(theta), 0.0004);
    if (uniform.uSunDisc > 0.0 && raySphere(vec3f(0.0, CAMERA_R, 0.0), dir, RG) < 0.0) {
        let limb = sqrt(max(1.0 - pow(min(theta / SUN_R, 1.0), 2.0), 0.0));
        let core = (1.0 - smoothstep(SUN_R - edge, SUN_R + edge, theta)) * (0.6 + 0.4 * limb) / 0.866667;
        col += core * uniform.uSunDisc * T_lut(CAMERA_R, dir.y);
    }
    let peak = max(max(col.r, col.g), col.b);
    return col * min(1.0, 40000.0 / max(peak, 1.0));
}

@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let phi = (input.uv0.x - 0.5) * 2.0 * PI;
    let theta = (0.5 - input.uv0.y) * PI;
    var dir = vec3f(sin(phi) * cos(theta), sin(theta), cos(phi) * cos(theta));
    dir.x *= -1.0;
    output.color = vec4f(skyColor(normalize(dir)), 1.0);
    return output;
}
`;
const SKY_FS_WGSL = WGSL_COMMON + WGSL_SKY_BODY;

/**
 * The same medium and transmittance integral on the CPU, for the sun's colour as a light source.
 * Matches the transmittance LUT to within the LUT's own sampling.
 *
 * @param {number[]} sunDir - Unit vector towards the sun.
 * @param {{rayleigh: number, mie: number, ozone: number}} p - Atmosphere multipliers.
 * @returns {number[]} Per-channel transmittance from ten metres up to the top of the atmosphere.
 */
function sunTransmittanceCPU(sunDir, p) {
    const RG = 6360, RT = 6460;
    const rayleighS = [5.802e-3, 13.558e-3, 33.1e-3];
    const mieS = 3.996e-3, mieA = 0.444e-3;
    const ozoneA = [0.650e-3, 1.881e-3, 0.085e-3];
    const mie = p.mie;
    const r = RG + 0.01;
    const mu = sunDir[1];
    const disc = r * r * (mu * mu - 1) + RT * RT;
    if (disc < 0) return [0, 0, 0];
    const tMax = Math.max(0, -r * mu + Math.sqrt(disc));
    if (raySphereHit(r, mu, RG)) return [0, 0, 0];
    const N = 64;
    let tPrev = 0;
    const tau = [0, 0, 0];
    for (let i = 0; i < N; i++) {
        const end = tMax * ((i + 1) / N) ** 2;
        const dt = end - tPrev;
        const t = (end + tPrev) * 0.5;
        tPrev = end;
        const rp = Math.sqrt(r * r + t * t + 2 * r * t * mu);
        const h = rp - RG;
        const dR = Math.exp(-h / 8), dM = Math.exp(-h / 1.2), dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
        for (let c = 0; c < 3; c++) {
            tau[c] += (rayleighS[c] * p.rayleigh * dR + (mieS + mieA) * mie * dM + ozoneA[c] * p.ozone * dO) * dt;
        }
    }
    return tau.map(v => Math.exp(-v));
}

function raySphereHit(r, mu, R) {
    // from a point at radius r looking with cos-zenith mu: does the ray meet the sphere of radius R?
    if (mu >= 0) return false;
    const disc = r * r * (mu * mu - 1) + R * R;
    return disc >= 0;
}

/** Sun placement, atmospheric visibility, and one common scene exposure. */
const DEFAULT_SKY_PARAMS = Object.freeze({
    sunElevation: 25,      // degrees, positive above the horizon
    sunAzimuth: 165,       // degrees, 0 is +Z, 90 is +X
    haze: 1,              // aerosol density relative to the Earth reference atmosphere
    exposure: 0.55        // common scale for sky radiance and direct sunlight
});

const RANGES = {
    sunElevation: [-90, 90],
    sunAzimuth: [-Infinity, Infinity],
    haze: [0, 20],
    exposure: [0, 100]
};

/** Validate a complete update before changing any live state. */
function resolveSkyParams(patch, base = DEFAULT_SKY_PARAMS) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new TypeError('Sky parameters must be an object.');
    }
    const next = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(RANGES, key)) throw new TypeError(`Unknown sky parameter: ${key}`);
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new TypeError(`Sky parameter ${key} must be a finite number.`);
        }
        const [min, max] = RANGES[key];
        if (value < min || value > max) {
            throw new RangeError(`Sky parameter ${key} must be between ${min} and ${max}.`);
        }
        next[key] = key === 'sunAzimuth' ? ((value + 180) % 360 + 360) % 360 - 180 : value;
    }
    return Object.freeze(next);
}

const SOLAR_IRRADIANCE = 18;
const AEROSOL_ASYMMETRY = 0.82;
const SUN_SOLID_ANGLE = Math.PI * Math.sin(0.00465) ** 2;

/**
 * Independent Earth atmosphere and environment lighting for PlayCanvas.
 *
 * The visible sky includes the sun. The environment excludes its disc because direct lighting
 * should supply solar illumination separately. Use getSunDirection()/getSunColor() for that light.
 * No camera, water surface, scene geometry, post processing, or directional light is created.
 *
 * GPU work runs in the next app frame, including the initial build. Assign onUpdate immediately
 * after construction to receive the first completed environment as well as subsequent changes.
 * Pass { attachToScene: false } as the third argument to manage scene assignment yourself.
 */
class Sky {
    constructor(app, params = {}, { attachToScene = true } = {}) {
        this._params = resolveSkyParams(params);
        if (typeof attachToScene !== 'boolean') throw new TypeError('attachToScene must be a boolean.');
        this.app = app;
        this.device = app.graphicsDevice;
        this._attachToScene = attachToScene;
        this._destroyed = false;
        this._previousScene = null;
        this._appliedExposure = null;
        this._ready = false;
        const device = this.device;

        const mkEquirect = (name, w, h) => new Texture(device, {
            name, width: w, height: h, format: PIXELFORMAT_RGBA16F, mipmaps: false,
            minFilter: FILTER_LINEAR, magFilter: FILTER_LINEAR,
            addressU: ADDRESS_REPEAT, addressV: ADDRESS_CLAMP_TO_EDGE,
            projection: TEXTUREPROJECTION_EQUIRECT
        });
        const mkLut = (name, w, h) => new Texture(device, {
            name, width: w, height: h, format: PIXELFORMAT_RGBA16F, mipmaps: false,
            minFilter: FILTER_LINEAR, magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE
        });

        this.transmittanceLut = mkLut('skyTransmittanceLUT', 256, 64);
        this.multiScatterLut = mkLut('skyMultiScatterLUT', 64, 32);
        this.rtTransmittance = new RenderTarget({ name: 'skyTransmittanceRT', colorBuffer: this.transmittanceLut, depth: false });
        this.rtMultiScatter = new RenderTarget({ name: 'skyMultiScatterRT', colorBuffer: this.multiScatterLut, depth: false });
        // Resolve the narrow sky band above the geometric horizon instead of averaging it with ground.
        this.lightingEquirect = mkEquirect('skyLightingEquirect', 2048, 1024);
        // Four thousand longitude samples keep the half-degree solar disc round after filtering.
        this.skyboxEquirect = mkEquirect('skyboxEquirect', 4096, 2048);
        this.rtLighting = new RenderTarget({ name: 'skyLightingRT', colorBuffer: this.lightingEquirect, depth: false });
        this.rtSkybox = new RenderTarget({ name: 'skyboxRT', colorBuffer: this.skyboxEquirect, depth: false });

        const mk = (name, glsl, wgsl) => ShaderUtils.createShader(device, {
            uniqueName: name,
            attributes: { aPosition: SEMANTIC_POSITION },
            vertexGLSL: ATMOS_VS, fragmentGLSL: glsl,
            vertexWGSL: ATMOS_VS_WGSL, fragmentWGSL: wgsl
        });
        this.transmittanceShader = mk('skyTransmittance', TRANSMITTANCE_FS, TRANSMITTANCE_FS_WGSL);
        this.multiScatterShader = mk('skyMultiScatter', MULTISCATTER_FS, MULTISCATTER_FS_WGSL);
        this.skyShader = mk('skyMarch', SKY_FS, SKY_FS_WGSL);

        this.sunDir = new Vec3();
        this.sunColor = new Color();
        this.envAtlas = null;
        this.lightingSource = null;
        this.skyboxCubemap = null;
        this.onUpdate = null;
        this._dirty = true;
        this._mediumDirty = true;
        this._skyDirty = true;
        this._updateSun();
        this._onFrame = () => {
            if (this._dirty && !this._destroyed) {
                this._dirty = false;
                this._rebuild();
            }
        };
        app.on('update', this._onFrame);
    }

    /** Immutable current configuration. Use setParams to change it. */
    get params() { return this._params; }
    get ready() { return this._ready; }
    getParams() { return { ...this._params }; }

    /** Linear lighting outputs. Radiance excludes the solar disc; exposure is applied by consumers. */
    get environment() {
        return Object.freeze({
            atlas: this.envAtlas,
            radiance: this._ready ? this.lightingEquirect : null,
            sunDirection: this.getSunDirection(),
            sunColor: this.getSunColor(),
            exposure: this._params.exposure,
            hazeDensity: this.aerialDensity
        });
    }

    /** Luminance-weighted atmospheric extinction at the observer, in inverse metres. */
    get aerialDensity() {
        const molecular = (5.802e-3 * 0.2126 + 13.558e-3 * 0.7152 + 33.1e-3 * 0.0722) * Math.exp(-0.01 / 8);
        const aerosol = 4.440e-3 * this._params.haze * Math.exp(-0.01 / 1.2);
        return (molecular + aerosol) / 1000;
    }

    /** Validate and merge an update; expensive work is coalesced into the next app frame. */
    setParams(patch) {
        if (this._destroyed) throw new Error('Sky has been destroyed.');
        const next = resolveSkyParams(patch, this._params);
        const changed = Object.keys(next).filter(key => next[key] !== this._params[key]);
        if (!changed.length) return this;
        this._mediumDirty ||= changed.includes('haze');
        this._skyDirty ||= changed.some(key => key !== 'exposure');
        this._params = next;
        this._dirty = true;
        this._updateSun();
        return this;
    }

    /** Apply a complete configuration from defaults, so omitted fields cannot leak between scenes. */
    resetParams(patch = {}) {
        return this.setParams(resolveSkyParams(patch));
    }

    _updateSun() {
        const p = this._params;
        const el = p.sunElevation * Math.PI / 180;
        const az = p.sunAzimuth * Math.PI / 180;
        this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
        const T = sunTransmittanceCPU([this.sunDir.x, this.sunDir.y, this.sunDir.z], { rayleigh: 1, mie: p.haze, ozone: 1 });
        const k = SOLAR_IRRADIANCE * p.exposure;
        this.sunColor.set(T[0] * k, T[1] * k, T[2] * k);
    }

    _setAtmosphere() {
        const p = this._params;
        const scope = this.device.scope;
        scope.resolve('uRayleigh').setValue(1);
        scope.resolve('uMie').setValue(p.haze);
        scope.resolve('uOzone').setValue(1);
        scope.resolve('uGroundAlbedo').setValue(0.1);
    }

    _setSky(withDisc) {
        const { sunDir } = this;
        const scope = this.device.scope;
        scope.resolve('uTransmittance').setValue(this.transmittanceLut);
        scope.resolve('uMultiScatter').setValue(this.multiScatterLut);
        scope.resolve('uSunDir').setValue([sunDir.x, sunDir.y, sunDir.z]);
        scope.resolve('uSunIntensity').setValue(SOLAR_IRRADIANCE);
        scope.resolve('uMieG').setValue(AEROSOL_ASYMMETRY);
        scope.resolve('uSunDisc').setValue(withDisc ? SOLAR_IRRADIANCE / SUN_SOLID_ANGLE : 0);
    }

    _rebuild() {
        const { device, app } = this;
        this._setAtmosphere();
        if (this._mediumDirty) {
            drawQuadWithShader(device, this.rtTransmittance, this.transmittanceShader);
            device.scope.resolve('uTransmittance').setValue(this.transmittanceLut);
            drawQuadWithShader(device, this.rtMultiScatter, this.multiScatterShader);
            this._mediumDirty = false;
        }

        let oldSource, oldAtlas, oldSkybox;
        if (this._skyDirty) {
            this._setSky(false);
            drawQuadWithShader(device, this.rtLighting, this.skyShader);
            this._setSky(true);
            drawQuadWithShader(device, this.rtSkybox, this.skyShader);
            oldSource = this.lightingSource;
            oldAtlas = this.envAtlas;
            oldSkybox = this.skyboxCubemap;
            // Recreate prefiltered targets: updating them in place can alias engine render passes.
            this.lightingSource = EnvLighting.generateLightingSource(this.lightingEquirect, { size: 256 });
            this.envAtlas = EnvLighting.generateAtlas(this.lightingSource, { numReflectionSamples: 1024, numAmbientSamples: 2048 });
            this.skyboxCubemap = EnvLighting.generateSkyboxCubemap(this.skyboxEquirect, 1024);
            this._skyDirty = false;
        }
        if (this._attachToScene) {
            const scene = app.scene;
            this._previousScene ??= {
                envAtlas: scene.envAtlas,
                prefilteredCubemaps: [...scene.prefilteredCubemaps],
                skybox: scene.skybox,
                intensity: scene.skyboxIntensity,
                mip: scene.skyboxMip
            };
            scene.envAtlas = this.envAtlas;
            scene.skybox = this.skyboxCubemap;
            scene.skyboxIntensity = this._params.exposure;
            scene.skyboxMip = 0;
            this._appliedExposure = this._params.exposure;
        }
        this._ready = true;
        // Notify before releasing the previous atlas so consumers can detach it safely.
        try {
            this.onUpdate?.(this);
        } finally {
            oldSource?.destroy();
            oldAtlas?.destroy();
            oldSkybox?.destroy();
        }
    }

    /** Average linear radiance just above the horizon, before exposure. Null before the first frame. */
    readHorizonColor() { return this._readRow((this.lightingEquirect.height >> 1) - 1); }
    /** Average linear radiance 25 degrees below the zenith, before exposure. */
    readZenithColor() { return this._readRow(Math.round(this.lightingEquirect.height * 0.14)); }

    async _readRow(y) {
        if (!this._ready || this._destroyed) return null;
        const t = this.lightingEquirect;
        const W = t.width;
        const data = await t.read(0, y, W, 1);
        if (!data || this._destroyed) return null;
        const values = data instanceof Uint16Array ? data : new Uint16Array(data.buffer ?? data, data.byteOffset ?? 0, W * 4);
        const h2f = (h) => {
            const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
            if (e === 0) return s * m * 2 ** -24;
            if (e === 31) return 0;
            return s * (1 + m / 1024) * 2 ** (e - 15);
        };
        const c = [0, 0, 0];
        for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) c[k] += h2f(values[x * 4 + k]);
        return c.map(v => v / W);
    }

    /** Release owned resources; restore scene lighting only where this sky still owns it. */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._ready = false;
        this.app.off('update', this._onFrame);
        const scene = this.app.scene, previous = this._previousScene;
        if (previous) {
            if (scene.envAtlas === this.envAtlas) {
                if (previous.prefilteredCubemaps.length) scene.prefilteredCubemaps = previous.prefilteredCubemaps;
                else scene.envAtlas = previous.envAtlas;
            }
            if (scene.skybox === this.skyboxCubemap) {
                scene.skybox = previous.skybox;
                if (scene.skyboxIntensity === this._appliedExposure) scene.skyboxIntensity = previous.intensity;
                if (scene.skyboxMip === 0) scene.skyboxMip = previous.mip;
            }
        }
        [this.rtLighting, this.rtSkybox, this.rtTransmittance, this.rtMultiScatter].forEach(rt => rt?.destroy());
        [this.lightingEquirect, this.skyboxEquirect, this.transmittanceLut, this.multiScatterLut,
            this.lightingSource, this.envAtlas, this.skyboxCubemap].forEach(t => t?.destroy());
        this.onUpdate = null;
    }

    /** Direction towards the sun in world space. The returned vector belongs to the caller. */
    getSunDirection() { return this.sunDir.clone(); }
    /** Direct solar irradiance in linear scene units, including atmospheric extinction and exposure. */
    getSunColor() { return this.sunColor.clone(); }
}

export { DEFAULT_SKY_PARAMS, Sky };
