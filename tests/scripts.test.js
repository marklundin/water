import test from 'node:test';
import assert from 'node:assert/strict';
import { Entity, Vec3, Color } from 'playcanvas';
import { readFile } from 'node:fs/promises';
import { WaterScript, SkyScript } from '../src/scripts/index.js';
import { resolveWaterConfig } from '../src/water/config.js';
import { resolveSkyParams } from '../src/sky/params.js';

function host(name = 'Host') {
    const entity = new Entity(name);
    entity._enabledInHierarchy = true;
    const scripts = new Map();
    entity.script = { enabled: true, _beingEnabled: false, get: name => scripts.get(name) };
    return { entity, scripts };
}
function cameraHost() {
    const result = host('Camera');
    const counts = { color: 0, depth: 0 };
    result.entity.camera = {
        requestSceneColorMap(on) { counts.color += on ? 1 : -1; },
        requestSceneDepthMap(on) { counts.depth += on ? 1 : -1; }
    };
    const rendering = { sceneColorMap: false, sceneDepthMap: true };
    result.scripts.set('cameraFrame', { rendering });
    return { ...result, counts, rendering };
}
function prepare(Type, entity, properties = {}) {
    const script = new Type({ app: {}, entity });
    Object.assign(script, properties);
    script._initialized = script._postInitialized = true;
    return script;
}
class FakeWater {
    constructor(config, log = []) { this.config = resolveWaterConfig(config); this.log = log; this.updates = []; }
    set(patch) { this.config = resolveWaterConfig(patch, this.config); }
    setEnvironment(environment) { assert.equal(environment.atlas.dead, undefined); this.environment = environment; }
    setShoreMap(map) { this.shore = map; }
    update(dt, camera) { this.updates.push([dt, camera]); }
    destroy() { this.destroyed = true; this.log.push('water-destroy'); }
}
class FakeSky {
    constructor(params, log = []) {
        this.params = resolveSkyParams(params); this.log = log; this.ready = false;
        this.envAtlas = {}; this.lightingEquirect = {}; this.aerialDensity = 0.0001;
    }
    setParams(params) { this.params = resolveSkyParams(params, this.params); }
    getSunDirection() { return new Vec3(0.3, 0.6, 0.5).normalize(); }
    getSunColor() { return new Color(2, 1.2, 0.4); }
    get environment() {
        return { atlas: this.envAtlas, radiance: this.lightingEquirect, exposure: this.params.exposure,
            sunDirection: this.getSunDirection(), sunColor: this.getSunColor(), hazeDensity: this.aerialDensity };
    }
    makeReady() { this.ready = true; this.onUpdate?.(); }
    destroy() { this.envAtlas.dead = true; this.ready = false; this.log.push('sky-destroy'); }
}
function scene() {
    const camera = cameraHost(), ocean = host('Ocean'), light = host('Sky'), log = [];
    light.entity.light = { type: 'directional', color: new Color(0.2, 0.3, 0.4), intensity: 7 };
    const sky = prepare(SkyScript, light.entity);
    sky._createSky = params => new FakeSky(params, log);
    light.scripts.set('atmosphereSky', sky);
    const water = prepare(WaterScript, ocean.entity, { cameraEntity: camera.entity, skyEntity: light.entity, quality: 'low' });
    water._createWater = config => new FakeWater(config, log);
    // Water may initialize first in an Editor scene.
    water.initialize();
    sky.initialize();
    return { camera, ocean, light, water, sky, log };
}

test('script wrappers are exported separately without import-time registration', async () => {
    assert.deepEqual(Object.keys(await import('water/scripts')).sort(), ['SkyScript', 'WaterScript']);
    assert.equal(WaterScript.scriptName, 'waterSurface');
    assert.equal(SkyScript.scriptName, 'atmosphereSky');
});

test('water waits for sky readiness, binds maps once, and responds to attributes after camera movement', () => {
    const { water, sky, camera, ocean } = scene();
    assert.equal(water.water, null);
    assert.deepEqual(camera.counts, { color: 1, depth: 1 });
    sky.sky.makeReady();
    assert.ok(water.water);
    assert.equal(water.water.updates[0][0], 0);
    assert.equal(water.water.environment.radiance, sky.sky.lightingEquirect);
    water.windSpeed = 13;
    water.waterColor.set(0.02, 0.15, 0.2);
    ocean.entity.setPosition(0, 2, 0);
    water.postUpdate(0.016);
    assert.equal(water.water.config.wind.speed, 13);
    assert.equal(water.water.config.seaLevel, 2);
    assert.deepEqual(water.water.config.volume.color, [0.02, 0.15, 0.2]);
    assert.equal(water.water.updates.at(-1)[1], camera.entity);
    water.enabled = false;
    sky.enabled = false;
});

test('sky disable detaches consumers before destroying textures, and re-enable reconnects them', () => {
    const { water, sky, camera, light, log } = scene();
    const originalColor = light.entity.light.color.clone();
    const originalRotation = light.entity.getLocalRotation().clone();
    sky.sky.makeReady();
    const originalWater = water.water;
    assert.equal(light.entity.light.intensity, 2);
    sky.enabled = false;
    assert.equal(water.water, null);
    assert.equal(originalWater.destroyed, true);
    assert.deepEqual(log.slice(-2), ['water-destroy', 'sky-destroy']);
    assert.equal(light.entity.light.intensity, 7);
    assert.deepEqual(light.entity.light.color, originalColor);
    assert.deepEqual(light.entity.getLocalRotation(), originalRotation);
    sky.enabled = true;
    sky.sky.makeReady();
    assert.ok(water.water);
    assert.notEqual(water.water, originalWater);
    assert.deepEqual(camera.counts, { color: 1, depth: 1 });
    water.enabled = false;
    sky.enabled = false;
});

test('disable/destroy balances shared camera leases and retains caller-owned maps across enable', () => {
    const { water, sky, camera, ocean } = scene();
    sky.sky.makeReady();
    const otherHost = host('Other ocean');
    const other = prepare(WaterScript, otherHost.entity, { cameraEntity: camera.entity });
    other._createWater = config => new FakeWater(config);
    other.setEnvironment(sky.getEnvironment());
    other.initialize();
    const map = { texture: {}, seaLevel: 0, destroy() { throw new Error('Caller map was destroyed'); } };
    water.setShoreMap(map);
    water.enabled = false;
    assert.deepEqual(camera.counts, { color: 1, depth: 1 });
    assert.equal(camera.rendering.sceneColorMap, true);
    water.enabled = true;
    assert.equal(water.water.shore, map);
    water.enabled = false;
    water.fire('destroy');
    other.enabled = false;
    other.fire('destroy');
    assert.deepEqual(camera.counts, { color: 0, depth: 0 });
    assert.deepEqual(camera.rendering, { sceneColorMap: false, sceneDepthMap: true });
    assert.equal(ocean.entity.enabled, true);
    sky.enabled = false;
});

test('destroying an application camera stops the dependent water before later script teardown', () => {
    const { water, sky, camera } = scene();
    sky.sky.makeReady();
    const renderer = water.water;
    camera.entity.fire('destroy');
    assert.equal(renderer.destroyed, true);
    assert.equal(water.water, null);
    assert.deepEqual(camera.counts, { color: 0, depth: 0 });
    water.enabled = false;
    water.fire('destroy');
    sky.enabled = false;
});

test('invalid camera setup reports a useful error without leaking a map lease', () => {
    const ocean = host('Missing camera');
    const script = prepare(WaterScript, ocean.entity);
    assert.throws(() => script.initialize(), /assign cameraEntity/);
    assert.equal(script._active, false);
});

test('Editor modules are independently importable and preserve component attributes', async () => {
    const read = name => readFile(new URL(`../dist-editor/${name}`, import.meta.url), 'utf8');
    for (const [file, name, dependency] of [
        ['water-surface.mjs', 'WaterScript', './water-lib.mjs'],
        ['atmosphere-sky.mjs', 'SkyScript', './sky-lib.mjs']
    ]) {
        const code = await read(file);
        const imports = [...code.matchAll(/^import .+ from ['"](.+)['"];$/gm)].map(match => match[1]);
        assert.deepEqual(imports, ['playcanvas', dependency]);
        assert.match(code, /@type \{Entity\}/);
        assert.ok(code.includes(`export class ${name} extends Script`));
        assert.equal(typeof (await import(`../dist-editor/${file}`))[name], 'function');
    }
    assert.deepEqual(Object.keys(await import('../dist-editor/water-lib.mjs')).sort(), ['WATER_DEFAULTS', 'Water', 'bakeShoreMap']);
    const water = await read('water-lib.mjs');
    const sky = await read('sky-lib.mjs');
    assert.doesNotMatch(water, /class Sky|Adrift|CinematicFrame|applyTerrain|camera-frame/);
    assert.doesNotMatch(sky, /class Water|Adrift|CinematicFrame|FFT/);
    for (const code of [water, sky]) {
        const imports = [...code.matchAll(/^import .+ from ['"](.+)['"];$/gm)].map(match => match[1]);
        assert.deepEqual(imports, ['playcanvas']);
    }
    assert.deepEqual(Object.keys(await import('water/scripts/water')), ['WaterScript']);
    assert.deepEqual(Object.keys(await import('water/scripts/sky')), ['SkyScript']);
});

test('standalone water needs no sky or example scripts and retains custom lighting', () => {
    const camera = cameraHost(), ocean = host('Independent ocean');
    const script = prepare(WaterScript, ocean.entity, { cameraEntity: camera.entity });
    script._createWater = config => new FakeWater(config);
    script.initialize();
    assert.equal(script.water, null);
    const environment = { atlas: {}, sunDirection: new Vec3(0, 1, 0), sunColor: new Color(1, 1, 1) };
    script.setEnvironment(environment);
    assert.ok(script.water);
    assert.equal(script.water.environment.atlas, environment.atlas);
    script.enabled = false;
    script.enabled = true;
    assert.equal(script.water.environment.atlas, environment.atlas);
    script.enabled = false;
    assert.deepEqual(camera.counts, { color: 0, depth: 0 });
});

test('Adrift components do not bundle or import the reusable renderers', async () => {
    for (const [file, name, dependency] of [
        ['adrift-camera.mjs', 'AdriftCamera', './adrift-post.mjs'],
        ['adrift-buoy.mjs', 'AdriftBuoy', null],
        ['adrift-terrain.mjs', 'AdriftTerrain', './adrift-materials.mjs']
    ]) {
        const code = await readFile(new URL(`../dist-editor/${file}`, import.meta.url), 'utf8');
        const imports = [...code.matchAll(/^import .+ from ['"](.+)['"];$/gm)].map(match => match[1]);
        assert.deepEqual(imports, dependency ? ['playcanvas', dependency] : ['playcanvas']);
        assert.deepEqual([...code.matchAll(/export class (\w+) extends Script/g)].map(m => m[1]), [name]);
        assert.doesNotMatch(code, /new Water\(|new Sky\(|new Entity\(/);
    }
});
