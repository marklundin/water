import { bundleModule, copyComponent } from './editor-modules.mjs';

await bundleModule('demo/CinematicFrame.js', 'adrift-post.mjs');
await bundleModule('demo/triplanar.js', 'adrift-materials.mjs');
await copyComponent('demo/editor/AdriftCamera.mjs', 'adrift-camera.mjs', {
    "'../CinematicFrame.js'": "'./adrift-post.mjs'"
});
await copyComponent('demo/editor/AdriftBuoy.mjs', 'adrift-buoy.mjs');
await copyComponent('demo/editor/AdriftTerrain.mjs', 'adrift-terrain.mjs', {
    "'../triplanar.js'": "'./adrift-materials.mjs'"
});
