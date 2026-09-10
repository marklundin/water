# Add Water and Sky to a PlayCanvas project

`WaterScript` and `SkyScript` are optional components around the rendering libraries. They add
no camera, scene geometry, colour grade or directional light. The small runnable example at
[`demo/script.html`](../demo/script.html) uses both scripts with application-owned reference
objects and controls for checking disable/enable behaviour.

## PlayCanvas Editor

1. In this checkout, run `npm install` and `npm run build:editor`.
2. For water, upload **`dist-editor/water-surface.mjs`** and **`dist-editor/water-lib.mjs`**
   into the same Editor folder. The first is the readable component; the second contains
   only the water renderer. For our optional atmosphere, also
   upload **`atmosphere-sky.mjs`** and **`sky-lib.mjs`** together in a folder. Each pair is
   independent of the other and of every Adrift file. Relative ESM imports connect them;
   the Editor supplies `playcanvas`.
3. Parse the uploaded script's attributes. Add a Script component to an entity and add
   **`atmosphereSky`**. Assign an existing directional-light entity to **Light Entity**, or attach
   the script to the directional-light entity itself. The light is optional if only the sky and
   environment are needed.
4. Add **`waterSurface`** to another entity's Script component. Assign the existing camera to
   **Camera Entity**, and the entity carrying `atmosphereSky` to **Sky Entity**. Place the water
   entity at the desired Y sea level. The surface follows the camera in XZ; it does not follow
   the water entity's rotation or XZ translation.
5. Set the five water controls: **Wind Speed**, **Wave Height**, **Water Color**, **Visibility**
   and **Quality**. The sky exposes **Sun Elevation**, **Sun Azimuth**, **Haze** and **Exposure**.
   Start with the defaults and use the application's camera tone mapping for final presentation.

The Editor loads and registers exported `.mjs` Script classes automatically. Attribute parsing
is required when adding or changing attribute definitions. These steps follow the official
[ESM script workflow](https://developer.playcanvas.com/user-manual/scripting/esm-scripts/) and
[ESM attribute reference](https://developer.playcanvas.com/user-manual/scripting/script-attributes/esm/).

A camera needs scene colour and scene depth maps for refraction and screen-space reflection.
The water script acquires and releases the camera's map requests. If the camera carries the
PlayCanvas **Camera Frame ESM script** named `cameraFrame`, it also enables that script's scene
map settings and restores their original values when the last water component releases them.
Configure HDR output and tone mapping in Camera Frame or your own camera setup; the wrapper
does not create or grade the camera. If you instantiate the engine's `CameraFrame` class directly
in application code, enable `frame.rendering.sceneColorMap` and
`frame.rendering.sceneDepthMap` there, since that external object is not an entity script.

## Engine-only or bundled application

Install the package into an application using PlayCanvas 2.22 or later. When working directly
from this checkout, replace `water/scripts` below with `./src/scripts/index.js`.

```js
import { Entity, registerScript } from 'playcanvas';
import { WaterScript } from 'water/scripts/water';
import { SkyScript } from 'water/scripts/sky';

// app, cameraEntity and sunlightEntity are supplied by the application.
// app must include Camera, Light, Render and Script component systems.
registerScript(WaterScript, undefined, app);
registerScript(SkyScript, undefined, app);

sunlightEntity.addComponent('script');
const atmosphere = sunlightEntity.script.create('atmosphereSky', {
    properties: { sunElevation: 18, sunAzimuth: 160, haze: 0.6, exposure: 0.55 }
});

const oceanEntity = new Entity('Ocean');
oceanEntity.addComponent('script');
app.root.addChild(oceanEntity);
const ocean = oceanEntity.script.create('waterSurface', {
    properties: {
        cameraEntity,
        skyEntity: sunlightEntity,
        windSpeed: 7,
        waveHeight: 0.8,
        visibility: 12,
        quality: 'medium'
    }
});
```

Register the classes with the particular application's registry before creating them by name.
The engine's `properties` creation option assigns actual Entity/Color objects before
`initialize()`; it avoids requiring Editor-generated attribute metadata in an engine-only app.
This is verified against the installed PlayCanvas 2.22 ScriptComponent implementation and the
[registration reference](https://api.playcanvas.com/engine/functions/registerScript.html).

The package does not register scripts as an import side effect. Existing Script components
should be reused instead of adding them a second time. See
[`demo/script-main.js`](../demo/script-main.js) for a complete application, including Camera
Frame, a directional light and component-system registration.

## Runtime changes and ownership

```js
ocean.windSpeed = 12;       // Editor-style fields update the renderer next frame
atmosphere.sunElevation = 5;
ocean.enabled = false;      // releases the surface and this script's camera map requests
ocean.enabled = true;       // recreates the surface when lighting is ready
```

`ocean.water` is the current Water instance, or `null` while disabled or waiting for lighting.
`atmosphere.sky` is the current Sky instance, or `null` while disabled. Disable/re-enable
recreates GPU resources and restarts water simulation time; it is a component lifecycle control,
not a seamless animation pause. Use `ocean.water.set({ timeScale: 0 })` to pause only the sea.
The wrappers use the engine's documented
[enable, disable and destroy lifecycle events](https://developer.playcanvas.com/user-manual/scripting/script-lifecycle/).

Water waits for the assigned sky's first completed environment. Subsequent sky updates replace
its lighting reference before the previous textures are disposed. Disabling the sky first
removes its dependent water surface, then releases the sky textures and restores the previous
scene environment and the assigned light's original rotation, colour and intensity. Re-enabling
the sky reconnects enabled water scripts. Application entities and geometry are never destroyed.

For settings outside the five primary water controls, subscribe to the readiness event so the
same configuration is applied after every resource recreation:

```js
const configureWater = water => {
    water.set({
        swell: { strength: 0.4, direction: -30 },
        roughness: 0.045,
        caustics: { enabled: true, strength: 0.7, scale: 0.2 }
    });
};
ocean.on('water:ready', configureWater);
if (ocean.water) configureWater(ocean.water);
```

The primary attributes own their corresponding settings; changing one of them reapplies that
small set of water controls. `water:before-destroy` and `sky:before-destroy` notify consumers
before renderer-owned resources are released. Do not destroy the exposed renderer instances
yourself; disable or destroy the owning script instead.

## Bathymetry and custom lighting

Geometry and shore-map baking remain application responsibilities. Supply a map baked at the
water entity's Y sea level using `ocean.setShoreMap(map)`. The wrapper retains that caller-owned
map across disable/enable and never destroys its texture. Detach and rebake before changing sea
level. Remove the map from the script before destroying it in application code.

SkyScript is optional. Without an assigned Sky Entity or an `atmosphereSky` script on the water
entity itself, supply another environment using the same descriptor accepted by Water:

```js
ocean.setEnvironment({
    atlas: applicationAtlas,
    radiance: applicationRadianceTexture, // optional direct equirectangular radiance
    exposure: 1,
    sunDirection,                        // PlayCanvas Vec3 toward the sun
    sunColor,                            // PlayCanvas Color, direct linear irradiance
    hazeDensity: 0.0001
});
```

Those textures remain caller-owned. Keep them alive while the enabled water component uses
them; supply a replacement or disable water before disposing them. WaterScript can use SkyScript
without a directional light, while SkyScript can run without any WaterScript.

## Verification

`npm run build:editor` creates the four uploadable water/sky modules. `npm test` covers readiness ordering,
attribute changes, texture-disposal ordering, repeated enable/disable, shared camera-map leases,
map ownership, standalone custom lighting, and the generated modules’ dependency boundaries and preserved attributes. These
checks use real engine Script/Entity/event classes with GPU renderer fakes.

Open `/demo/script.html` and `/demo/script.html?gfx=webgl2` in a browser to exercise the actual
component integration and both GPU backends. The fixture's buttons disable/re-enable each
component and its visible status reports readiness. Editor-side upload and attribute parsing must also be checked after migrating an existing project;
source tests alone do not verify its saved asset references.

### Underwater scene materials

The core renderer can opt opaque StandardMaterials into water attenuation and wave-driven
caustics without adding Editor attributes:

```js
const water = waterEntity.script.waterSurface.water;
const detach = water.addReceiver(seabedMaterial);
// Detach before disposing the material; water.destroy() also releases the binding.
```

Attach after the water script has initialized. If the component is disabled and re-enabled,
its Water instance is recreated, so reattach receivers to the new instance. The application owns
which scene materials participate. The existing visibility and caustic settings control their
appearance; there is no separate demo-only underwater fog control.

## The Adrift Editor example

[Water + Atmosphere](https://playcanvas.com/editor/scene/2591939) uses a small,
authored scene. The camera stays at its Editor transform; imported coast and buoy
templates contain native render entities that can be inspected and repositioned.
There is no runtime gallery bootstrap or hosted asset root. Assets are organised into
**Water**, **Sky** and **Adrift Example** folders. The Water folder is the complete reusable
water dependency set; Sky is optional. The previous gallery bootstrap is retained under
Adrift Example as `unused-gallery-bootstrap.mjs`, with Preload off and Exclude on.

| Entity | Script | Attribute connections |
| --- | --- | --- |
| Camera | `adriftCamera` | `focusEntity` → Buoy |
| Light | `atmosphereSky` | `lightEntity` → Light |
| Water | `waterSurface` | `cameraEntity` → Camera; `skyEntity` → Light |
| coast | `adriftTerrain` | `waterEntity` → Water; seven texture assets below |
| Buoy | `adriftBuoy` | `waterEntity` → Water |

Camera position is `[5, 2, 10]`, Euler rotation `[-4.94, 30.26, 0]`, FOV 38,
and clip range 0.1–60000. Buoy position is `[-2, 0, -2]`; coast and Water are at
the origin. The sky uses sun elevation 12°, azimuth 108°, haze 0.6 and exposure
0.33. Water uses wind speed 1.8, wave height 0.6, visibility 16 and medium quality.

Assign these **preloaded texture assets** to `adriftTerrain`:

| Attribute | Asset |
| --- | --- |
| `sandAlbedo` | `coast_sand_01_diffuse_2k.jpg` |
| `sandNormal` | `coast_sand_01_nor_gl_2k.jpg` |
| `landAlbedo` | `coast_land_rocks_01_diffuse_2k.jpg` |
| `landNormal` | `coast_land_rocks_01_nor_gl_2k.jpg` |
| `rockAlbedo` | `rock_face_03_diffuse_2k.jpg` |
| `rockNormal` | `rock_face_03_nor_gl_2k.jpg` |
| `rockArm` | `rock_face_03_arm_2k.jpg` |

The terrain script shades existing render components and registers their materials
as water receivers. The buoy script samples the water around its authored anchor
and animates only its position and rotation. The camera script adds the example's
cinematic treatment and focuses on its assigned entity. These three scripts are
example code, separate from the reusable water and atmosphere components.

To rebuild the uploadable scripts:

```sh
npm run build:editor          # independent water and sky component/runtime pairs
npm run build:editor:adrift   # separate example camera, buoy and terrain components
npm run export:editor:buoy    # offline export of the existing buoy prop
npm run build                # compressed production coast and textures
```

Upload the water/sky pairs described above, plus these example-only files:

| Component | Companion module | Responsibility |
| --- | --- | --- |
| `adrift-camera.mjs` | `adrift-post.mjs` | Camera Frame and focus settings |
| `adrift-buoy.mjs` | None | Animate an existing prop using water surface samples |
| `adrift-terrain.mjs` | `adrift-materials.mjs` | Coast materials and underwater receiver registration |

Keep each component and its companion in the same Editor folder. Parse the five component
scripts (`water-surface`, `atmosphere-sky`, `adrift-camera`, `adrift-buoy`, `adrift-terrain`).
The library modules are dependencies, not components to attach to entities.

To take water into another project, copy **only the water pair** and connect your camera.
Supply custom lighting with `setEnvironment()` as above, or copy the optional sky pair and
assign Sky Entity. No coast, buoy, textures, camera controller or post effects are required.
The low-level `Water` class is also exported by `water-lib.mjs` for custom integrations.

When migrating from the old combined bundles, replace them rather than retaining duplicate
`waterSurface` / `atmosphereSky` / `adrift*` registrations. Existing script names and attribute
names are unchanged, so authored scene references can be retained.

 Import `dist-editor/adrift-buoy.glb` and
`dist/demo/assets/coast/coast.glb`, then drag their templates into the hierarchy.
Upload the seven production texture files from `dist/demo/assets/` and connect the
attributes listed above. Imported coast materials and embedded textures remain
part of the project. The GLB export happens offline; it does not generate geometry
when the scene launches.
