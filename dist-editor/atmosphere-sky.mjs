// Generated from src/scripts/SkyScript.mjs. Keep its companion modules in the same Editor folder.
import { Script, Entity, Vec3, Quat } from 'playcanvas';
import { Sky } from './sky-lib.mjs';

/** Standalone atmosphere component; the application supplies its optional directional light. */
export class SkyScript extends Script {
    static scriptName = 'atmosphereSky';

    /** Optional entity with a directional Light component; defaults to this entity's light.
     * @attribute
     * @type {Entity}
     */
    lightEntity = null;

    /** Sun height in degrees; negative values produce twilight.
     * @attribute
     * @range [-12, 90]
     */
    sunElevation = 25;

    /** Sun heading in degrees.
     * @attribute
     * @range [0, 360]
     */
    sunAzimuth = 165;

    /** Atmospheric aerosol amount.
     * @attribute
     * @range [0, 8]
     */
    haze = 1;

    /** Shared atmosphere and sunlight exposure.
     * @attribute
     * @range [0.05, 3]
     */
    exposure = 0.55;

    /** The current Sky, or null while this component is disabled. Do not destroy it directly. */
    sky = null;

    initialize() {
        this._axis = new Vec3();
        this._rotation = new Quat();
        this.on('enable', this._start, this);
        this.on('disable', this._stop, this);
        this.on('destroy', this._stop, this);
        if (this.enabled) this._start();
    }

    _params() {
        return { sunElevation: this.sunElevation, sunAzimuth: this.sunAzimuth, haze: this.haze, exposure: this.exposure };
    }

    // Factory seam keeps lifecycle tests independent of GPU allocation.
    _createSky(params) { return new Sky(this.app, params); }

    _start() {
        if (this.sky) return;
        this.sky = this._createSky(this._params());
        this.sky.onUpdate = () => {
            this._syncLight();
            this.fire('sky:ready', this.sky);
        };
        if (this.sky.ready) this.sky.onUpdate();
    }

    _stop() {
        if (!this.sky) return;
        // Consumers detach before the environment textures are disposed.
        this.fire('sky:before-destroy', this.sky);
        this.sky.destroy();
        this.sky = null;
        this._restoreLight();
    }

    _restoreLight() {
        if (!this._lightState) return;
        const { entity, rotation, color, intensity } = this._lightState;
        if (entity.light) {
            entity.setLocalRotation(rotation);
            entity.light.color = color;
            entity.light.intensity = intensity;
        }
        this._lightState = null;
    }

    _syncLight() {
        const entity = this.lightEntity ?? (this.entity.light ? this.entity : null);
        if (this._lightState?.entity !== entity) {
            this._restoreLight();
            if (entity) {
                if (!(entity instanceof Entity) || entity.light?.type !== 'directional') {
                    throw new Error('SkyScript: lightEntity must have a directional Light component.');
                }
                this._lightState = {
                    entity, rotation: entity.getLocalRotation().clone(),
                    color: entity.light.color.clone(), intensity: entity.light.intensity
                };
            }
        }
        if (!entity || !this.sky?.ready) return;
        const direction = this.sky.getSunDirection();
        this._axis.set(direction.z, 0, -direction.x);
        if (this._axis.length() > 1e-6) {
            this._rotation.setFromAxisAngle(this._axis.normalize(), Math.acos(Math.max(-1, Math.min(1, direction.y))) * 180 / Math.PI);
        } else if (direction.y < 0) this._rotation.setFromAxisAngle(Vec3.RIGHT, 180);
        else this._rotation.copy(Quat.IDENTITY);
        entity.setRotation(this._rotation);
        const color = this.sky.getSunColor();
        const intensity = Math.max(color.r, color.g, color.b);
        entity.light.color = color.mulScalar(intensity > 0 ? 1 / intensity : 0);
        entity.light.intensity = intensity;
    }

    update() {
        if (!this.sky) return;
        this.sky.setParams(this._params());
        this._syncLight();
    }

    /** Caller may connect other renderers to the same exposed lighting values. */
    getEnvironment() {
        if (!this.sky?.ready) return null;
        return this.sky.environment;
    }
}
