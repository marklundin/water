# PlayCanvas Editor modules

Upload each component and its companion into the same asset folder. Parse the component's
attributes, then attach it by script name. Implementation modules are imports, not entity scripts.

| Copy | Component | Implementation | Attach as |
| --- | --- | --- | --- |
| Water | `water-surface.mjs` | `water-lib.mjs` | `waterSurface` |
| Optional sky | `atmosphere-sky.mjs` | `sky-lib.mjs` | `atmosphereSky` |
| Example camera | `adrift-camera.mjs` | `adrift-post.mjs` | `adriftCamera` |
| Example prop | `adrift-buoy.mjs` | — | `adriftBuoy` |
| Example coast | `adrift-terrain.mjs` | `adrift-materials.mjs` | `adriftTerrain` |

**To extract water, copy only its two files.** Assign Camera Entity and supply an environment
through `setEnvironment()`, or copy the optional sky pair and assign Sky Entity. No Adrift file
or model is needed. Water also exports its low-level renderer, defaults and shore-map baker
from `water-lib.mjs`.

Keep your camera, geometry and materials in your scene. The components don't create them.
The five `adrift-*` modules are example code and are not dependencies of either library.

See [the integration guide](../docs/playcanvas.md) for setup, custom lighting and lifecycle.
Build libraries/components with `npm run build:editor`, examples with `npm run build:editor:adrift`.
Generated `.mjs` files are checked in for direct download; edit their source files to make changes.
