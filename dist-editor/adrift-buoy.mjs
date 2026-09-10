// Generated from demo/editor/AdriftBuoy.mjs. Keep its companion modules in the same Editor folder.
import { Script, Entity, Vec3, Quat } from 'playcanvas';

/** Float an existing, Editor-placed model around its authored waterline. */
export class AdriftBuoy extends Script {
    static scriptName = 'adriftBuoy';
    /**
     * @attribute
     * @type {Entity}
     */
    waterEntity = null;
    initialize() {
        this.anchor = this.entity.getPosition().clone();
        this.rotation = this.entity.getRotation().clone();
        this.up = new Vec3(0, 1, 0);
        this.axis = new Vec3();
        this.normal = new Vec3();
        this.tilt = new Quat();
        this.target = new Quat();
        this.smoothed = this.rotation.clone();
    }
    update(dt) {
        const water = this.waterEntity?.script?.waterSurface?.water;
        if (!water) return;
        const { x, z } = this.anchor;
        const y = water.getSurfaceAt(x, z).position.y;
        const dx = water.getSurfaceAt(x + 1.1, z).position.y - y;
        const dz = water.getSurfaceAt(x, z + 1.1).position.y - y;
        this.normal.set(-dx / 1.1, 1, -dz / 1.1).normalize().lerp(this.up, this.normal, .55).normalize();
        const axis = this.axis.cross(this.up, this.normal);
        this.tilt.copy(Quat.IDENTITY);
        if (axis.length() > 1e-5) this.tilt.setFromAxisAngle(axis.normalize(), Math.acos(Math.min(1, this.up.dot(this.normal))) * 180 / Math.PI);
        this.target.mul2(this.tilt, this.rotation);
        const k = Math.min(1, dt * 6), p = this.entity.getPosition();
        this.entity.setPosition(x, p.y + (y + this.anchor.y - p.y) * k, z);
        this.smoothed.slerp(this.smoothed, this.target, k);
        this.entity.setRotation(this.smoothed);
    }
}
