import { Script, Entity, Asset, StandardMaterial, ADDRESS_REPEAT } from 'playcanvas';
import { applyTerrain, applyRockWaterline } from '../triplanar.js';

/** Apply the demo coast's shading to existing geometry, using Editor texture assets. */
export class AdriftTerrain extends Script {
    static scriptName = 'adriftTerrain';
    /** @attribute
     * @type {Entity}
     */
    waterEntity = null;
    /** @attribute
     * @type {Asset}
     * @resource texture
     */
    sandAlbedo = null;
    /** @attribute
     * @type {Asset}
     * @resource texture
     */
    sandNormal = null;
    /** @attribute
     * @type {Asset}
     * @resource texture
     */
    landAlbedo = null;
    /** @attribute
     * @type {Asset}
     * @resource texture
     */
    landNormal = null;
    /** @attribute
     * @type {Asset}
     * @resource texture
     */
    rockAlbedo = null;
    /** @attribute
     * @type {Asset}
     * @resource texture
     */
    rockNormal = null;
    /** @attribute
     * @type {Asset}
     * @resource texture
     */
    rockArm = null;

    initialize() {
        const fields = ['sandAlbedo', 'sandNormal', 'landAlbedo', 'landNormal', 'rockAlbedo', 'rockNormal', 'rockArm'];
        if (fields.some(field => !this[field]?.resource)) throw new Error('Assign and preload all Adrift terrain texture attributes.');
        for (const field of fields) {
            const texture = this[field].resource;
            texture.srgb = field.endsWith('Albedo');
            texture.addressU = texture.addressV = ADDRESS_REPEAT;
        }
        const seaLevel = this.waterEntity?.getPosition().y ?? 0;
        const material = new StandardMaterial();
        material.name = 'Adrift coast surface';
        material.useMetalness = true;
        material.metalness = 0;
        applyTerrain(material, {
            sand: { albedo: this.sandAlbedo.resource, normal: this.sandNormal.resource },
            grass: { albedo: this.landAlbedo.resource, normal: this.landNormal.resource },
            rock: { albedo: this.rockAlbedo.resource, normal: this.rockNormal.resource, arm: this.rockArm.resource },
            tileMetres: [3, 20, 2.7], seaLevel
        });
        const materials = new Set();
        this.originals = [];
        for (const render of this.entity.findComponents('render')) for (const mesh of render.meshInstances) {
            if (mesh.material.name === 'CoastTerrain') {
                this.originals.push([mesh, mesh.material]);
                mesh.material = material;
            } else if (!materials.has(mesh.material)) applyRockWaterline(mesh.material, seaLevel);
            materials.add(mesh.material);
        }
        const component = this.waterEntity?.script?.waterSurface;
        const attach = water => { this.detach = [...materials].map(m => water.addReceiver(m)); };
        component?.on('water:ready', attach);
        if (component?.water) attach(component.water);
        this.on('destroy', () => {
            component?.off('water:ready', attach);
            this.detach?.forEach(fn => fn());
            for (const [mesh, original] of this.originals) mesh.material = original;
            material.destroy();
        });
    }
}
