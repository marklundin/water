// ---------------------------------------------------------------------------------------------
// Materials for the coast, built on the engine's StandardMaterial through chunk overrides so the
// terrain and the rocks keep its lights, cascaded shadows, environment lighting and fog.
//
//   terrain   three scanned PBR sets (sand, scrub,
//             rock face) are projected along the world axes and blended by the normal (with the
//             tangent-space normals re-oriented per projection — Golus' whiteout blend), then
//             blended by height, slope and the bpy-authored bedrock mask. Wet sand along the swash.
//   rock      the scanned rock models keep their own UVs and maps; the override only adds the
//             dark, wet intertidal band below the high-water line.
//
// Every chunk is written twice, GLSL and WGSL, as the rest of this project does.
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------- terrain
const TERRAIN_GLSL = {
    diffusePS: /* glsl */`
uniform float uSeaLevel;
uniform vec3  uTexScale;        // tiles per metre: sand, grass, rock
uniform sampler2D uSandAlbedo;  uniform sampler2D uSandNormal;
uniform sampler2D uGrassAlbedo; uniform sampler2D uGrassNormal;
uniform sampler2D uRockAlbedo;  uniform sampler2D uRockNormal;  uniform sampler2D uRockArm;

vec3 gW;                           // triplanar weights
float gRock, gGrass, gWet, gRough, gFar, gNear;

// Smooth domain variation keeps PBR channels registered while breaking the tile grid.
float terrainNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1,0), vec2(127.1,311.7)),
        dot(i + vec2(0,1), vec2(127.1,311.7)), dot(i + vec2(1,1), vec2(127.1,311.7)))) * 43758.5453);
    return mix(mix(h.x,h.y,u.x), mix(h.z,h.w,u.x), u.y);
}
vec2 terrainUv(vec2 p) {
    return p + (vec2(terrainNoise(p * 0.17), terrainNoise(p * 0.17 + vec2(19.3,7.1))) - 0.5) * 2.4;
}

vec3 triWeights(vec3 n) {
    vec3 w = pow(abs(n), vec3(5.0));
    return w / (w.x + w.y + w.z);
}
vec4 triSample(sampler2D t, vec3 p, vec3 w) {
    return texture(t, terrainUv(p.zy)) * w.x + texture(t, terrainUv(p.xz)) * w.y + texture(t, terrainUv(p.xy)) * w.z;
}
vec3 triNormal(sampler2D t, vec3 p, vec3 w, vec3 n) {
    vec3 tx = texture(t, terrainUv(p.zy)).xyz * 2.0 - 1.0;
    vec3 ty = texture(t, terrainUv(p.xz)).xyz * 2.0 - 1.0;
    vec3 tz = texture(t, terrainUv(p.xy)).xyz * 2.0 - 1.0;
    tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
    ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
    tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
    return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}

void getAlbedo() {
    vec3 n = normalize(dVertexNormalW);
    gW = triWeights(n);
    float h = vPositionW.y - uSeaLevel;
    float slope = 1.0 - n.y;

    // a slow field breaks the bands so the scrub line and the rock line wander
    float wander = 0.6 * sin(vPositionW.x * 0.031 + 1.7) * sin(vPositionW.z * 0.027) + 0.4 * sin(vPositionW.x * 0.071 + vPositionW.z * 0.043);
    float hb = h + wander * 4.0;

    gRock = smoothstep(0.30, 0.52, slope + wander * 0.12);
    gRock = max(gRock, smoothstep(15.0, 24.0, hb) * smoothstep(0.08, 0.25, slope));
    gRock = max(gRock, (1.0 - smoothstep(-80.0, 20.0, vPositionW.x)) * smoothstep(0.0, 3.0, h) * 0.9);
    gRock = max(gRock, vVertexColor.r);
    gGrass = smoothstep(3.2, 6.5, hb) * (1.0 - smoothstep(0.16, 0.36, slope)) * (1.0 - gRock);
    // wet sand: darker and glossier from the swash zone down
    gWet = (1.0 - smoothstep(0.1, 1.1, h)) * (1.0 - gRock) * (1.0 - gGrass);

    vec3 ps = vPositionW * uTexScale.x, pg = vPositionW * uTexScale.y, pr = vPositionW * uTexScale.z;
    // the rock tile is small enough to read close up and so repeats across a cliff; past 50 m it
    // is cross-faded to the same map at a 5x larger tile, and a slow tonal variation is laid over
    gFar = smoothstep(50.0, 180.0, distance(vPositionW, view_position));
    vec4 sand = mix(triSample(uSandAlbedo, ps, gW), triSample(uSandAlbedo, ps * 0.713 + vec3(0.37, 0.0, 0.61), gW), 0.5);
    // a close-range grain: the sand map again at a 12x smaller tile, fading out past a few metres
    gNear = 1.0 - smoothstep(3.0, 12.0, distance(vPositionW, view_position));
    sand.rgb *= 1.0 + (triSample(uSandAlbedo, ps * 12.0, gW).g * 2.0 - 1.0) * 0.22 * gNear;
    sand.rgb = mix(sand.rgb, mix(vec3(0.48, 0.42, 0.32), sand.rgb, 0.25), 1.0 - smoothstep(-0.5, 0.5, h));
    vec4 grass = triSample(uGrassAlbedo, pg, gW);
    vec4 rock = mix(triSample(uRockAlbedo, pr, gW), triSample(uRockAlbedo, pr * 0.2, gW), gFar);
    rock.rgb *= mix(0.85, 1.1, triSample(uRockAlbedo, pr * 0.045, gW).g) * vec3(0.75, 0.82, 0.88);
    // sand and scrub are matte and open; only the rock's own AO / roughness map is worth sampling
    vec4 rockArm = triSample(uRockArm, pr, gW);
    gRough = mix(mix(0.78, 0.85, gGrass), rockArm.g, gRock);
    float ao = mix(1.0, rockArm.r, gRock);

    vec3 c = mix(mix(sand.rgb, grass.rgb, gGrass), rock.rgb, gRock) * ao;
    c *= mix(1.0, 0.5, gWet);
    // sand goes a little greener as it goes under, the way wet silica does through a metre of water
    c *= mix(vec3(1.0), vec3(0.85, 0.95, 0.9), clamp(-h * 0.25, 0.0, 1.0) * (1.0 - gRock));
    c *= mix(1.0, 0.55, gRock * (1.0 - smoothstep(-0.4, 1.0, h)));
    dAlbedo = c;
}
`,
    normalMapPS: /* glsl */`
void getNormal() {
    vec3 n = normalize(dVertexNormalW);
    vec3 ps = vPositionW * uTexScale.x, pr = vPositionW * uTexScale.z;
    vec3 ns = triNormal(uSandNormal, ps, gW, n);
    float phase = vPositionW.x * 8.0 + sin(vPositionW.z * 0.43 + sin(vPositionW.x * 0.19)) * 3.0;
    float sedimentPatch = smoothstep(-0.2, 0.7, sin(vPositionW.x * 0.21) * sin(vPositionW.z * 0.17 + 1.4));
    float ripple = sin(phase) * sedimentPatch * (1.0 - smoothstep(0.4, 2.0, fwidth(phase)));
    ns = normalize(mix(n, ns, 0.18) + vec3(ripple * 0.045, 0.0, ripple * 0.012));
    vec3 ng = triNormal(uGrassNormal, vPositionW * uTexScale.y, gW, n);
    vec3 nr = normalize(mix(n, triNormal(uRockNormal, pr, gW, n), 0.65));
    dNormalW = normalize(mix(mix(ns, ng, gGrass), nr, gRock));
}
`,
    glossPS: /* glsl */`
void getGlossiness() {
    dGlossiness = mix(1.0 - gRough, mix(0.12, 0.55, smoothstep(-0.2, 0.4, vPositionW.y - uSeaLevel)), gWet) + 0.0000001;
}
`
};

const TERRAIN_WGSL = {
    diffusePS: /* wgsl */`
uniform uSeaLevel: f32;
uniform uTexScale: vec3f;
var uSandAlbedo: texture_2d<f32>;
var uSandAlbedoSampler: sampler;
var uSandNormal: texture_2d<f32>;
var uSandNormalSampler: sampler;
var uGrassAlbedo: texture_2d<f32>;
var uGrassAlbedoSampler: sampler;
var uGrassNormal: texture_2d<f32>;
var uGrassNormalSampler: sampler;
var uRockAlbedo: texture_2d<f32>;
var uRockAlbedoSampler: sampler;
var uRockNormal: texture_2d<f32>;
var uRockNormalSampler: sampler;
var uRockArm: texture_2d<f32>;
var uRockArmSampler: sampler;

var<private> gW: vec3f;
var<private> gRock: f32;
var<private> gGrass: f32;
var<private> gWet: f32;
var<private> gRough: f32;
var<private> gFar: f32;
var<private> gNear: f32;

fn terrainNoise(p: vec2f) -> f32 {
    let i = floor(p); let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let h = fract(sin(vec4f(dot(i, vec2f(127.1,311.7)), dot(i + vec2f(1,0), vec2f(127.1,311.7)),
        dot(i + vec2f(0,1), vec2f(127.1,311.7)), dot(i + vec2f(1,1), vec2f(127.1,311.7)))) * 43758.5453);
    return mix(mix(h.x,h.y,u.x), mix(h.z,h.w,u.x), u.y);
}
fn terrainUv(p: vec2f) -> vec2f {
    return p + (vec2f(terrainNoise(p * 0.17), terrainNoise(p * 0.17 + vec2f(19.3,7.1))) - 0.5) * 2.4;
}

fn triWeights(n: vec3f) -> vec3f {
    let w = pow(abs(n), vec3f(5.0));
    return w / (w.x + w.y + w.z);
}
fn triSample(t: texture_2d<f32>, s: sampler, p: vec3f, w: vec3f) -> vec4f {
    return textureSample(t, s, terrainUv(p.zy)) * w.x + textureSample(t, s, terrainUv(p.xz)) * w.y + textureSample(t, s, terrainUv(p.xy)) * w.z;
}
fn triNormal(t: texture_2d<f32>, s: sampler, p: vec3f, w: vec3f, n: vec3f) -> vec3f {
    var tx = textureSample(t, s, terrainUv(p.zy)).xyz * 2.0 - 1.0;
    var ty = textureSample(t, s, terrainUv(p.xz)).xyz * 2.0 - 1.0;
    var tz = textureSample(t, s, terrainUv(p.xy)).xyz * 2.0 - 1.0;
    tx = vec3f(tx.xy + n.zy, abs(tx.z) * n.x);
    ty = vec3f(ty.xy + n.xz, abs(ty.z) * n.y);
    tz = vec3f(tz.xy + n.xy, abs(tz.z) * n.z);
    return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}

fn getAlbedo() {
    let n = normalize(dVertexNormalW);
    gW = triWeights(n);
    let h = vPositionW.y - uniform.uSeaLevel;
    let slope = 1.0 - n.y;

    let wander = 0.6 * sin(vPositionW.x * 0.031 + 1.7) * sin(vPositionW.z * 0.027) + 0.4 * sin(vPositionW.x * 0.071 + vPositionW.z * 0.043);
    let hb = h + wander * 4.0;

    gRock = smoothstep(0.30, 0.52, slope + wander * 0.12);
    gRock = max(gRock, smoothstep(15.0, 24.0, hb) * smoothstep(0.08, 0.25, slope));
    gRock = max(gRock, (1.0 - smoothstep(-80.0, 20.0, vPositionW.x)) * smoothstep(0.0, 3.0, h) * 0.9);
    gRock = max(gRock, vVertexColor.r);
    gGrass = smoothstep(3.2, 6.5, hb) * (1.0 - smoothstep(0.16, 0.36, slope)) * (1.0 - gRock);
    gWet = (1.0 - smoothstep(0.1, 1.1, h)) * (1.0 - gRock) * (1.0 - gGrass);

    let ps = vPositionW * uniform.uTexScale.x;
    let pg = vPositionW * uniform.uTexScale.y;
    let pr = vPositionW * uniform.uTexScale.z;
    let dist = distance(vPositionW, uniform.view_position);
    gFar = smoothstep(50.0, 180.0, dist);
    gNear = 1.0 - smoothstep(3.0, 12.0, dist);
    var sand = mix(triSample(uSandAlbedo, uSandAlbedoSampler, ps, gW), triSample(uSandAlbedo, uSandAlbedoSampler, ps * 0.713 + vec3f(0.37, 0.0, 0.61), gW), 0.5);
    sand = vec4f(sand.rgb * (1.0 + (triSample(uSandAlbedo, uSandAlbedoSampler, ps * 12.0, gW).g * 2.0 - 1.0) * 0.22 * gNear), sand.a);
    sand = vec4f(mix(sand.rgb, mix(vec3f(0.48, 0.42, 0.32), sand.rgb, 0.25), 1.0 - smoothstep(-0.5, 0.5, h)), sand.a);
    let grass = triSample(uGrassAlbedo, uGrassAlbedoSampler, pg, gW);
    var rock = mix(triSample(uRockAlbedo, uRockAlbedoSampler, pr, gW), triSample(uRockAlbedo, uRockAlbedoSampler, pr * 0.2, gW), gFar);
    rock = vec4f(rock.rgb * mix(0.85, 1.1, triSample(uRockAlbedo, uRockAlbedoSampler, pr * 0.045, gW).g) * vec3f(0.75, 0.82, 0.88), rock.a);
    let rockArm = triSample(uRockArm, uRockArmSampler, pr, gW);
    gRough = mix(mix(0.78, 0.85, gGrass), rockArm.g, gRock);
    let ao = mix(1.0, rockArm.r, gRock);

    var c = mix(mix(sand.rgb, grass.rgb, gGrass), rock.rgb, gRock) * ao;
    c = c * mix(1.0, 0.5, gWet);
    c = c * mix(vec3f(1.0), vec3f(0.85, 0.95, 0.9), clamp(-h * 0.25, 0.0, 1.0) * (1.0 - gRock));
    c = c * mix(1.0, 0.55, gRock * (1.0 - smoothstep(-0.4, 1.0, h)));
    dAlbedo = c;
}
`,
    normalMapPS: /* wgsl */`
fn getNormal() {
    let n = normalize(dVertexNormalW);
    let ps = vPositionW * uniform.uTexScale.x;
    let pr = vPositionW * uniform.uTexScale.z;
    var ns = triNormal(uSandNormal, uSandNormalSampler, ps, gW, n);
    let phase = vPositionW.x * 8.0 + sin(vPositionW.z * 0.43 + sin(vPositionW.x * 0.19)) * 3.0;
    let sedimentPatch = smoothstep(-0.2, 0.7, sin(vPositionW.x * 0.21) * sin(vPositionW.z * 0.17 + 1.4));
    let ripple = sin(phase) * sedimentPatch * (1.0 - smoothstep(0.4, 2.0, fwidth(phase)));
    ns = normalize(mix(n, ns, 0.18) + vec3f(ripple * 0.045, 0.0, ripple * 0.012));
    let ng = triNormal(uGrassNormal, uGrassNormalSampler, vPositionW * uniform.uTexScale.y, gW, n);
    let nr = normalize(mix(n, triNormal(uRockNormal, uRockNormalSampler, pr, gW, n), 0.65));
    dNormalW = normalize(mix(mix(ns, ng, gGrass), nr, gRock));
}
`,
    glossPS: /* wgsl */`
fn getGlossiness() {
    dGlossiness = mix(1.0 - gRough, mix(0.12, 0.55, smoothstep(-0.2, 0.4, vPositionW.y - uniform.uSeaLevel)), gWet) + 0.0000001;
}
`
};

/**
 * Turn a StandardMaterial into the triplanar terrain material.
 *
 * @param {import('playcanvas').StandardMaterial} mat - Material to modify in place.
 * @param {object} opts - Options.
 * @param {{albedo: Texture, normal: Texture, arm: Texture}} opts.sand - Sand set.
 * @param {{albedo: Texture, normal: Texture, arm: Texture}} opts.grass - Scrub set.
 * @param {{albedo: Texture, normal: Texture, arm: Texture}} opts.rock - Rock face set.
 * @param {number[]} opts.tileMetres - Metres covered by one tile of each set: [sand, grass, rock].
 * @param {number} [opts.seaLevel] - World Y of the sea, for the wet band.
 */
function applyTerrain(mat, { sand, grass, rock, tileMetres, seaLevel = 0 }) {
    mat.diffuseVertexColor = true; // Authored bedrock/sediment mask, consumed by our albedo chunk.
    mat.shaderChunks.version = '2.22';
    for (const [k, v] of Object.entries(TERRAIN_GLSL)) mat.shaderChunks.glsl.set(k, v);
    for (const [k, v] of Object.entries(TERRAIN_WGSL)) mat.shaderChunks.wgsl.set(k, v);
    mat.setParameter('uSeaLevel', seaLevel);
    mat.setParameter('uTexScale', tileMetres.map(m => 1 / m));
    for (const [name, set] of [['Sand', sand], ['Grass', grass], ['Rock', rock]]) {
        mat.setParameter(`u${name}Albedo`, set.albedo);
        mat.setParameter(`u${name}Normal`, set.normal);
    }
    mat.setParameter('uRockArm', rock.arm);
    mat.update();
}

// ---------------------------------------------------------------- scanned rocks
// The engine's own albedo and gloss stages, with the intertidal band added at the end of each.
const ROCK_GLSL = {
    diffusePS: /* glsl */`
uniform vec3 material_diffuse;
uniform float uSeaLevel;
float gWet;
void getAlbedo() {
    dAlbedo = material_diffuse.rgb;
    #ifdef STD_DIFFUSE_TEXTURE
        dAlbedo *= {STD_DIFFUSE_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_UV}, textureBias)).{STD_DIFFUSE_TEXTURE_CHANNEL};
    #endif
    #ifdef STD_DIFFUSE_VERTEX
        dAlbedo *= saturate(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
    #endif
    // wet, weed-darkened rock below the high-water line
    gWet = 1.0 - smoothstep(0.4, 1.5, vPositionW.y - uSeaLevel);
    dAlbedo *= mix(1.0, 0.4, gWet) * mix(vec3(1.0), vec3(0.8, 0.92, 0.85), gWet * 0.5);
}
`,
    glossPS: /* glsl */`
#ifdef STD_GLOSS_CONSTANT
uniform float material_gloss;
#endif
void getGlossiness() {
    dGlossiness = 1.0;
    #ifdef STD_GLOSS_CONSTANT
    dGlossiness *= material_gloss;
    #endif
    #ifdef STD_GLOSS_TEXTURE
    dGlossiness *= texture2DBias({STD_GLOSS_TEXTURE_NAME}, {STD_GLOSS_TEXTURE_UV}, textureBias).{STD_GLOSS_TEXTURE_CHANNEL};
    #endif
    #ifdef STD_GLOSS_VERTEX
    dGlossiness *= saturate(vVertexColor.{STD_GLOSS_VERTEX_CHANNEL});
    #endif
    #ifdef STD_GLOSS_INVERT
    dGlossiness = 1.0 - dGlossiness;
    #endif
    dGlossiness = mix(dGlossiness, 0.75, gWet) + 0.0000001;
}
`
};

const ROCK_WGSL = {
    diffusePS: /* wgsl */`
uniform material_diffuse: vec3f;
uniform uSeaLevel: f32;
var<private> gWet: f32;
fn getAlbedo() {
    dAlbedo = uniform.material_diffuse.rgb;
    #ifdef STD_DIFFUSE_TEXTURE
        dAlbedo = dAlbedo * {STD_DIFFUSE_TEXTURE_DECODE}(textureSampleBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_NAME}Sampler, {STD_DIFFUSE_TEXTURE_UV}, uniform.textureBias)).{STD_DIFFUSE_TEXTURE_CHANNEL};
    #endif
    #ifdef STD_DIFFUSE_VERTEX
        dAlbedo = dAlbedo * saturate3(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
    #endif
    gWet = 1.0 - smoothstep(0.4, 1.5, vPositionW.y - uniform.uSeaLevel);
    dAlbedo = dAlbedo * mix(1.0, 0.4, gWet) * mix(vec3f(1.0), vec3f(0.8, 0.92, 0.85), gWet * 0.5);
}
`,
    glossPS: /* wgsl */`
#ifdef STD_GLOSS_CONSTANT
    uniform material_gloss: f32;
#endif
fn getGlossiness() {
    dGlossiness = 1.0;
    #ifdef STD_GLOSS_CONSTANT
    dGlossiness = dGlossiness * uniform.material_gloss;
    #endif
    #ifdef STD_GLOSS_TEXTURE
    dGlossiness = dGlossiness * textureSampleBias({STD_GLOSS_TEXTURE_NAME}, {STD_GLOSS_TEXTURE_NAME}Sampler, {STD_GLOSS_TEXTURE_UV}, uniform.textureBias).{STD_GLOSS_TEXTURE_CHANNEL};
    #endif
    #ifdef STD_GLOSS_VERTEX
    dGlossiness = dGlossiness * saturate(vVertexColor.{STD_GLOSS_VERTEX_CHANNEL});
    #endif
    #ifdef STD_GLOSS_INVERT
    dGlossiness = 1.0 - dGlossiness;
    #endif
    dGlossiness = mix(dGlossiness, 0.75, gWet) + 0.0000001;
}
`
};

/**
 * Add the intertidal band to a scanned rock's material.
 *
 * @param {import('playcanvas').StandardMaterial} mat - Material from the glTF, modified in place.
 * @param {number} [seaLevel] - World Y of the sea.
 */
function applyRockWaterline(mat, seaLevel = 0) {
    mat.shaderChunks.version = '2.22';
    for (const [k, v] of Object.entries(ROCK_GLSL)) mat.shaderChunks.glsl.set(k, v);
    for (const [k, v] of Object.entries(ROCK_WGSL)) mat.shaderChunks.wgsl.set(k, v);
    mat.setParameter('uSeaLevel', seaLevel);
    mat.update();
}

export { applyRockWaterline, applyTerrain };
