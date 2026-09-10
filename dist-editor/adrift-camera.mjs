// Generated from demo/editor/AdriftCamera.mjs. Keep its companion modules in the same Editor folder.
import { Script, Entity } from 'playcanvas';
import { CinematicFrame } from './adrift-post.mjs';

/** Presentation only: never moves the camera or creates scene geometry. */
export class AdriftCamera extends Script {
    static scriptName = 'adriftCamera';
    /**
     * @attribute
     * @type {Entity}
     */
    focusEntity = null;

    initialize() {
        this.frame = this.entity.script.create(CinematicFrame);
        const f = this.frame;
        f.rendering.renderFormat = 'rgba16';
        f.rendering.toneMapping = 'aces2';
        f.rendering.sceneColorMap = true;
        f.rendering.sceneDepthMap = true;
        f.rendering.samples = 1;
        f.bloom.enabled = true;
        f.bloom.intensity = .02;
        f.bloom.blurLevel = 6;
        f.dof.enabled = Boolean(this.focusEntity);
        f.dof.nearBlur = true;
        f.dof.highQuality = true;
        f.dof.focusRange = 7;
        f.dof.blurRadius = 4;
        f.waterFocus = true;
        f.seaLevel = 0;
        this.on('destroy', () => this.entity.script?.destroy(CinematicFrame));
    }
    update() {
        if (this.focusEntity) this.frame.dof.focusDistance = this.entity.getPosition().distance(this.focusEntity.getPosition());
    }
}
