# Demo assets

The scanned rocks and ground textures listed in the tables below are from
[Poly Haven](https://polyhaven.com) and licensed
[CC0](https://creativecommons.org/publicdomain/zero/1.0/). The separately supplied Saltreach
candidate has no provenance recorded in this repository; the CC0 statement does not cover it.

## Source models (`models/`, authoring only)

These originals are preserved for the bpy build and excluded from production.

Scanned coastal rocks, downloaded as glTF at 1k texture resolution and decimated with
[glTF Transform](https://gltf-transform.dev) (`simplify --ratio … --error 0.002`) to roughly
50k triangles each, then packed to GLB.

| File | Poly Haven asset | Used for |
| --- | --- | --- |
| `coast_rocks_01.glb` | [Coast Rocks 01](https://polyhaven.com/a/coast_rocks_01) | stacks and skerries |
| `coast_rocks_03.glb` | [Coast Rocks 03](https://polyhaven.com/a/coast_rocks_03) | stacks and skerries |
| `coast_rocks_05.glb` | [Coast Rocks 05](https://polyhaven.com/a/coast_rocks_05) | stacks and skerries |
| `sand_rocks_small_01.glb` | [Sand Rocks Small 01](https://polyhaven.com/a/sand_rocks_small_01) | rocks on the beach |
| `boulder_01.glb` | [Boulder 01](https://polyhaven.com/a/boulder_01) | boulders on the beach and at the headland foot |
| `rock_09.glb` | [Rock 09](https://polyhaven.com/a/rock_09) | small stones |

## Textures (`textures/`)

Scanned PBR sets at 2k (`diffuse`, `nor_gl` OpenGL-convention normal; the rock set also carries
`arm` = AO / roughness / metalness), projected onto the terrain heightfield triplanar-ly and blended
by height and slope.

| Folder | Poly Haven asset | Tile | Used for |
| --- | --- | --- | --- |
| `coast_sand_01` | [Coast Sand 01](https://polyhaven.com/a/coast_sand_01) | 3 m | the beach and sea bed |
| `coast_land_rocks_01` | [Coast Land Rocks 01](https://polyhaven.com/a/coast_land_rocks_01) | 20 m | scrub above the high-water line |
| `rock_face_03` | [Rock Face 03](https://polyhaven.com/a/rock_face_03) | 2.7 m | cliffs and steep ground |

## Saltreach source reference

`models/saltreach_src.glb` is a supplied coast scene preserved at its original scale and quality
for reference. It can be inspected with `?saltreach` in development only, retaining its authored
materials. The normal gallery uses the bpy-authored coast in `coast/`, built from the scanned rocks listed
above. Saltreach is excluded from the production build and the production page cannot load it
through the query flag. The original source file remains in the repository.

The September 2026 source audit reads the GLB JSON, accessor counts and KTX2 headers:

| Property | Source asset |
| --- | --- |
| File size | 197.65 MiB |
| Meshes / material groups | 12 / 8 |
| Unique vertices | 1,091,337 |
| Base triangles | 1,444,138 |
| Triangles after all GPU instances | 6,485,417 before culling |
| Textures | 23 KTX2 images: four 8192², twelve 4096², seven 2048² |
| Terrain footprint | Approximately 305 × 285 metres |
| Terrain / rock elevation | Approximately −16.3 to +11.9 metres; vegetation extends above this |
| Compression | Draco geometry, Basis textures, GPU instancing |
| LODs | None recorded |

Compressed textures can use substantially less GPU memory than their decoded size. An RGBA8
fallback with complete mip chains would be approximately 2.48 GiB for these images, before
geometry and renderer targets; this is an upper-bound estimate, not a measured allocation.

The model's ledges and vegetation are useful for evaluating authored coast silhouettes, but the
source budget is disproportionate to a portable shader example. A delivery version needs LODs
and a texture budget based on camera distance. Its wood, foliage, soil and rock materials must
retain their own shading; a blanket rock-waterline override previously modified every material.

The demo's existing shore map is baked from `coast/coast.glb`, **not this model**. Loading the
candidate does not validate wave shoaling, shore foam or underwater depth against its coastline.
Before making it a gallery scene, derive bathymetry from its terrain in world coordinates, align
sea level, and validate shallow-water shots against the resulting map. Keep the original source
available separately from a smaller delivery asset.

## Authored delivery (`coast/`)

The normal gallery now loads the bpy-authored `coast.glb` and matching baked bathymetry.
The editable source and regeneration/export instructions are in [`art/README.md`](../../art/README.md).
Trimmed scan bases meet buried terrain collars, with a vertex-painted bedrock mask around their
footprints. Terrain PBR coordinates vary smoothly and blend scales to reduce obvious repetition.
The source scan images are reused; there are no higher-resolution texture additions.
Actual geometry and file budgets are recorded in `coast/budget.json`.
