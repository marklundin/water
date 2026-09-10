// Generated from src/scripts/WaterScript.mjs. Keep its companion modules in the same Editor folder.
import { Script, Entity, Color } from 'playcanvas';
import { Water } from './water-lib.mjs';
// CameraFrame uses booleans while CameraComponent uses reference-counted requests.
// Share one lease per CameraFrame settings object so multiple surfaces cannot undo each other.
const frameLeases = new WeakMap();

function acquireSceneMaps(cameraEntity) {
    const camera = cameraEntity?.camera;
    if (!camera) throw new Error('WaterScript: assign cameraEntity to an entity with a Camera component.');
    camera.requestSceneColorMap(true);
    try { camera.requestSceneDepthMap(true); }
    catch (error) { camera.requestSceneColorMap(false); throw error; }
    const rendering = cameraEntity.script?.get('cameraFrame')?.rendering;
    if (rendering) {
        let lease = frameLeases.get(rendering);
        if (!lease) {
            lease = { count: 0, color: rendering.sceneColorMap, depth: rendering.sceneDepthMap };
            frameLeases.set(rendering, lease);
        }
        lease.count++;
        rendering.sceneColorMap = rendering.sceneDepthMap = true;
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        // A removed Camera component has already disposed its render passes.
        if (cameraEntity.camera === camera) {
            camera.requestSceneColorMap(false);
            camera.requestSceneDepthMap(false);
        }
        if (rendering) {
            const lease = frameLeases.get(rendering);
            if (--lease.count === 0) {
                if (rendering.sceneColorMap === true) rendering.sceneColorMap = lease.color;
                if (rendering.sceneDepthMap === true) rendering.sceneDepthMap = lease.depth;
                frameLeases.delete(rendering);
            }
        }
    };
}


/** A water surface component with five primary look controls and explicit scene references. */
export class WaterScript extends Script {
    static scriptName = 'waterSurface';

    /** Camera driving the surface; defaults to this entity if it has a Camera component.
     * @attribute
     * @type {Entity}
     */
    cameraEntity = null;

    /** Entity with an atmosphereSky script; defaults to this entity. Other lighting can be supplied in code.
     * @attribute
     * @type {Entity}
     */
    skyEntity = null;

    /** Local wind speed in metres per second.
     * @attribute
     * @range [0.1, 30]
     */
    windSpeed = 9;

    /** Overall wave displacement multiplier.
     * @attribute
     * @range [0, 2]
     */
    waveHeight = 1;

    /** Water-body scattering colour in linear RGB.
     * @attribute
     */
    waterColor = new Color(0.003, 0.075, 0.11);

    /** Visibility through the water, in metres.
     * @attribute
     * @range [0.5, 50]
     */
    visibility = 10;

    /** Simulation and surface quality.
     * @attribute
     * @type {'low' | 'medium' | 'high'}
     */
    quality = 'medium';

    /** Current Water, or null while disabled or waiting for lighting. Do not destroy it directly. */
    water = null;

    initialize() {
        this.on('enable', this._start, this);
        this.on('disable', this._stop, this);
        this.on('destroy', this._stop, this);
        if (this.enabled) this._start();
    }

    _config() {
        return {
            seaLevel: this.entity.getPosition().y, quality: this.quality, wind: { speed: this.windSpeed }, waves: { amplitude: this.waveHeight },
            volume: { color: [this.waterColor.r, this.waterColor.g, this.waterColor.b], visibility: this.visibility }
        };
    }

    _createWater(config) { return new Water(this.app, config); }

    _attributeValues() {
        return [this.entity.getPosition().y, this.quality, this.windSpeed, this.waveHeight,
            this.waterColor.r, this.waterColor.g, this.waterColor.b, this.visibility];
    }

    _start() {
        if (this._active) return;
        this._active = true;
        try { this._syncReferences(); this._ensureWater(); }
        catch (error) { this._stop(); throw error; }
    }

    _stop() {
        this._active = false;
        this._unbindSky();
        this._disposeWater();
        this._releaseMaps?.();
        this._releaseMaps = null;
        this._camera?.off('destroy', this._onCameraDestroyed, this);
        this._camera = null;
    }

    _onCameraDestroyed() { this._stop(); }

    _disposeWater() {
        if (!this.water) return;
        this.fire('water:before-destroy', this.water);
        this.water.destroy();
        this.water = null;
    }

    _unbindSky() {
        this._skyScript?.off('sky:ready', this._onSkyReady, this);
        this._skyScript?.off('sky:before-destroy', this._onSkyGone, this);
        this._skyScript = null;
    }

    _syncReferences() {
        const camera = this.cameraEntity ?? this.entity;
        if (!(camera instanceof Entity)) throw new TypeError('WaterScript: cameraEntity must be an Entity.');
        if (camera !== this._camera) {
            // Acquire first: a bad replacement does not discard the existing valid camera lease.
            const release = acquireSceneMaps(camera);
            this._releaseMaps?.();
            this._releaseMaps = release;
            this._camera?.off('destroy', this._onCameraDestroyed, this);
            this._camera = camera;
            camera.on('destroy', this._onCameraDestroyed, this);
        }
        const sky = (this.skyEntity ?? this.entity).script?.get('atmosphereSky') ?? null;
        if (sky !== this._skyScript) {
            this._unbindSky();
            this._disposeWater();
            this._skyScript = sky;
            sky?.on('sky:ready', this._onSkyReady, this);
            sky?.on('sky:before-destroy', this._onSkyGone, this);
        }
    }

    _onSkyReady() {
        if (!this._active) return;
        this._ensureWater();
        if (this.water) this.water.setEnvironment(this._skyScript.getEnvironment());
    }

    _onSkyGone() { this._disposeWater(); }

    _ensureWater() {
        if (!this._active || this.water) return;
        const environment = this._skyScript ? this._skyScript.getEnvironment() : this._environment;
        if (!environment) return; // Explicit readiness: never render with an unbound environment texture.
        const water = this._createWater(this._config());
        try {
            water.setEnvironment(environment);
            if (this._shoreMap) water.setShoreMap(this._shoreMap);
            water.update(0, this._camera);
        } catch (error) { water.destroy(); throw error; }
        this.water = water;
        this._lastAttributes = this._attributeValues();
        this.fire('water:ready', water);
    }

    /** Supply caller-owned lighting when not using a SkyScript. Textures are never destroyed here. */
    setEnvironment(environment) {
        if (this._skyScript || this.skyEntity) throw new Error('WaterScript: clear skyEntity before supplying custom lighting.');
        this._environment = {
            ...environment, sunDirection: environment.sunDirection.clone(), sunColor: environment.sunColor.clone()
        };
        this._ensureWater();
        this.water?.setEnvironment(this._environment);
        return this;
    }

    /** Retain caller-owned bathymetry across disable/enable. Set null to detach it. */
    setShoreMap(map) {
        this.water?.setShoreMap(map);
        this._shoreMap = map;
        return this;
    }

    postUpdate(dt) {
        if (!this._active) return;
        this._syncReferences();
        this._ensureWater();
        if (!this.water) return;
        const attributes = this._attributeValues();
        if (attributes.some((value, i) => value !== this._lastAttributes[i])) {
            this.water.set(this._config());
            this._lastAttributes = attributes;
        }
        this.water.update(dt, this._camera);
    }
}
