import { readFile } from 'node:fs/promises';
import { bundleModule, copyComponent } from './editor-modules.mjs';

await bundleModule('src/water/index.js', 'water-lib.mjs');
const sceneMaps = (await readFile('src/scripts/scene-maps.js', 'utf8'))
    .replace('export function acquireSceneMaps', 'function acquireSceneMaps');
await copyComponent('src/scripts/WaterScript.mjs', 'water-surface.mjs', {
    "import { Water } from '../index.js';": "import { Water } from './water-lib.mjs';",
    "import { acquireSceneMaps } from './scene-maps.js';": sceneMaps
});
await bundleModule('src/sky/index.js', 'sky-lib.mjs');
await copyComponent('src/scripts/SkyScript.mjs', 'atmosphere-sky.mjs', {
    "'../sky/index.js'": "'./sky-lib.mjs'"
});
