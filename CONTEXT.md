# Water and atmosphere

This workspace contains two independent PlayCanvas rendering libraries, optional Script components, and a gallery that composes them.

- **Water** owns the sea surface, spectral wave simulation, optical shading and approximate surface queries. Its supported configuration has 17 leaves; renderer constants remain private.
- **Sea state** combines local wind and independent swell, with amplitude and choppiness. It is independent of camera framing and colour grade.
- **Quality** is a named `low`, `medium` or `high` budget for simulation, tessellation and reflection tracing. It is not a collection of publicly adjustable GPU constants.
- **Shore map** is caller-owned bathymetry at a specified sea level. Supplying a map enables the renderer's derived shore response.
- **Environment** is caller-owned illumination: a prefiltered atlas, optional directional sky radiance, sun direction/irradiance, exposure and atmospheric extinction. Water accepts one named descriptor and does not require Sky.
- **Sky** owns an Earth atmosphere and solar/environment outputs. Its four controls are sun elevation, sun azimuth, haze and exposure. Molecular scattering, ozone, aerosol phase and ground reflectance are model constants. `sky.environment` is the integration descriptor.
- **Script components** adapt the core libraries to PlayCanvas entities, camera references, light references and component lifecycle. They contain no gallery logic.
- **Study** is a demo camera path with a visual intent and a complete look, defined in `demo/director.js`.
- **Gallery** contains nine studies. Focused light (`caustics`) looks down from below the surface to isolate moving caustic ribbons on sand; Beneath the surface instead looks up at the air/water interface.
- **Look** combines water configuration, sky configuration and camera presentation, exclusively in `demo/presets.js`.
- **Scene** owns demo geometry, bathymetry, props, terrain material effects and asset loading. The gallery coast is authored with bpy; its delivery mesh and raycast bathymetry share one export. Runtime terrain generation is not part of either library.

Supported package imports are `water`, `water/sky`, `water/scripts/water` and `water/scripts/sky`; `water/scripts` remains a convenience barrel. Editor distribution uses independent readable components and implementation modules: water-surface + water-lib, atmosphere-sky + sky-lib. Adrift camera, buoy and terrain scripts are example-only files; neither library imports them. Configuration is immutable and changed through validated setters. There is no public advanced configuration object. The demo's Studio is a separate eight-control adapter, not a mirror of the renderer schema. Caustics are explicitly opt-in and disabled by default.

Caustic focus samples the two finest live FFT bands in `src/water/shaders/caustics.js`, follows inverse solar refraction and estimates the ray-map area change. Finite footprints and a bounded response stabilize folds; multiple ray paths and exact energy conservation remain approximations. Water owns `addReceiver(StandardMaterial)` for opaque underwater attenuation and caustics, with a detachable material lifecycle. Receivers preserve material maps and shadows and use the same RGB extinction / visibility as the surface. The demo owns only terrain material detail and scene attachment; it no longer implements its own caustic effect.

Aerial perspective uses the sky's directional radiance and extinction. Fading finite mesh coverage is separate from optical haze; a resource boundary must not dictate a fake atmospheric density. Camera exposure and effects remain application decisions.

The gallery is a rendering study, not a full fluid or weather simulation. See `docs/review.md` for model limits and the supplied coast assessment, and `docs/playcanvas.md` for Script component integration.
