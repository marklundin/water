import { Compute, RenderTarget, Shader, SHADERLANGUAGE_WGSL, ShaderUtils, SEMANTIC_POSITION, RenderPassShaderQuad, Texture, FILTER_LINEAR_MIPMAP_LINEAR, ADDRESS_REPEAT, FILTER_LINEAR, PIXELFORMAT_RGBA16F, ADDRESS_CLAMP_TO_EDGE, FILTER_NEAREST, PIXELFORMAT_RGBA32F, Mesh, BoundingBox, Vec3, PIXELFORMAT_RGBA8, Color, ShaderMaterial, BLEND_NORMAL, CULLFACE_NONE, MeshInstance, Entity, LAYERID_WORLD, StandardMaterial } from 'playcanvas';

/** Wave-driven, filtered inverse-refraction caustics shared by surface and opaque receivers. */
const CAUSTICS_GLSL = /* glsl */`
uniform sampler2D uCaustWave0;
uniform sampler2D uCaustWave1;
uniform vec2 uCaustWaveScales;
uniform vec3 uCaustWaveSettings; // amplitude, choppiness, texture resolution

vec3 waterCausticSunRay(vec3 sunDirection) {
    return refract(-sunDirection, vec3(0.0, 1.0, 0.0), 0.75187969);
}
vec3 waterCausticNormal(vec2 p, float footprint) {
    vec4 d = vec4(0.0);
    d += textureLod(uCaustWave0, p * uCaustWaveScales.x, max(0.0, log2(max(footprint * uCaustWaveScales.x * uCaustWaveSettings.z, 1.0))));
    d += textureLod(uCaustWave1, p * uCaustWaveScales.y, max(0.0, log2(max(footprint * uCaustWaveScales.y * uCaustWaveSettings.z, 1.0))));
    d *= uCaustWaveSettings.x;
    vec2 slope = d.xy / max(vec2(1.0) + d.zw * uCaustWaveSettings.y, vec2(0.2));
    return normalize(vec3(-slope.x, 1.0, -slope.y));
}
vec2 waterCausticOffset(vec2 p, float depth, float footprint, vec3 sun) {
    vec3 ray = refract(-sun, waterCausticNormal(p, footprint), 0.75187969);
    return ray.xz * depth / max(-ray.y, 0.2);
}
float waterCausticFocus(vec2 entry, float depth, float scale, vec3 sun, float pixelMetres) {
    if (uCaustWaveSettings.x <= 0.0 || depth <= 0.0) return 1.0;
    // Filter to the solar disc / pixel footprint. Scale selects a wave footprint, never a
    // second pattern frequency. Positions and time always come from the live FFT field.
    float epsilon = max(max(pixelMetres * 1.5, depth * 0.00465), 0.12 / max(scale, 0.1));
    vec3 flatRay = waterCausticSunRay(sun);
    vec2 receiver = entry + flatRay.xz * depth / max(-flatRay.y, 0.2);
    vec2 p = entry;
    // Bounded inverse refraction: follow the wave's ray landing toward this receiver.
    for (int i = 0; i < 2; i++) {
        vec2 error = p + waterCausticOffset(p, depth, epsilon, sun) - receiver;
        p -= clamp(error, vec2(-epsilon * 2.0), vec2(epsilon * 2.0)) * 0.65;
    }
    vec2 dx = (waterCausticOffset(p + vec2(epsilon, 0.0), depth, epsilon, sun)
             - waterCausticOffset(p - vec2(epsilon, 0.0), depth, epsilon, sun)) / (2.0 * epsilon);
    vec2 dz = (waterCausticOffset(p + vec2(0.0, epsilon), depth, epsilon, sun)
             - waterCausticOffset(p - vec2(0.0, epsilon), depth, epsilon, sun)) / (2.0 * epsilon);
    float determinant = (1.0 + dx.x) * (1.0 + dz.y) - dx.y * dz.x;
    // Finite source regularization: flat water returns exactly one, convergence brightens,
    // divergence darkens. Multiple overlapping ray paths are still an approximation.
    float irradiance = min(3.5, sqrt(1.05) / sqrt(determinant * determinant + 0.05));
    return mix(1.0, irradiance, 1.0 - smoothstep(0.3, 1.2, pixelMetres));
}
`;

const CAUSTICS_WGSL = /* wgsl */`
var uCaustWave0: texture_2d<f32>;
var uCaustWave0Sampler: sampler;
var uCaustWave1: texture_2d<f32>;
var uCaustWave1Sampler: sampler;
uniform uCaustWaveScales: vec2f;
uniform uCaustWaveSettings: vec3f; // amplitude, choppiness, texture resolution

fn waterCausticSunRay(sunDirection: vec3f) -> vec3f {
    return refract(-sunDirection, vec3f(0.0, 1.0, 0.0), 0.75187969);
}
fn waterCausticNormal(p: vec2f, footprint: f32) -> vec3f {
    var d = vec4f(0.0);
    d += textureSampleLevel(uCaustWave0, uCaustWave0Sampler, p * uniform.uCaustWaveScales.x, max(0.0, log2(max(footprint * uniform.uCaustWaveScales.x * uniform.uCaustWaveSettings.z, 1.0))));
    d += textureSampleLevel(uCaustWave1, uCaustWave1Sampler, p * uniform.uCaustWaveScales.y, max(0.0, log2(max(footprint * uniform.uCaustWaveScales.y * uniform.uCaustWaveSettings.z, 1.0))));
    d *= uniform.uCaustWaveSettings.x;
    var slope = d.xy / max(vec2f(1.0) + d.zw * uniform.uCaustWaveSettings.y, vec2f(0.2));
    return normalize(vec3f(-slope.x, 1.0, -slope.y));
}
fn waterCausticOffset(p: vec2f, depth: f32, footprint: f32, sun: vec3f) -> vec2f {
    var ray = refract(-sun, waterCausticNormal(p, footprint), 0.75187969);
    return ray.xz * depth / max(-ray.y, 0.2);
}
fn waterCausticFocus(entry: vec2f, depth: f32, scale: f32, sun: vec3f, pixelMetres: f32) -> f32 {
    if (uniform.uCaustWaveSettings.x <= 0.0 || depth <= 0.0) { return 1.0; }
    // Filter to the solar disc / pixel footprint. Scale selects a wave footprint, never a
    // second pattern frequency. Positions and time always come from the live FFT field.
    var epsilon = max(max(pixelMetres * 1.5, depth * 0.00465), 0.12 / max(scale, 0.1));
    var flatRay = waterCausticSunRay(sun);
    var receiver = entry + flatRay.xz * depth / max(-flatRay.y, 0.2);
    var p = entry;
    // Bounded inverse refraction: follow the wave's ray landing toward this receiver.
    for (var i = 0; i < 2; i++) {
        var error = p + waterCausticOffset(p, depth, epsilon, sun) - receiver;
        p -= clamp(error, vec2f(-epsilon * 2.0), vec2f(epsilon * 2.0)) * 0.65;
    }
    var dx = (waterCausticOffset(p + vec2f(epsilon, 0.0), depth, epsilon, sun)
             - waterCausticOffset(p - vec2f(epsilon, 0.0), depth, epsilon, sun)) / (2.0 * epsilon);
    var dz = (waterCausticOffset(p + vec2f(0.0, epsilon), depth, epsilon, sun)
             - waterCausticOffset(p - vec2f(0.0, epsilon), depth, epsilon, sun)) / (2.0 * epsilon);
    var determinant = (1.0 + dx.x) * (1.0 + dz.y) - dx.y * dz.x;
    // Finite source regularization: flat water returns exactly one, convergence brightens,
    // divergence darkens. Multiple overlapping ray paths are still an approximation.
    var irradiance = min(3.5, sqrt(1.05) / sqrt(determinant * determinant + 0.05));
    return mix(1.0, irradiance, 1.0 - smoothstep(0.3, 1.2, pixelMetres));
}
`;

// Reuse the surface's derivative bindings: WGSL does not expand GLSL-style aliases.
const SURFACE_CAUSTICS_GLSL = CAUSTICS_GLSL
    .replace(/uniform sampler2D uCaustWave[01];\n/g, '')
    .replace(/uCaustWave([01])/g, (_, i) => `uDeriv${Number(i) + 2}`);
const SURFACE_CAUSTICS_WGSL = CAUSTICS_WGSL
    .replace(/var uCaustWave[01](?:Sampler)?: [^;]+;\n/g, '')
    .replace(/uCaustWave([01])/g, (_, i) => `uDeriv${Number(i) + 2}`);

const attached = new WeakSet();

/** Short-wave curvature dominates shallow caustics. Bind the two finest live FFT bands,
 * leaving a StandardMaterial enough samplers for its own PBR maps and cascaded shadows. */
function bindCausticWaves(material, simulation, config) {
    const scales = [];
    for (let i = 0; i < 2; i++) {
        const j = Math.max(0, simulation.lengthScales.length - 2 + i);
        material.setParameter(`uCaustWave${i}`, simulation.derivativeTextures[j]);
        scales.push(1 / simulation.lengthScales[j]);
    }
    material.setParameter('uCaustWaveScales', scales);
    material.setParameter('uCaustWaveSettings', [config.waves.amplitude, config.waves.choppiness, simulation.params.size]);
}

const FOG_GLSL = /* glsl */`
uniform vec3 fog_color;
#if FOG == LINEAR
uniform float fog_start;
uniform float fog_end;
#else
uniform float fog_density;
#endif
uniform vec3 uReceiverExtinction;
uniform vec3 uReceiverScatter;
uniform vec3 uReceiverSun;
uniform vec3 uReceiverSunColor;
uniform vec4 uReceiverParams; // sea level, caustic strength, footprint scale, exposure
uniform sampler2D uReceiverSky;
float dBlendModeFogFactor = 1.0;
${CAUSTICS_GLSL}
vec3 addFog(vec3 color) {
    float distanceMetres = distance(view_position, vPositionW);
    if (view_position.y >= uReceiverParams.x) {
        #if FOG == NONE
            return color;
        #elif FOG == LINEAR
            float transmittance = clamp((fog_end - distanceMetres) / max(fog_end - fog_start, 0.001), 0.0, 1.0);
        #elif FOG == EXP
            float transmittance = exp(-distanceMetres * fog_density);
        #else
            float transmittance = exp(-pow(distanceMetres * fog_density, 2.0));
        #endif
        #if FOG != NONE
        return mix(fog_color * dBlendModeFogFactor, color, transmittance);
        #endif
    }
    float depth = max(uReceiverParams.x - vPositionW.y, 0.0);
    float pixelMetres = max(length(dFdx(vPositionW.xz)), length(dFdy(vPositionW.xz)));
    vec3 sunRay = waterCausticSunRay(uReceiverSun);
    float sunPath = depth / max(-sunRay.y, 0.2);
    vec3 ambient = textureLod(uReceiverSky, vec2(0.5, 0.1), 0.0).rgb * uReceiverParams.w;
    float sunUp = max(uReceiverSun.y, 0.0);
    if (uReceiverParams.y > 0.0 && depth > 0.0 && sunUp > 0.0) {
        vec2 entry = vPositionW.xz - sunRay.xz * sunPath;
        float focus = waterCausticFocus(entry, depth, uReceiverParams.z, uReceiverSun, pixelMetres);
        float direct = dot(uReceiverSunColor, vec3(0.2126, 0.7152, 0.0722)) * sunUp;
        float fraction = direct / max(direct + dot(ambient, vec3(0.2126, 0.7152, 0.0722)) * 3.14159, 0.001);
        color *= max(0.0, 1.0 + (focus - 1.0) * uReceiverParams.y * fraction);
    }
    // Light loses red on its way to the floor as well as on its way back to the viewer.
    color *= exp(-uReceiverExtinction * sunPath);
    float cameraDepth = max(uReceiverParams.x - view_position.y, 0.0);
    if (vPositionW.y > uReceiverParams.x) distanceMetres *= cameraDepth / max(vPositionW.y - view_position.y, 0.001);
    vec3 scatter = uReceiverScatter * (ambient + uReceiverSunColor * sunUp * 0.3183)
        * exp(-uReceiverExtinction * cameraDepth);
    vec3 transmittance = exp(-uReceiverExtinction * distanceMetres);
    return color * transmittance + scatter * (vec3(1.0) - transmittance);
}
`;

const FOG_WGSL = /* wgsl */`
uniform fog_color: vec3f;
#if FOG == LINEAR
uniform fog_start: f32;
uniform fog_end: f32;
#else
uniform fog_density: f32;
#endif
uniform uReceiverExtinction: vec3f;
uniform uReceiverScatter: vec3f;
uniform uReceiverSun: vec3f;
uniform uReceiverSunColor: vec3f;
uniform uReceiverParams: vec4f;
var uReceiverSky: texture_2d<f32>;
var uReceiverSkySampler: sampler;
var<private> dBlendModeFogFactor: f32 = 1.0;
${CAUSTICS_WGSL}
fn addFog(source: vec3f) -> vec3f {
    var color = source;
    var distanceMetres = distance(uniform.view_position, vPositionW);
    if (uniform.view_position.y >= uniform.uReceiverParams.x) {
        #if FOG == NONE
            return color;
        #elif FOG == LINEAR
            let transmittance = clamp((uniform.fog_end - distanceMetres) / max(uniform.fog_end - uniform.fog_start, 0.001), 0.0, 1.0);
        #elif FOG == EXP
            let transmittance = exp(-distanceMetres * uniform.fog_density);
        #else
            let transmittance = exp(-pow(distanceMetres * uniform.fog_density, 2.0));
        #endif
        #if FOG != NONE
        return mix(uniform.fog_color * dBlendModeFogFactor, color, transmittance);
        #endif
    }
    let depth = max(uniform.uReceiverParams.x - vPositionW.y, 0.0);
    let pixelMetres = max(length(dpdx(vPositionW.xz)), length(dpdy(vPositionW.xz)));
    let sunRay = waterCausticSunRay(uniform.uReceiverSun);
    let sunPath = depth / max(-sunRay.y, 0.2);
    let ambient = textureSampleLevel(uReceiverSky, uReceiverSkySampler, vec2f(0.5, 0.1), 0.0).rgb * uniform.uReceiverParams.w;
    let sunUp = max(uniform.uReceiverSun.y, 0.0);
    if (uniform.uReceiverParams.y > 0.0 && depth > 0.0 && sunUp > 0.0) {
        let entry = vPositionW.xz - sunRay.xz * sunPath;
        let focus = waterCausticFocus(entry, depth, uniform.uReceiverParams.z, uniform.uReceiverSun, pixelMetres);
        let direct = dot(uniform.uReceiverSunColor, vec3f(0.2126, 0.7152, 0.0722)) * sunUp;
        let fraction = direct / max(direct + dot(ambient, vec3f(0.2126, 0.7152, 0.0722)) * 3.14159, 0.001);
        color *= max(0.0, 1.0 + (focus - 1.0) * uniform.uReceiverParams.y * fraction);
    }
    color *= exp(-uniform.uReceiverExtinction * sunPath);
    let cameraDepth = max(uniform.uReceiverParams.x - uniform.view_position.y, 0.0);
    if (vPositionW.y > uniform.uReceiverParams.x) { distanceMetres *= cameraDepth / max(vPositionW.y - uniform.view_position.y, 0.001); }
    let scatter = uniform.uReceiverScatter * (ambient + uniform.uReceiverSunColor * sunUp * 0.3183)
        * exp(-uniform.uReceiverExtinction * cameraDepth);
    let transmittance = exp(-uniform.uReceiverExtinction * distanceMetres);
    return color * transmittance + scatter * (vec3f(1.0) - transmittance);
}
`;

function attachReceiver(material) {
    if (attached.has(material)) throw new Error('Material already belongs to another water receiver');
    attached.add(material);
    const { glsl, wgsl } = material.shaderChunks;
    const previous = [glsl.get('fogPS'), wgsl.get('fogPS')];
    glsl.set('fogPS', FOG_GLSL);
    wgsl.set('fogPS', FOG_WGSL);
    material.update();
    return () => {
        attached.delete(material);
        for (const [i, chunks] of [glsl, wgsl].entries()) {
            if (previous[i] === undefined) chunks.delete('fogPS');
            else chunks.set('fogPS', previous[i]);
        }
        for (const name of ['uCaustWave0', 'uCaustWave1', 'uCaustWaveScales', 'uCaustWaveSettings', 'uReceiverExtinction', 'uReceiverScatter', 'uReceiverSun', 'uReceiverSunColor', 'uReceiverParams', 'uReceiverSky']) material.deleteParameter(name);
        material.update();
    };
}

// Shared GLSL for the ocean spectrum / FFT simulation (WebGL2 fragment path).
// Math follows Horvath 2015 "Empirical directional wave spectra for computer graphics"
// (JONSWAP + TMA shallow-water correction, Hasselmann / Donelan-Banner directional spreading)
// as popularised by the gasgiant / Jump Trajectory FFT ocean and the Sea of Thieves talk.

const SIM_MATH_GLSL = /* glsl */`
#define PI 3.14159265358979
#define TWO_PI 6.28318530717959

// ---- integer hash -> uniform floats (pcg3d, Jarzynski & Olano 2020) ----
uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
}
vec3 hash3(uvec3 p) {
    return vec3(pcg3d(p)) * (1.0 / 4294967296.0);
}
// two independent standard normal variates (Box-Muller)
vec2 gaussian2(uvec2 texel, uint seed) {
    vec3 r = hash3(uvec3(texel, seed));
    float u1 = max(r.x, 1e-7);
    float u2 = r.y;
    float mag = sqrt(-2.0 * log(u1));
    return vec2(mag * cos(TWO_PI * u2), mag * sin(TWO_PI * u2));
}

// ---- dispersion (finite depth) ----
float dispersion(float k, float g, float depth) {
    return sqrt(g * k * tanh(min(k * depth, 20.0)));
}
float dispersionDerivative(float k, float g, float depth) {
    float th = tanh(min(k * depth, 20.0));
    float ch = cosh(min(k * depth, 20.0));
    return g * (depth * k / (ch * ch) + th) / dispersion(k, g, depth) * 0.5;
}

// ---- directional spreading ----
float normalisationFactor(float s) {
    float s2 = s * s, s3 = s2 * s, s4 = s3 * s;
    if (s < 5.0) return -0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * s + 0.163;
    return -4.80e-08 * s4 + 1.07e-05 * s3 - 9.53e-04 * s2 + 5.90e-02 * s + 3.93e-01;
}
float cosine2s(float theta, float s) {
    return normalisationFactor(s) * pow(abs(cos(0.5 * theta)), 2.0 * s);
}
float spreadPower(float omega, float peakOmega) {
    if (omega > peakOmega) return 9.77 * pow(abs(omega / peakOmega), -2.5);
    return 6.97 * pow(abs(omega / peakOmega), 5.0);
}

// spectrum parameter block:
//   p0 = (scale, angle, spreadBlend, swell)
//   p1 = (alpha, peakOmega, gamma, shortWavesFade)
float directionSpectrum(float theta, float omega, vec4 p0, vec4 p1) {
    float s = spreadPower(omega, p1.y) + 16.0 * tanh(min(omega / p1.y, 20.0)) * p0.w * p0.w;
    float c = cos(theta);
    return mix(2.0 / PI * c * c, cosine2s(theta - p0.y, s), p0.z);
}
float tmaCorrection(float omega, float g, float depth) {
    float omegaH = omega * sqrt(depth / g);
    if (omegaH <= 1.0) return 0.5 * omegaH * omegaH;
    if (omegaH < 2.0) return 1.0 - 0.5 * (2.0 - omegaH) * (2.0 - omegaH);
    return 1.0;
}
float jonswap(float omega, float g, float depth, vec4 p0, vec4 p1) {
    float peakOmega = p1.y;
    float sigma = omega <= peakOmega ? 0.07 : 0.09;
    float d = (omega - peakOmega) / (sigma * peakOmega);
    float r = exp(-0.5 * d * d);
    float invOmega = 1.0 / omega;
    float pk = peakOmega * invOmega;
    return p0.x * tmaCorrection(omega, g, depth) * p1.x * g * g
         * invOmega * invOmega * invOmega * invOmega * invOmega
         * exp(-1.25 * pk * pk * pk * pk)
         * pow(abs(p1.z), r);
}
float shortWavesFade(float k, vec4 p1) {
    return exp(-p1.w * p1.w * k * k);
}

// complex helpers
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cconj(vec2 a) { return vec2(a.x, -a.y); }
`;

// Full-screen quad vertex shader (engine chunk 'quadVS' provides aPosition / uv0)
const SIM_QUAD_VS = /* glsl */`
attribute vec2 aPosition;
varying vec2 uv0;
void main(void) {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    uv0 = (aPosition.xy + 1.0) * 0.5;
}
`;

// ---------------------------------------------------------------------------
// Pass 1: initial spectrum H0(k) and conj(H0(-k)) -> RGBA32F
// ---------------------------------------------------------------------------
const SPECTRUM_FS = /* glsl */`
${SIM_MATH_GLSL}
uniform int   uSize;
uniform float uLengthScale;
uniform float uCutoffLow;
uniform float uCutoffHigh;
uniform float uDepth;
uniform float uGravity;
uniform int   uSeed;
uniform vec4  uSpecA0, uSpecA1, uSpecB0, uSpecB1;

vec2 h0(ivec2 texel) {
    int n = uSize;
    float deltaK = TWO_PI / uLengthScale;
    int nx = texel.x < n / 2 ? texel.x : texel.x - n;
    int nz = texel.y < n / 2 ? texel.y : texel.y - n;
    vec2 k = vec2(float(nx), float(nz)) * deltaK;
    float kLen = length(k);
    if (kLen < uCutoffLow || kLen > uCutoffHigh || kLen < 1e-6) return vec2(0.0);

    float kAngle = atan(k.y, k.x);
    float omega = dispersion(kLen, uGravity, uDepth);
    float dOmegadk = dispersionDerivative(kLen, uGravity, uDepth);

    float spectrum = jonswap(omega, uGravity, uDepth, uSpecA0, uSpecA1)
                   * directionSpectrum(kAngle, omega, uSpecA0, uSpecA1)
                   * shortWavesFade(kLen, uSpecA1);
    if (uSpecB0.x > 0.0) {
        spectrum += jonswap(omega, uGravity, uDepth, uSpecB0, uSpecB1)
                  * directionSpectrum(kAngle, omega, uSpecB0, uSpecB1)
                  * shortWavesFade(kLen, uSpecB1);
    }
    vec2 xi = gaussian2(uvec2(texel), uint(uSeed));
    // h0 = (xi_r + i xi_i)/sqrt(2) * sqrt(Ph),  Ph = Psi(k) dk^2 / 2  =>  calibrated so that
    // the ensemble height variance equals the integral of the directional spectrum.
    return xi * 0.5 * sqrt(spectrum * abs(dOmegadk) / kLen * deltaK * deltaK);
}

void main(void) {
    ivec2 texel = ivec2(gl_FragCoord.xy);
    ivec2 mirror = ivec2((uSize - texel.x) % uSize, (uSize - texel.y) % uSize);
    vec2 a = h0(texel);
    vec2 b = h0(mirror);
    gl_FragColor = vec4(a, cconj(b));
}
`;

// ---------------------------------------------------------------------------
// Pass 2: time evolution. Packs 8 real fields into 4 complex spectra (2 x RGBA32F):
//   out0 = ( Dx + i Dz ,  Dy + i dDx/dz )
//   out1 = ( dDy/dx + i dDy/dz ,  dDx/dx + i dDz/dz )
// ---------------------------------------------------------------------------
const EVOLVE_FS = /* glsl */`
${SIM_MATH_GLSL}
uniform sampler2D uSpectrum;
uniform int   uSize;
uniform float uLengthScale;
uniform float uDepth;
uniform float uGravity;
uniform float uTime;

void main(void) {
    ivec2 texel = ivec2(gl_FragCoord.xy);
    vec4 s = texelFetch(uSpectrum, texel, 0);
    int n = uSize;
    float deltaK = TWO_PI / uLengthScale;
    int nx = texel.x < n / 2 ? texel.x : texel.x - n;
    int nz = texel.y < n / 2 ? texel.y : texel.y - n;
    vec2 k = vec2(float(nx), float(nz)) * deltaK;
    float kLen = length(k);
    float invK = kLen > 1e-6 ? 1.0 / kLen : 0.0;
    float omega = dispersion(max(kLen, 1e-6), uGravity, uDepth);
    float phase = omega * uTime;
    vec2 e = vec2(cos(phase), sin(phase));
    vec2 h = cmul(s.xy, e) + cmul(s.zw, cconj(e));   // height spectrum h(k,t)
    vec2 ih = vec2(-h.y, h.x);                         // i*h

    // Horizontal displacement. Tessendorf writes D = sum -i (k/|k|) h e^{ikx} and then applies it
    // with a *negative* lambda; with the positive choppiness this simulation exposes, that sign
    // pushes surface points away from the crests and piles them into the troughs — sharp troughs,
    // broad crests, and whitecaps in the wrong place. So the sign is folded in here: +i (k/|k|) h,
    // which is the Gerstner convergence (points crowd the crest) for lambda > 0. The second
    // derivatives of D follow the same sign.
    vec2 Dx  = k.x * invK * ih;
    vec2 Dz  = k.y * invK * ih;
    vec2 Dy  = h;
    vec2 dyx = k.x * ih;
    vec2 dyz = k.y * ih;
    vec2 dxx = -k.x * k.x * invK * h;
    vec2 dzz = -k.y * k.y * invK * h;
    vec2 dxz = -k.x * k.y * invK * h;

    pcFragColor0 = vec4(Dx + vec2(-Dz.y, Dz.x),  Dy + vec2(-dxz.y, dxz.x));
    pcFragColor1 = vec4(dyx + vec2(-dyz.y, dyz.x), dxx + vec2(-dzz.y, dzz.x));
}
`;

// ---------------------------------------------------------------------------
// Pass 3: radix-2 Cooley-Tukey (decimation in time) inverse FFT, one stage per pass,
// horizontal then vertical. Bit-reversal permutation is folded into stage 0.
// Operates on two RGBA32F textures = four complex signals at once.
// ---------------------------------------------------------------------------
const FFT_FS = /* glsl */`
uniform sampler2D uIn0;
uniform sampler2D uIn1;
uniform int uSize;
uniform int uLog2Size;
uniform int uStage;       // 0 .. log2Size-1
uniform int uVertical;    // 0 = rows, 1 = columns

int bitReverse(int x) {
    int r = 0;
    for (int i = 0; i < uLog2Size; i++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
    }
    return r;
}

void main(void) {
    ivec2 texel = ivec2(gl_FragCoord.xy);
    int x = uVertical == 1 ? texel.y : texel.x;
    int hs = 1 << uStage;
    int len = hs << 1;
    int k = x & (len - 1);
    bool upper = k >= hs;
    int j = upper ? k - hs : k;
    int i0 = upper ? x - hs : x;
    int i1 = i0 + hs;
    if (uStage == 0) { i0 = bitReverse(i0); i1 = bitReverse(i1); }

    ivec2 t0 = uVertical == 1 ? ivec2(texel.x, i0) : ivec2(i0, texel.y);
    ivec2 t1 = uVertical == 1 ? ivec2(texel.x, i1) : ivec2(i1, texel.y);

    float ang = 6.28318530717959 * float(j) / float(len);   // inverse transform: +i
    vec2 w = vec2(cos(ang), sin(ang));

    vec4 a0 = texelFetch(uIn0, t0, 0);
    vec4 b0 = texelFetch(uIn0, t1, 0);
    vec4 a1 = texelFetch(uIn1, t0, 0);
    vec4 b1 = texelFetch(uIn1, t1, 0);

    // complex multiply each of the 4 complex numbers by w
    vec4 wb0 = vec4(b0.x * w.x - b0.y * w.y, b0.x * w.y + b0.y * w.x,
                    b0.z * w.x - b0.w * w.y, b0.z * w.y + b0.w * w.x);
    vec4 wb1 = vec4(b1.x * w.x - b1.y * w.y, b1.x * w.y + b1.y * w.x,
                    b1.z * w.x - b1.w * w.y, b1.z * w.y + b1.w * w.x);

    pcFragColor0 = upper ? a0 - wb0 : a0 + wb0;
    pcFragColor1 = upper ? a1 - wb1 : a1 + wb1;
}
`;

// ---------------------------------------------------------------------------
// Pass 4: assemble displacement / derivative maps + temporal foam (Jacobian).
//   displacement = (lambda*Dx, Dy, lambda*Dz, turbulence)
//   derivatives  = (dDy/dx, dDy/dz, dDx/dx, dDz/dz)
// ---------------------------------------------------------------------------
const ASSEMBLE_FS = /* glsl */`
uniform sampler2D uIn0;
uniform sampler2D uIn1;
uniform sampler2D uPrevDisplacement;
uniform float uLambda;
uniform float uDeltaTime;
uniform float uFoamDecay;   // recovery rate of the Jacobian (1/s)
uniform float uFoamReset;   // 1 = ignore history (first frame after a rebuild)

void main(void) {
    ivec2 texel = ivec2(gl_FragCoord.xy);
    vec4 a = texelFetch(uIn0, texel, 0);
    vec4 b = texelFetch(uIn1, texel, 0);
    float Dx = a.x, Dz = a.y, Dy = a.z, dxz = a.w;
    float dyx = b.x, dyz = b.y, dxx = b.z, dzz = b.w;

    float jacobian = (1.0 + uLambda * dxx) * (1.0 + uLambda * dzz) - uLambda * uLambda * dxz * dxz;
    float prev = texelFetch(uPrevDisplacement, texel, 0).w;
    float turb = min(jacobian, prev + uDeltaTime * uFoamDecay / max(jacobian, 0.5));
    if (uFoamReset > 0.5) turb = jacobian;

    pcFragColor0 = vec4(uLambda * Dx, Dy, uLambda * Dz, turb);
    pcFragColor1 = vec4(dyx, dyz, dxx, dzz);
}
`;

// WGSL compute kernels for the ocean spectrum / FFT simulation (WebGPU path).
// Same math and data layout as simCommon.glsl.js — see that file for the derivation.

const SIM_MATH_WGSL = /* wgsl */`
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

fn pcg3d(vIn: vec3u) -> vec3u {
    var v = vIn * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> vec3u(16u);
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
}
fn hash3(p: vec3u) -> vec3f {
    return vec3f(pcg3d(p)) * (1.0 / 4294967296.0);
}
fn gaussian2(texel: vec2u, seed: u32) -> vec2f {
    let r = hash3(vec3u(texel, seed));
    let u1 = max(r.x, 1e-7);
    let u2 = r.y;
    let mag = sqrt(-2.0 * log(u1));
    return vec2f(mag * cos(TWO_PI * u2), mag * sin(TWO_PI * u2));
}
fn dispersion(k: f32, g: f32, depth: f32) -> f32 {
    return sqrt(g * k * tanh(min(k * depth, 20.0)));
}
fn dispersionDerivative(k: f32, g: f32, depth: f32) -> f32 {
    let th = tanh(min(k * depth, 20.0));
    let ch = cosh(min(k * depth, 20.0));
    return g * (depth * k / (ch * ch) + th) / dispersion(k, g, depth) * 0.5;
}
fn normalisationFactor(s: f32) -> f32 {
    let s2 = s * s; let s3 = s2 * s; let s4 = s3 * s;
    if (s < 5.0) { return -0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * s + 0.163; }
    return -4.80e-08 * s4 + 1.07e-05 * s3 - 9.53e-04 * s2 + 5.90e-02 * s + 3.93e-01;
}
fn cosine2s(theta: f32, s: f32) -> f32 {
    return normalisationFactor(s) * pow(abs(cos(0.5 * theta)), 2.0 * s);
}
fn spreadPower(omega: f32, peakOmega: f32) -> f32 {
    if (omega > peakOmega) { return 9.77 * pow(abs(omega / peakOmega), -2.5); }
    return 6.97 * pow(abs(omega / peakOmega), 5.0);
}
fn directionSpectrum(theta: f32, omega: f32, p0: vec4f, p1: vec4f) -> f32 {
    let s = spreadPower(omega, p1.y) + 16.0 * tanh(min(omega / p1.y, 20.0)) * p0.w * p0.w;
    let c = cos(theta);
    return mix(2.0 / PI * c * c, cosine2s(theta - p0.y, s), p0.z);
}
fn tmaCorrection(omega: f32, g: f32, depth: f32) -> f32 {
    let omegaH = omega * sqrt(depth / g);
    if (omegaH <= 1.0) { return 0.5 * omegaH * omegaH; }
    if (omegaH < 2.0) { return 1.0 - 0.5 * (2.0 - omegaH) * (2.0 - omegaH); }
    return 1.0;
}
fn jonswap(omega: f32, g: f32, depth: f32, p0: vec4f, p1: vec4f) -> f32 {
    let peakOmega = p1.y;
    let sigma = select(0.09, 0.07, omega <= peakOmega);
    let d = (omega - peakOmega) / (sigma * peakOmega);
    let r = exp(-0.5 * d * d);
    let invOmega = 1.0 / omega;
    let pk = peakOmega * invOmega;
    return p0.x * tmaCorrection(omega, g, depth) * p1.x * g * g
         * invOmega * invOmega * invOmega * invOmega * invOmega
         * exp(-1.25 * pk * pk * pk * pk)
         * pow(abs(p1.z), r);
}
fn shortWavesFade(k: f32, p1: vec4f) -> f32 {
    return exp(-p1.w * p1.w * k * k);
}
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn cconj(a: vec2f) -> vec2f { return vec2f(a.x, -a.y); }
fn cmul4(b: vec4f, w: vec2f) -> vec4f {
    return vec4f(b.x * w.x - b.y * w.y, b.x * w.y + b.y * w.x,
                 b.z * w.x - b.w * w.y, b.z * w.y + b.w * w.x);
}
`;

function spectrumCS(N) {
    return /* wgsl */`
${SIM_MATH_WGSL}
uniform uLengthScale: f32;
uniform uCutoffLow: f32;
uniform uCutoffHigh: f32;
uniform uDepth: f32;
uniform uGravity: f32;
uniform uSeed: u32;
uniform uSpecA0: vec4f;
uniform uSpecA1: vec4f;
uniform uSpecB0: vec4f;
uniform uSpecB1: vec4f;
var uOut: texture_storage_2d<rgba32float, write>;

fn h0(texel: vec2i) -> vec2f {
    let n = ${N};
    let deltaK = TWO_PI / uniform.uLengthScale;
    let nx = select(texel.x - n, texel.x, texel.x < n / 2);
    let nz = select(texel.y - n, texel.y, texel.y < n / 2);
    let k = vec2f(f32(nx), f32(nz)) * deltaK;
    let kLen = length(k);
    if (kLen < uniform.uCutoffLow || kLen > uniform.uCutoffHigh || kLen < 1e-6) { return vec2f(0.0); }
    let kAngle = atan2(k.y, k.x);
    let omega = dispersion(kLen, uniform.uGravity, uniform.uDepth);
    let dOmegadk = dispersionDerivative(kLen, uniform.uGravity, uniform.uDepth);
    var spectrum = jonswap(omega, uniform.uGravity, uniform.uDepth, uniform.uSpecA0, uniform.uSpecA1)
                 * directionSpectrum(kAngle, omega, uniform.uSpecA0, uniform.uSpecA1)
                 * shortWavesFade(kLen, uniform.uSpecA1);
    if (uniform.uSpecB0.x > 0.0) {
        spectrum += jonswap(omega, uniform.uGravity, uniform.uDepth, uniform.uSpecB0, uniform.uSpecB1)
                  * directionSpectrum(kAngle, omega, uniform.uSpecB0, uniform.uSpecB1)
                  * shortWavesFade(kLen, uniform.uSpecB1);
    }
    let xi = gaussian2(vec2u(texel), uniform.uSeed);
    return xi * 0.5 * sqrt(spectrum * abs(dOmegadk) / kLen * deltaK * deltaK);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let n = ${N};
    let texel = vec2i(gid.xy);
    if (texel.x >= n || texel.y >= n) { return; }
    let mirror = vec2i((n - texel.x) % n, (n - texel.y) % n);
    let a = h0(texel);
    let b = h0(mirror);
    textureStore(uOut, texel, vec4f(a, cconj(b)));
}
`;
}

function evolveCS(N) {
    return /* wgsl */`
${SIM_MATH_WGSL}
uniform uLengthScale: f32;
uniform uDepth: f32;
uniform uGravity: f32;
uniform uTime: f32;
var uSpectrum: texture_2d<f32>;
var uOut0: texture_storage_2d<rgba32float, write>;
var uOut1: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let n = ${N};
    let texel = vec2i(gid.xy);
    if (texel.x >= n || texel.y >= n) { return; }
    let s = textureLoad(uSpectrum, texel, 0);
    let deltaK = TWO_PI / uniform.uLengthScale;
    let nx = select(texel.x - n, texel.x, texel.x < n / 2);
    let nz = select(texel.y - n, texel.y, texel.y < n / 2);
    let k = vec2f(f32(nx), f32(nz)) * deltaK;
    let kLen = length(k);
    let invK = select(0.0, 1.0 / kLen, kLen > 1e-6);
    let omega = dispersion(max(kLen, 1e-6), uniform.uGravity, uniform.uDepth);
    let phase = omega * uniform.uTime;
    let e = vec2f(cos(phase), sin(phase));
    let h = cmul(s.xy, e) + cmul(s.zw, cconj(e));
    let ih = vec2f(-h.y, h.x);

    // see the GLSL twin: +i (k/|k|) h so that positive choppiness crowds points onto the crests
    let Dx  = k.x * invK * ih;
    let Dz  = k.y * invK * ih;
    let Dy  = h;
    let dyx = k.x * ih;
    let dyz = k.y * ih;
    let dxx = -k.x * k.x * invK * h;
    let dzz = -k.y * k.y * invK * h;
    let dxz = -k.x * k.y * invK * h;

    textureStore(uOut0, texel, vec4f(Dx + vec2f(-Dz.y, Dz.x),  Dy + vec2f(-dxz.y, dxz.x)));
    textureStore(uOut1, texel, vec4f(dyx + vec2f(-dyz.y, dyz.x), dxx + vec2f(-dzz.y, dzz.x)));
}
`;
}

// One workgroup per row (or column); the entire 1D inverse FFT runs in workgroup memory.
// Each thread performs one butterfly per stage, so workgroup size = N/2.
function fftCS(N) {
    const log2N = Math.log2(N) | 0;
    const WG = N / 2;
    return /* wgsl */`
${SIM_MATH_WGSL}
uniform uVertical: u32;
var uIn0: texture_2d<f32>;
var uIn1: texture_2d<f32>;
var uOut0: texture_storage_2d<rgba32float, write>;
var uOut1: texture_storage_2d<rgba32float, write>;

var<workgroup> s0: array<vec4f, ${N}>;
var<workgroup> s1: array<vec4f, ${N}>;

fn bitReverse(xIn: u32) -> u32 {
    var x = xIn;
    var r = 0u;
    for (var i = 0u; i < ${log2N}u; i++) {
        r = (r << 1u) | (x & 1u);
        x >>= 1u;
    }
    return r;
}

fn coord(line: u32, i: u32) -> vec2i {
    if (uniform.uVertical == 1u) { return vec2i(i32(line), i32(i)); }
    return vec2i(i32(i), i32(line));
}

@compute @workgroup_size(${WG}, 1, 1)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let line = wid.x;
    let t = lid.x;

    // load with bit-reversal permutation
    for (var i = t; i < ${N}u; i += ${WG}u) {
        let src = bitReverse(i);
        s0[i] = textureLoad(uIn0, coord(line, src), 0);
        s1[i] = textureLoad(uIn1, coord(line, src), 0);
    }
    workgroupBarrier();

    for (var stage = 0u; stage < ${log2N}u; stage++) {
        let hs = 1u << stage;
        let len = hs << 1u;
        // butterfly index t -> element pair (i0, i1)
        let j = t & (hs - 1u);
        let i0 = ((t >> stage) << (stage + 1u)) + j;
        let i1 = i0 + hs;
        let ang = TWO_PI * f32(j) / f32(len);
        let w = vec2f(cos(ang), sin(ang));
        let a0 = s0[i0]; let b0 = cmul4(s0[i1], w);
        let a1 = s1[i0]; let b1 = cmul4(s1[i1], w);
        workgroupBarrier();
        s0[i0] = a0 + b0; s0[i1] = a0 - b0;
        s1[i0] = a1 + b1; s1[i1] = a1 - b1;
        workgroupBarrier();
    }

    for (var i = t; i < ${N}u; i += ${WG}u) {
        textureStore(uOut0, coord(line, i), s0[i]);
        textureStore(uOut1, coord(line, i), s1[i]);
    }
}
`;
}

function assembleCS(N) {
    return /* wgsl */`
uniform uLambda: f32;
uniform uDeltaTime: f32;
uniform uFoamDecay: f32;
uniform uFoamReset: f32;
var uIn0: texture_2d<f32>;
var uIn1: texture_2d<f32>;
var uPrevDisplacement: texture_2d<f32>;
var uDisplacement: texture_storage_2d<rgba16float, write>;
var uDerivatives: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let n = ${N};
    let texel = vec2i(gid.xy);
    if (texel.x >= n || texel.y >= n) { return; }
    let a = textureLoad(uIn0, texel, 0);
    let b = textureLoad(uIn1, texel, 0);
    let Dx = a.x; let Dz = a.y; let Dy = a.z; let dxz = a.w;
    let dyx = b.x; let dyz = b.y; let dxx = b.z; let dzz = b.w;
    let lambda = uniform.uLambda;
    let jacobian = (1.0 + lambda * dxx) * (1.0 + lambda * dzz) - lambda * lambda * dxz * dxz;
    let prev = textureLoad(uPrevDisplacement, texel, 0).w;
    var turb = min(jacobian, prev + uniform.uDeltaTime * uniform.uFoamDecay / max(jacobian, 0.5));
    if (uniform.uFoamReset > 0.5) { turb = jacobian; }
    textureStore(uDisplacement, texel, vec4f(lambda * Dx, Dy, lambda * Dz, turb));
    textureStore(uDerivatives, texel, vec4f(dyx, dyz, dxx, dzz));
}
`;
}

/**
 * Default simulation parameters. Two JONSWAP spectra are summed: a local wind sea and a
 * long-period swell. Spectra are described by physical quantities (wind speed in m/s,
 * fetch in metres) following Horvath 2015.
 */
const DEFAULT_WAVE_PARAMS = {
    size: 256,                     // FFT resolution per cascade (128 | 256 | 512)
    lengthScales: [1024, 256, 48, 8], // metres covered by each cascade (coarse -> fine)
    cascadeOverlap: 6,             // wavelength ratio used to split wave numbers between cascades
    depth: 500,                    // water depth (m) — TMA correction & dispersion
    gravity: 9.81,
    seed: 1337,
    choppiness: 1.4,               // horizontal displacement scale (lambda)
    foamDecay: 0.6,                // Jacobian recovery rate (1/s); lower = foam lingers longer
    timeScale: 1.0,
    wind: {
        scale: 1.0,
        windSpeed: 9.0,            // m/s
        windDirection: 35.0,       // degrees
        fetch: 120000,             // m
        spreadBlend: 0.9,
        swell: 0.25,
        peakEnhancement: 3.3,
        shortWavesFade: 0.015
    },
    swell: {
        scale: 0.6,
        windSpeed: 4.0,
        windDirection: -20,
        fetch: 500000,
        spreadBlend: 1.0,
        swell: 1.0,
        peakEnhancement: 3.3,
        shortWavesFade: 0.05
    }
};

function packSpectrum(s, g) {
    const alpha = 0.076 * Math.pow(s.windSpeed * s.windSpeed / (s.fetch * g), 0.22);
    const peakOmega = 22 * Math.pow(g * g / (s.windSpeed * s.fetch), 1 / 3);
    return {
        p0: [s.scale, s.windDirection * Math.PI / 180, s.spreadBlend, s.swell],
        p1: [alpha, peakOmega, s.peakEnhancement, s.shortWavesFade]
    };
}

function createTex(device, name, size, format, filter, address, storage, mipmaps = false) {
    return new Texture(device, {
        name, width: size, height: size, format,
        mipmaps,
        minFilter: mipmaps ? FILTER_LINEAR_MIPMAP_LINEAR : filter, magFilter: filter,
        anisotropy: mipmaps ? 16 : 1,   // the sea is seen at grazing angles: isotropic mips would blur it
        addressU: address, addressV: address,
        storage: !!storage
    });
}

/**
 * Cascaded FFT ocean simulation. Produces, per cascade, a displacement map
 * (x, y, z, turbulence) and a derivatives map (dy/dx, dy/dz, dx/dx, dz/dz) each frame.
 * Uses WebGPU compute when available, otherwise a WebGL2 MRT fragment pipeline.
 */
class WaveSimulation {
    constructor(device, params = {}) {
        this.device = device;
        this.params = structuredClone(DEFAULT_WAVE_PARAMS);
        Object.assign(this.params, params);
        this.useCompute = !!device.supportsCompute;
        this.time = 0;
        this.frame = 0;
        this.cascades = [];
        this._spectrumDirty = true;
        this._build();
    }

    get numCascades() { return this.cascades.length; }
    get size() { return this.params.size; }

    /** Current displacement textures (one per cascade). */
    get displacementTextures() { return this.cascades.map(c => c.sampled ? c.sampled.displacement : c.displacement[c.pingIndex]); }
    /** Derivative textures (one per cascade). */
    get derivativeTextures() { return this.cascades.map(c => c.sampled ? c.sampled.derivatives : c.derivatives); }
    /** Length scales (metres) per cascade. */
    get lengthScales() { return this.params.lengthScales; }

    /** Mark the initial spectrum for regeneration (call after changing wind/swell/depth/seed). */
    invalidateSpectrum() { this._spectrumDirty = true; }

    /** Change FFT size / cascade layout: rebuilds all GPU resources. */
    rebuild(newParams = {}) {
        Object.assign(this.params, newParams);
        this.destroy();
        this.frame = 0;
        this._build();
    }

    _build() {
        const { device, params } = this;
        const N = params.size;
        if ((N & (N - 1)) !== 0 || N < 16 || N > 1024) throw new Error('Water: FFT size must be a power of two in [16, 1024]');
        if (this.useCompute) {
            const maxWG = device.limits?.maxComputeWorkgroupSizeX ?? 256;
            const maxShared = device.limits?.maxComputeWorkgroupStorageSize ?? 16384;
            if (N / 2 > maxWG || N * 32 > maxShared) {
                console.warn(`Water: FFT size ${N} exceeds compute limits, using fragment path`);
                this.useCompute = false;
            }
        }
        this.log2N = Math.log2(N) | 0;
        this.cascades = params.lengthScales.map((L, i) => this._createCascade(i, L));
        this._spectrumDirty = true;
        if (this.useCompute) this._buildCompute(); else this._buildFragment();
    }

    _createCascade(index, lengthScale) {
        const { device, params } = this;
        const N = params.size;
        const storage = this.useCompute;
        const c = {
            index, lengthScale, pingIndex: 0,
            spectrum: createTex(device, `oceanSpectrum${index}`, N, PIXELFORMAT_RGBA32F, FILTER_NEAREST, ADDRESS_CLAMP_TO_EDGE, storage),
            pingA: [0, 1].map(j => createTex(device, `oceanPingA${index}_${j}`, N, PIXELFORMAT_RGBA32F, FILTER_NEAREST, ADDRESS_CLAMP_TO_EDGE, storage)),
            pingB: [0, 1].map(j => createTex(device, `oceanPingB${index}_${j}`, N, PIXELFORMAT_RGBA32F, FILTER_NEAREST, ADDRESS_CLAMP_TO_EDGE, storage)),
            // The outputs carry a mip chain: the surface mesh gets coarser with distance, so the vertex
            // shader reads the displacement at the mip that matches its local spacing, and the
            // fragment shader's slopes are filtered the same way. Without it the grid point-samples
            // waves shorter than its spacing, and the alias pattern moves whenever the camera does.
            displacement: [0, 1].map(j => createTex(device, `oceanDisplacement${index}_${j}`, N, PIXELFORMAT_RGBA16F, FILTER_LINEAR, ADDRESS_REPEAT, storage, !storage)),
            derivatives: createTex(device, `oceanDerivatives${index}`, N, PIXELFORMAT_RGBA16F, FILTER_LINEAR, ADDRESS_REPEAT, storage, !storage),
            // WebGPU storage textures are bound as a single level, so the compute path writes plain
            // textures and copies them into these mipmapped ones for sampling
            sampled: storage ? {
                displacement: createTex(device, `oceanDisplacementMip${index}`, N, PIXELFORMAT_RGBA16F, FILTER_LINEAR, ADDRESS_REPEAT, false, true),
                derivatives: createTex(device, `oceanDerivativesMip${index}`, N, PIXELFORMAT_RGBA16F, FILTER_LINEAR, ADDRESS_REPEAT, false, true)
            } : null
        };
        // wave-number band handled by this cascade
        const k = params.cascadeOverlap;
        const scales = params.lengthScales;
        c.cutoffLow = index === 0 ? 0.0001 : 2 * Math.PI / scales[index] * k;
        c.cutoffHigh = index === scales.length - 1 ? 1e6 : 2 * Math.PI / scales[index + 1] * k;
        return c;
    }

    // ------------------------------------------------------------------ WebGPU compute
    _buildCompute() {
        const { device, params } = this;
        const N = params.size;
        const mk = (name, src) => new Shader(device, {
            name, shaderLanguage: SHADERLANGUAGE_WGSL, cshader: src, computeEntryPoint: 'main'
        });
        this.csSpectrum = mk('oceanSpectrumCS', spectrumCS(N));
        this.csEvolve = mk('oceanEvolveCS', evolveCS(N));
        this.csFFT = mk('oceanFFTCS', fftCS(N));
        this.csAssemble = mk('oceanAssembleCS', assembleCS(N));
        const groups = Math.ceil(N / 8);

        for (const c of this.cascades) {
            c.spectrumCompute = new Compute(device, this.csSpectrum, `oceanSpectrum${c.index}`);
            c.spectrumCompute.setParameter('uOut', c.spectrum);
            c.spectrumCompute.setupDispatch(groups, groups, 1);

            c.evolveCompute = new Compute(device, this.csEvolve, `oceanEvolve${c.index}`);
            c.evolveCompute.setParameter('uSpectrum', c.spectrum);
            c.evolveCompute.setParameter('uOut0', c.pingA[0]);
            c.evolveCompute.setParameter('uOut1', c.pingA[1]);
            c.evolveCompute.setupDispatch(groups, groups, 1);

            c.fftH = new Compute(device, this.csFFT, `oceanFFTH${c.index}`);
            c.fftH.setParameter('uVertical', 0);
            c.fftH.setParameter('uIn0', c.pingA[0]);
            c.fftH.setParameter('uIn1', c.pingA[1]);
            c.fftH.setParameter('uOut0', c.pingB[0]);
            c.fftH.setParameter('uOut1', c.pingB[1]);
            c.fftH.setupDispatch(N, 1, 1);

            c.fftV = new Compute(device, this.csFFT, `oceanFFTV${c.index}`);
            c.fftV.setParameter('uVertical', 1);
            c.fftV.setParameter('uIn0', c.pingB[0]);
            c.fftV.setParameter('uIn1', c.pingB[1]);
            c.fftV.setParameter('uOut0', c.pingA[0]);
            c.fftV.setParameter('uOut1', c.pingA[1]);
            c.fftV.setupDispatch(N, 1, 1);

            c.assembleCompute = [0, 1].map((j) => {
                const cs = new Compute(device, this.csAssemble, `oceanAssemble${c.index}_${j}`);
                cs.setParameter('uIn0', c.pingA[0]);
                cs.setParameter('uIn1', c.pingA[1]);
                cs.setParameter('uPrevDisplacement', c.displacement[1 - j]);
                cs.setParameter('uDisplacement', c.displacement[j]);
                cs.setParameter('uDerivatives', c.derivatives);
                cs.setupDispatch(groups, groups, 1);
                return cs;
            });
        }
    }

    _updateSpectrumCompute() {
        const { params } = this;
        const a = packSpectrum(params.wind, params.gravity);
        const b = packSpectrum(params.swell, params.gravity);
        const computes = [];
        for (const c of this.cascades) {
            const cs = c.spectrumCompute;
            cs.setParameter('uLengthScale', c.lengthScale);
            cs.setParameter('uCutoffLow', c.cutoffLow);
            cs.setParameter('uCutoffHigh', c.cutoffHigh);
            cs.setParameter('uDepth', params.depth);
            cs.setParameter('uGravity', params.gravity);
            cs.setParameter('uSeed', params.seed >>> 0);
            cs.setParameter('uSpecA0', a.p0); cs.setParameter('uSpecA1', a.p1);
            cs.setParameter('uSpecB0', b.p0); cs.setParameter('uSpecB1', b.p1);
            computes.push(cs);
        }
        this.device.computeDispatch(computes, 'oceanSpectrum');
    }

    _stepCompute(dt) {
        const { params } = this;
        const computes = [];
        for (const c of this.cascades) {
            const e = c.evolveCompute;
            e.setParameter('uLengthScale', c.lengthScale);
            e.setParameter('uDepth', params.depth);
            e.setParameter('uGravity', params.gravity);
            e.setParameter('uTime', this.time);
            computes.push(e);
        }
        this.device.computeDispatch(computes, 'oceanEvolve');
        this.device.computeDispatch(this.cascades.map(c => c.fftH), 'oceanFFTH');
        this.device.computeDispatch(this.cascades.map(c => c.fftV), 'oceanFFTV');
        const assembles = [];
        for (const c of this.cascades) {
            c.pingIndex = 1 - c.pingIndex;
            const cs = c.assembleCompute[c.pingIndex];
            cs.setParameter('uLambda', params.choppiness);
            cs.setParameter('uDeltaTime', dt);
            cs.setParameter('uFoamDecay', params.foamDecay);
            cs.setParameter('uFoamReset', this.frame < 2 ? 1 : 0);
            assembles.push(cs);
        }
        this.device.computeDispatch(assembles, 'oceanAssemble');
        // copy the results into the mipmapped sampling textures and rebuild their chains
        const N = params.size;
        const encoder = this.device.getCommandEncoder();
        for (const c of this.cascades) {
            for (const [src, dst] of [[c.displacement[c.pingIndex], c.sampled.displacement], [c.derivatives, c.sampled.derivatives]]) {
                encoder.copyTextureToTexture({ texture: src.impl.gpuTexture }, { texture: dst.impl.gpuTexture }, { width: N, height: N, depthOrArrayLayers: 1 });
                this.device.mipmapRenderer.generate(dst.impl);
            }
        }
    }

    // ------------------------------------------------------------------ WebGL2 fragment
    _buildFragment() {
        const { device } = this;
        const attributes = { aPosition: SEMANTIC_POSITION };
        const mk = (name, fs, outputs) => ShaderUtils.createShader(device, {
            uniqueName: name, attributes, vertexGLSL: SIM_QUAD_VS, fragmentGLSL: fs,
            fragmentOutputTypes: outputs
        });
        this.fsSpectrum = mk('oceanSpectrumFS', SPECTRUM_FS, ['vec4']);
        this.fsEvolve = mk('oceanEvolveFS', EVOLVE_FS, ['vec4', 'vec4']);
        this.fsFFT = mk('oceanFFTFS', FFT_FS, ['vec4', 'vec4']);
        this.fsAssemble = mk('oceanAssembleFS', ASSEMBLE_FS, ['vec4', 'vec4']);

        const mkPass = (shader, rt) => {
            const pass = new RenderPassShaderQuad(device);
            pass.shader = shader;
            pass.init(rt);
            return pass;
        };

        for (const c of this.cascades) {
            c.rtSpectrum = new RenderTarget({ name: `oceanSpectrumRT${c.index}`, colorBuffer: c.spectrum, depth: false });
            c.rtA = new RenderTarget({ name: `oceanPingART${c.index}`, colorBuffers: c.pingA, depth: false });
            c.rtB = new RenderTarget({ name: `oceanPingBRT${c.index}`, colorBuffers: c.pingB, depth: false });
            c.rtOut = [0, 1].map(j => new RenderTarget({
                name: `oceanOutRT${c.index}_${j}`, colorBuffers: [c.displacement[j], c.derivatives], depth: false,
                mipmaps: true   // the engine regenerates the chain when the pass ends
            }));
            c.spectrumPass = mkPass(this.fsSpectrum, c.rtSpectrum);
            c.evolvePass = mkPass(this.fsEvolve, c.rtA);
            c.fftPassA = mkPass(this.fsFFT, c.rtA);   // writes A (reads B)
            c.fftPassB = mkPass(this.fsFFT, c.rtB);   // writes B (reads A)
            c.assemblePass = c.rtOut.map(rt => mkPass(this.fsAssemble, rt));
        }
    }

    _updateSpectrumFragment() {
        const { device, params } = this;
        const scope = device.scope;
        const a = packSpectrum(params.wind, params.gravity);
        const b = packSpectrum(params.swell, params.gravity);
        scope.resolve('uSize').setValue(params.size);
        scope.resolve('uDepth').setValue(params.depth);
        scope.resolve('uGravity').setValue(params.gravity);
        scope.resolve('uSeed').setValue(params.seed | 0);
        scope.resolve('uSpecA0').setValue(a.p0); scope.resolve('uSpecA1').setValue(a.p1);
        scope.resolve('uSpecB0').setValue(b.p0); scope.resolve('uSpecB1').setValue(b.p1);
        for (const c of this.cascades) {
            scope.resolve('uLengthScale').setValue(c.lengthScale);
            scope.resolve('uCutoffLow').setValue(c.cutoffLow);
            scope.resolve('uCutoffHigh').setValue(c.cutoffHigh);
            c.spectrumPass.render();
        }
    }

    _stepFragment(dt) {
        const { device, params } = this;
        const scope = device.scope;
        const uIn0 = scope.resolve('uIn0'), uIn1 = scope.resolve('uIn1');
        const uStage = scope.resolve('uStage'), uVertical = scope.resolve('uVertical');
        scope.resolve('uSize').setValue(params.size);
        scope.resolve('uLog2Size').setValue(this.log2N);
        scope.resolve('uDepth').setValue(params.depth);
        scope.resolve('uGravity').setValue(params.gravity);
        scope.resolve('uTime').setValue(this.time);
        scope.resolve('uLambda').setValue(params.choppiness);
        scope.resolve('uDeltaTime').setValue(dt);
        scope.resolve('uFoamDecay').setValue(params.foamDecay);
        scope.resolve('uFoamReset').setValue(this.frame < 2 ? 1 : 0);

        for (const c of this.cascades) {
            scope.resolve('uLengthScale').setValue(c.lengthScale);
            scope.resolve('uSpectrum').setValue(c.spectrum);
            c.evolvePass.render();   // -> A

            let inA = true;
            for (let dir = 0; dir < 2; dir++) {
                uVertical.setValue(dir);
                for (let s = 0; s < this.log2N; s++) {
                    uStage.setValue(s);
                    const src = inA ? c.pingA : c.pingB;
                    uIn0.setValue(src[0]); uIn1.setValue(src[1]);
                    (inA ? c.fftPassB : c.fftPassA).render();
                    inA = !inA;
                }
            }
            // ensure the result is in A (even number of stages keeps it there; handle odd)
            const src = inA ? c.pingA : c.pingB;
            uIn0.setValue(src[0]); uIn1.setValue(src[1]);
            c.pingIndex = 1 - c.pingIndex;
            scope.resolve('uPrevDisplacement').setValue(c.displacement[1 - c.pingIndex]);
            c.assemblePass[c.pingIndex].render();
        }
    }

    /**
     * Advance the simulation. Call once per frame before rendering.
     * @param {number} dt - frame delta time in seconds
     */
    update(dt) {
        dt = Math.min(dt, 1 / 15) * this.params.timeScale;
        this.time += dt;
        if (this._spectrumDirty) {
            this._spectrumDirty = false;
            if (this.useCompute) this._updateSpectrumCompute(); else this._updateSpectrumFragment();
        }
        if (this.useCompute) this._stepCompute(dt); else this._stepFragment(dt);
        this.frame++;
    }

    destroy() {
        for (const c of this.cascades) {
            [c.spectrum, ...c.pingA, ...c.pingB, ...c.displacement, c.derivatives, c.sampled?.displacement, c.sampled?.derivatives].forEach(t => t?.destroy());
            [c.rtSpectrum, c.rtA, c.rtB, ...(c.rtOut || [])].forEach(rt => rt?.destroy());
            [c.spectrumPass, c.evolvePass, c.fftPassA, c.fftPassB, ...(c.assemblePass || [])].forEach(p => p?.quadRender?.destroy());
            [c.spectrumCompute, c.evolveCompute, c.fftH, c.fftV, ...(c.assembleCompute || [])].forEach(cs => cs?.destroy());
        }
        this.cascades = [];
        [this.csSpectrum, this.csEvolve, this.csFFT, this.csAssemble].forEach(sh => sh?.destroy());
        this.csSpectrum = this.csEvolve = this.csFFT = this.csAssemble = null;
    }
}

/**
 * Camera-centred polar grid. Vertex density falls off geometrically with radius which gives a
 * near-constant screen-space triangle size for a surface viewed from above, without the
 * T-junction cracks of a clipmap. The mesh is translated (never rotated) to follow the camera
 * each frame; the wave field is sampled in world space so the tessellation just slides under it.
 *
 * @param {import('playcanvas').GraphicsDevice} device
 * @param {object} [opts]
 * @param {number} [opts.sectors=256]   angular subdivisions
 * @param {number} [opts.rings=320]     radial subdivisions
 * @param {number} [opts.innerRadius=0.5] radius of the first ring (m)
 * @param {number} [opts.outerRadius=20000] radius of the last ring (m)
 * @param {number} [opts.maxWaveHeight=30] used for the bounding box only
 */
function createWaterMesh(device, opts = {}) {
    const sectors = opts.sectors ?? 256;
    const rings = opts.rings ?? 320;
    const r0 = opts.innerRadius ?? 0.5;
    const r1 = opts.outerRadius ?? 20000;
    const growth = Math.pow(r1 / r0, 1 / (rings - 1));

    const positions = [];
    const indices = [];

    // centre vertex + fan
    positions.push(0, 0, 0);
    for (let j = 0; j < rings; j++) {
        const r = r0 * Math.pow(growth, j);
        for (let i = 0; i < sectors; i++) {
            const a = (i / sectors) * Math.PI * 2;
            positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
        }
    }
    const ringBase = j => 1 + j * sectors;
    for (let i = 0; i < sectors; i++) {
        const i2 = (i + 1) % sectors;
        indices.push(0, ringBase(0) + i2, ringBase(0) + i);
    }
    for (let j = 0; j < rings - 1; j++) {
        const a = ringBase(j), b = ringBase(j + 1);
        for (let i = 0; i < sectors; i++) {
            const i2 = (i + 1) % sectors;
            // alternate the diagonal for a more isotropic triangulation
            if ((i + j) & 1) {
                indices.push(a + i, b + i2, b + i, a + i, a + i2, b + i2);
            } else {
                indices.push(a + i, a + i2, b + i, a + i2, b + i2, b + i);
            }
        }
    }

    const mesh = new Mesh(device);
    mesh.setPositions(positions);
    mesh.setIndices(indices);
    mesh.update();
    const h = opts.maxWaveHeight ?? 30;
    mesh.aabb = new BoundingBox(new Vec3(0, 0, 0), new Vec3(r1, h, r1));
    return mesh;
}

// Wave probe (GLSL). Evaluates the same cascaded displacement the surface vertex shader uses, for
// a grid of world-space XZ queries, and inverts the horizontal (choppy) displacement so the result
// is the surface point that actually ends up above the query position.
//
// Input  uQuery  : RGBA32F, (worldX, worldZ, active, unused) per texel
// Output          : RGBA32F, (surfaceY, slopeX, slopeZ, active) per texel
//
// Both the query fetch and the output use gl_FragCoord, which indexes the same memory row on WebGL
// and WebGPU, so a readback of the result lines up with the uploaded query buffer on both.

const PROBE_VS = /* glsl */`
attribute vec2 aPosition;
void main(void) {
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const PROBE_FS = /* glsl */`
uniform sampler2D uQuery;
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform sampler2D uDisp3;
uniform sampler2D uDeriv0;
uniform sampler2D uDeriv1;
uniform sampler2D uDeriv2;
uniform sampler2D uDeriv3;
uniform vec4  uCascadeInv[4];   // w = 1 / lengthScale
uniform int   uNumCascades;
uniform float uLambda;
uniform float uDisplacementScale;
uniform float uSeaLevel;

vec3 sampleDisp(vec2 p) {
    vec3 d = textureLod(uDisp0, p * uCascadeInv[0].w, 0.0).xyz;
    if (uNumCascades > 1) d += textureLod(uDisp1, p * uCascadeInv[1].w, 0.0).xyz;
    if (uNumCascades > 2) d += textureLod(uDisp2, p * uCascadeInv[2].w, 0.0).xyz;
    if (uNumCascades > 3) d += textureLod(uDisp3, p * uCascadeInv[3].w, 0.0).xyz;
    return d * uDisplacementScale;
}

vec4 sampleDeriv(vec2 p) {
    vec4 d = textureLod(uDeriv0, p * uCascadeInv[0].w, 0.0);
    if (uNumCascades > 1) d += textureLod(uDeriv1, p * uCascadeInv[1].w, 0.0);
    if (uNumCascades > 2) d += textureLod(uDeriv2, p * uCascadeInv[2].w, 0.0);
    if (uNumCascades > 3) d += textureLod(uDeriv3, p * uCascadeInv[3].w, 0.0);
    return d * uDisplacementScale;
}

void main(void) {
    ivec2 texel = ivec2(gl_FragCoord.xy);
    vec4 q = texelFetch(uQuery, texel, 0);
    if (q.z < 0.5) { gl_FragColor = vec4(uSeaLevel, 0.0, 0.0, 0.0); return; }

    vec2 target = q.xy;
    vec2 p = target;
    for (int i = 0; i < 4; i++) {
        p = target - sampleDisp(p).xz;
    }
    vec3 d = sampleDisp(p);
    vec4 der = sampleDeriv(p);
    vec2 slope = vec2(der.x / (1.0 + uLambda * der.z), der.y / (1.0 + uLambda * der.w));
    gl_FragColor = vec4(uSeaLevel + d.y, slope.x, slope.y, 1.0);
}
`;

// Wave probe — native WGSL for WebGPU. Mirrors waveProbe.glsl.js.

const PROBE_VS_WGSL = /* wgsl */`
attribute aPosition: vec2f;

@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4f(input.aPosition, 0.0, 1.0);
    return output;
}
`;

const PROBE_FS_WGSL = /* wgsl */`
var uQuery: texture_2d<f32>;
var uDisp0: texture_2d<f32>;
var uDisp0Sampler: sampler;
var uDisp1: texture_2d<f32>;
var uDisp1Sampler: sampler;
var uDisp2: texture_2d<f32>;
var uDisp2Sampler: sampler;
var uDisp3: texture_2d<f32>;
var uDisp3Sampler: sampler;
var uDeriv0: texture_2d<f32>;
var uDeriv0Sampler: sampler;
var uDeriv1: texture_2d<f32>;
var uDeriv1Sampler: sampler;
var uDeriv2: texture_2d<f32>;
var uDeriv2Sampler: sampler;
var uDeriv3: texture_2d<f32>;
var uDeriv3Sampler: sampler;
uniform uCascadeInv: array<vec4f, 4>;
uniform uNumCascades: i32;
uniform uLambda: f32;
uniform uDisplacementScale: f32;
uniform uSeaLevel: f32;

fn sampleDisp(p: vec2f) -> vec3f {
    var d = textureSampleLevel(uDisp0, uDisp0Sampler, p * uniform.uCascadeInv[0].w, 0.0).xyz;
    if (uniform.uNumCascades > 1) { d += textureSampleLevel(uDisp1, uDisp1Sampler, p * uniform.uCascadeInv[1].w, 0.0).xyz; }
    if (uniform.uNumCascades > 2) { d += textureSampleLevel(uDisp2, uDisp2Sampler, p * uniform.uCascadeInv[2].w, 0.0).xyz; }
    if (uniform.uNumCascades > 3) { d += textureSampleLevel(uDisp3, uDisp3Sampler, p * uniform.uCascadeInv[3].w, 0.0).xyz; }
    return d * uniform.uDisplacementScale;
}

fn sampleDeriv(p: vec2f) -> vec4f {
    var d = textureSampleLevel(uDeriv0, uDeriv0Sampler, p * uniform.uCascadeInv[0].w, 0.0);
    if (uniform.uNumCascades > 1) { d += textureSampleLevel(uDeriv1, uDeriv1Sampler, p * uniform.uCascadeInv[1].w, 0.0); }
    if (uniform.uNumCascades > 2) { d += textureSampleLevel(uDeriv2, uDeriv2Sampler, p * uniform.uCascadeInv[2].w, 0.0); }
    if (uniform.uNumCascades > 3) { d += textureSampleLevel(uDeriv3, uDeriv3Sampler, p * uniform.uCascadeInv[3].w, 0.0); }
    return d * uniform.uDisplacementScale;
}

@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let texel = vec2i(pcPosition.xy);
    let q = textureLoad(uQuery, texel, 0);
    if (q.z < 0.5) {
        output.color = vec4f(uniform.uSeaLevel, 0.0, 0.0, 0.0);
        return output;
    }

    let queryXZ = q.xy;
    var p = queryXZ;
    for (var i = 0; i < 4; i++) {
        p = queryXZ - sampleDisp(p).xz;
    }
    let d = sampleDisp(p);
    let der = sampleDeriv(p);
    let slope = vec2f(der.x / (1.0 + uniform.uLambda * der.z), der.y / (1.0 + uniform.uLambda * der.w));
    output.color = vec4f(uniform.uSeaLevel + d.y, slope.x, slope.y, 1.0);
    return output;
}
`;

const GRID = 16;                 // 16 x 16 = 256 simultaneous query points
const SLOTS = GRID * GRID;
const READ_INTERVAL = 3;          // frames between readbacks

/**
 * CPU-side queries of the GPU wave field, for buoyancy and submersion tests.
 *
 * Each query point registered by {@link WaveProbe#sample} occupies one texel of a small query
 * texture. A quad pass evaluates the same cascaded displacement the vertex shader uses — including
 * the inverse of the horizontal (choppy) displacement, solved by fixed-point iteration — and the
 * result is read back asynchronously. Callers therefore get a value that is one or two frames old,
 * which is invisible for floating objects and not suitable for exact collision.
 *
 * Points are keyed on their XZ position, so asking about the same point every frame reuses its slot
 * and costs nothing; slots not asked about for a while are recycled.
 */
class WaveProbe {
    /** @param {import('./Water.js').Water} water - The water instance to sample. */
    constructor(water) {
        this.water = water;
        this.device = water._device;

        this.queryData = new Float32Array(SLOTS * 4);
        this.resultData = new Float32Array(SLOTS * 4);
        /** @type {Map<string, {slot: number, lastUsed: number, result: {position: Vec3, normal: Vec3}}>} */
        this.entries = new Map();
        this.slotOwner = new Array(SLOTS).fill(null);
        this.nextSlot = 0;
        this.frame = 0;
        this.pending = false;
        this.lastRead = -99;
        this._generation = 0;
        this._destroyed = false;
        this._zero = { position: new Vec3(), normal: new Vec3(0, 1, 0) };

        this._build();
    }

    _build() {
        const device = this.device;
        this.queryTex = new Texture(device, {
            name: 'waveProbeQuery', width: GRID, height: GRID, format: PIXELFORMAT_RGBA32F,
            mipmaps: false, minFilter: FILTER_NEAREST, magFilter: FILTER_NEAREST,
            addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE
        });
        this.queryTex.lock().set(this.queryData);
        this.queryTex.unlock();

        this.resultTex = new Texture(device, {
            name: 'waveProbeResult', width: GRID, height: GRID, format: PIXELFORMAT_RGBA32F,
            mipmaps: false, minFilter: FILTER_NEAREST, magFilter: FILTER_NEAREST,
            addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE
        });
        this.rt = new RenderTarget({ name: 'waveProbeRT', colorBuffer: this.resultTex, depth: false });

        const shader = ShaderUtils.createShader(device, {
            uniqueName: 'waveProbe',
            attributes: { aPosition: SEMANTIC_POSITION },
            vertexGLSL: PROBE_VS, fragmentGLSL: PROBE_FS,
            vertexWGSL: PROBE_VS_WGSL, fragmentWGSL: PROBE_FS_WGSL,
            fragmentOutputTypes: ['vec4']
        });
        this.pass = new RenderPassShaderQuad(device);
        this.pass.shader = shader;
        this.pass.init(this.rt);
        this._cascadeData = new Float32Array(16);
    }

    /** Rebuild after the simulation's cascade layout changed. */
    rebuild() {
        // In-flight results describe the previous configuration; never publish them over the reset.
        this._generation++;
        this.resultData.fill(0);
        for (const entry of this.entries.values()) {
            entry.result.position.y = this.water.seaLevel;
            entry.result.normal.set(0, 1, 0);
        }
        this.lastRead = -99;
    }

    /**
     * Surface point and normal at a world XZ position.
     *
     * @param {number} x - World X.
     * @param {number} z - World Z.
     * @returns {{position: Vec3, normal: Vec3}} A per-query object, updated in place each frame.
     */
    sample(x, z) {
        // quantise the key so a slowly drifting query keeps its slot
        const key = `${Math.round(x * 4)}:${Math.round(z * 4)}`;
        let e = this.entries.get(key);
        if (!e) {
            const slot = this._acquireSlot(key);
            if (slot < 0) {
                this._zero.position.set(x, this.water.config.seaLevel, z);
                return this._zero;
            }
            e = { slot, lastUsed: this.frame, result: { position: new Vec3(x, this.water.config.seaLevel, z), normal: new Vec3(0, 1, 0) } };
            this.entries.set(key, e);
        }
        e.lastUsed = this.frame;
        e.result.position.x = x;
        e.result.position.z = z;
        this.queryData[e.slot * 4 + 0] = x;
        this.queryData[e.slot * 4 + 1] = z;
        this.queryData[e.slot * 4 + 2] = 1;
        return e.result;
    }

    _acquireSlot(key) {
        for (let i = 0; i < SLOTS; i++) {
            const s = (this.nextSlot + i) % SLOTS;
            const owner = this.slotOwner[s];
            if (owner === null) { this.slotOwner[s] = key; this.nextSlot = s + 1; return s; }
            const e = this.entries.get(owner);
            if (!e || this.frame - e.lastUsed > 30) {
                if (e) this.entries.delete(owner);
                this.slotOwner[s] = key;
                this.nextSlot = s + 1;
                return s;
            }
        }
        return -1;
    }

    /** Run one probe pass and pick up the previous readback. Called by {@link Water#update}. */
    update() {
        this.frame++;
        if (this.entries.size === 0) return;

        const water = this.water;
        const sim = water._simulation;
        const cfg = water.config;
        const scope = this.device.scope;

        this.queryTex.lock().set(this.queryData);
        this.queryTex.unlock();

        const disp = sim.displacementTextures;
        const deriv = sim.derivativeTextures;
        const scales = sim.lengthScales;
        const n = disp.length;
        for (let i = 0; i < 4; i++) {
            const j = Math.min(i, n - 1);
            scope.resolve(`uDisp${i}`).setValue(disp[j]);
            scope.resolve(`uDeriv${i}`).setValue(deriv[j]);
            this._cascadeData[i * 4 + 3] = 1 / scales[j];
        }
        scope.resolve('uCascadeInv').setValue(this._cascadeData);
        scope.resolve('uCascadeInv[0]').setValue(this._cascadeData);
        scope.resolve('uQuery').setValue(this.queryTex);
        scope.resolve('uNumCascades').setValue(n);
        scope.resolve('uLambda').setValue(cfg.waves.choppiness);
        scope.resolve('uDisplacementScale').setValue(cfg.waves.amplitude);
        scope.resolve('uSeaLevel').setValue(cfg.seaLevel);
        this.pass.render();

        // One readback in flight at a time, and no more than every READ_INTERVAL frames: the staging
        // buffer a read maps is recycled by the device, and issuing them back to back trips its
        // validation. 20 Hz is far more than a floating object needs.
        if (!this.pending && this.frame - this.lastRead >= READ_INTERVAL) {
            this.pending = true;
            this.lastRead = this.frame;
            const generation = this._generation;
            const owners = Array.from(this.entries.entries());
            this.resultTex.read(0, 0, GRID, GRID, { renderTarget: this.rt, data: this.resultData, frequent: true })
                .then(() => {
                    this.pending = false;
                    if (!this._destroyed && generation === this._generation) this._publish(owners);
                })
                .catch(() => { this.pending = false; });
        }
    }

    _publish(owners) {
        const d = this.resultData;
        for (const [key, e] of owners) {
            if (this.entries.get(key) !== e) continue; // a slot was recycled during the GPU read
            const i = e.slot * 4;
            e.result.position.y = d[i + 0];
            e.result.normal.set(-d[i + 1], 1, -d[i + 2]).normalize();
        }
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._generation++;
        this.pass?.quadRender?.destroy();
        this.rt?.destroy();
        this.queryTex?.destroy();
        this.resultTex?.destroy();
        this.entries.clear();
    }
}

// Whitewater is not noise — it is bubbles. What reads as foam is a field of round cells packed at
// several sizes, torn into filaments at the edges. A value-noise fbm gives none of that structure,
// so this bakes a tiling cellular texture once at start-up instead of pulling in an image.
//
//   r  coarse bubble clusters, the shape the eye reads first
//   g  fine bubbles, the texture inside a clump
//   b  large-scale breakup, so a foam sheet is never uniform
//   a  a soft dilation of r, used to tint the water around a patch of foam

/** Deterministic 2D hash on a wrapped integer lattice. */
function hash2(ix, iy, period, seed) {
    let x = ((ix % period) + period) % period;
    let y = ((iy % period) + period) % period;
    let h = x * 374761393 + y * 668265263 + seed * 1442695041;
    h = (h ^ (h >> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    const a = ((h ^ (h >> 16)) >>> 0) / 4294967296;
    h = Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0;
    const b = ((h ^ (h >> 15)) >>> 0) / 4294967296;
    return [a, b];
}

/**
 * Tiling cellular (Worley) field: distance to the nearest jittered feature point, normalised so 0 is
 * a cell centre and 1 is a cell boundary. Wraps exactly at `cells`.
 */
function worley(u, v, cells, seed) {
    const x = u * cells;
    const y = v * cells;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let best = 1e9;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const [jx, jy] = hash2(ix + dx, iy + dy, cells, seed);
            const px = ix + dx + jx;
            const py = iy + dy + jy;
            const d = (x - px) * (x - px) + (y - py) * (y - py);
            if (d < best) best = d;
        }
    }
    return Math.min(Math.sqrt(best), 1);
}

/** Sum of tiling cellular octaves, each an inverted distance field so cells read as bubbles. */
function bubbles(u, v, baseCells, octaves, seed) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let cells = baseCells;
    for (let o = 0; o < octaves; o++) {
        sum += amp * (1 - worley(u, v, cells, seed + o * 71));
        norm += amp;
        amp *= 0.5;
        cells *= 2;
    }
    return sum / norm;
}

/**
 * Build the foam texture. Runs once, on the CPU, at start-up.
 *
 * @param {import('playcanvas').GraphicsDevice} device - The graphics device.
 * @param {number} [size] - Edge length in texels; must be a power of two.
 * @returns {Texture} A tiling, mipmapped RGBA texture.
 */
function createFoamTexture(device, size = 512) {
    const data = new Uint8Array(size * size * 4);
    const inv = 1 / size;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * inv;
            const v = (y + 0.5) * inv;

            // coarse clumps: contrast-stretched so the field is mostly empty with dense islands
            let coarse = bubbles(u, v, 6, 3, 17);
            coarse = Math.min(1, Math.max(0, (coarse - 0.34) * 2.1));
            coarse = coarse * coarse * (3 - 2 * coarse);

            // fine bubbles inside a clump
            const fine = Math.min(1, Math.max(0, (bubbles(u, v, 22, 2, 53) - 0.3) * 1.8));

            // slow breakup, so a sheet of foam has holes and streaks in it
            const broad = 0.5 + 0.5 * Math.sin((1 - worley(u, v, 3, 91)) * 5.2 + u * 6.283) *
                Math.cos(v * 6.283 * 2 + (1 - worley(u, v, 4, 29)) * 4.0);

            // a soft halo around the clumps, for tinting the water a patch of foam sits in
            const halo = Math.min(1, Math.max(0, (bubbles(u, v, 5, 2, 17) - 0.18) * 1.5));

            const i = (y * size + x) * 4;
            data[i] = coarse * 255;
            data[i + 1] = fine * 255;
            data[i + 2] = broad * 255;
            data[i + 3] = halo * 255;
        }
    }

    const tex = new Texture(device, {
        name: 'waterFoam', width: size, height: size, format: PIXELFORMAT_RGBA8,
        mipmaps: true, minFilter: FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR,
        addressU: ADDRESS_REPEAT, addressV: ADDRESS_REPEAT, anisotropy: 2,
        levels: [data]
    });
    return tex;
}

/**
 * @typedef {object} ShoreMap
 * @property {Texture} texture - RGBA map of the coast, see {@link bakeShoreMap}.
 * @property {number[]} origin - World XZ of the map's lower corner.
 * @property {number[]} size - World XZ extent the map covers, in metres.
 * @property {number} maxDepth - Depth in metres that R = 1 represents.
 * @property {number} seaLevel - World Y used when baking. Re-bake after changing the water level.
 * @property {() => void} destroy - Dispose the caller-owned texture after detaching the map.
 */

/**
 * Bake the coast into a texture the water shader can read anywhere on the surface.
 *
 * Open-ocean waves know nothing about the land they are running into. What makes a coast read as a
 * coast is everything that happens in the last few metres of depth: the swell shortens and steepens,
 * crests turn until they run parallel to the shore, they break, and the foam left behind washes up
 * and drains back. All of that is driven by one quantity — how deep the water is — which the surface
 * shader has no way to know from the wave simulation alone.
 *
 * So it is baked once, from whatever function describes the sea bed:
 *
 *   r  water depth, normalised against `maxDepth`; 0 is dry land
 *   gb the offshore direction (the normalised gradient of depth), packed into 0..1
 *   a  a smooth land mask, 1 in open water and 0 above the waterline
 *
 * Depth doubles as the phase variable for the shore waves. Lines of constant depth follow the
 * coastline, so a wave whose phase is a function of depth is automatically parallel to the shore and
 * wraps around headlands and sandbars without any extra work — which is the effect wave refraction
 * has in the real world, arrived at from the other end.
 *
 * @param {import('playcanvas').GraphicsDevice} device - The graphics device.
 * @param {object} options - Bake settings.
 * @param {number[]} options.origin - World XZ of the lower corner of the area to cover.
 * @param {number[]} options.size - World XZ extent to cover, in metres.
 * @param {(x: number, z: number) => number} options.heightAt - Sea-bed height at a world position.
 * @param {number} [options.seaLevel] - World Y of the undisturbed surface.
 * @param {number} [options.maxDepth] - Depth that saturates the depth channel. Only the shallows
 * matter, so keep this small — 40 m spends the whole channel on the surf zone.
 * @param {number} [options.resolution] - Texels per side.
 * @returns {ShoreMap} The baked map and the transform that places it in the world.
 */
function bakeShoreMap(device, options) {
    if (!options || typeof options !== 'object') throw new TypeError('Water: shore bake options are required');
    const {
        origin, size, heightAt,
        seaLevel = 0, maxDepth = 40, resolution = 512
    } = options;

    validatePair(origin, 'origin', false);
    validatePair(size, 'size', true);
    if (typeof heightAt !== 'function') throw new TypeError('Water: shore heightAt must be a function');
    if (!Number.isFinite(seaLevel)) throw new TypeError('Water: shore seaLevel must be finite');
    if (!Number.isFinite(maxDepth) || maxDepth <= 0) throw new RangeError('Water: shore maxDepth must be positive');
    if (!Number.isInteger(resolution) || resolution < 2 || resolution > (device.maxTextureSize || 16384)) {
        throw new RangeError('Water: shore resolution must be an integer from 2 to the device texture limit');
    }

    const n = resolution;
    const depth = new Float32Array(n * n);
    const stepX = size[0] / (n - 1);
    const stepZ = size[1] / (n - 1);

    for (let j = 0; j < n; j++) {
        const z = origin[1] + j * stepZ;
        for (let i = 0; i < n; i++) {
            const x = origin[0] + i * stepX;
            const height = heightAt(x, z);
            if (!Number.isFinite(height)) throw new TypeError(`Water: shore heightAt returned a non-finite height at (${x}, ${z})`);
            depth[j * n + i] = Math.max(seaLevel - height, 0);
        }
    }

    const data = new Uint8Array(n * n * 4);
    const at = (i, j) => depth[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];

    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const d = depth[j * n + i];

            // central differences give the direction the sea bed falls away in
            let gx = (at(i + 1, j) - at(i - 1, j)) / (2 * stepX);
            let gz = (at(i, j + 1) - at(i, j - 1)) / (2 * stepZ);
            const len = Math.hypot(gx, gz);
            if (len > 1e-6) { gx /= len; gz /= len; } else { gx = 0; gz = 0; }

            const k = (j * n + i) * 4;
            data[k] = Math.min(1, d / maxDepth) * 255;
            data[k + 1] = (gx * 0.5 + 0.5) * 255;
            data[k + 2] = (gz * 0.5 + 0.5) * 255;
            // a metre of water is already sea; the mask only needs to cut the dry land out
            data[k + 3] = Math.min(1, d / 0.6) * 255;
        }
    }

    const texture = new Texture(device, {
        name: 'waterShoreMap', width: n, height: n, format: PIXELFORMAT_RGBA8,
        mipmaps: false, minFilter: FILTER_LINEAR, magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE,
        levels: [data]
    });
    let destroyed = false;
    return Object.freeze({
        texture, origin: Object.freeze(origin.slice()), size: Object.freeze(size.slice()), maxDepth, seaLevel,
        get destroyed() { return destroyed; },
        destroy() { if (!destroyed) { destroyed = true; texture.destroy(); } }
    });
}

function validatePair(value, label, positive) {
    if (!Array.isArray(value) || value.length !== 2 ||
        !value.every(n => Number.isFinite(n) && (!positive || n > 0))) {
        throw new TypeError(`Water: shore ${label} must contain two finite ${positive ? 'positive ' : ''}numbers`);
    }
}

/** Internal guard also permits externally generated maps following the documented data contract. */
function validateShoreMap(map, seaLevel) {
    if (!map || typeof map !== 'object' || !map.texture || map.destroyed) throw new TypeError('Water: expected a live shore map or null');
    validatePair(map.origin, 'origin', false);
    validatePair(map.size, 'size', true);
    if (!Number.isFinite(map.maxDepth) || map.maxDepth <= 0) throw new RangeError('Water: shore maxDepth must be positive');
    if (!Number.isFinite(map.seaLevel) || map.seaLevel !== seaLevel) {
        throw new RangeError('Water: shore map must be baked at the water seaLevel');
    }
}

/** A 1x1 stand-in meaning "deep water everywhere", bound when no coast has been supplied. */
function createDeepWaterMap(device) {
    const texture = new Texture(device, {
        name: 'waterShoreMapNone', width: 1, height: 1, format: PIXELFORMAT_RGBA8,
        mipmaps: false, minFilter: FILTER_LINEAR, magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE,
        levels: [new Uint8Array([255, 128, 128, 255])]
    });
    return texture;
}

// Ocean surface shader (GLSL, WebGL2). A WGSL twin lives in oceanSurface.wgsl.js.
//
// Physically-based water shading:
//   · Fresnel (IOR 1.333) with roughness-aware Schlick
//   · GGX sun highlight widened by the sun's angular radius
//   · pre-filtered environment reflection + screen-space reflections of scene geometry
//   · Beer-Lambert absorption and in-scatter against the scene colour/depth grab
//   · animated caustics projected onto the refracted geometry
//   · crest subsurface scattering
//   · Jacobian whitecaps, wave-driven lacing and shoreline foam
//   · from below: Snell's window with total internal reflection

const WATER_VS = /* glsl */`
attribute vec3 vertex_position;

uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
uniform vec3 view_position;

uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform sampler2D uDisp3;
uniform vec4 uCascade[4];      // (lengthScale, fadeStart, fadeEnd, 1/lengthScale)
uniform int  uNumCascades;
uniform float uSeaLevel;
uniform float uDisplacementScale;
uniform vec4 uMeshLod;         // (grid spacing per metre of radius, inner radius, sim size, -)
// Declared identically in both stages: the engine hoists uniforms from vertex and fragment
// sources into one shared block, and two spellings of the same uniform become a redefinition.
// uShoreArea    (originX, originZ, 1/sizeX, 1/sizeZ)
// uShoreParams  (maxDepth, crest spacing in m of depth, speed, break depth)
// uShoreParams2 (foam, swash, shoaling, enabled)
uniform sampler2D uShoreMap;
uniform vec4 uShoreArea;
uniform vec4 uShoreParams;
uniform vec4 uShoreParams2;

varying vec3 vWorldPos;
varying vec4 vClipPos;
varying vec2 vSampleXZ;
varying vec2 vShore;          // (water depth in m, land mask)

float cascadeWeight(int i, float dist) {
    if (i == 0) return 1.0;
    return 1.0 - smoothstep(uCascade[i].y, uCascade[i].z, dist);
}

void main(void) {
    vec3 base = (matrix_model * vec4(vertex_position, 1.0)).xyz;
    base.y = uSeaLevel;
    float dist = distance(base, view_position);

    // The mesh is a camera-centred polar grid whose spacing grows with radius, so past a few
    // metres it cannot carry the shorter waves in a cascade. Point-sampling them anyway aliases,
    // and because the grid slides under the wave field the alias pattern moves with the camera.
    // So each cascade is read at the mip whose texel matches the local grid spacing: the geometry
    // carries what the mesh can represent and the normal map carries the rest.
    float spacing = max(length(vertex_position.xz) * uMeshLod.x, uMeshLod.y);
    float lod0 = log2(max(spacing * uCascade[0].w * uMeshLod.z, 1.0));
    float lod1 = log2(max(spacing * uCascade[1].w * uMeshLod.z, 1.0));
    float lod2 = log2(max(spacing * uCascade[2].w * uMeshLod.z, 1.0));
    float lod3 = log2(max(spacing * uCascade[3].w * uMeshLod.z, 1.0));
    vec3 disp = vec3(0.0);
    disp += textureLod(uDisp0, base.xz * uCascade[0].w, lod0).xyz * cascadeWeight(0, dist);
    if (uNumCascades > 1) disp += textureLod(uDisp1, base.xz * uCascade[1].w, lod1).xyz * cascadeWeight(1, dist);
    if (uNumCascades > 2) disp += textureLod(uDisp2, base.xz * uCascade[2].w, lod2).xyz * cascadeWeight(2, dist);
    if (uNumCascades > 3) disp += textureLod(uDisp3, base.xz * uCascade[3].w, lod3).xyz * cascadeWeight(3, dist);

    // ---- the coast ----
    vec2 shoreUv = (base.xz - uShoreArea.xy) * uShoreArea.zw;
    vec4 shore = texture(uShoreMap, clamp(shoreUv, 0.0, 1.0));
    // Outside a supplied bathymetry map the surface is open ocean, not its clamped edge.
    if (any(lessThan(shoreUv, vec2(0.0))) || any(greaterThan(shoreUv, vec2(1.0)))) shore = vec4(1.0, 0.5, 0.5, 1.0);
    float depth = shore.x * uShoreParams.x;
    float landMask = shore.w;
    vShore = vec2(depth, landMask);

    if (uShoreParams2.w > 0.5) {
        // A wave cannot be taller than the water it is standing in: as the bed rises the swell has
        // to give up its amplitude, and it does so by rearing up first. Both halves matter — without
        // the damping the sea saws straight through the beach, without the rearing there is no surf.
        float shoal = clamp(depth / max(uShoreParams.w * 2.5, 0.5), 0.0, 1.0);
        float rear = 1.0 + uShoreParams2.z * (1.0 - shoal) * shoal * 4.0;
        disp.y *= shoal * rear;
        disp.xz *= mix(0.35, 1.0, shoal);
        disp *= landMask;
    }

    vec3 worldPos = base + disp * uDisplacementScale;
    // The wave field is a function of the *undisplaced* point: the surface at base.xz has moved to
    // worldPos, but its slope, its folding and the foam riding on it all belong to base.xz. Reading
    // them back at worldPos.xz instead offsets everything by the horizontal displacement — metres,
    // on a choppy sea — which is what puts whitecaps in the troughs instead of on the crest faces.
    vSampleXZ = base.xz;
    vWorldPos = worldPos;
    vClipPos = matrix_viewProjection * vec4(worldPos, 1.0);
    gl_Position = vClipPos;
}
`;

const WATER_FS = /* glsl */`
#include "decodePS"
#include "gammaPS"
#include "tonemappingPS"
#include "fogPS"
#include "screenDepthPS"
#include "sphericalPS"
#include "envAtlasPS"

uniform sampler2D uSceneColorMap;
uniform sampler2D texture_envAtlas;
uniform sampler2D uFoamTex;

uniform vec3 view_position;
uniform mat4 matrix_viewProjection;

uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform sampler2D uDisp3;
uniform sampler2D uDeriv0;
uniform sampler2D uDeriv1;
uniform sampler2D uDeriv2;
uniform sampler2D uDeriv3;
uniform vec4 uCascade[4];
uniform int  uNumCascades;
uniform float uLambda;
uniform float uDisplacementScale;
uniform float uTime;

uniform vec3  uSunDir;          // towards the sun (world)
uniform vec3  uSunColor;        // sun irradiance (linear)
uniform float uSunRadius;       // tan(angular radius) used to widen the highlight

uniform vec3  uExtinction;      // per-channel extinction 1/m
uniform vec3  uScatterColor;    // volumetric in-scatter albedo
uniform float uScatterStrength;
uniform vec3  uSSSColor;
uniform vec4  uSSSParams;       // (strength, power, height scale, normal distortion)
uniform vec4  uSurfaceParams;   // (roughness, roughnessDistance, envStrength, specularStrength)
uniform vec4  uRefractionParams;// (strength, blur, max thickness for distortion, unused)
uniform vec4  uFoamParams;      // (bias, sharpness, tiling, shoreDistance)
uniform vec3  uFoamColor;
uniform float uFoamStrength;
uniform vec4  uFoamCascadeWeights;
uniform sampler2D uSkyRadiance;
uniform float uHasSkyRadiance;
uniform float uEnvironmentExposure;
uniform float uWaterRadius;
uniform float uFogDensity;      // aerial perspective towards the sky colour in the view direction
uniform vec4  uSSRParams;       // (intensity, maxDistance, steps, thickness tolerance)
uniform vec3  uCausticsParams;  // (intensity, inverse footprint, depth fade 1/m)
uniform float uSeaLevel;
uniform sampler2D uShoreMap;
uniform vec4 uShoreArea;
uniform vec4 uShoreParams;
uniform vec4 uShoreParams2;

varying vec3 vWorldPos;
varying vec4 vClipPos;
varying vec2 vSampleXZ;
varying vec2 vShore;

#define F0 0.02
#define IOR_AIR_WATER 0.75187969   // 1.0 / 1.333
#define IOR_WATER_AIR 1.333

${SURFACE_CAUSTICS_GLSL}

float cascadeWeight(int i, float dist) {
    if (i == 0) return 1.0;
    return 1.0 - smoothstep(uCascade[i].y, uCascade[i].z, dist);
}

// environment reflection from the prefiltered atlas (roughness in [0,1])
vec3 sampleEnv(vec3 dir, float roughness) {
    vec3 d = normalize(dir) * vec3(-1.0, 1.0, 1.0);
    vec2 uv = toSphericalUv(d);
    float level = clamp(roughness * 5.0, 0.0, 5.0);
    float il = floor(level);
    vec2 uvA = il == 0.0 ? mapShinyUv(uv, 0.0) : mapRoughnessUv(uv, il);
    vec2 uvB = mapRoughnessUv(uv, il + 1.0);
    vec3 a = {ENV_DECODE}(texture(texture_envAtlas, uvA));
    vec3 b = {ENV_DECODE}(texture(texture_envAtlas, uvB));
    return mix(a, b, level - il) * uEnvironmentExposure;
}
// Aerial light uses the unfiltered sky, not a roughness-convolved reflection that mixes
// planetary ground into the horizon. Generic environments can use the atlas fallback.
vec3 sampleAerial(vec3 dir) {
    if (uHasSkyRadiance > 0.5) return textureLod(uSkyRadiance, toSphericalUv(normalize(dir) * vec3(-1.0, 1.0, 1.0)), 0.0).rgb * uEnvironmentExposure;
    return sampleEnv(dir, 0.0);
}
vec3 sampleAmbient(vec3 dir) {
    vec3 d = normalize(dir) * vec3(-1.0, 1.0, 1.0);
    vec2 uv = mapUv(toSphericalUv(d), vec4(128.0, 256.0 + 128.0, 64.0, 32.0) / atlasSize);
    return {ENV_DECODE}(texture(texture_envAtlas, uv)) * uEnvironmentExposure;
}

// GGX specular for a directional light with angular size widening (Karis 2013)
float ggxSpecular(vec3 N, vec3 V, vec3 L, float roughness) {
    float a = roughness * roughness;
    float aWide = clamp(a + uSunRadius, 0.0, 1.0);
    // The widened GGX distribution is already normalized; retain its integrated energy.
    vec3 H = (V + L) / max(length(V + L), 1e-5);
    float NdotH = max(dot(N, H), 0.0);
    float NdotV = max(dot(N, V), 1e-4);
    float NdotL = max(dot(N, L), 0.0);
    float a2 = aWide * aWide;
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    float D = a2 / (3.14159265 * d * d);
    float k = aWide * 0.5;
    float Vis = 1.0 / ((NdotV * (1.0 - k) + k) * (NdotL * (1.0 - k) + k));   // Smith-Schlick, includes 1/(4 NdotV NdotL)
    return D * Vis * 0.25 * NdotL;
}

// ---- screen-space reflections against the opaque colour/depth grab ----
// Marches the reflected ray in world space with a geometrically growing step, then bisects the
// crossing. Returns the reflected colour; 'mask' is the confidence (0 = miss, fall back to the sky).
vec3 traceSSR(vec3 origin, vec3 dir, float roughness, float dither, out float mask) {
    mask = 0.0;
    int steps = int(uSSRParams.z);
    float stride = uSSRParams.y * 0.14 / (pow(1.14, float(steps)) - 1.0);
    float tol = uSSRParams.w;

    vec3 prev = origin;
    float t = stride * (0.5 + dither);
    float grow = 1.0;
    for (int i = 0; i < 40; i++) {
        if (i >= steps || t > uSSRParams.y) break;
        vec3 p = origin + dir * t;
        vec4 clip = matrix_viewProjection * vec4(p, 1.0);
        if (clip.w <= 0.0) break;
        vec2 uv = getGrabScreenPos(clip);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

        float sceneD = getLinearScreenDepth(uv);
        float rayD = getLinearDepth(p);
        float delta = rayD - sceneD;
        if (delta > 0.0 && delta < tol + stride * grow) {
            // bisect between prev (in front) and p (behind) for a tighter hit
            vec3 a = prev, b = p;
            for (int j = 0; j < 5; j++) {
                vec3 m = (a + b) * 0.5;
                vec4 mc = matrix_viewProjection * vec4(m, 1.0);
                vec2 muv = getGrabScreenPos(mc);
                if (getLinearDepth(m) - getLinearScreenDepth(muv) > 0.0) b = m; else a = m;
            }
            vec4 hc = matrix_viewProjection * vec4(b, 1.0);
            uv = getGrabScreenPos(hc);
            // fade at the screen border, at grazing rays and with distance travelled
            vec2 edge = smoothstep(vec2(0.0), vec2(0.12), uv) * smoothstep(vec2(0.0), vec2(0.12), 1.0 - uv);
            mask = edge.x * edge.y * (1.0 - smoothstep(0.6, 1.0, t / uSSRParams.y));
            vec3 hitColor = textureLod(uSceneColorMap, uv, min(roughness * 8.0, 4.0)).rgb;
            #ifdef SCENE_COLORMAP_GAMMA
                hitColor = decodeGamma(hitColor);
            #endif
            return hitColor;
        }
        prev = p;
        grow *= 1.14;
        t += stride * grow;
    }
    return vec3(0.0);
}

void main(void) {
    vec3 worldPos = vWorldPos;
    vec3 camToPos = worldPos - view_position;
    float dist = max(length(camToPos), 1e-4);
    vec3 V = -camToPos / dist;
    bool underwater = view_position.y < uSeaLevel;

    // ---- normal from summed slope derivatives ----
    // slopes follow the cascade LOD; the folding (Jacobian) does not — see the WGSL twin
    vec4 dsum = vec4(0.0);
    float wsum = 0.0;
    float jac = 1.0;
    float w;
    vec2 cuv;
    w = cascadeWeight(0, dist); cuv = vSampleXZ * uCascade[0].w; dsum += texture(uDeriv0, cuv) * w; jac += (texture(uDisp0, cuv).w - 1.0) * uFoamCascadeWeights.x; wsum += w;
    if (uNumCascades > 1) { w = cascadeWeight(1, dist); cuv = vSampleXZ * uCascade[1].w; dsum += texture(uDeriv1, cuv) * w; jac += (texture(uDisp1, cuv).w - 1.0) * uFoamCascadeWeights.y; wsum += w; }
    if (uNumCascades > 2) { w = cascadeWeight(2, dist); cuv = vSampleXZ * uCascade[2].w; dsum += texture(uDeriv2, cuv) * w; jac += (texture(uDisp2, cuv).w - 1.0) * uFoamCascadeWeights.z; wsum += w; }
    if (uNumCascades > 3) { w = cascadeWeight(3, dist); cuv = vSampleXZ * uCascade[3].w; dsum += texture(uDeriv3, cuv) * w; jac += (texture(uDisp3, cuv).w - 1.0) * uFoamCascadeWeights.w; wsum += w; }
    dsum *= uDisplacementScale;
    float detail = wsum / float(uNumCascades);
    // A folded FFT surface has no single-valued slope. Bound its horizontal Jacobian
    // before division so breaking crests stay finite rather than flipping inside out.
    vec2 slope = dsum.xy / max(vec2(1.0) + uLambda * dsum.zw, vec2(0.1));
    vec3 Nup = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 N = underwater ? -Nup : Nup;
    // keep the normal facing the viewer (steep backfaces of choppy waves)
    float NdotVraw = dot(N, V);
    if (NdotVraw < 0.02) N = normalize(N + V * (0.02 - NdotVraw));
    float NdotV = max(dot(N, V), 1e-4);

    // ---- roughness increases as high-frequency cascades fade ----
    float roughness = clamp(uSurfaceParams.x + uSurfaceParams.y * (1.0 - detail), 0.02, 1.0);
    // geometric specular anti-aliasing (Tokuyoshi & Kaplanyan): fold normal variance within the pixel into roughness
    vec3 dndx = dFdx(N), dndy = dFdy(N);
    float nVar = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));
    roughness = sqrt(clamp(roughness * roughness + min(2.0 * nVar, 0.2), 0.0, 1.0));

    // ---- Fresnel (Schlick) ----
    // Plain Schlick, not the roughness-capped variant: that one is an ambient-occlusion
    // approximation, and capping grazing reflectance at (1 - roughness) means a rough sea reflects
    // only half the sky at the horizon. The far water then comes out darker than the sky above it,
    // which is what draws a line along the horizon. Roughness belongs in the lobe, not here.
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);

    // ---- refraction / underwater volume ----
    vec2 screenUv = getGrabScreenPos(vClipPos);
    float surfaceDepth = getLinearDepth(worldPos);
    float sceneDepth = getLinearScreenDepth(screenUv);
    float thickness = max(sceneDepth - surfaceDepth, 0.0);
    // Reconstruct the opaque receiver at the original pixel. Distance to its tangent plane
    // makes the contact band stable when the camera turns; eye-depth thickness does not.
    vec3 opaquePos = view_position + camToPos * (sceneDepth / max(surfaceDepth, 1e-4));
    vec3 receiverCross = cross(dFdx(opaquePos), dFdy(opaquePos));
    vec3 receiverNormal = receiverCross * inversesqrt(max(dot(receiverCross, receiverCross), 1e-8));
    float contactDistance = abs(dot(opaquePos - worldPos, receiverNormal));
    float contactNearby = 1.0 - smoothstep(2.0, 4.0, length(opaquePos - worldPos));

    // Project the refracted ray into the camera, so distortion follows camera heading/roll.
    vec3 camFwd = -vec3(matrix_view[0].z, matrix_view[1].z, matrix_view[2].z);
    vec3 refrDir = refract(-V, N, underwater ? IOR_WATER_AIR : IOR_AIR_WATER);
    vec3 offsetPoint = worldPos + refrDir * min(thickness, uRefractionParams.z);
    vec2 offset = (getGrabScreenPos(matrix_viewProjection * vec4(offsetPoint, 1.0)) - screenUv) * uRefractionParams.x;
    offset = clamp(offset, vec2(-0.05), vec2(0.05));
    vec2 refrUv = clamp(screenUv + offset, vec2(0.001), vec2(0.999));
    float refrDepth = getLinearScreenDepth(refrUv);
    if (refrDepth < surfaceDepth) { refrUv = screenUv; refrDepth = sceneDepth; }
    thickness = max(refrDepth - surfaceDepth, 0.0);
    float opticalDistance = thickness / max(dot(refrDir, camFwd), 0.15);
    float lod = min(opticalDistance * uRefractionParams.y, 4.0);
    vec3 sceneColor = textureLod(uSceneColorMap, refrUv, lod).rgb;
    #ifdef SCENE_COLORMAP_GAMMA
        sceneColor = decodeGamma(sceneColor);
    #endif

    vec3 ambientUp = sampleAmbient(vec3(0.0, 1.0, 0.0));
    vec3 sunE = uSunColor;
    float sunUp = clamp(uSunDir.y, 0.0, 1.0);

    // Pixel derivatives stay outside divergent branches for both rendering backends.
    float causticPixelMetres = max(length(dFdx(opaquePos.xz)), length(dFdy(opaquePos.xz)));
    // Shared, bounded wave-ray focusing modulates the receiver's existing light.
    if (uCausticsParams.x > 0.0 && uDisplacementScale > 0.0 && thickness > 0.0 && !underwater && sunUp > 0.0) {
        vec3 hit = worldPos + refrDir * opticalDistance;
        float depthBelow = max(uSeaLevel - hit.y, 0.0);
        vec3 sunRay = waterCausticSunRay(uSunDir);
        float lightPath = depthBelow / max(-sunRay.y, 0.1);
        vec2 entry = hit.xz - sunRay.xz * lightPath;
        float focus = waterCausticFocus(entry, depthBelow, uCausticsParams.y,
            uSunDir, causticPixelMetres);
        float facing = max(dot(receiverNormal, -sunRay), 0.0);
        float direct = dot(sunE, vec3(0.2126, 0.7152, 0.0722)) * facing;
        float diffuseSky = dot(ambientUp, vec3(0.2126, 0.7152, 0.0722)) * 3.14159265;
        float directFraction = direct / max(direct + diffuseSky, 1e-5);
        float fade = exp(-depthBelow * uCausticsParams.z) * smoothstep(0.02, 0.35, sunUp) * detail;
        float amount = uCausticsParams.x * min(uDisplacementScale, 1.0) * fade * directFraction;
        sceneColor *= max(vec3(0.0), vec3(1.0) + (focus - 1.0) * amount * exp(-uExtinction * lightPath));
    }

    // ---- subsurface scattering through crests (Atlas / Sea of Thieves style) ----
    float waveHeight = max(worldPos.y - uSeaLevel, 0.0);
    vec3 Ls = normalize(-uSunDir + Nup * uSSSParams.w);
    float sssView = pow(clamp(dot(V, Ls), 0.0, 1.0), uSSSParams.y);
    float sssHeight = clamp(waveHeight * uSSSParams.z, 0.0, 1.0);
    vec3 sss = uSSSColor * (sunE * sssView * sssHeight * uSSSParams.x * sunUp + ambientUp * sssHeight * uSSSParams.x * 0.25);

    vec3 scatterRadiance = uScatterColor * uScatterStrength * (ambientUp + sunE * sunUp * 0.3183) + sss;
    vec3 T = exp(-uExtinction * opticalDistance);
    vec3 refracted = sceneColor * T + scatterRadiance * (1.0 - T);

    vec3 windowRay = refract(-V, N, IOR_WATER_AIR);
    float sunWindowCos = dot(windowRay / max(length(windowRay), 1e-5), uSunDir);
    float sunWindowEdge = max(fwidth(sunWindowCos), 1e-6);
    vec3 color;
    if (underwater) {
        // ---- looking up from below: Snell's window, total internal reflection outside it ----
        vec3 up = refract(-V, N, IOR_WATER_AIR);
        float tir = dot(up, up) < 1e-5 ? 1.0 : 0.0;
        vec3 skyThroughSurface = vec3(0.0);
        if (tir < 0.5) {
            skyThroughSurface = sampleEnv(up, roughness) * uSurfaceParams.z;
            // sun disc seen through the window
            float sunCos = sunWindowCos;
            float radius = max(uSunRadius, 1e-4);
            float edge = sunWindowEdge;
            float disc = smoothstep(cos(radius) - edge, cos(radius) + edge, sunCos);
            skyThroughSurface += sunE * disc / max(3.14159265 * radius * radius, 1e-6);
        }
        // the water below the surface, mirrored back down when past the critical angle
        vec3 mirrored = scatterRadiance;
        // Exact dielectric Fresnel approaches one smoothly at the critical angle.
        float cosT = sqrt(max(1.0 - IOR_WATER_AIR * IOR_WATER_AIR * (1.0 - NdotV * NdotV), 0.0));
        float rs = (IOR_WATER_AIR * NdotV - cosT) / max(IOR_WATER_AIR * NdotV + cosT, 1e-5);
        float rp = (NdotV - IOR_WATER_AIR * cosT) / max(NdotV + IOR_WATER_AIR * cosT, 1e-5);
        float fUp = mix(0.5 * (rs * rs + rp * rp), 1.0, tir);
        color = mix(skyThroughSurface, mirrored, fUp);
    } else {
        vec3 R = reflect(-V, N);
        vec3 envRefl = sampleEnv(R, roughness) * uSurfaceParams.z;
        // only worth tracing when the ray stays low enough to plausibly meet geometry
        if (uSSRParams.x > 0.0 && roughness < 0.3 && R.y < 0.4) {
            float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453 + uTime);
            float mask;
            vec3 ssr = traceSSR(worldPos, R, roughness, dither, mask);
            mask *= uSSRParams.x * (1.0 - smoothstep(0.15, 0.35, roughness));
            envRefl = mix(envRefl, ssr, clamp(mask, 0.0, 1.0));
        }
        float spec = ggxSpecular(N, V, uSunDir, roughness) * uSurfaceParams.w;
        vec3 H = (V + uSunDir) / max(length(V + uSunDir), 1e-5);
        float FH = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
        vec3 sunSpec = sunE * spec * FH;
        color = refracted * (1.0 - fresnel) + envRefl * fresnel + sunSpec;
    }

    // ---- foam: whitecaps where the surface is folding, plus a shoreline band ----
    float foamMask = clamp((uFoamParams.x - jac) * uFoamParams.y, 0.0, 1.0);
    vec2 foamUv = vSampleXZ * uFoamParams.z;
    // two scales drifting apart, so the bubble field never reads as a repeating tile
    vec4 fa = texture(uFoamTex, foamUv + vec2(uTime * 0.011, uTime * 0.006));
    vec4 fb = texture(uFoamTex, foamUv * 2.83 - vec2(uTime * 0.019, uTime * -0.013));
    float clumps = fa.r * 0.62 + fb.r * 0.38;
    float bubbles = fa.g * 0.5 + fb.g * 0.5;
    float lace = clamp(clumps * mix(0.72, 1.28, fa.b) + bubbles * 0.22, 0.0, 1.0);

    float whitecap = foamMask * smoothstep(1.0 - foamMask * 1.15, max(1.0 - foamMask * 0.22, 1.001 - foamMask * 1.15), lace);
    whitecap *= mix(0.72, 1.0, bubbles);
    // Past a couple of kilometres a whitecap is smaller than a pixel. The mip-averaged texture put
    // through the threshold above still reports ~40% coverage there, and foam lit by a dull sky is
    // darker than the horizon glow behind it — which is what paints a dark band along the horizon
    // on a stormy sea. So the resolved coverage is faded with distance instead.
    whitecap *= 1.0 - 0.75 * smoothstep(700.0, 2600.0, dist);

    float shore = (1.0 - smoothstep(0.02, 0.55, contactDistance)) * contactNearby;
    float shoreBands = 0.5 + 0.5 * sin(contactDistance * 9.0 - uTime * 1.3 + fa.b * 5.0);
    float shoreFoam = shore * shore * clamp((lace * 0.9 + shoreBands * 0.5 + shore * 0.6 - 0.78) * 3.2, 0.0, 1.0);

    // ---- surf: bands of broken water riding the shoaling swell in towards the beach ----
    float surfFoam = 0.0;
    if (uShoreParams2.w > 0.5) {
        float depth = vShore.x;
        vec4 sh = texture(uShoreMap, clamp((vSampleXZ - uShoreArea.xy) * uShoreArea.zw, 0.0, 1.0));
        vec2 offshore = sh.yz * 2.0 - 1.0;

        // Depth is the phase variable, so a crest is a line of constant depth: parallel to the shore
        // wherever the shore happens to run, and bending around a headland the way refraction does.
        float phase = depth / max(uShoreParams.y, 0.05) + uTime * uShoreParams.z;
        // break the bands up so they are not perfectly regular
        phase += (fa.b - 0.5) * 0.35 + dot(vSampleXZ, offshore) * 0.004;
        float band = 0.5 - 0.5 * cos(phase * 6.28318530718);

        // waves break where the water gets too shallow to hold them, and the foam lingers after
        float breaking = 1.0 - smoothstep(uShoreParams.w * 0.3, uShoreParams.w * 1.4, depth);
        float crest = pow(band, 3.0);
        float surf = crest * breaking;

        // swash: the sheet of foam left on the sand, always there, thickest at the waterline
        // swash: a lace a metre or two wide that runs up the sand and drains back, not a sheet
        float swashPulse = 0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * 0.9 + fa.b * 6.0 + depth * 4.0));
        float swash = uShoreParams2.y * (1.0 - smoothstep(0.0, uShoreParams.w * 0.2, depth)) * swashPulse;

        surfFoam = clamp((surf + swash) * lace * 1.15 * uShoreParams2.x, 0.0, 1.0);
        surfFoam *= vShore.y;
    }

    float foam = clamp((whitecap + shoreFoam + surfFoam) * uFoamStrength, 0.0, 1.0);
    if (underwater) foam *= 0.25;

    // the water immediately around a foam patch is aerated: lighter, and less transparent
    float aerate = clamp((fa.a * 0.7 + fb.a * 0.3) * foamMask * uFoamStrength - 0.25, 0.0, 1.0) * 0.22;
    float NdotL = max(dot(Nup, uSunDir), 0.0);
    vec3 foamLit = uFoamColor * (ambientUp + sunE * (NdotL * 0.85 + 0.15) * 0.3183);
    // wet foam has a sheen: at grazing angles it mirrors the sky like the water around it
    if (!underwater) foamLit = mix(foamLit, sampleEnv(reflect(-V, Nup), 0.35), fresnel * 0.55);
    color = mix(color, foamLit * 0.55, aerate * (1.0 - foam));
    color = mix(color, foamLit, foam);

    if (!underwater) {
        // Exponential atmospheric extinction, plus a separate coverage fade at the finite
        // mesh boundary. Sampling the actual horizon removes the old fixed-elevation stripe.
        vec3 apDir = normalize(vec3(camToPos.x, max(camToPos.y, 0.0), camToPos.z));
        vec3 horizonSky = sampleAerial(apDir);
        float coverage = 1.0 - smoothstep(uWaterRadius * 0.72, uWaterRadius * 0.98, dist);
        color = mix(horizonSky, color, exp(-uFogDensity * dist) * coverage);
    } else {
        // seen through the water body: absorb along the view ray
        color = mix(scatterRadiance, color, exp(-uExtinction * dist));
    }
    // The surface dissolves where the water runs out of depth, so the shoreline is a wet gradient
    // rather than a cut; the foam lying in the swash stays.
    float alpha = 1.0;
    if (!underwater) alpha = clamp(smoothstep(0.0, 0.08, mix(1.0, contactDistance, contactNearby)) + foam * 0.7, 0.0, 1.0);
    // Keep HDR output representable in half-float targets, independently of the camera grade.
    gl_FragColor = vec4(gammaCorrectOutput(toneMap(clamp(color, 0.0, 60000.0))), alpha);
}
`;

// Ocean surface shader — native WGSL for WebGPU. Mirrors oceanSurface.glsl.js exactly.

const WATER_VS_WGSL = /* wgsl */`
attribute vertex_position: vec3f;

uniform matrix_model: mat4x4f;
uniform matrix_viewProjection: mat4x4f;
uniform view_position: vec3f;
uniform uCascade: array<vec4f, 4>;
uniform uNumCascades: i32;
uniform uSeaLevel: f32;
uniform uDisplacementScale: f32;
uniform uShoreArea: vec4f;
uniform uShoreParams: vec4f;
uniform uShoreParams2: vec4f;
uniform uMeshLod: vec4f;      // (grid spacing per metre of radius, inner radius, sim size, -)

var uShoreMap: texture_2d<f32>;
var uShoreMapSampler: sampler;
var uDisp0: texture_2d<f32>;
var uDisp0Sampler: sampler;
var uDisp1: texture_2d<f32>;
var uDisp1Sampler: sampler;
var uDisp2: texture_2d<f32>;
var uDisp2Sampler: sampler;
var uDisp3: texture_2d<f32>;
var uDisp3Sampler: sampler;

varying vWorldPos: vec3f;
varying vClipPos: vec4f;
varying vSampleXZ: vec2f;
varying vShore: vec2f;

fn cascadeWeight(i: i32, dist: f32) -> f32 {
    if (i == 0) { return 1.0; }
    return 1.0 - smoothstep(uniform.uCascade[i].y, uniform.uCascade[i].z, dist);
}

@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    var base = (uniform.matrix_model * vec4f(input.vertex_position, 1.0)).xyz;
    base.y = uniform.uSeaLevel;
    let dist = distance(base, uniform.view_position);

    // The grid's spacing here, in metres, against each cascade's texel: the mip whose texel is
    // the spacing holds only the waves this vertex density can represent. See the GLSL twin.
    let spacing = max(length(input.vertex_position.xz) * uniform.uMeshLod.x, uniform.uMeshLod.y);
    let lod0 = log2(max(spacing * uniform.uCascade[0].w * uniform.uMeshLod.z, 1.0));
    let lod1 = log2(max(spacing * uniform.uCascade[1].w * uniform.uMeshLod.z, 1.0));
    let lod2 = log2(max(spacing * uniform.uCascade[2].w * uniform.uMeshLod.z, 1.0));
    let lod3 = log2(max(spacing * uniform.uCascade[3].w * uniform.uMeshLod.z, 1.0));
    var disp = vec3f(0.0);
    disp += textureSampleLevel(uDisp0, uDisp0Sampler, base.xz * uniform.uCascade[0].w, lod0).xyz * cascadeWeight(0, dist);
    if (uniform.uNumCascades > 1) { disp += textureSampleLevel(uDisp1, uDisp1Sampler, base.xz * uniform.uCascade[1].w, lod1).xyz * cascadeWeight(1, dist); }
    if (uniform.uNumCascades > 2) { disp += textureSampleLevel(uDisp2, uDisp2Sampler, base.xz * uniform.uCascade[2].w, lod2).xyz * cascadeWeight(2, dist); }
    if (uniform.uNumCascades > 3) { disp += textureSampleLevel(uDisp3, uDisp3Sampler, base.xz * uniform.uCascade[3].w, lod3).xyz * cascadeWeight(3, dist); }

    // ---- the coast; see the GLSL twin ----
    let shoreUv = (base.xz - uniform.uShoreArea.xy) * uniform.uShoreArea.zw;
    var shore = textureSampleLevel(uShoreMap, uShoreMapSampler, clamp(shoreUv, vec2f(0.0), vec2f(1.0)), 0.0);
    if (any(shoreUv < vec2f(0.0)) || any(shoreUv > vec2f(1.0))) { shore = vec4f(1.0, 0.5, 0.5, 1.0); }
    let depth = shore.x * uniform.uShoreParams.x;
    output.vShore = vec2f(depth, shore.w);

    if (uniform.uShoreParams2.w > 0.5) {
        let shoal = clamp(depth / max(uniform.uShoreParams.w * 2.5, 0.5), 0.0, 1.0);
        let rear = 1.0 + uniform.uShoreParams2.z * (1.0 - shoal) * shoal * 4.0;
        disp.y *= shoal * rear;
        disp = vec3f(disp.x * mix(0.35, 1.0, shoal), disp.y, disp.z * mix(0.35, 1.0, shoal));
        disp *= shore.w;
    }

    let worldPos = base + disp * uniform.uDisplacementScale;
    // see the GLSL twin: slope, folding and foam are functions of the undisplaced point
    output.vSampleXZ = base.xz;
    output.vWorldPos = worldPos;
    output.vClipPos = uniform.matrix_viewProjection * vec4f(worldPos, 1.0);
    output.position = output.vClipPos;
    return output;
}
`;

const WATER_FS_WGSL = /* wgsl */`
#include "decodePS"
#include "gammaPS"
#include "tonemappingPS"
#include "fogPS"
#include "screenDepthPS"
#include "sphericalPS"
#include "envAtlasPS"

var uSceneColorMap: texture_2d<f32>;
var uSceneColorMapSampler: sampler;
var texture_envAtlas: texture_2d<f32>;
var texture_envAtlas_sampler: sampler;
var uFoamTex: texture_2d<f32>;
var uFoamTexSampler: sampler;

uniform view_position: vec3f;
uniform matrix_viewProjection: mat4x4f;

var uDisp0: texture_2d<f32>;
var uDisp0Sampler: sampler;
var uDisp1: texture_2d<f32>;
var uDisp1Sampler: sampler;
var uDisp2: texture_2d<f32>;
var uDisp2Sampler: sampler;
var uDisp3: texture_2d<f32>;
var uDisp3Sampler: sampler;
var uDeriv0: texture_2d<f32>;
var uDeriv0Sampler: sampler;
var uDeriv1: texture_2d<f32>;
var uDeriv1Sampler: sampler;
var uDeriv2: texture_2d<f32>;
var uDeriv2Sampler: sampler;
var uDeriv3: texture_2d<f32>;
var uDeriv3Sampler: sampler;
uniform uCascade: array<vec4f, 4>;
uniform uNumCascades: i32;
uniform uLambda: f32;
uniform uDisplacementScale: f32;
uniform uTime: f32;

uniform uSunDir: vec3f;
uniform uSunColor: vec3f;
uniform uSunRadius: f32;

uniform uExtinction: vec3f;
uniform uScatterColor: vec3f;
uniform uScatterStrength: f32;
uniform uSSSColor: vec3f;
uniform uSSSParams: vec4f;
uniform uSurfaceParams: vec4f;
uniform uRefractionParams: vec4f;
uniform uFoamParams: vec4f;
uniform uFoamColor: vec3f;
uniform uFoamStrength: f32;
uniform uFoamCascadeWeights: vec4f;
var uSkyRadiance: texture_2d<f32>;
var uSkyRadianceSampler: sampler;
uniform uHasSkyRadiance: f32;
uniform uEnvironmentExposure: f32;
uniform uWaterRadius: f32;
uniform uFogDensity: f32;
uniform uSSRParams: vec4f;
uniform uCausticsParams: vec3f;
uniform uSeaLevel: f32;
uniform uShoreArea: vec4f;
uniform uShoreParams: vec4f;
uniform uShoreParams2: vec4f;
var uShoreMap: texture_2d<f32>;
var uShoreMapSampler: sampler;

varying vWorldPos: vec3f;
varying vClipPos: vec4f;
varying vSampleXZ: vec2f;
varying vShore: vec2f;

const F0: f32 = 0.02;
const IOR_AIR_WATER: f32 = 0.75187969;
const IOR_WATER_AIR: f32 = 1.333;

${SURFACE_CAUSTICS_WGSL}

fn cascadeWeight(i: i32, dist: f32) -> f32 {
    if (i == 0) { return 1.0; }
    return 1.0 - smoothstep(uniform.uCascade[i].y, uniform.uCascade[i].z, dist);
}

fn sampleEnv(dir: vec3f, roughness: f32) -> vec3f {
    let d = normalize(dir) * vec3f(-1.0, 1.0, 1.0);
    let uv = toSphericalUv(d);
    let level = clamp(roughness * 5.0, 0.0, 5.0);
    let il = floor(level);
    let uvA = select(mapRoughnessUv(uv, il), mapShinyUv(uv, 0.0), il == 0.0);
    let uvB = mapRoughnessUv(uv, il + 1.0);
    let a = {ENV_DECODE}(textureSampleLevel(texture_envAtlas, texture_envAtlas_sampler, uvA, 0.0));
    let b = {ENV_DECODE}(textureSampleLevel(texture_envAtlas, texture_envAtlas_sampler, uvB, 0.0));
    return mix(a, b, level - il) * uniform.uEnvironmentExposure;
}
fn sampleAerial(dir: vec3f) -> vec3f {
    if (uniform.uHasSkyRadiance > 0.5) {
        return textureSampleLevel(uSkyRadiance, uSkyRadianceSampler, toSphericalUv(normalize(dir) * vec3f(-1.0, 1.0, 1.0)), 0.0).rgb * uniform.uEnvironmentExposure;
    }
    return sampleEnv(dir, 0.0);
}
fn sampleAmbient(dir: vec3f) -> vec3f {
    let d = normalize(dir) * vec3f(-1.0, 1.0, 1.0);
    let uv = mapUv(toSphericalUv(d), vec4f(128.0, 256.0 + 128.0, 64.0, 32.0) / atlasSize);
    return {ENV_DECODE}(textureSampleLevel(texture_envAtlas, texture_envAtlas_sampler, uv, 0.0)) * uniform.uEnvironmentExposure;
}

fn ggxSpecular(N: vec3f, V: vec3f, L: vec3f, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let aWide = clamp(a + uniform.uSunRadius, 0.0, 1.0);
    // The widened GGX distribution is already normalized.
    let H = (V + L) / max(length(V + L), 1e-5);
    let NdotH = max(dot(N, H), 0.0);
    let NdotV = max(dot(N, V), 1e-4);
    let NdotL = max(dot(N, L), 0.0);
    let a2 = aWide * aWide;
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    let D = a2 / (3.14159265 * d * d);
    let k = aWide * 0.5;
    let Vis = 1.0 / ((NdotV * (1.0 - k) + k) * (NdotL * (1.0 - k) + k));
    return D * Vis * 0.25 * NdotL;
}

struct SsrResult { color: vec3f, mask: f32 }

// ---- screen-space reflections against the opaque colour/depth grab ----
fn traceSSR(origin: vec3f, dir: vec3f, roughness: f32, dither: f32) -> SsrResult {
    var res: SsrResult;
    res.color = vec3f(0.0);
    res.mask = 0.0;
    let steps = i32(uniform.uSSRParams.z);
    let stride = uniform.uSSRParams.y * 0.14 / (pow(1.14, f32(steps)) - 1.0);
    let tol = uniform.uSSRParams.w;

    var prev = origin;
    var t = stride * (0.5 + dither);
    var grow = 1.0;
    for (var i = 0; i < 40; i++) {
        if (i >= steps || t > uniform.uSSRParams.y) { break; }
        let p = origin + dir * t;
        let clip = uniform.matrix_viewProjection * vec4f(p, 1.0);
        if (clip.w <= 0.0) { break; }
        var uv = getGrabScreenPos(clip);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }

        let sceneD = getLinearScreenDepth(uv);
        let rayD = getLinearDepth(p);
        let delta = rayD - sceneD;
        if (delta > 0.0 && delta < tol + stride * grow) {
            var a = prev;
            var b = p;
            for (var j = 0; j < 5; j++) {
                let m = (a + b) * 0.5;
                let mc = uniform.matrix_viewProjection * vec4f(m, 1.0);
                let muv = getGrabScreenPos(mc);
                if (getLinearDepth(m) - getLinearScreenDepth(muv) > 0.0) { b = m; } else { a = m; }
            }
            let hc = uniform.matrix_viewProjection * vec4f(b, 1.0);
            uv = getGrabScreenPos(hc);
            let edge = smoothstep(vec2f(0.0), vec2f(0.12), uv) * smoothstep(vec2f(0.0), vec2f(0.12), vec2f(1.0) - uv);
            res.mask = edge.x * edge.y * (1.0 - smoothstep(0.6, 1.0, t / uniform.uSSRParams.y));
            res.color = textureSampleLevel(uSceneColorMap, uSceneColorMapSampler, uv, min(roughness * 8.0, 4.0)).rgb;
            #ifdef SCENE_COLORMAP_GAMMA
                res.color = decodeGamma3(res.color);
            #endif
            return res;
        }
        prev = p;
        grow *= 1.14;
        t += stride * grow;
    }
    return res;
}

@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let worldPos = input.vWorldPos;
    let camToPos = worldPos - uniform.view_position;
    let dist = max(length(camToPos), 1e-4);
    let V = -camToPos / dist;
    let underwater = uniform.view_position.y < uniform.uSeaLevel;

    // Slopes follow the cascade LOD. The folding (Jacobian) does not: whitecaps are a property of
    // the sea state, so every cascade counts at every distance — the maps are mipmapped, so a far
    // sample is the local average — or the whitecap coverage would change with the camera.
    var dsum = vec4f(0.0);
    var wsum = 0.0;
    var jac = 1.0;
    var w: f32;
    var cuv: vec2f;
    w = cascadeWeight(0, dist); cuv = input.vSampleXZ * uniform.uCascade[0].w;
    dsum += textureSample(uDeriv0, uDeriv0Sampler, cuv) * w; jac += (textureSample(uDisp0, uDisp0Sampler, cuv).w - 1.0) * uniform.uFoamCascadeWeights.x; wsum += w;
    if (uniform.uNumCascades > 1) { w = cascadeWeight(1, dist); cuv = input.vSampleXZ * uniform.uCascade[1].w;
        dsum += textureSample(uDeriv1, uDeriv1Sampler, cuv) * w; jac += (textureSample(uDisp1, uDisp1Sampler, cuv).w - 1.0) * uniform.uFoamCascadeWeights.y; wsum += w; }
    if (uniform.uNumCascades > 2) { w = cascadeWeight(2, dist); cuv = input.vSampleXZ * uniform.uCascade[2].w;
        dsum += textureSample(uDeriv2, uDeriv2Sampler, cuv) * w; jac += (textureSample(uDisp2, uDisp2Sampler, cuv).w - 1.0) * uniform.uFoamCascadeWeights.z; wsum += w; }
    if (uniform.uNumCascades > 3) { w = cascadeWeight(3, dist); cuv = input.vSampleXZ * uniform.uCascade[3].w;
        dsum += textureSample(uDeriv3, uDeriv3Sampler, cuv) * w; jac += (textureSample(uDisp3, uDisp3Sampler, cuv).w - 1.0) * uniform.uFoamCascadeWeights.w; wsum += w; }
    dsum *= uniform.uDisplacementScale;
    let detail = wsum / f32(uniform.uNumCascades);
    let slope = dsum.xy / max(vec2f(1.0) + uniform.uLambda * dsum.zw, vec2f(0.1));
    let Nup = normalize(vec3f(-slope.x, 1.0, -slope.y));
    var N = select(Nup, -Nup, underwater);
    let NdotVraw = dot(N, V);
    if (NdotVraw < 0.02) { N = normalize(N + V * (0.02 - NdotVraw)); }
    let NdotV = max(dot(N, V), 1e-4);

    var roughness = clamp(uniform.uSurfaceParams.x + uniform.uSurfaceParams.y * (1.0 - detail), 0.02, 1.0);
    let dndx = dpdx(N); let dndy = dpdy(N);
    let nVar = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));
    roughness = sqrt(clamp(roughness * roughness + min(2.0 * nVar, 0.2), 0.0, 1.0));

    // plain Schlick — see the GLSL twin on why the roughness-capped variant darkens the horizon
    let fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);

    let screenUv = getGrabScreenPos(input.vClipPos);
    let surfaceDepth = getLinearDepth(worldPos);
    let sceneDepth = getLinearScreenDepth(screenUv);
    var thickness = max(sceneDepth - surfaceDepth, 0.0);
    let opaquePos = uniform.view_position + camToPos * (sceneDepth / max(surfaceDepth, 1e-4));
    let receiverCross = cross(dpdx(opaquePos), dpdy(opaquePos));
    let receiverNormal = receiverCross * inverseSqrt(max(dot(receiverCross, receiverCross), 1e-8));
    let contactDistance = abs(dot(opaquePos - worldPos, receiverNormal));
    let contactNearby = 1.0 - smoothstep(2.0, 4.0, length(opaquePos - worldPos));

    let camFwd = -vec3f(uniform.matrix_view[0].z, uniform.matrix_view[1].z, uniform.matrix_view[2].z);
    let refrDir = refract(-V, N, select(IOR_AIR_WATER, IOR_WATER_AIR, underwater));
    let offsetPoint = worldPos + refrDir * min(thickness, uniform.uRefractionParams.z);
    var offset = (getGrabScreenPos(uniform.matrix_viewProjection * vec4f(offsetPoint, 1.0)) - screenUv) * uniform.uRefractionParams.x;
    offset = clamp(offset, vec2f(-0.05), vec2f(0.05));
    var refrUv = clamp(screenUv + offset, vec2f(0.001), vec2f(0.999));
    var refrDepth = getLinearScreenDepth(refrUv);
    if (refrDepth < surfaceDepth) { refrUv = screenUv; refrDepth = sceneDepth; }
    thickness = max(refrDepth - surfaceDepth, 0.0);
    let opticalDistance = thickness / max(dot(refrDir, camFwd), 0.15);
    let lod = min(opticalDistance * uniform.uRefractionParams.y, 4.0);
    var sceneColor = textureSampleLevel(uSceneColorMap, uSceneColorMapSampler, refrUv, lod).rgb;
    #ifdef SCENE_COLORMAP_GAMMA
        sceneColor = decodeGamma3(sceneColor);
    #endif

    let ambientUp = sampleAmbient(vec3f(0.0, 1.0, 0.0));
    let sunE = uniform.uSunColor;
    let sunUp = clamp(uniform.uSunDir.y, 0.0, 1.0);

    let causticPixelMetres = max(length(dpdx(opaquePos.xz)), length(dpdy(opaquePos.xz)));
    if (uniform.uCausticsParams.x > 0.0 && uniform.uDisplacementScale > 0.0 && thickness > 0.0 && !underwater && sunUp > 0.0) {
        let hit = worldPos + refrDir * opticalDistance;
        let depthBelow = max(uniform.uSeaLevel - hit.y, 0.0);
        let sunRay = waterCausticSunRay(uniform.uSunDir);
        let lightPath = depthBelow / max(-sunRay.y, 0.1);
        let entry = hit.xz - sunRay.xz * lightPath;
        let focus = waterCausticFocus(entry, depthBelow, uniform.uCausticsParams.y,
            uniform.uSunDir, causticPixelMetres);
        let facing = max(dot(receiverNormal, -sunRay), 0.0);
        let direct = dot(sunE, vec3f(0.2126, 0.7152, 0.0722)) * facing;
        let diffuseSky = dot(ambientUp, vec3f(0.2126, 0.7152, 0.0722)) * 3.14159265;
        let directFraction = direct / max(direct + diffuseSky, 1e-5);
        let fade = exp(-depthBelow * uniform.uCausticsParams.z) * smoothstep(0.02, 0.35, sunUp) * detail;
        let amount = uniform.uCausticsParams.x * min(uniform.uDisplacementScale, 1.0) * fade * directFraction;
        sceneColor *= max(vec3f(0.0), vec3f(1.0) + (focus - 1.0) * amount * exp(-uniform.uExtinction * lightPath));
    }

    let waveHeight = max(worldPos.y - uniform.uSeaLevel, 0.0);
    let Ls = normalize(-uniform.uSunDir + Nup * uniform.uSSSParams.w);
    let sssView = pow(clamp(dot(V, Ls), 0.0, 1.0), uniform.uSSSParams.y);
    let sssHeight = clamp(waveHeight * uniform.uSSSParams.z, 0.0, 1.0);
    let sss = uniform.uSSSColor * (sunE * sssView * sssHeight * uniform.uSSSParams.x * sunUp + ambientUp * sssHeight * uniform.uSSSParams.x * 0.25);

    let scatterRadiance = uniform.uScatterColor * uniform.uScatterStrength * (ambientUp + sunE * sunUp * 0.3183) + sss;
    let T = exp(-uniform.uExtinction * opticalDistance);
    let refracted = sceneColor * T + scatterRadiance * (1.0 - T);

    let windowRay = refract(-V, N, IOR_WATER_AIR);
    let sunWindowCos = dot(windowRay / max(length(windowRay), 1e-5), uniform.uSunDir);
    let sunWindowEdge = max(fwidth(sunWindowCos), 1e-6);
    var color: vec3f;
    if (underwater) {
        let up = refract(-V, N, IOR_WATER_AIR);
        let tir = select(0.0, 1.0, dot(up, up) < 1e-5);
        var skyThroughSurface = vec3f(0.0);
        if (tir < 0.5) {
            skyThroughSurface = sampleEnv(up, roughness) * uniform.uSurfaceParams.z;
            let sunCos = sunWindowCos;
            let radius = max(uniform.uSunRadius, 1e-4);
            let edge = sunWindowEdge;
            let disc = smoothstep(cos(radius) - edge, cos(radius) + edge, sunCos);
            skyThroughSurface += sunE * disc / max(3.14159265 * radius * radius, 1e-6);
        }
        let mirrored = scatterRadiance;
        let cosT = sqrt(max(1.0 - IOR_WATER_AIR * IOR_WATER_AIR * (1.0 - NdotV * NdotV), 0.0));
        let rs = (IOR_WATER_AIR * NdotV - cosT) / max(IOR_WATER_AIR * NdotV + cosT, 1e-5);
        let rp = (NdotV - IOR_WATER_AIR * cosT) / max(NdotV + IOR_WATER_AIR * cosT, 1e-5);
        let fUp = mix(0.5 * (rs * rs + rp * rp), 1.0, tir);
        color = mix(skyThroughSurface, mirrored, fUp);
    } else {
        var R = reflect(-V, N);
        var envRefl = sampleEnv(R, roughness) * uniform.uSurfaceParams.z;
        if (uniform.uSSRParams.x > 0.0 && roughness < 0.3 && R.y < 0.4) {
            let dither = fract(sin(dot(pcPosition.xy, vec2f(12.9898, 78.233))) * 43758.5453 + uniform.uTime);
            let ssr = traceSSR(worldPos, R, roughness, dither);
            let m = ssr.mask * uniform.uSSRParams.x * (1.0 - smoothstep(0.15, 0.35, roughness));
            envRefl = mix(envRefl, ssr.color, clamp(m, 0.0, 1.0));
        }
        let spec = ggxSpecular(N, V, uniform.uSunDir, roughness) * uniform.uSurfaceParams.w;
        let H = (V + uniform.uSunDir) / max(length(V + uniform.uSunDir), 1e-5);
        let FH = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
        let sunSpec = sunE * spec * FH;
        color = refracted * (1.0 - fresnel) + envRefl * fresnel + sunSpec;
    }

    // see the GLSL twin
    let foamMask = clamp((uniform.uFoamParams.x - jac) * uniform.uFoamParams.y, 0.0, 1.0);
    let foamUv = input.vSampleXZ * uniform.uFoamParams.z;
    let fa = textureSample(uFoamTex, uFoamTexSampler, foamUv + vec2f(uniform.uTime * 0.011, uniform.uTime * 0.006));
    let fb = textureSample(uFoamTex, uFoamTexSampler, foamUv * 2.83 - vec2f(uniform.uTime * 0.019, uniform.uTime * -0.013));
    let clumps = fa.r * 0.62 + fb.r * 0.38;
    let bubbles = fa.g * 0.5 + fb.g * 0.5;
    let lace = clamp(clumps * mix(0.72, 1.28, fa.b) + bubbles * 0.22, 0.0, 1.0);

    var whitecap = foamMask * smoothstep(1.0 - foamMask * 1.15, max(1.0 - foamMask * 0.22, 1.001 - foamMask * 1.15), lace);
    whitecap *= mix(0.72, 1.0, bubbles);
    whitecap *= 1.0 - 0.75 * smoothstep(700.0, 2600.0, dist);   // see the GLSL twin

    let shore = (1.0 - smoothstep(0.02, 0.55, contactDistance)) * contactNearby;
    let shoreBands = 0.5 + 0.5 * sin(contactDistance * 9.0 - uniform.uTime * 1.3 + fa.b * 5.0);
    let shoreFoam = shore * shore * clamp((lace * 0.9 + shoreBands * 0.5 + shore * 0.6 - 0.78) * 3.2, 0.0, 1.0);

    // ---- surf; see the GLSL twin ----
    var surfFoam = 0.0;
    if (uniform.uShoreParams2.w > 0.5) {
        let sdepth = input.vShore.x;
        let sh = textureSampleLevel(uShoreMap, uShoreMapSampler, clamp((input.vSampleXZ - uniform.uShoreArea.xy) * uniform.uShoreArea.zw, vec2f(0.0), vec2f(1.0)), 0.0);
        let offshore = sh.yz * 2.0 - 1.0;

        var phase = sdepth / max(uniform.uShoreParams.y, 0.05) + uniform.uTime * uniform.uShoreParams.z;
        phase += (fa.b - 0.5) * 0.35 + dot(input.vSampleXZ, offshore) * 0.004;
        let band = 0.5 - 0.5 * cos(phase * 6.28318530718);

        let breaking = 1.0 - smoothstep(uniform.uShoreParams.w * 0.3, uniform.uShoreParams.w * 1.4, sdepth);
        let crest = pow(band, 3.0);
        let surf = crest * breaking;
        // swash: a lace a metre or two wide that runs up the sand and drains back, not a sheet
        let swashPulse = 0.4 + 0.6 * (0.5 + 0.5 * sin(uniform.uTime * 0.9 + fa.b * 6.0 + sdepth * 4.0));
        let swash = uniform.uShoreParams2.y * (1.0 - smoothstep(0.0, uniform.uShoreParams.w * 0.2, sdepth)) * swashPulse;

        surfFoam = clamp((surf + swash) * lace * 1.15 * uniform.uShoreParams2.x, 0.0, 1.0) * input.vShore.y;
    }

    var foam = clamp((whitecap + shoreFoam + surfFoam) * uniform.uFoamStrength, 0.0, 1.0);
    if (underwater) { foam *= 0.25; }

    let aerate = clamp((fa.a * 0.7 + fb.a * 0.3) * foamMask * uniform.uFoamStrength - 0.25, 0.0, 1.0) * 0.22;
    let NdotL = max(dot(Nup, uniform.uSunDir), 0.0);
    var foamLit = uniform.uFoamColor * (ambientUp + sunE * (NdotL * 0.85 + 0.15) * 0.3183);
    if (!underwater) { foamLit = mix(foamLit, sampleEnv(reflect(-V, Nup), 0.35), fresnel * 0.55); }
    color = mix(color, foamLit * 0.55, aerate * (1.0 - foam));
    color = mix(color, foamLit, foam);

    if (!underwater) {
        let apDir = normalize(vec3f(camToPos.x, max(camToPos.y, 0.0), camToPos.z));
        let horizonSky = sampleAerial(apDir);
        let coverage = 1.0 - smoothstep(uniform.uWaterRadius * 0.72, uniform.uWaterRadius * 0.98, dist);
        color = mix(horizonSky, color, exp(-uniform.uFogDensity * dist) * coverage);
    } else {
        color = mix(scatterRadiance, color, exp(-uniform.uExtinction * dist));
    }
    // The surface dissolves where the water runs out of depth, so the shoreline is a wet gradient
    // rather than a cut; the foam lying in the swash stays.
    var alpha = 1.0;
    if (!underwater) { alpha = clamp(smoothstep(0.0, 0.08, mix(1.0, contactDistance, contactNearby)) + foam * 0.7, 0.0, 1.0); }
    output.color = vec4f(gammaCorrectOutput(toneMap(clamp(color, vec3f(0.0), vec3f(60000.0)))), alpha);
    return output;
}
`;

/**
 * The supported water configuration. Partial objects are accepted by the constructor, set() and
 * reset(). Colours are linear RGB; distances are metres; headings are degrees.
 *
 * @typedef {object} WaterConfig
 * @property {number} seaLevel - World Y of the undisturbed surface.
 * @property {'low'|'medium'|'high'} quality - A matched FFT, tessellation and reflection budget.
 * @property {{speed:number, direction:number}} wind - Wind sea, with speed in metres per second.
 * @property {{strength:number, direction:number}} swell - Independent long-period wave energy.
 * @property {{amplitude:number, choppiness:number}} waves - Displacement and crest-shape multipliers.
 * @property {number} roughness - Microfacet roughness, from 0 to 1.
 * @property {{color:number[], visibility:number}} volume - Scattered colour and approximate green
 * channel 1/e attenuation distance. Extinction is [3.2, 1, 0.6] / visibility in inverse metres.
 * @property {number} foam - Foam coverage multiplier. Zero removes foam.
 * @property {{enabled:boolean, strength:number, scale:number}} caustics - Focused light, with scale
 * setting the inverse filtering footprint in metres; the pattern follows the FFT waves. Opt-in.
 * @property {number} seed - Reproducible unsigned 32-bit wave seed.
 * @property {number} timeScale - Simulation speed. Zero pauses water animation.
 */
const WATER_DEFAULTS = freezeConfig({
    seaLevel: 0,
    quality: 'medium',
    wind: { speed: 9, direction: 35 },
    swell: { strength: 0.6, direction: -20 },
    waves: { amplitude: 1, choppiness: 1.4 },
    roughness: 0.06,
    volume: { color: [0.003, 0.075, 0.11], visibility: 10 },
    foam: 1,
    caustics: { enabled: false, strength: 1, scale: 0.2 },
    seed: 1337,
    timeScale: 1
});

/** Internal configuration helpers. The package exposes defaults, not the merge machinery. */
function freezeConfig(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freezeConfig);
        Object.freeze(value);
    }
    return value;
}

const isObject = value => value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function mergeConfig(base, patch, path = '') {
    if (!isObject(patch)) throw new TypeError(`Water: ${path || 'configuration'} must be a plain object`);
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        const name = path ? `${path}.${key}` : key;
        if (!Object.hasOwn(base, key)) throw new TypeError(`Water: unknown configuration field "${name}"`);
        if (value === undefined) continue;
        if (isObject(base[key])) result[key] = mergeConfig(base[key], value, name);
        else if (Array.isArray(base[key])) {
            if (!Array.isArray(value)) throw new TypeError(`Water: ${name} must be an array`);
            result[key] = value.slice();
        } else {
            if (typeof value !== typeof base[key]) throw new TypeError(`Water: ${name} must be a ${typeof base[key]}`);
            result[key] = value;
        }
    }
    return result;
}

const RANGES = {
    seaLevel: [-Infinity, Infinity],
    'wind.speed': [0, 40], 'wind.direction': [-Infinity, Infinity],
    'swell.strength': [0, 3], 'swell.direction': [-Infinity, Infinity],
    'waves.amplitude': [0, 3], 'waves.choppiness': [0, 2.5],
    roughness: [0, 1], 'volume.visibility': [0.1, 1000],
    foam: [0, 2], 'caustics.strength': [0, 4], 'caustics.scale': [0.01, 2],
    seed: [0, 0xffffffff], timeScale: [0, 10]
};

function validateNumbers(value, path = '') {
    for (const [key, item] of Object.entries(value)) {
        const name = path ? `${path}.${key}` : key;
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            validateNumbers(item, name);
        } else if (typeof item === 'number') {
            const [min, max] = RANGES[name];
            if (!Number.isFinite(item) || item < min || item > max) {
                throw new RangeError(`Water: ${name} must be finite and in [${min}, ${max}]`);
            }
        }
    }
}

/** Validate an entire partial update before changing the live instance. */
function resolveWaterConfig(patch = {}, base = WATER_DEFAULTS) {
    const next = mergeConfig(base, patch);
    validateNumbers(next);
    if (!['low', 'medium', 'high'].includes(next.quality)) {
        throw new RangeError('Water: quality must be low, medium or high');
    }
    if (!Number.isInteger(next.seed)) throw new RangeError('Water: seed must be an unsigned 32-bit integer');
    const color = next.volume.color;
    if (color.length !== 3 || !Array.from(color).every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
        throw new TypeError('Water: volume.color must contain three linear RGB values in [0, 1]');
    }
    // Normalize equivalent headings so repeating a full turn does not regenerate the spectrum.
    for (const key of ['wind', 'swell']) {
        const direction = ((next[key].direction + 180) % 360 + 360) % 360 - 180;
        if (direction !== next[key].direction) next[key] = { ...next[key], direction };
    }
    return freezeConfig(next);
}

function configEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && configEqual(a[key], b[key]));
}

/** @typedef {import('./config.js').WaterConfig} WaterConfig */

// Implementation choices are deliberately not a second public configuration surface.
const QUALITY_TIERS = {
    low: { resolution: 128, sectors: 128, rings: 192, reflectionSteps: 12 },
    medium: { resolution: 256, sectors: 256, rings: 320, reflectionSteps: 18 },
    high: { resolution: 512, sectors: 384, rings: 420, reflectionSteps: 28 }
};
const CASCADE_LENGTHS = [1024, 256, 48, 8];
const CASCADE_FADE_START = 12;
const CASCADE_FADE_END = 30;
const SURFACE_RADIUS = 20000;
const SOLAR_ANGULAR_RADIUS = 0.00465;
const EARTH_GRAVITY = 9.81;
const DEEP_WATER_DEPTH = 500;
const FOAM_CASCADE_WEIGHTS = [1, 1, 0.4, 0.1];
const FOAM_COLOR = [0.92, 0.96, 1];
const CREST_SCATTER_COLOR = [0.06, 0.55, 0.45];
const CREST_SCATTER_PARAMS = [0.35, 6, 0.6, 0.35]; // strength, angular exponent, height, normal bias
const REFRACTION_PARAMS = [0.7, 0.12, 4, 0]; // offset, distance blur, offset depth limit
const FOAM_SURFACE_PARAMS = [0.68, 3, 0.07, 1]; // Jacobian threshold, edge, frequency, contact depth
const SHORE_RESPONSE = [1, 0.4, 0.6]; // surf, swash, shoaling
const CAUSTIC_DEPTH_FADE = 0.09;

/**
 * A configurable, physically-based water surface.
 *
 * A cascaded FFT wave simulation (WebGPU compute, with a WebGL2 fragment fallback) drives a
 * camera-following polar mesh. Everything about the look and the sea state lives in one config
 * object which can be patched at any time with {@link Water#set}.
 *
 * ```js
 * const water = new Water(app, { wind: { speed: 14 } });
 * app.on('update', dt => water.update(dt, camera));
 * water.set({ volume: { visibility: 20 } });
 * const y = water.getHeightAt(x, z);   // for buoyancy
 * ```
 */
class Water {
    /**
     * @param {import('playcanvas').AppBase} app - The application.
     * @param {Partial<WaterConfig>} [config] - Partial configuration; anything omitted uses the default.
     */
    constructor(app, config = {}) {
        this._app = app;
        this._device = app.graphicsDevice;

        this._config = resolveWaterConfig(config);
        this._time = 0;
        this._sunDirection = new Vec3(0, 1, 0);
        this._sunColor = new Color(1, 1, 1);
        this._hazeDensity = 0;
        this._destroyed = false;
        this._cascadeData = new Float32Array(16);
        this._envAtlas = null;
        this._skyRadiance = null;
        this._environmentExposure = 1;
        this._rebuildSim = false;
        this._rebuildMesh = false;

        this._simulation = new WaveSimulation(this._device, this._simParams());

        this._material = new ShaderMaterial({
            uniqueName: 'WaterSurface',
            attributes: { vertex_position: SEMANTIC_POSITION },
            vertexGLSL: WATER_VS,
            fragmentGLSL: WATER_FS,
            vertexWGSL: WATER_VS_WGSL,
            fragmentWGSL: WATER_FS_WGSL
        });
        // rendered in the transparent pass so the scene colour / depth grab includes everything below
        this._material.blendType = BLEND_NORMAL;
        this._material.depthWrite = true;
        this._material.cull = CULLFACE_NONE;
        this._material.setDefine('{ENV_DECODE}', 'decodeRGBP');

        this._foamTexture = createFoamTexture(this._device);
        this._material.setParameter('uFoamTex', this._foamTexture);

        this._deepWaterMap = createDeepWaterMap(this._device);
        /** @type {import('./shoreMap.js').ShoreMap|null} */
        this._shoreMap = null;
        this._material.setParameter('uShoreMap', this._deepWaterMap);
        this._material.setParameter('uShoreArea', [0, 0, 1, 1]);

        this._mesh = createWaterMesh(this._device, this._meshParams());
        this._builtMeshParams = this._meshParams();
        this._meshInstance = new MeshInstance(this._mesh, this._material);
        this._meshInstance.cull = false;
        this._meshInstance.castShadow = false;
        this._meshInstance.receiveShadow = false;

        this._entity = new Entity('Water');
        this._entity.addComponent('render', {
            meshInstances: [this._meshInstance], layers: [LAYERID_WORLD], castShadows: false
        });
        app.root.addChild(this._entity);

        this._probe = new WaveProbe(this);
    }

    /** Whether the wave simulation is running on WebGPU compute shaders. */
    get usesCompute() { return this._simulation.useCompute; }

    /** @type {WaterConfig} Immutable snapshot. Use set() or reset() to change it. */
    get config() { return this._config; }

    /** Elapsed simulation seconds, including timeScale and the simulation's delta clamp. */
    get time() { return this._time; }

    /** Copy of the light direction supplied to setEnvironment(). */
    get sunDirection() { return this._sunDirection.clone(); }

    /** Copy of the linear irradiance supplied to setEnvironment(). */
    get sunColor() { return this._sunColor.clone(); }

    /** Surface Y of the undisturbed water plane. */
    get seaLevel() { return this.config.seaLevel; }

    /**
     * Patch the configuration. Only the fields present in the patch change, and the minimum amount
     * of GPU work is redone. FFT layout and tessellation changes rebuild on the next update();
     * only changes to wind, swell or seed regenerate the initial spectrum.
     * Invalid patches throw before any state changes. Arrays are replaced in full.
     *
     * @param {Partial<WaterConfig>} patch - The fields to change.
     */
    set(patch) {
        this._assertAlive();
        return this._setConfig(resolveWaterConfig(patch, this.config));
    }

    /** Replace all settings with defaults plus config. Assigned environment and shore map remain. */
    reset(config = {}) {
        this._assertAlive();
        return this._setConfig(resolveWaterConfig(config));
    }

    _setConfig(next) {
        if (this._shoreMap && next.seaLevel !== this._shoreMap.seaLevel) {
            throw new RangeError('Water: detach the shore map before changing seaLevel, then bake and attach a map at the new level');
        }
        const before = this.config;
        if (configEqual(before, next)) return this;
        this._config = next;
        const params = this._simParams();
        const current = this._simulation.params;
        this._rebuildSim = ['size', 'lengthScales', 'cascadeOverlap'].some(key => !configEqual(current[key], params[key]));
        if (!this._rebuildSim) {
            const spectrumChanged = ['wind', 'swell', 'depth', 'gravity', 'seed'].some(key => !configEqual(current[key], params[key]));
            Object.assign(current, params);
            if (spectrumChanged) this._simulation.invalidateSpectrum();
        }
        this._rebuildMesh = !configEqual(this._builtMeshParams, this._meshParams());
        if (['seaLevel', 'waves', 'wind', 'swell', 'seed'].some(key => !configEqual(before[key], next[key]))) this._probe.rebuild();
        return this;
    }

    _assertAlive() {
        if (this._destroyed) throw new Error('Water: this instance has been destroyed');
    }

    /** Apply any deferred resource rebuild. Called at the top of {@link Water#update}. */
    _applyPendingRebuilds() {
        if (this._rebuildSim) {
            this._simulation.rebuild(this._simParams());
            this._probe.rebuild();
            this._rebuildSim = false;
        }
        if (this._rebuildMesh) {
            const old = this._mesh;
            this._mesh = createWaterMesh(this._device, this._meshParams());
            this._meshInstance.mesh = this._mesh;
            this._builtMeshParams = this._meshParams();
            this._rebuildMesh = false;
            old.destroy();
        }
    }

    /** Translate the public config into the flat parameter block the simulation expects. */
    _simParams() {
        const cfg = this.config;
        const q = QUALITY_TIERS[cfg.quality];
        const speed = cfg.wind.speed;
        return {
            size: q.resolution,
            lengthScales: CASCADE_LENGTHS.slice(),
            cascadeOverlap: 6,
            depth: DEEP_WATER_DEPTH,
            gravity: EARTH_GRAVITY,
            seed: cfg.seed,
            choppiness: cfg.waves.choppiness,
            foamDecay: 0.8,
            timeScale: cfg.timeScale,
            wind: {
                scale: speed === 0 ? 0 : 1, windSpeed: Math.max(speed, 0.1), windDirection: cfg.wind.direction,
                fetch: Math.max(10000, Math.min(1000000, 120000 * (speed / 9) ** 2)),
                spreadBlend: 0.9, swell: 0.25, peakEnhancement: 3.3, shortWavesFade: 0.0075
            },
            swell: {
                scale: cfg.swell.strength, windSpeed: 6, windDirection: cfg.swell.direction,
                fetch: 800000, spreadBlend: 1, swell: 1, peakEnhancement: 3.3, shortWavesFade: 0.05
            }
        };
    }

    _meshParams() {
        const q = QUALITY_TIERS[this.config.quality];
        return { sectors: q.sectors, rings: q.rings, outerRadius: SURFACE_RADIUS };
    }

    /**
     * Give the water a coast to break on.
     *
     * Pass a map baked by {@link import('./shoreMap.js').bakeShoreMap} and the shore model turns on:
     * the swell shoals and rears as the bed rises, breaks into shore-parallel bands of surf, and
     * leaves foam washing on the sand. Pass null to go back to open ocean. The map remains owned
     * by the caller: detach it before calling map.destroy(). It must be baked at this sea level.
     *
     * @param {import('./shoreMap.js').ShoreMap|null} map - The baked coast, or null.
     */
    setShoreMap(map) {
        this._assertAlive();
        if (map !== null) validateShoreMap(map, this.seaLevel);
        this._shoreMap = map;
        this._material.setParameter('uShoreMap', map ? map.texture : this._deepWaterMap);
        this._material.setParameter('uShoreArea', map
            ? [map.origin[0], map.origin[1], 1 / map.size[0], 1 / map.size[1]]
            : [0, 0, 1, 1]);
        return this;
    }

    /**
     * Assign the environment the surface reflects and the sun it is lit by.
     *
     * @param {object} environment - Caller-owned illumination resources, independent of any sky library.
     * @param {import('playcanvas').Texture} environment.atlas - Prefiltered PlayCanvas RGBP atlas.
     * @param {Vec3} environment.sunDirection - Direction towards the sun.
     * @param {Color} environment.sunColor - Linear solar irradiance, already including exposure.
     * @param {import('playcanvas').Texture} [environment.radiance] - Linear, sun-free equirectangular sky.
     * @param {number} [environment.exposure=1] - Scale for atlas and equirectangular radiance.
     * @param {number} [environment.hazeDensity=0] - Aerial extinction in inverse metres.
     */
    setEnvironment(environment) {
        this._assertAlive();
        if (!environment || typeof environment !== 'object' || Array.isArray(environment)) throw new TypeError('Water: environment must be an object');
        const allowed = ['atlas', 'radiance', 'sunDirection', 'sunColor', 'exposure', 'hazeDensity'];
        for (const key of Object.keys(environment)) if (!allowed.includes(key)) throw new TypeError(`Water: unknown environment field "${key}"`);
        const { atlas, radiance = null, sunDirection, sunColor, exposure = 1, hazeDensity = 0 } = environment;
        if (!atlas || typeof atlas !== 'object') throw new TypeError('Water: atlas must be a prefiltered texture');
        if (radiance !== null && typeof radiance !== 'object') throw new TypeError('Water: radiance must be a linear equirectangular texture');
        if (![exposure, hazeDensity].every(v => Number.isFinite(v) && v >= 0)) throw new RangeError('Water: exposure and hazeDensity must be finite and non-negative');
        if (!sunDirection || ![sunDirection.x, sunDirection.y, sunDirection.z].every(Number.isFinite) ||
            Math.hypot(sunDirection.x, sunDirection.y, sunDirection.z) === 0) {
            throw new TypeError('Water: sunDirection must be a finite non-zero vector');
        }
        if (!sunColor || ![sunColor.r, sunColor.g, sunColor.b].every(v => Number.isFinite(v) && v >= 0)) {
            throw new TypeError('Water: sunColor must contain finite non-negative linear RGB values');
        }
        this._envAtlas = atlas;
        this._skyRadiance = radiance;
        this._environmentExposure = exposure;
        this._hazeDensity = hazeDensity;
        this._material.setParameter('texture_envAtlas', atlas);
        this._material.setParameter('uSkyRadiance', radiance || atlas);
        this._material.setParameter('uHasSkyRadiance', radiance ? 1 : 0);
        this._material.setParameter('uEnvironmentExposure', exposure);
        this._sunDirection.copy(sunDirection).normalize();
        this._sunColor.copy(sunColor);
        return this;
    }

    /**
     * The surface height at a world XZ position, in metres. Backed by an asynchronous GPU readback,
     * updated at most once every three frames. New queries return seaLevel until the first readback.
     * Suitable for approximate buoyancy, not exact collision. Queries evaluate the FFT field and do
     * not include the visual shoreline deformation or distance filtering applied to the mesh.
     *
     * @param {number} x - World X.
     * @param {number} z - World Z.
     * @returns {number} World Y of the surface.
     */
    getHeightAt(x, z) {
        return this.getSurfaceAt(x, z).position.y;
    }

    /**
     * Full surface state at a world XZ position: the displaced point and its normal. Use this to
     * float and tilt an object convincingly. See {@link Water#getHeightAt} for the latency caveat.
     *
     * @param {number} x - World X.
     * @param {number} z - World Z.
     * @returns {{position: Vec3, normal: Vec3}} Borrowed query result updated in place; clone to retain.
     */
    getSurfaceAt(x, z) {
        this._assertAlive();
        if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('Water: query coordinates must be finite numbers');
        return this._probe.sample(x, z);
    }

    /**
     * Whether a world position is below the water surface, accounting for the waves.
     *
     * @param {Vec3} position - World position to test.
     * @returns {boolean} True when submerged.
     */
    isSubmerged(position) {
        return position.y < this.getHeightAt(position.x, position.z);
    }

    /** Opt an opaque StandardMaterial into underwater attenuation and wave caustics.
     * Returns a detach function. Material and texture ownership remain with the caller.
     * Its fog chunk is reserved while attached; call detach before destroying the material.
     */
    addReceiver(material) {
        this._assertAlive();
        if (!(material instanceof StandardMaterial)) {
            throw new TypeError('Water.addReceiver requires a StandardMaterial');
        }
        this._receivers ??= new Map();
        if (this._receivers.has(material)) return this._receivers.get(material);
        const restore = attachReceiver(material);
        const detach = () => {
            if (!this._receivers.delete(material)) return;
            restore();
        };
        this._receivers.set(material, detach);
        this._bindReceiver(material);
        return detach;
    }

    _bindReceiver(material) {
        const cfg = this.config, vol = cfg.volume, c = cfg.caustics;
        const sd = this._sunDirection, sc = this._sunColor;
        bindCausticWaves(material, this._simulation, cfg);
        material.setParameter('uReceiverExtinction', [3.2, 1, 0.6].map(e => e / vol.visibility));
        material.setParameter('uReceiverScatter', vol.color);
        material.setParameter('uReceiverSun', [sd.x, sd.y, sd.z]);
        material.setParameter('uReceiverSunColor', [sc.r, sc.g, sc.b]);
        material.setParameter('uReceiverParams', [cfg.seaLevel, c.enabled ? c.strength : 0, c.scale, this._skyRadiance ? this._environmentExposure : 0]);
        material.setParameter('uReceiverSky', this._skyRadiance || this._deepWaterMap);
    }

    /**
     * Step the simulation and push uniforms. Call once per frame from the app's `update` event,
     * before rendering.
     *
     * @param {number} dt - Frame delta time in seconds.
     * @param {import('playcanvas').Entity} cameraEntity - Camera the surface follows and fades against.
     */
    update(dt, cameraEntity) {
        this._assertAlive();
        if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Water: dt must be a finite non-negative number of seconds');
        if (!cameraEntity || typeof cameraEntity.getPosition !== 'function') throw new TypeError('Water: update requires a camera entity');
        this._applyPendingRebuilds();
        const cfg = this.config;
        const sim = this._simulation;
        sim.update(dt);
        this._time = sim.time;
        this._probe.update();

        // the surface disc follows the camera in XZ; the wave field is sampled in world space so the
        // tessellation just slides underneath it
        const cp = cameraEntity.getPosition();
        this._entity.setPosition(cp.x, 0, cp.z);

        const m = this._material;
        const disp = sim.displacementTextures;
        const deriv = sim.derivativeTextures;
        const scales = sim.lengthScales;
        const n = disp.length;
        for (let i = 0; i < 4; i++) {
            const j = Math.min(i, n - 1);
            m.setParameter(`uDisp${i}`, disp[j]);
            m.setParameter(`uDeriv${i}`, deriv[j]);
            const L = scales[j];
            this._cascadeData[i * 4 + 0] = L;
            this._cascadeData[i * 4 + 1] = L * CASCADE_FADE_START;
            this._cascadeData[i * 4 + 2] = L * CASCADE_FADE_END;
            this._cascadeData[i * 4 + 3] = 1 / L;
        }
        m.setParameter('uCascade[0]', this._cascadeData);   // WebGL names the array uniform 'uCascade[0]'
        m.setParameter('uCascade', this._cascadeData);      // WebGPU reflects it as 'uCascade'
        m.setParameter('uNumCascades', n);
        // vertex spacing of the polar grid as a fraction of radius: the larger of the radial and
        // angular steps. The vertex shader turns it into a mip level per cascade.
        const mp = this._meshParams();
        const growth = Math.log(mp.outerRadius / 0.5) / (mp.rings - 1);
        m.setParameter('uMeshLod', [Math.max(growth, 2 * Math.PI / mp.sectors), 0.5, this._simulation.params.size, 0]);
        m.setParameter('uWaterRadius', mp.outerRadius);
        m.setParameter('uLambda', cfg.waves.choppiness);
        m.setParameter('uDisplacementScale', cfg.waves.amplitude);
        m.setParameter('uSeaLevel', cfg.seaLevel);
        m.setParameter('uTime', this.time);

        const sd = this._sunDirection, sc = this._sunColor;
        m.setParameter('uSunDir', [sd.x, sd.y, sd.z]);
        m.setParameter('uSunColor', [sc.r, sc.g, sc.b]);
        m.setParameter('uSunRadius', SOLAR_ANGULAR_RADIUS);

        const vol = cfg.volume;
        m.setParameter('uExtinction', [3.2 / vol.visibility, 1 / vol.visibility, 0.6 / vol.visibility]);
        m.setParameter('uScatterColor', vol.color);
        m.setParameter('uScatterStrength', 1);
        m.setParameter('uSSSColor', CREST_SCATTER_COLOR);
        m.setParameter('uSSSParams', CREST_SCATTER_PARAMS);

        m.setParameter('uSurfaceParams', [cfg.roughness, 0.15, 1, 1]);
        m.setParameter('uRefractionParams', REFRACTION_PARAMS);
        m.setParameter('uSSRParams', [0.9, 220, QUALITY_TIERS[cfg.quality].reflectionSteps, 1.5]);

        bindCausticWaves(m, sim, cfg);
        const c = cfg.caustics;
        for (const receiver of this._receivers?.keys() ?? []) this._bindReceiver(receiver);
        m.setParameter('uCausticsParams', [c.enabled ? c.strength : 0, c.scale, CAUSTIC_DEPTH_FADE]);

        const active = this._shoreMap ? 1 : 0;
        m.setParameter('uShoreParams', [this._shoreMap ? this._shoreMap.maxDepth : 1, 5, 0.16, 2.4]);
        m.setParameter('uShoreParams2', [...SHORE_RESPONSE, active]);

        m.setParameter('uFoamParams', FOAM_SURFACE_PARAMS);
        m.setParameter('uFoamColor', FOAM_COLOR);
        m.setParameter('uFoamStrength', cfg.foam);
        m.setParameter('uFoamCascadeWeights', FOAM_CASCADE_WEIGHTS);
        m.setParameter('uFogDensity', this._hazeDensity);
        m.setParameter('uSkyRadiance', this._skyRadiance || this._envAtlas || this._deepWaterMap);
        m.setParameter('uHasSkyRadiance', this._skyRadiance ? 1 : 0);
        m.setParameter('uEnvironmentExposure', this._environmentExposure);
    }

    /** Release owned resources. Safe to call twice. Supplied environment and shore maps survive. */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        for (const detach of [...(this._receivers?.values() ?? [])]) detach();
        this._probe.destroy();
        // RenderComponent destroys its mesh instances. Detach the mesh so its ownership stays here.
        this._meshInstance.mesh = null;
        this._entity.destroy();
        this._foamTexture.destroy();
        this._deepWaterMap.destroy();
        this._simulation.destroy();
        this._mesh.destroy();
        this._material.destroy();
        this._shoreMap = null;
        this._envAtlas = null;
        this._skyRadiance = null;
    }
}

export { WATER_DEFAULTS, Water, bakeShoreMap };
