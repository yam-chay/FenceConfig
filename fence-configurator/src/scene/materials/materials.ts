// Brushed-aluminum starting point for the post/board material — not
// measured, just plausible. Needs scene.environment (see RoomEnvironment
// setup in Scene.tsx) to actually read as metal; metalness alone against a
// flat background renders dull/grey.
export const ALUMINUM_ROUGHNESS = 0.35;
export const ALUMINUM_METALNESS = 0.75;
// Flat grass ground — sits just below the grid (see groundMesh.position.y
// in Scene.tsx) so the grid lines stay visible on top without z-fighting.
// Reacts to the day/night ambient/sun/moon lights automatically since it's
// a lit MeshStandardMaterial, not a flat/unlit color.
export const GRASS_COLOR_HEX = '#356323';
/** GridHelper's own material needs transparent:true before this has any effect (see Scene.tsx). 1 = fully opaque (current look), lower = grid fades into the grass more. */
export const GRID_OPACITY = 0.4;
