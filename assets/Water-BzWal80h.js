var oe=Object.defineProperty;var ne=(o,e,r)=>e in o?oe(o,e,{enumerable:!0,configurable:!0,writable:!0,value:r}):o[e]=r;var S=(o,e,r)=>ne(o,typeof e!="symbol"?e+"":e,r);import{bt as T,bu as ue,bv as ce,I as J,J as q,bw as Y,w as F,aJ as ee,aO as L,aN as b,P as O,x as y,F as R,p as W,W as le,B as me,V as k,b1 as H,C as fe,U as pe,aA as de,aD as he,m as ve,E as ge,bx as xe,k as Se}from"./Sky-BTEONCv1.js";class we{constructor(){S(this,"value");S(this,"scopeId",null)}}class A{constructor(e,r,t="Unnamed"){S(this,"shader",null);S(this,"name");S(this,"parameters",new Map);S(this,"countX",1);S(this,"countY");S(this,"countZ");S(this,"indirectSlotIndex",-1);S(this,"indirectBuffer",null);S(this,"indirectFrameStamp",0);this.device=e,this.shader=r,this.name=t,e.supportsCompute&&(this.impl=e.createComputeImpl(this))}setParameter(e,r){let t=this.parameters.get(e);t||(t=new we,t.scopeId=this.device.scope.resolve(e),this.parameters.set(e,t)),t.value=r}getParameter(e){var r;return(r=this.parameters.get(e))==null?void 0:r.value}deleteParameter(e){this.parameters.delete(e)}destroy(){var e;(e=this.impl)==null||e.destroy(),this.impl=null}applyParameters(){for(const[,e]of this.parameters)e.scopeId.setValue(e.value)}setupDispatch(e,r,t){this.countX=e,this.countY=r,this.countZ=t,this.indirectSlotIndex=-1,this.indirectBuffer=null}setupIndirectDispatch(e,r=null){this.indirectSlotIndex=e,this.indirectBuffer=r,this.indirectFrameStamp=this.device.renderVersion}static calcDispatchSize(e,r,t=65535){if(e<=t)return r.set(e,1);const s=Math.ceil(e/t);return r.set(Math.ceil(e/s),s)}}const te=`
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
`,ae=`
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
`,ye=te.replace(/uniform sampler2D uCaustWave[01];\n/g,"").replace(/uCaustWave([01])/g,(o,e)=>`uDeriv${Number(e)+2}`),_e=ae.replace(/var uCaustWave[01](?:Sampler)?: [^;]+;\n/g,"").replace(/uCaustWave([01])/g,(o,e)=>`uDeriv${Number(e)+2}`),V=new WeakSet;function Z(o,e,r){const t=[];for(let s=0;s<2;s++){const i=Math.max(0,e.lengthScales.length-2+s);o.setParameter(`uCaustWave${s}`,e.derivativeTextures[i]),t.push(1/e.lengthScales[i])}o.setParameter("uCaustWaveScales",t),o.setParameter("uCaustWaveSettings",[r.waves.amplitude,r.waves.choppiness,e.params.size])}const be=`
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
${te}
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
`,De=`
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
${ae}
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
`;function Pe(o){if(V.has(o))throw new Error("Material already belongs to another water receiver");V.add(o);const{glsl:e,wgsl:r}=o.shaderChunks,t=[e.get("fogPS"),r.get("fogPS")];return e.set("fogPS",be),r.set("fogPS",De),o.update(),()=>{V.delete(o);for(const[s,i]of[e,r].entries())t[s]===void 0?i.delete("fogPS"):i.set("fogPS",t[s]);for(const s of["uCaustWave0","uCaustWave1","uCaustWaveScales","uCaustWaveSettings","uReceiverExtinction","uReceiverScatter","uReceiverSun","uReceiverSunColor","uReceiverParams","uReceiverSky"])o.deleteParameter(s);o.update()}}const re=`
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
`,Ce=`
attribute vec2 aPosition;
varying vec2 uv0;
void main(void) {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    uv0 = (aPosition.xy + 1.0) * 0.5;
}
`,Re=`
${re}
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
`,ke=`
${re}
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
`,ze=`
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
`,Le=`
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
`,$=`
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
`;function Fe(o){return`
${$}
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
    let n = ${o};
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
    let n = ${o};
    let texel = vec2i(gid.xy);
    if (texel.x >= n || texel.y >= n) { return; }
    let mirror = vec2i((n - texel.x) % n, (n - texel.y) % n);
    let a = h0(texel);
    let b = h0(mirror);
    textureStore(uOut, texel, vec4f(a, cconj(b)));
}
`}function Ae(o){return`
${$}
uniform uLengthScale: f32;
uniform uDepth: f32;
uniform uGravity: f32;
uniform uTime: f32;
var uSpectrum: texture_2d<f32>;
var uOut0: texture_storage_2d<rgba32float, write>;
var uOut1: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let n = ${o};
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
`}function Ee(o){const e=Math.log2(o)|0,r=o/2;return`
${$}
uniform uVertical: u32;
var uIn0: texture_2d<f32>;
var uIn1: texture_2d<f32>;
var uOut0: texture_storage_2d<rgba32float, write>;
var uOut1: texture_storage_2d<rgba32float, write>;

var<workgroup> s0: array<vec4f, ${o}>;
var<workgroup> s1: array<vec4f, ${o}>;

fn bitReverse(xIn: u32) -> u32 {
    var x = xIn;
    var r = 0u;
    for (var i = 0u; i < ${e}u; i++) {
        r = (r << 1u) | (x & 1u);
        x >>= 1u;
    }
    return r;
}

fn coord(line: u32, i: u32) -> vec2i {
    if (uniform.uVertical == 1u) { return vec2i(i32(line), i32(i)); }
    return vec2i(i32(i), i32(line));
}

@compute @workgroup_size(${r}, 1, 1)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let line = wid.x;
    let t = lid.x;

    // load with bit-reversal permutation
    for (var i = t; i < ${o}u; i += ${r}u) {
        let src = bitReverse(i);
        s0[i] = textureLoad(uIn0, coord(line, src), 0);
        s1[i] = textureLoad(uIn1, coord(line, src), 0);
    }
    workgroupBarrier();

    for (var stage = 0u; stage < ${e}u; stage++) {
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

    for (var i = t; i < ${o}u; i += ${r}u) {
        textureStore(uOut0, coord(line, i), s0[i]);
        textureStore(uOut1, coord(line, i), s1[i]);
    }
}
`}function Te(o){return`
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
    let n = ${o};
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
`}const We={size:256,lengthScales:[1024,256,48,8],cascadeOverlap:6,depth:500,gravity:9.81,seed:1337,choppiness:1.4,foamDecay:.6,timeScale:1,wind:{scale:1,windSpeed:9,windDirection:35,fetch:12e4,spreadBlend:.9,swell:.25,peakEnhancement:3.3,shortWavesFade:.015},swell:{scale:.6,windSpeed:4,windDirection:-20,fetch:5e5,spreadBlend:1,swell:1,peakEnhancement:3.3,shortWavesFade:.05}};function N(o,e){const r=.076*Math.pow(o.windSpeed*o.windSpeed/(o.fetch*e),.22),t=22*Math.pow(e*e/(o.windSpeed*o.fetch),1/3);return{p0:[o.scale,o.windDirection*Math.PI/180,o.spreadBlend,o.swell],p1:[r,t,o.peakEnhancement,o.shortWavesFade]}}function C(o,e,r,t,s,i,a,n=!1){return new F(o,{name:e,width:r,height:r,format:t,mipmaps:n,minFilter:n?ee:s,magFilter:s,anisotropy:n?16:1,addressU:i,addressV:i,storage:!!a})}class Me{constructor(e,r={}){this.device=e,this.params=structuredClone(We),Object.assign(this.params,r),this.useCompute=!!e.supportsCompute,this.time=0,this.frame=0,this.cascades=[],this._spectrumDirty=!0,this._build()}get numCascades(){return this.cascades.length}get size(){return this.params.size}get displacementTextures(){return this.cascades.map(e=>e.sampled?e.sampled.displacement:e.displacement[e.pingIndex])}get derivativeTextures(){return this.cascades.map(e=>e.sampled?e.sampled.derivatives:e.derivatives)}get lengthScales(){return this.params.lengthScales}invalidateSpectrum(){this._spectrumDirty=!0}rebuild(e={}){Object.assign(this.params,e),this.destroy(),this.frame=0,this._build()}_build(){var s,i;const{device:e,params:r}=this,t=r.size;if((t&t-1)!==0||t<16||t>1024)throw new Error("Water: FFT size must be a power of two in [16, 1024]");if(this.useCompute){const a=((s=e.limits)==null?void 0:s.maxComputeWorkgroupSizeX)??256,n=((i=e.limits)==null?void 0:i.maxComputeWorkgroupStorageSize)??16384;(t/2>a||t*32>n)&&(console.warn(`Water: FFT size ${t} exceeds compute limits, using fragment path`),this.useCompute=!1)}this.log2N=Math.log2(t)|0,this.cascades=r.lengthScales.map((a,n)=>this._createCascade(n,a)),this._spectrumDirty=!0,this.useCompute?this._buildCompute():this._buildFragment()}_createCascade(e,r){const{device:t,params:s}=this,i=s.size,a=this.useCompute,n={index:e,lengthScale:r,pingIndex:0,spectrum:C(t,`oceanSpectrum${e}`,i,W,R,y,a),pingA:[0,1].map(l=>C(t,`oceanPingA${e}_${l}`,i,W,R,y,a)),pingB:[0,1].map(l=>C(t,`oceanPingB${e}_${l}`,i,W,R,y,a)),displacement:[0,1].map(l=>C(t,`oceanDisplacement${e}_${l}`,i,O,b,L,a,!a)),derivatives:C(t,`oceanDerivatives${e}`,i,O,b,L,a,!a),sampled:a?{displacement:C(t,`oceanDisplacementMip${e}`,i,O,b,L,!1,!0),derivatives:C(t,`oceanDerivativesMip${e}`,i,O,b,L,!1,!0)}:null},u=s.cascadeOverlap,c=s.lengthScales;return n.cutoffLow=e===0?1e-4:2*Math.PI/c[e]*u,n.cutoffHigh=e===c.length-1?1e6:2*Math.PI/c[e+1]*u,n}_buildCompute(){const{device:e,params:r}=this,t=r.size,s=(a,n)=>new ue(e,{name:a,shaderLanguage:ce,cshader:n,computeEntryPoint:"main"});this.csSpectrum=s("oceanSpectrumCS",Fe(t)),this.csEvolve=s("oceanEvolveCS",Ae(t)),this.csFFT=s("oceanFFTCS",Ee(t)),this.csAssemble=s("oceanAssembleCS",Te(t));const i=Math.ceil(t/8);for(const a of this.cascades)a.spectrumCompute=new A(e,this.csSpectrum,`oceanSpectrum${a.index}`),a.spectrumCompute.setParameter("uOut",a.spectrum),a.spectrumCompute.setupDispatch(i,i,1),a.evolveCompute=new A(e,this.csEvolve,`oceanEvolve${a.index}`),a.evolveCompute.setParameter("uSpectrum",a.spectrum),a.evolveCompute.setParameter("uOut0",a.pingA[0]),a.evolveCompute.setParameter("uOut1",a.pingA[1]),a.evolveCompute.setupDispatch(i,i,1),a.fftH=new A(e,this.csFFT,`oceanFFTH${a.index}`),a.fftH.setParameter("uVertical",0),a.fftH.setParameter("uIn0",a.pingA[0]),a.fftH.setParameter("uIn1",a.pingA[1]),a.fftH.setParameter("uOut0",a.pingB[0]),a.fftH.setParameter("uOut1",a.pingB[1]),a.fftH.setupDispatch(t,1,1),a.fftV=new A(e,this.csFFT,`oceanFFTV${a.index}`),a.fftV.setParameter("uVertical",1),a.fftV.setParameter("uIn0",a.pingB[0]),a.fftV.setParameter("uIn1",a.pingB[1]),a.fftV.setParameter("uOut0",a.pingA[0]),a.fftV.setParameter("uOut1",a.pingA[1]),a.fftV.setupDispatch(t,1,1),a.assembleCompute=[0,1].map(n=>{const u=new A(e,this.csAssemble,`oceanAssemble${a.index}_${n}`);return u.setParameter("uIn0",a.pingA[0]),u.setParameter("uIn1",a.pingA[1]),u.setParameter("uPrevDisplacement",a.displacement[1-n]),u.setParameter("uDisplacement",a.displacement[n]),u.setParameter("uDerivatives",a.derivatives),u.setupDispatch(i,i,1),u})}_updateSpectrumCompute(){const{params:e}=this,r=N(e.wind,e.gravity),t=N(e.swell,e.gravity),s=[];for(const i of this.cascades){const a=i.spectrumCompute;a.setParameter("uLengthScale",i.lengthScale),a.setParameter("uCutoffLow",i.cutoffLow),a.setParameter("uCutoffHigh",i.cutoffHigh),a.setParameter("uDepth",e.depth),a.setParameter("uGravity",e.gravity),a.setParameter("uSeed",e.seed>>>0),a.setParameter("uSpecA0",r.p0),a.setParameter("uSpecA1",r.p1),a.setParameter("uSpecB0",t.p0),a.setParameter("uSpecB1",t.p1),s.push(a)}this.device.computeDispatch(s,"oceanSpectrum")}_stepCompute(e){const{params:r}=this,t=[];for(const n of this.cascades){const u=n.evolveCompute;u.setParameter("uLengthScale",n.lengthScale),u.setParameter("uDepth",r.depth),u.setParameter("uGravity",r.gravity),u.setParameter("uTime",this.time),t.push(u)}this.device.computeDispatch(t,"oceanEvolve"),this.device.computeDispatch(this.cascades.map(n=>n.fftH),"oceanFFTH"),this.device.computeDispatch(this.cascades.map(n=>n.fftV),"oceanFFTV");const s=[];for(const n of this.cascades){n.pingIndex=1-n.pingIndex;const u=n.assembleCompute[n.pingIndex];u.setParameter("uLambda",r.choppiness),u.setParameter("uDeltaTime",e),u.setParameter("uFoamDecay",r.foamDecay),u.setParameter("uFoamReset",this.frame<2?1:0),s.push(u)}this.device.computeDispatch(s,"oceanAssemble");const i=r.size,a=this.device.getCommandEncoder();for(const n of this.cascades)for(const[u,c]of[[n.displacement[n.pingIndex],n.sampled.displacement],[n.derivatives,n.sampled.derivatives]])a.copyTextureToTexture({texture:u.impl.gpuTexture},{texture:c.impl.gpuTexture},{width:i,height:i,depthOrArrayLayers:1}),this.device.mipmapRenderer.generate(c.impl)}_buildFragment(){const{device:e}=this,r={aPosition:q},t=(i,a,n)=>J.createShader(e,{uniqueName:i,attributes:r,vertexGLSL:Ce,fragmentGLSL:a,fragmentOutputTypes:n});this.fsSpectrum=t("oceanSpectrumFS",Re,["vec4"]),this.fsEvolve=t("oceanEvolveFS",ke,["vec4","vec4"]),this.fsFFT=t("oceanFFTFS",ze,["vec4","vec4"]),this.fsAssemble=t("oceanAssembleFS",Le,["vec4","vec4"]);const s=(i,a)=>{const n=new Y(e);return n.shader=i,n.init(a),n};for(const i of this.cascades)i.rtSpectrum=new T({name:`oceanSpectrumRT${i.index}`,colorBuffer:i.spectrum,depth:!1}),i.rtA=new T({name:`oceanPingART${i.index}`,colorBuffers:i.pingA,depth:!1}),i.rtB=new T({name:`oceanPingBRT${i.index}`,colorBuffers:i.pingB,depth:!1}),i.rtOut=[0,1].map(a=>new T({name:`oceanOutRT${i.index}_${a}`,colorBuffers:[i.displacement[a],i.derivatives],depth:!1,mipmaps:!0})),i.spectrumPass=s(this.fsSpectrum,i.rtSpectrum),i.evolvePass=s(this.fsEvolve,i.rtA),i.fftPassA=s(this.fsFFT,i.rtA),i.fftPassB=s(this.fsFFT,i.rtB),i.assemblePass=i.rtOut.map(a=>s(this.fsAssemble,a))}_updateSpectrumFragment(){const{device:e,params:r}=this,t=e.scope,s=N(r.wind,r.gravity),i=N(r.swell,r.gravity);t.resolve("uSize").setValue(r.size),t.resolve("uDepth").setValue(r.depth),t.resolve("uGravity").setValue(r.gravity),t.resolve("uSeed").setValue(r.seed|0),t.resolve("uSpecA0").setValue(s.p0),t.resolve("uSpecA1").setValue(s.p1),t.resolve("uSpecB0").setValue(i.p0),t.resolve("uSpecB1").setValue(i.p1);for(const a of this.cascades)t.resolve("uLengthScale").setValue(a.lengthScale),t.resolve("uCutoffLow").setValue(a.cutoffLow),t.resolve("uCutoffHigh").setValue(a.cutoffHigh),a.spectrumPass.render()}_stepFragment(e){const{device:r,params:t}=this,s=r.scope,i=s.resolve("uIn0"),a=s.resolve("uIn1"),n=s.resolve("uStage"),u=s.resolve("uVertical");s.resolve("uSize").setValue(t.size),s.resolve("uLog2Size").setValue(this.log2N),s.resolve("uDepth").setValue(t.depth),s.resolve("uGravity").setValue(t.gravity),s.resolve("uTime").setValue(this.time),s.resolve("uLambda").setValue(t.choppiness),s.resolve("uDeltaTime").setValue(e),s.resolve("uFoamDecay").setValue(t.foamDecay),s.resolve("uFoamReset").setValue(this.frame<2?1:0);for(const c of this.cascades){s.resolve("uLengthScale").setValue(c.lengthScale),s.resolve("uSpectrum").setValue(c.spectrum),c.evolvePass.render();let l=!0;for(let m=0;m<2;m++){u.setValue(m);for(let f=0;f<this.log2N;f++){n.setValue(f);const h=l?c.pingA:c.pingB;i.setValue(h[0]),a.setValue(h[1]),(l?c.fftPassB:c.fftPassA).render(),l=!l}}const g=l?c.pingA:c.pingB;i.setValue(g[0]),a.setValue(g[1]),c.pingIndex=1-c.pingIndex,s.resolve("uPrevDisplacement").setValue(c.displacement[1-c.pingIndex]),c.assemblePass[c.pingIndex].render()}}update(e){e=Math.min(e,1/15)*this.params.timeScale,this.time+=e,this._spectrumDirty&&(this._spectrumDirty=!1,this.useCompute?this._updateSpectrumCompute():this._updateSpectrumFragment()),this.useCompute?this._stepCompute(e):this._stepFragment(e),this.frame++}destroy(){var e,r;for(const t of this.cascades)[t.spectrum,...t.pingA,...t.pingB,...t.displacement,t.derivatives,(e=t.sampled)==null?void 0:e.displacement,(r=t.sampled)==null?void 0:r.derivatives].forEach(s=>s==null?void 0:s.destroy()),[t.rtSpectrum,t.rtA,t.rtB,...t.rtOut||[]].forEach(s=>s==null?void 0:s.destroy()),[t.spectrumPass,t.evolvePass,t.fftPassA,t.fftPassB,...t.assemblePass||[]].forEach(s=>{var i;return(i=s==null?void 0:s.quadRender)==null?void 0:i.destroy()}),[t.spectrumCompute,t.evolveCompute,t.fftH,t.fftV,...t.assembleCompute||[]].forEach(s=>s==null?void 0:s.destroy());this.cascades=[],[this.csSpectrum,this.csEvolve,this.csFFT,this.csAssemble].forEach(t=>t==null?void 0:t.destroy()),this.csSpectrum=this.csEvolve=this.csFFT=this.csAssemble=null}}function K(o,e={}){const r=e.sectors??256,t=e.rings??320,s=e.innerRadius??.5,i=e.outerRadius??2e4,a=Math.pow(i/s,1/(t-1)),n=[],u=[];n.push(0,0,0);for(let m=0;m<t;m++){const f=s*Math.pow(a,m);for(let h=0;h<r;h++){const d=h/r*Math.PI*2;n.push(Math.cos(d)*f,0,Math.sin(d)*f)}}const c=m=>1+m*r;for(let m=0;m<r;m++){const f=(m+1)%r;u.push(0,c(0)+f,c(0)+m)}for(let m=0;m<t-1;m++){const f=c(m),h=c(m+1);for(let d=0;d<r;d++){const p=(d+1)%r;d+m&1?u.push(f+d,h+p,h+d,f+d,f+p,h+p):u.push(f+d,f+p,h+d,f+p,h+p,h+d)}}const l=new le(o);l.setPositions(n),l.setIndices(u),l.update();const g=e.maxWaveHeight??30;return l.aabb=new me(new k(0,0,0),new k(i,g,i)),l}const Oe=`
attribute vec2 aPosition;
void main(void) {
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`,Ne=`
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
`,Ie=`
attribute aPosition: vec2f;

@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4f(input.aPosition, 0.0, 1.0);
    return output;
}
`,Ve=`
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
`,P=16,E=P*P,Ue=3;class Ge{constructor(e){this.water=e,this.device=e._device,this.queryData=new Float32Array(E*4),this.resultData=new Float32Array(E*4),this.entries=new Map,this.slotOwner=new Array(E).fill(null),this.nextSlot=0,this.frame=0,this.pending=!1,this.lastRead=-99,this._generation=0,this._destroyed=!1,this._zero={position:new k,normal:new k(0,1,0)},this._build()}_build(){const e=this.device;this.queryTex=new F(e,{name:"waveProbeQuery",width:P,height:P,format:W,mipmaps:!1,minFilter:R,magFilter:R,addressU:y,addressV:y}),this.queryTex.lock().set(this.queryData),this.queryTex.unlock(),this.resultTex=new F(e,{name:"waveProbeResult",width:P,height:P,format:W,mipmaps:!1,minFilter:R,magFilter:R,addressU:y,addressV:y}),this.rt=new T({name:"waveProbeRT",colorBuffer:this.resultTex,depth:!1});const r=J.createShader(e,{uniqueName:"waveProbe",attributes:{aPosition:q},vertexGLSL:Oe,fragmentGLSL:Ne,vertexWGSL:Ie,fragmentWGSL:Ve,fragmentOutputTypes:["vec4"]});this.pass=new Y(e),this.pass.shader=r,this.pass.init(this.rt),this._cascadeData=new Float32Array(16)}rebuild(){this._generation++,this.resultData.fill(0);for(const e of this.entries.values())e.result.position.y=this.water.seaLevel,e.result.normal.set(0,1,0);this.lastRead=-99}sample(e,r){const t=`${Math.round(e*4)}:${Math.round(r*4)}`;let s=this.entries.get(t);if(!s){const i=this._acquireSlot(t);if(i<0)return this._zero.position.set(e,this.water.config.seaLevel,r),this._zero;s={slot:i,lastUsed:this.frame,result:{position:new k(e,this.water.config.seaLevel,r),normal:new k(0,1,0)}},this.entries.set(t,s)}return s.lastUsed=this.frame,s.result.position.x=e,s.result.position.z=r,this.queryData[s.slot*4+0]=e,this.queryData[s.slot*4+1]=r,this.queryData[s.slot*4+2]=1,s.result}_acquireSlot(e){for(let r=0;r<E;r++){const t=(this.nextSlot+r)%E,s=this.slotOwner[t];if(s===null)return this.slotOwner[t]=e,this.nextSlot=t+1,t;const i=this.entries.get(s);if(!i||this.frame-i.lastUsed>30)return i&&this.entries.delete(s),this.slotOwner[t]=e,this.nextSlot=t+1,t}return-1}update(){if(this.frame++,this.entries.size===0)return;const e=this.water,r=e._simulation,t=e.config,s=this.device.scope;this.queryTex.lock().set(this.queryData),this.queryTex.unlock();const i=r.displacementTextures,a=r.derivativeTextures,n=r.lengthScales,u=i.length;for(let c=0;c<4;c++){const l=Math.min(c,u-1);s.resolve(`uDisp${c}`).setValue(i[l]),s.resolve(`uDeriv${c}`).setValue(a[l]),this._cascadeData[c*4+3]=1/n[l]}if(s.resolve("uCascadeInv").setValue(this._cascadeData),s.resolve("uCascadeInv[0]").setValue(this._cascadeData),s.resolve("uQuery").setValue(this.queryTex),s.resolve("uNumCascades").setValue(u),s.resolve("uLambda").setValue(t.waves.choppiness),s.resolve("uDisplacementScale").setValue(t.waves.amplitude),s.resolve("uSeaLevel").setValue(t.seaLevel),this.pass.render(),!this.pending&&this.frame-this.lastRead>=Ue){this.pending=!0,this.lastRead=this.frame;const c=this._generation,l=Array.from(this.entries.entries());this.resultTex.read(0,0,P,P,{renderTarget:this.rt,data:this.resultData,frequent:!0}).then(()=>{this.pending=!1,!this._destroyed&&c===this._generation&&this._publish(l)}).catch(()=>{this.pending=!1})}}_publish(e){const r=this.resultData;for(const[t,s]of e){if(this.entries.get(t)!==s)continue;const i=s.slot*4;s.result.position.y=r[i+0],s.result.normal.set(-r[i+1],1,-r[i+2]).normalize()}}destroy(){var e,r,t,s,i;this._destroyed||(this._destroyed=!0,this._generation++,(r=(e=this.pass)==null?void 0:e.quadRender)==null||r.destroy(),(t=this.rt)==null||t.destroy(),(s=this.queryTex)==null||s.destroy(),(i=this.resultTex)==null||i.destroy(),this.entries.clear())}}function je(o,e,r,t){let s=(o%r+r)%r,i=(e%r+r)%r,a=s*374761393+i*668265263+t*1442695041;a=(a^a>>13)>>>0,a=Math.imul(a,1274126177)>>>0;const n=((a^a>>16)>>>0)/4294967296;a=Math.imul(a^2654435769,2246822519)>>>0;const u=((a^a>>15)>>>0)/4294967296;return[n,u]}function B(o,e,r,t){const s=o*r,i=e*r,a=Math.floor(s),n=Math.floor(i);let u=1e9;for(let c=-1;c<=1;c++)for(let l=-1;l<=1;l++){const[g,m]=je(a+l,n+c,r,t),f=a+l+g,h=n+c+m,d=(s-f)*(s-f)+(i-h)*(i-h);d<u&&(u=d)}return Math.min(Math.sqrt(u),1)}function U(o,e,r,t,s){let i=0,a=1,n=0,u=r;for(let c=0;c<t;c++)i+=a*(1-B(o,e,u,s+c*71)),n+=a,a*=.5,u*=2;return i/n}function Be(o,e=512){const r=new Uint8Array(e*e*4),t=1/e;for(let i=0;i<e;i++)for(let a=0;a<e;a++){const n=(a+.5)*t,u=(i+.5)*t;let c=U(n,u,6,3,17);c=Math.min(1,Math.max(0,(c-.34)*2.1)),c=c*c*(3-2*c);const l=Math.min(1,Math.max(0,(U(n,u,22,2,53)-.3)*1.8)),g=.5+.5*Math.sin((1-B(n,u,3,91))*5.2+n*6.283)*Math.cos(u*6.283*2+(1-B(n,u,4,29))*4),m=Math.min(1,Math.max(0,(U(n,u,5,2,17)-.18)*1.5)),f=(i*e+a)*4;r[f]=c*255,r[f+1]=l*255,r[f+2]=g*255,r[f+3]=m*255}return new F(o,{name:"waterFoam",width:e,height:e,format:H,mipmaps:!0,minFilter:ee,magFilter:b,addressU:L,addressV:L,anisotropy:2,levels:[r]})}function vt(o,e){if(!e||typeof e!="object")throw new TypeError("Water: shore bake options are required");const{origin:r,size:t,heightAt:s,seaLevel:i=0,maxDepth:a=40,resolution:n=512}=e;if(I(r,"origin",!1),I(t,"size",!0),typeof s!="function")throw new TypeError("Water: shore heightAt must be a function");if(!Number.isFinite(i))throw new TypeError("Water: shore seaLevel must be finite");if(!Number.isFinite(a)||a<=0)throw new RangeError("Water: shore maxDepth must be positive");if(!Number.isInteger(n)||n<2||n>(o.maxTextureSize||16384))throw new RangeError("Water: shore resolution must be an integer from 2 to the device texture limit");const u=n,c=new Float32Array(u*u),l=t[0]/(u-1),g=t[1]/(u-1);for(let p=0;p<u;p++){const x=r[1]+p*g;for(let _=0;_<u;_++){const v=r[0]+_*l,w=s(v,x);if(!Number.isFinite(w))throw new TypeError(`Water: shore heightAt returned a non-finite height at (${v}, ${x})`);c[p*u+_]=Math.max(i-w,0)}}const m=new Uint8Array(u*u*4),f=(p,x)=>c[Math.min(u-1,Math.max(0,x))*u+Math.min(u-1,Math.max(0,p))];for(let p=0;p<u;p++)for(let x=0;x<u;x++){const _=c[p*u+x];let v=(f(x+1,p)-f(x-1,p))/(2*l),w=(f(x,p+1)-f(x,p-1))/(2*g);const D=Math.hypot(v,w);D>1e-6?(v/=D,w/=D):(v=0,w=0);const M=(p*u+x)*4;m[M]=Math.min(1,_/a)*255,m[M+1]=(v*.5+.5)*255,m[M+2]=(w*.5+.5)*255,m[M+3]=Math.min(1,_/.6)*255}const h=new F(o,{name:"waterShoreMap",width:u,height:u,format:H,mipmaps:!1,minFilter:b,magFilter:b,addressU:y,addressV:y,levels:[m]});let d=!1;return Object.freeze({texture:h,origin:Object.freeze(r.slice()),size:Object.freeze(t.slice()),maxDepth:a,seaLevel:i,get destroyed(){return d},destroy(){d||(d=!0,h.destroy())}})}function I(o,e,r){if(!Array.isArray(o)||o.length!==2||!o.every(t=>Number.isFinite(t)&&(!r||t>0)))throw new TypeError(`Water: shore ${e} must contain two finite ${r?"positive ":""}numbers`)}function qe(o,e){if(!o||typeof o!="object"||!o.texture||o.destroyed)throw new TypeError("Water: expected a live shore map or null");if(I(o.origin,"origin",!1),I(o.size,"size",!0),!Number.isFinite(o.maxDepth)||o.maxDepth<=0)throw new RangeError("Water: shore maxDepth must be positive");if(!Number.isFinite(o.seaLevel)||o.seaLevel!==e)throw new RangeError("Water: shore map must be baked at the water seaLevel")}function He(o){return new F(o,{name:"waterShoreMapNone",width:1,height:1,format:H,mipmaps:!1,minFilter:b,magFilter:b,addressU:y,addressV:y,levels:[new Uint8Array([255,128,128,255])]})}const $e=`
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
`,Xe=`
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

${ye}

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
`,Ze=`
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
`,Ke=`
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

${_e}

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
`,Qe=X({seaLevel:0,quality:"medium",wind:{speed:9,direction:35},swell:{strength:.6,direction:-20},waves:{amplitude:1,choppiness:1.4},roughness:.06,volume:{color:[.003,.075,.11],visibility:10},foam:1,caustics:{enabled:!1,strength:1,scale:.2},seed:1337,timeScale:1});function X(o){return o&&typeof o=="object"&&!Object.isFrozen(o)&&(Object.values(o).forEach(X),Object.freeze(o)),o}const Q=o=>o!==null&&typeof o=="object"&&(Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null);function se(o,e,r=""){if(!Q(e))throw new TypeError(`Water: ${r||"configuration"} must be a plain object`);const t={...o};for(const[s,i]of Object.entries(e)){const a=r?`${r}.${s}`:s;if(!Object.hasOwn(o,s))throw new TypeError(`Water: unknown configuration field "${a}"`);if(i!==void 0)if(Q(o[s]))t[s]=se(o[s],i,a);else if(Array.isArray(o[s])){if(!Array.isArray(i))throw new TypeError(`Water: ${a} must be an array`);t[s]=i.slice()}else{if(typeof i!=typeof o[s])throw new TypeError(`Water: ${a} must be a ${typeof o[s]}`);t[s]=i}}return t}const Je={seaLevel:[-1/0,1/0],"wind.speed":[0,40],"wind.direction":[-1/0,1/0],"swell.strength":[0,3],"swell.direction":[-1/0,1/0],"waves.amplitude":[0,3],"waves.choppiness":[0,2.5],roughness:[0,1],"volume.visibility":[.1,1e3],foam:[0,2],"caustics.strength":[0,4],"caustics.scale":[.01,2],seed:[0,4294967295],timeScale:[0,10]};function ie(o,e=""){for(const[r,t]of Object.entries(o)){const s=e?`${e}.${r}`:r;if(t&&typeof t=="object"&&!Array.isArray(t))ie(t,s);else if(typeof t=="number"){const[i,a]=Je[s];if(!Number.isFinite(t)||t<i||t>a)throw new RangeError(`Water: ${s} must be finite and in [${i}, ${a}]`)}}}function G(o={},e=Qe){const r=se(e,o);if(ie(r),!["low","medium","high"].includes(r.quality))throw new RangeError("Water: quality must be low, medium or high");if(!Number.isInteger(r.seed))throw new RangeError("Water: seed must be an unsigned 32-bit integer");const t=r.volume.color;if(t.length!==3||!Array.from(t).every(s=>Number.isFinite(s)&&s>=0&&s<=1))throw new TypeError("Water: volume.color must contain three linear RGB values in [0, 1]");for(const s of["wind","swell"]){const i=((r[s].direction+180)%360+360)%360-180;i!==r[s].direction&&(r[s]={...r[s],direction:i})}return X(r)}function z(o,e){if(o===e)return!0;if(!o||!e||typeof o!="object"||typeof e!="object")return!1;const r=Object.keys(o);return r.length===Object.keys(e).length&&r.every(t=>Object.hasOwn(e,t)&&z(o[t],e[t]))}const j={low:{resolution:128,sectors:128,rings:192,reflectionSteps:12},medium:{resolution:256,sectors:256,rings:320,reflectionSteps:18},high:{resolution:512,sectors:384,rings:420,reflectionSteps:28}},Ye=[1024,256,48,8],et=12,tt=30,at=2e4,rt=.00465,st=9.81,it=500,ot=[1,1,.4,.1],nt=[.92,.96,1],ut=[.06,.55,.45],ct=[.35,6,.6,.35],lt=[.7,.12,4,0],mt=[.68,3,.07,1],ft=[1,.4,.6],pt=.09;class gt{constructor(e,r={}){this._app=e,this._device=e.graphicsDevice,this._config=G(r),this._time=0,this._sunDirection=new k(0,1,0),this._sunColor=new fe(1,1,1),this._hazeDensity=0,this._destroyed=!1,this._cascadeData=new Float32Array(16),this._envAtlas=null,this._skyRadiance=null,this._environmentExposure=1,this._rebuildSim=!1,this._rebuildMesh=!1,this._simulation=new Me(this._device,this._simParams()),this._material=new pe({uniqueName:"WaterSurface",attributes:{vertex_position:q},vertexGLSL:$e,fragmentGLSL:Xe,vertexWGSL:Ze,fragmentWGSL:Ke}),this._material.blendType=de,this._material.depthWrite=!0,this._material.cull=he,this._material.setDefine("{ENV_DECODE}","decodeRGBP"),this._foamTexture=Be(this._device),this._material.setParameter("uFoamTex",this._foamTexture),this._deepWaterMap=He(this._device),this._shoreMap=null,this._material.setParameter("uShoreMap",this._deepWaterMap),this._material.setParameter("uShoreArea",[0,0,1,1]),this._mesh=K(this._device,this._meshParams()),this._builtMeshParams=this._meshParams(),this._meshInstance=new ve(this._mesh,this._material),this._meshInstance.cull=!1,this._meshInstance.castShadow=!1,this._meshInstance.receiveShadow=!1,this._entity=new ge("Water"),this._entity.addComponent("render",{meshInstances:[this._meshInstance],layers:[xe],castShadows:!1}),e.root.addChild(this._entity),this._probe=new Ge(this)}get usesCompute(){return this._simulation.useCompute}get config(){return this._config}get time(){return this._time}get sunDirection(){return this._sunDirection.clone()}get sunColor(){return this._sunColor.clone()}get seaLevel(){return this.config.seaLevel}set(e){return this._assertAlive(),this._setConfig(G(e,this.config))}reset(e={}){return this._assertAlive(),this._setConfig(G(e))}_setConfig(e){if(this._shoreMap&&e.seaLevel!==this._shoreMap.seaLevel)throw new RangeError("Water: detach the shore map before changing seaLevel, then bake and attach a map at the new level");const r=this.config;if(z(r,e))return this;this._config=e;const t=this._simParams(),s=this._simulation.params;if(this._rebuildSim=["size","lengthScales","cascadeOverlap"].some(i=>!z(s[i],t[i])),!this._rebuildSim){const i=["wind","swell","depth","gravity","seed"].some(a=>!z(s[a],t[a]));Object.assign(s,t),i&&this._simulation.invalidateSpectrum()}return this._rebuildMesh=!z(this._builtMeshParams,this._meshParams()),["seaLevel","waves","wind","swell","seed"].some(i=>!z(r[i],e[i]))&&this._probe.rebuild(),this}_assertAlive(){if(this._destroyed)throw new Error("Water: this instance has been destroyed")}_applyPendingRebuilds(){if(this._rebuildSim&&(this._simulation.rebuild(this._simParams()),this._probe.rebuild(),this._rebuildSim=!1),this._rebuildMesh){const e=this._mesh;this._mesh=K(this._device,this._meshParams()),this._meshInstance.mesh=this._mesh,this._builtMeshParams=this._meshParams(),this._rebuildMesh=!1,e.destroy()}}_simParams(){const e=this.config,r=j[e.quality],t=e.wind.speed;return{size:r.resolution,lengthScales:Ye.slice(),cascadeOverlap:6,depth:it,gravity:st,seed:e.seed,choppiness:e.waves.choppiness,foamDecay:.8,timeScale:e.timeScale,wind:{scale:t===0?0:1,windSpeed:Math.max(t,.1),windDirection:e.wind.direction,fetch:Math.max(1e4,Math.min(1e6,12e4*(t/9)**2)),spreadBlend:.9,swell:.25,peakEnhancement:3.3,shortWavesFade:.0075},swell:{scale:e.swell.strength,windSpeed:6,windDirection:e.swell.direction,fetch:8e5,spreadBlend:1,swell:1,peakEnhancement:3.3,shortWavesFade:.05}}}_meshParams(){const e=j[this.config.quality];return{sectors:e.sectors,rings:e.rings,outerRadius:at}}setShoreMap(e){return this._assertAlive(),e!==null&&qe(e,this.seaLevel),this._shoreMap=e,this._material.setParameter("uShoreMap",e?e.texture:this._deepWaterMap),this._material.setParameter("uShoreArea",e?[e.origin[0],e.origin[1],1/e.size[0],1/e.size[1]]:[0,0,1,1]),this}setEnvironment(e){if(this._assertAlive(),!e||typeof e!="object"||Array.isArray(e))throw new TypeError("Water: environment must be an object");const r=["atlas","radiance","sunDirection","sunColor","exposure","hazeDensity"];for(const c of Object.keys(e))if(!r.includes(c))throw new TypeError(`Water: unknown environment field "${c}"`);const{atlas:t,radiance:s=null,sunDirection:i,sunColor:a,exposure:n=1,hazeDensity:u=0}=e;if(!t||typeof t!="object")throw new TypeError("Water: atlas must be a prefiltered texture");if(s!==null&&typeof s!="object")throw new TypeError("Water: radiance must be a linear equirectangular texture");if(![n,u].every(c=>Number.isFinite(c)&&c>=0))throw new RangeError("Water: exposure and hazeDensity must be finite and non-negative");if(!i||![i.x,i.y,i.z].every(Number.isFinite)||Math.hypot(i.x,i.y,i.z)===0)throw new TypeError("Water: sunDirection must be a finite non-zero vector");if(!a||![a.r,a.g,a.b].every(c=>Number.isFinite(c)&&c>=0))throw new TypeError("Water: sunColor must contain finite non-negative linear RGB values");return this._envAtlas=t,this._skyRadiance=s,this._environmentExposure=n,this._hazeDensity=u,this._material.setParameter("texture_envAtlas",t),this._material.setParameter("uSkyRadiance",s||t),this._material.setParameter("uHasSkyRadiance",s?1:0),this._material.setParameter("uEnvironmentExposure",n),this._sunDirection.copy(i).normalize(),this._sunColor.copy(a),this}getHeightAt(e,r){return this.getSurfaceAt(e,r).position.y}getSurfaceAt(e,r){if(this._assertAlive(),!Number.isFinite(e)||!Number.isFinite(r))throw new TypeError("Water: query coordinates must be finite numbers");return this._probe.sample(e,r)}isSubmerged(e){return e.y<this.getHeightAt(e.x,e.z)}addReceiver(e){if(this._assertAlive(),!(e instanceof Se))throw new TypeError("Water.addReceiver requires a StandardMaterial");if(this._receivers??(this._receivers=new Map),this._receivers.has(e))return this._receivers.get(e);const r=Pe(e),t=()=>{this._receivers.delete(e)&&r()};return this._receivers.set(e,t),this._bindReceiver(e),t}_bindReceiver(e){const r=this.config,t=r.volume,s=r.caustics,i=this._sunDirection,a=this._sunColor;Z(e,this._simulation,r),e.setParameter("uReceiverExtinction",[3.2,1,.6].map(n=>n/t.visibility)),e.setParameter("uReceiverScatter",t.color),e.setParameter("uReceiverSun",[i.x,i.y,i.z]),e.setParameter("uReceiverSunColor",[a.r,a.g,a.b]),e.setParameter("uReceiverParams",[r.seaLevel,s.enabled?s.strength:0,s.scale,this._skyRadiance?this._environmentExposure:0]),e.setParameter("uReceiverSky",this._skyRadiance||this._deepWaterMap)}update(e,r){var _;if(this._assertAlive(),!Number.isFinite(e)||e<0)throw new RangeError("Water: dt must be a finite non-negative number of seconds");if(!r||typeof r.getPosition!="function")throw new TypeError("Water: update requires a camera entity");this._applyPendingRebuilds();const t=this.config,s=this._simulation;s.update(e),this._time=s.time,this._probe.update();const i=r.getPosition();this._entity.setPosition(i.x,0,i.z);const a=this._material,n=s.displacementTextures,u=s.derivativeTextures,c=s.lengthScales,l=n.length;for(let v=0;v<4;v++){const w=Math.min(v,l-1);a.setParameter(`uDisp${v}`,n[w]),a.setParameter(`uDeriv${v}`,u[w]);const D=c[w];this._cascadeData[v*4+0]=D,this._cascadeData[v*4+1]=D*et,this._cascadeData[v*4+2]=D*tt,this._cascadeData[v*4+3]=1/D}a.setParameter("uCascade[0]",this._cascadeData),a.setParameter("uCascade",this._cascadeData),a.setParameter("uNumCascades",l);const g=this._meshParams(),m=Math.log(g.outerRadius/.5)/(g.rings-1);a.setParameter("uMeshLod",[Math.max(m,2*Math.PI/g.sectors),.5,this._simulation.params.size,0]),a.setParameter("uWaterRadius",g.outerRadius),a.setParameter("uLambda",t.waves.choppiness),a.setParameter("uDisplacementScale",t.waves.amplitude),a.setParameter("uSeaLevel",t.seaLevel),a.setParameter("uTime",this.time);const f=this._sunDirection,h=this._sunColor;a.setParameter("uSunDir",[f.x,f.y,f.z]),a.setParameter("uSunColor",[h.r,h.g,h.b]),a.setParameter("uSunRadius",rt);const d=t.volume;a.setParameter("uExtinction",[3.2/d.visibility,1/d.visibility,.6/d.visibility]),a.setParameter("uScatterColor",d.color),a.setParameter("uScatterStrength",1),a.setParameter("uSSSColor",ut),a.setParameter("uSSSParams",ct),a.setParameter("uSurfaceParams",[t.roughness,.15,1,1]),a.setParameter("uRefractionParams",lt),a.setParameter("uSSRParams",[.9,220,j[t.quality].reflectionSteps,1.5]),Z(a,s,t);const p=t.caustics;for(const v of((_=this._receivers)==null?void 0:_.keys())??[])this._bindReceiver(v);a.setParameter("uCausticsParams",[p.enabled?p.strength:0,p.scale,pt]);const x=this._shoreMap?1:0;a.setParameter("uShoreParams",[this._shoreMap?this._shoreMap.maxDepth:1,5,.16,2.4]),a.setParameter("uShoreParams2",[...ft,x]),a.setParameter("uFoamParams",mt),a.setParameter("uFoamColor",nt),a.setParameter("uFoamStrength",t.foam),a.setParameter("uFoamCascadeWeights",ot),a.setParameter("uFogDensity",this._hazeDensity),a.setParameter("uSkyRadiance",this._skyRadiance||this._envAtlas||this._deepWaterMap),a.setParameter("uHasSkyRadiance",this._skyRadiance?1:0),a.setParameter("uEnvironmentExposure",this._environmentExposure)}destroy(){var e;if(!this._destroyed){this._destroyed=!0;for(const r of[...((e=this._receivers)==null?void 0:e.values())??[]])r();this._probe.destroy(),this._meshInstance.mesh=null,this._entity.destroy(),this._foamTexture.destroy(),this._deepWaterMap.destroy(),this._simulation.destroy(),this._mesh.destroy(),this._material.destroy(),this._shoreMap=null,this._envAtlas=null,this._skyRadiance=null}}}export{gt as W,vt as b};
