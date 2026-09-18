import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';import { layoutShape, fieldCountForLeg, type Shape } from '../geometry/shape';
import { computeBoardStack } from '../geometry/field';
import { buildPostSpec, activeGrooveFaces } from '../geometry/post';
import {
  POST_THICKNESS_CM,
  BOARD_THICKNESS_CM,
  ROSETTE_OFFSET_CM,
  POST_ACCESSORY_WIDTH_MULTIPLIER,
  POST_CAP_HEIGHT_CM,
  WALL_END_OVERHANG_CM,
  CAP_COLOR_HEX,
} from '../geometry/constants';
import type { Selection, ColorScheme, ProfileScheme } from './types';
import { resolveBoardColorHex, resolveBoardStepCandidates } from './resolvers';
import { VIEW_DIRECTION, CAMERA_FORWARD_AZIMUTH_RAD } from './constants';
import { drawSkyGradient, skyDirectionForHour, sampleDayNight } from './environment/dayNightCycle';
import {
  CLOUD_COUNT,
  CLOUD_ORBIT_RADIUS_M,
  CLOUD_RADIUS_JITTER_M,
  CLOUD_BASE_ELEVATION_M,
  CLOUD_ELEVATION_JITTER_M,
  CLOUD_AZIMUTH_SPAN_DEG,
  CLOUD_DRIFT_DEG_PER_SEC,
  CLOUD_SHADOW_Y_OFFSET_M,
  CLOUD_SCALE_MIN,
  CLOUD_SCALE_MAX,
  cloudPositionForAzimuth,
  drawCloudTexture,
} from './environment/clouds';
import { buildPostGeometry } from './geometry/postGeometry';
import {
  DEFAULT_POLAR,
  DEFAULT_AZIMUTH,
  AZIMUTH_RANGE,
  POLAR_RANGE,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  FLY_DURATION_MS,
  CLICK_MOVE_THRESHOLD_PX,
  FOCUS_ELEMENT_PADDING,
  FOCUS_EDIT_PADDING,
  FULL_SHAPE_PADDING,
  easeInOutQuad,
} from './camera/cameraUtils';
import { diffFocusLegs } from './camera/cameraFocus';
import { ALUMINUM_ROUGHNESS, ALUMINUM_METALNESS, GRASS_COLOR_HEX, GRID_OPACITY } from './materials/materials';
import { SHADOW_MAP_SIZE, SHADOW_FRUSTUM_MARGIN_M } from './environment/lighting';

export type { Selection, ColorScheme, ProfileScheme, BoardColorRule, BoardProfileRule, SpacerRule } from './types';
export { resolveBoardColorHex, resolveBoardProfile, resolveSpacerMultiplier, resolveBoardStepCandidates } from './resolvers';
export { DAY_NIGHT_KEYFRAMES } from './environment/dayNightCycle';

interface SceneProps {
  shape: Shape;
  colorScheme: ColorScheme;
  profileScheme: ProfileScheme;
  /** Controlled — Scene renders a highlight based on this, doesn't just track its own click state. */
  selection: Selection | null;
  onSelect?: (selection: Selection | null) => void;
  onStats?: (stats: {
    fps: number;
    drawCalls: number;
    triangles: number;
    boardCount: number;
    postCount: number;
    doublePostCount: number;
    fieldCount: number;
    /** Board count per leg (keyed by legIndex) — the REAL count from the
     * actual per-step resolved stack (profile rules, spacer fallback
     * search included), not an approximation from the leg's default board
     * type alone. Drives the "(X שלבים)" readout in HeightSnapSlider. */
    boardCountByLeg: Record<number, number>;
    /** Board count per FIELD (keyed by `${legIndex}:${fieldIndex}`) — same
     * real per-step count as boardCountByLeg, but not summed across a
     * leg's fields, since sibling fields can differ (field-scoped rules).
     * Drives the "שלב X מתוך Y" readout in the board-edit sheet header. */
    boardCountByField: Record<string, number>;
  }) => void;
  /** When the caller sets .current = true before a shape change, that ONE
   * change skips the camera reframe it would otherwise trigger (consumed
   * and reset back to false here) — for edits that legitimately change a
   * leg's numbers but shouldn't fly the camera around, like a fine-precision
   * nudge in the general panel. */
  skipNextFocusRef?: { current: boolean };
  /** Set by the panel when a leg's accordion header is clicked OPEN — flies
   * the camera to frame that whole leg. `nonce` makes every click a fresh
   * request even when re-opening the same leg, since the object would
   * otherwise look unchanged. Null = no pending leg-focus request. */
  legCameraFocus?: { legIndex: number; nonce: number } | null;
  /** Hour of day, 0–24 (fractional allowed) — drives sun/moon position,
   * sky color, and ambient/sun/moon light intensity. See
   * DAY_NIGHT_KEYFRAMES below. */
  timeOfDayHours: number;
}

interface FrameTarget {
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
}

interface CloudSprite {
  bright: THREE.Sprite;
  shadow: THREE.Sprite;
  baseAzimuth: number;
  elevationM: number;
  radiusM: number;
  driftDegPerSec: number;
}

const isMobileViewport = () => window.matchMedia('(max-width: 700px)').matches;

export default function Scene({
  shape,
  colorScheme,
  profileScheme,
  selection,
  onSelect,
  onStats,
  skipNextFocusRef,
  legCameraFocus,
  timeOfDayHours,
}: SceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
 const fenceGroupRef = useRef<THREE.Group | null>(null);
  // Day/night cycle refs — created once in the setup effect below, retuned
  // by the separate timeOfDayHours effect without rerunning scene setup.
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null); // now the MERGED sun+moon light
  const sunMeshRef = useRef<THREE.Mesh | null>(null);
  const envIntensityRef = useRef(1);
  const moonMeshRef = useRef<THREE.Mesh | null>(null);
  // Refs for the palette additions below: grass material (retuned per
  // hour, same pattern as the lights), the sky gradient's own canvas +
  // texture (redrawn in place each hour rather than recreated), and the
  // two glow halo sprites behind the sun/moon discs.
  const groundMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const skyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const skyTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const sunGlowRef = useRef<THREE.Sprite | null>(null);
   const moonGlowRef = useRef<THREE.Sprite | null>(null);
  // Shadow-only proxy group + shared material — see the post-loop comment
  // in the shape-rebuild effect for why these exist.
  const cloudSpritesRef = useRef<CloudSprite[]>([]);
  const onStatsRef = useRef(onStats);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const geometryStatsRef = useRef({
    boardCount: 0,
    postCount: 0,
    doublePostCount: 0,
    fieldCount: 0,
    boardCountByLeg: {} as Record<number, number>,
    boardCountByField: {} as Record<string, number>,
  });

  const shapeBoundsRef = useRef<FrameTarget>({ centerX: 4, centerY: 0.8, centerZ: 0, radius: 4 });
  const legBoundsRef = useRef<Map<number, { minX: number; maxX: number; minZ: number; maxZ: number; topM: number }>>(
    new Map(),
  );
  const prevShapeRef = useRef<Shape | null>(null);
  const prevSelectionRef = useRef<Selection | null>(null);
  const lastFrameTargetRef = useRef<FrameTarget | null>(null);
  const lastPaddingRef = useRef(FULL_SHAPE_PADDING);
  const flyRef = useRef<null | {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    startTime: number;
    toDistance: number;
  }>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const deselectFlyTimeoutRef = useRef<number | null>(null);

  const PANEL_OPEN_DISTANCE_FACTOR: number = 1;
  const PANEL_CLOSE_DISTANCE_FACTOR: number = 1;

  const PANEL_OPEN_ANGLE_OFFSET: number = 0;
  const PANEL_CLOSE_ANGLE_OFFSET: number = 0;
  const lastAspectRef = useRef<number | null>(null);
  function distanceForTarget(target: FrameTarget, padding: number): number {
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!camera || !container) return target.radius * 3;
    const vFov = (camera.fov * Math.PI) / 180;
    const aspect = container.clientWidth / container.clientHeight;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const distForV = target.radius / Math.sin(vFov / 2);
    const distForH = target.radius / Math.sin(hFov / 2);
    return Math.max(distForV, distForH) * padding;
  }

  function applyConstraints(distance: number) {
    const controls = controlsRef.current;
    if (!controls) return;
    const fullDistance = distanceForTarget(shapeBoundsRef.current, FULL_SHAPE_PADDING);
    controls.minDistance = Math.min(distance * ZOOM_IN_FACTOR, 1.2);
    controls.maxDistance = Math.max(distance * ZOOM_OUT_FACTOR, fullDistance * 0.95);
    controls.minAzimuthAngle = DEFAULT_AZIMUTH - AZIMUTH_RANGE;
    controls.maxAzimuthAngle = DEFAULT_AZIMUTH + AZIMUTH_RANGE;
    controls.minPolarAngle = DEFAULT_POLAR - POLAR_RANGE;
    controls.maxPolarAngle = DEFAULT_POLAR + POLAR_RANGE;
  }

  /**
   * Every camera move — instant or animated — goes through this one
   * function now. There used to be a separate snapTo() that set
   * camera.position/controls.target directly; it quietly re-implemented
   * (and kept drifting out of sync with) flyTo's own direction/constraint
   * logic — preserveAngle existed on one but not the other for a while,
   * which is exactly what caused the angle-reset bugs. `instant: true`
   * still animates, technically — it's the same lerp, just given a
   * startTime already FLY_DURATION_MS in the past, so it resolves to its
   * destination on the very next frame instead of over FLY_DURATION_MS.
   */
  function flyTo(
    target: FrameTarget,
    padding: number,
    opts?: {
      relativeToCurrent?: boolean;
      preserveAngle?: boolean;
      instant?: boolean;
      preserveDistance?: boolean;
      zoomDistance?: number;
    },
  ) {

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const hadDamping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = hadDamping;

    let distance = opts?.zoomDistance ?? distanceForTarget(target, padding);

    if (opts?.preserveDistance) {
      distance = camera.position.distanceTo(controls.target);
    } else if (opts?.relativeToCurrent && lastFrameTargetRef.current) {
      const currentDistance = camera.position.distanceTo(controls.target);
      const oldNaturalDistance = distanceForTarget(
        lastFrameTargetRef.current,
        lastPaddingRef.current,
      );
      const ratio = THREE.MathUtils.clamp(
        currentDistance / oldNaturalDistance,
        0.25,
        4,
      );
      distance = distance * ratio;
    }

    let direction = VIEW_DIRECTION;
    if (opts?.preserveAngle) {
      const currentOffset = camera.position.clone().sub(controls.target);
      if (currentOffset.lengthSq() > 1e-6) {
        direction = currentOffset.normalize();
      }
    }

    const toPos = new THREE.Vector3(
      target.centerX + direction.x * distance,
      target.centerY + direction.y * distance,
      target.centerZ + direction.z * distance,
    );
    const toTarget = new THREE.Vector3(target.centerX, target.centerY, target.centerZ);
    controls.enabled = false;
    flyRef.current = {
      fromPos: opts?.instant ? toPos.clone() : camera.position.clone(),
      toPos,
      fromTarget: opts?.instant ? toTarget.clone() : controls.target.clone(),
      toTarget,
      startTime: opts?.instant ? performance.now() - FLY_DURATION_MS : performance.now(),
      toDistance: distance,
    };
    lastFrameTargetRef.current = target;
    lastPaddingRef.current = padding;
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

  const scene = new THREE.Scene();
    // Sky gradient: a small canvas redrawn in place (drawSkyGradient)
    // whenever the hour changes, rather than a flat background color.
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4;
    skyCanvas.height = 256;
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    skyCanvasRef.current = skyCanvas;
    skyTextureRef.current = skyTexture;
    scene.background = skyTexture;
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 500);
    cameraRef.current = camera;

     const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Procedural studio-style environment map — gives PBR materials (the
    // aluminum post/board metalness below) something to actually reflect.
    // RoomEnvironment is a small built-in procedural room three.js ships
    // for exactly this — no external image asset needed. Swap for a real
    // equirectangular photo later (RGBELoader/TextureLoader +
    // EquirectangularReflectionMapping) once there's an actual site
    // reference — that's the separate 360-capture feature (TODO M/N/O),
    // not this.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.5;
    // Stays TRUE — needed for OrbitControls' native two-finger pinch-zoom
    // on touch. Desktop mouse-wheel zoom is still fully handled by our own
    // handleWheelZoom below, not this: that handler runs in the capture
    // phase and calls stopImmediatePropagation(), so OrbitControls never
    // even sees wheel events regardless of this flag. Turning enableZoom
    // off entirely (as before) was redundant for wheel and had the side
    // effect of also disabling pinch, since OrbitControls gates BOTH
    // input methods behind this one flag internally.
    controls.enableZoom = true;
    controlsRef.current = controls;
    // Fixed zoom distance per wheel step.
    const ZOOM_STEP_M = 1.25;

    const handleWheelZoom = (event: WheelEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const currentDistance = camera.position.distanceTo(controls.target);

      const delta =
        event.deltaY > 0
          ? ZOOM_STEP_M
          : -ZOOM_STEP_M;

      const minDistance = controls.minDistance || 0.1;
      const maxDistance = controls.maxDistance || Infinity;

      const newDistance = THREE.MathUtils.clamp(
        currentDistance + delta,
        minDistance,
        maxDistance,
      );

      const currentTarget = controls.target.clone();

      flyTo(
        {
          centerX: currentTarget.x,
          centerY: currentTarget.y,
          centerZ: currentTarget.z,
          radius: 1,
        },
        1,
        {
          preserveAngle: true,
          zoomDistance: newDistance,
        },
      );
    };

    renderer.domElement.addEventListener(
      'wheel',
      handleWheelZoom,
      {
        passive: false,
        capture: true,
      },
    );

   flyTo(shapeBoundsRef.current, FULL_SHAPE_PADDING, { instant: true });

    // Day/night cycle: ambient/sun/moon are stored in refs (not local
    // consts) so the separate timeOfDayHours effect below can retune them
    // without rerunning this whole one-time setup. moon starts at
    // intensity 0 — the timeOfDayHours effect sets its real value on the
    // very next commit, before any frame renders with it wrong.
       // ONE directional light for both sun and moon — its color/position/
    // intensity morph continuously between "sunny" and "moonlit" in the
    // day/night effect below, rather than two separate light objects.
    // sunMesh/moonMesh (below) stay separate — they're unlit visual discs
    // marking where the light appears to come from, not light sources
    // themselves.
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const sky = new THREE.DirectionalLight(0xffffff, 0.8);
    sky.castShadow = true;
    sky.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    // A small bias, negative, is the standard fix for "shadow acne" (self-
    // shadowing artifacts) on flat surfaces — the frustum itself gets
    // sized to the fence's actual bounds in the shape-rebuild effect below
    // (see updateShadowFrustum), not here; these are just safe fallback
    // defaults before the first shape ever builds.
    // Reduced from -0.0015 — that magnitude was pulling shadows visibly
    // away from the base of tall/vertical surfaces (the wall, posts),
    // making them look like they don't touch the ground (peter-panning).
    // If shadow acne (speckled self-shadow noise on flat surfaces)
    // reappears at this lower magnitude, nudge back up gradually rather
    // than jumping straight to -0.0015 again.
    sky.shadow.bias = -0.0005;
    // PCFSoftShadowMap's own blur radius (in shadow-map texels, not
    // world units) — default (~1) was already soft; the fine board-gap
    // detail needed something closer to a hard edge. Lower = sharper.
    sky.shadow.radius = 1;
    sky.shadow.radius = 1;
    sky.shadow.camera.near = 0.5;
    sky.shadow.camera.far = 80;
    sky.shadow.camera.left = -10;
    sky.shadow.camera.right = 10;
    sky.shadow.camera.top = 10;
    sky.shadow.camera.bottom = -10;
    // DirectionalLight needs an explicit target object in the scene graph
    // for its shadow camera to aim correctly — otherwise it defaults to
    // aiming at the world origin (0,0,0), which is wrong once the fence's
    // own center isn't there. Retargeted per-shape in the rebuild effect.
    scene.add(sky.target);
    ambientLightRef.current = ambient;
    sunLightRef.current = sky; // reused ref name — this IS now the merged sky light
    scene.add(ambient, sky);
    // Small unlit discs (MeshBasicMaterial — unaffected by scene
    // lighting, since these represent the light SOURCES, not lit
    // objects) marking the sun/moon's position in the sky. Always full
    // moon per skyDirectionForHour's own comment — no lunar-phase model.
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3d6 }),
    );
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xe4e9f5 }),
    );
   sunMeshRef.current = sunMesh;
    moonMeshRef.current = moonMesh;
    scene.add(sunMesh, moonMesh);

    // Soft glow halos behind the sun/moon discs — one shared radial-
    // gradient sprite texture (white center fading to transparent),
    // reused via two separate Sprite instances tinted per hour
    // (glowColor). Additive blending + no depth write so the halo never
    // occludes anything or fights depth with the disc it sits behind.
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = 128;
    haloCanvas.height = 128;
    const haloCtx = haloCanvas.getContext('2d')!;
    const haloGradient = haloCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    haloGradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    haloGradient.addColorStop(1, 'rgba(255,255,255,0)');
    haloCtx.fillStyle = haloGradient;
    haloCtx.fillRect(0, 0, 128, 128);
    const haloTexture = new THREE.CanvasTexture(haloCanvas);

    const sunGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: haloTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sunGlow.scale.set(9, 9, 1);
    const moonGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: haloTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    moonGlow.scale.set(7, 7, 1);
    sunGlowRef.current = sunGlow;
    moonGlowRef.current = moonGlow;
    scene.add(sunGlow, moonGlow);

    // Cloud sprites — CLOUD_COUNT puffs, each a bright top layer + a
    // larger, dimmer, downward-offset shadow layer sharing one blotchy
    // alpha texture (drawCloudTexture), tinted per-hour from the
    // palette's own Cloud Bright/Cloud Shadow tokens (see the day/night
    // effect below). Positions drift continuously via elapsed real time
    // in the render loop (cloudAnimStartMs, in animate() below) —
    // independent of timeOfDayHours, which only controls their COLOR.
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = 128;
    cloudCanvas.height = 96;
    drawCloudTexture(cloudCanvas);
    const cloudTexture = new THREE.CanvasTexture(cloudCanvas);

    // Skipped entirely on mobile — cloud sprites weren't rendering
    // correctly there (checked once at setup, same pattern as the rest
    // of this one-time effect; doesn't react to a later resize/orientation
    // change, consistent with how isMobileViewport() is used elsewhere).
    const cloudSprites: CloudSprite[] = [];
    if (!isMobileViewport()) {
    for (let i = 0; i < CLOUD_COUNT; i++) {
      // Fully random within the whole span, not an even step-per-cloud
      // with a small jitter — the old approach kept every cloud locked
      // near its own narrow slot, which read as one tight cluster rather
      // than a genuinely scattered sky.
      const baseAzimuth = CAMERA_FORWARD_AZIMUTH_RAD + THREE.MathUtils.degToRad((Math.random() - 0.5) * CLOUD_AZIMUTH_SPAN_DEG);
      const elevationM = CLOUD_BASE_ELEVATION_M + (Math.random() - 0.5) * CLOUD_ELEVATION_JITTER_M;
      const radiusM = CLOUD_ORBIT_RADIUS_M + (Math.random() - 0.5) * CLOUD_RADIUS_JITTER_M;
      const driftDegPerSec = CLOUD_DRIFT_DEG_PER_SEC * (0.7 + Math.random() * 0.6);
      // Nearer clouds (smaller radius) read bigger, farther ones smaller —
      // reinforces the depth variation from radiusM instead of scale
      // being purely random and disconnected from distance.
      const radiusT = (radiusM - (CLOUD_ORBIT_RADIUS_M - CLOUD_RADIUS_JITTER_M / 2)) / CLOUD_RADIUS_JITTER_M;
      const scale = THREE.MathUtils.lerp(CLOUD_SCALE_MAX, CLOUD_SCALE_MIN, THREE.MathUtils.clamp(radiusT, 0, 1));

      const bright = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, depthWrite: false }),
      );
      bright.scale.set(scale, scale * 0.6, 1);
      const shadow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, depthWrite: false, opacity: 0.5 }),
      );
      shadow.scale.set(scale * 1.15, scale * 0.7, 1);

      scene.add(bright, shadow);
      cloudSprites.push({ bright, shadow, baseAzimuth, elevationM, radiusM, driftDegPerSec });
    }
    }
    cloudSpritesRef.current = cloudSprites;

    const ground = new THREE.GridHelper(200, 200, 0xc9d2d8, 0xdfe5e9);
    // opacity has no visible effect until transparent:true is set — off by
    // default on GridHelper's material.
    const gridMat = ground.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = GRID_OPACITY;
    // polygonOffset pushes the grid slightly FORWARD in the depth buffer
    // (not in world space) so it wins z-fighting against the grass plane
    // sitting at the exact same y — this replaces the old approach of
    // physically offsetting the grass to y=-0.01, which created a real,
    // visible gap between the grass and the fence/wall base sitting at
    // y=0. Negative factor/units = closer to camera.
    gridMat.polygonOffset = true;
    gridMat.polygonOffsetFactor = -1;
    gridMat.polygonOffsetUnits = -1;
    scene.add(ground);
    // Grass ground plane, same footprint as the grid above it. Offset
    // slightly below y=0 so the grid's own lines render on top instead of
    // fighting with the grass surface for the same depth. PlaneGeometry is
    // built facing +Z by default, hence the -90° X rotation to lay it flat.
    const groundMeshGeo = new THREE.PlaneGeometry(200, 200);
    const groundMeshMat = new THREE.MeshStandardMaterial({
      color: GRASS_COLOR_HEX,
      roughness: 0.95,
      metalness: 0,
    });
    const groundMesh = new THREE.Mesh(groundMeshGeo, groundMeshMat);
    groundMesh.rotation.x = -Math.PI / 2;
    // Sits exactly at y=0 now (no more -0.01 offset) — flush with the
    // fence/wall base. The grid's own polygonOffset above is what keeps
    // it visible on top instead of z-fighting, so this mesh no longer
    // needs to physically sit below true ground level.
    groundMesh.receiveShadow = true;
    groundMatRef.current = groundMeshMat;
    scene.add(groundMesh);    const fenceGroup = new THREE.Group();
    fenceGroupRef.current = fenceGroup;
    scene.add(fenceGroup);

    const raycaster = new THREE.Raycaster();

    function boundsForSteps(
      legIndex: number,
      fieldIndex: number,
      stepIndices: number[],
    ): { target: FrameTarget; heights: Record<number, number> } | null {
      const matches = fenceGroup.children.filter(
        (c) =>
          c.userData.kind === 'board' &&
          c.userData.legIndex === legIndex &&
          c.userData.fieldIndex === fieldIndex &&
          stepIndices.includes(c.userData.stepIndex),
      ) as THREE.Mesh[];
      if (matches.length === 0) return null;
      let minY = Infinity;
      let maxY = -Infinity;
      let x = 0;
      let z = 0;
      const heights: Record<number, number> = {};
      matches.forEach((m) => {
        m.geometry.computeBoundingSphere();
        const r = m.geometry.boundingSphere ? m.geometry.boundingSphere.radius : 0.2;
        minY = Math.min(minY, m.position.y - r);
        maxY = Math.max(maxY, m.position.y + r);
        x = m.position.x;
        z = m.position.z;
        heights[m.userData.stepIndex as number] = m.userData.heightCm as number;
      });
      return {
        target: { centerX: x, centerY: (minY + maxY) / 2, centerZ: z, radius: Math.max((maxY - minY) / 2, 0.25) },
        heights,
      };
    }

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownRef.current = { x: e.clientX, y: e.clientY };
    };
    const handlePointerUp = (e: PointerEvent) => {
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved > CLICK_MOVE_THRESHOLD_PX) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(fenceGroup.children, false);
      if (hits.length === 0) {
        onSelectRef.current?.(null);
        return;
      }

      const mesh = hits[0].object as THREE.Mesh;
      const kind = mesh.userData.kind as 'post' | 'board' | undefined;

      if (kind === 'post') {
        onSelectRef.current?.({ kind: 'post' });

        if (!isMobileViewport()) {
          mesh.geometry.computeBoundingSphere();
          const sphere = mesh.geometry.boundingSphere;
          const radius = Math.max(sphere ? sphere.radius : 0.3, 0.25);
          flyTo(
            { centerX: mesh.position.x, centerY: mesh.position.y, centerZ: mesh.position.z, radius },
            FOCUS_ELEMENT_PADDING,
            { preserveAngle: true },
          );
        }

        return;
      }
      if (kind !== 'board') {
        onSelectRef.current?.(null);
        return;
      }

      const legIndex = mesh.userData.legIndex as number;
      const fieldIndex = mesh.userData.fieldIndex as number;
      const stepIndex = mesh.userData.stepIndex as number;
      const heightCm = mesh.userData.heightCm as number;

      const prevSel = selectionRef.current;
      const sameField = prevSel?.kind === 'board' && prevSel.legIndex === legIndex && prevSel.fieldIndex === fieldIndex;
      // pointerType is what actually generated THIS click ('mouse' | 'touch' | 'pen') —
      // unlike matchMedia('pointer: coarse'), which asks what the device is CAPABLE of
      // and can misreport on hybrid touchscreen laptops even for a real mouse click.
      const isTouchEvent = e.pointerType === 'touch' || e.pointerType === 'pen';
      const ctrlKey = e.ctrlKey || e.metaKey;
      // No modifier keys exist on touch, so a second tap within the same
      // field IS the range gesture there — shift does the same on desktop.
      const rangeGesture = sameField && (e.shiftKey || (isTouchEvent && !ctrlKey));

      let stepIndices: number[];
      if (rangeGesture) {
        const lo = Math.min((prevSel as Extract<Selection, { kind: 'board' }>).stepIndex, stepIndex);
        const hi = Math.max((prevSel as Extract<Selection, { kind: 'board' }>).stepIndex, stepIndex);
        stepIndices = [];
        for (let i = lo; i <= hi; i++) stepIndices.push(i);
      } else if (sameField && ctrlKey) {
        const current = new Set((prevSel as Extract<Selection, { kind: 'board' }>).stepIndices);
        if (current.has(stepIndex)) current.delete(stepIndex);
        else current.add(stepIndex);
        if (current.size === 0) {
          onSelectRef.current?.(null);
          return;
        }
        stepIndices = Array.from(current).sort((a, b) => a - b);
      } else {
        stepIndices = [stepIndex];
      }

      const isExtending = rangeGesture || (sameField && ctrlKey);

      const result = stepIndices.length > 1 ? boundsForSteps(legIndex, fieldIndex, stepIndices) : null;
      if (result) {
        onSelectRef.current?.({
          kind: 'board',
          legIndex,
          fieldIndex,
          heightCm,
          stepIndex,
          stepIndices,
          stepHeights: result.heights,
        });

        if (!isExtending) {
          flyTo(result.target, FOCUS_ELEMENT_PADDING, { preserveAngle: true });
        }
      }
      else {
        onSelectRef.current?.({
          kind: 'board',
          legIndex,
          fieldIndex,
          heightCm,
          stepIndex,
          stepIndices,
          stepHeights: { [stepIndex]: heightCm },
        });
        if (!isExtending) {
          mesh.geometry.computeBoundingSphere();
          const sphere = mesh.geometry.boundingSphere;
          const radius = Math.max(sphere ? sphere.radius : 0.3, 0.25);
          flyTo(
            { centerX: mesh.position.x, centerY: mesh.position.y, centerZ: mesh.position.z, radius },
            FOCUS_ELEMENT_PADDING,
            { preserveAngle: true },
          );
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    let frameCount = 0;
    let lastFpsSample = performance.now();
    let rafId: number;
    const cloudAnimStartMs = performance.now();

    const animate = () => {
      rafId = requestAnimationFrame(animate);

      const fly = flyRef.current;
      if (fly) {
        const t = Math.min(1, (performance.now() - fly.startTime) / FLY_DURATION_MS);
        const eased = easeInOutQuad(t);
        camera.position.lerpVectors(fly.fromPos, fly.toPos, eased);
        const curTarget = new THREE.Vector3().lerpVectors(fly.fromTarget, fly.toTarget, eased);
        controls.target.copy(curTarget);
        camera.lookAt(curTarget);

        if (t >= 1) {
          applyConstraints(fly.toDistance);
          controls.enabled = true;
          flyRef.current = null;
          controls.update();
        }
      } else {
        controls.update();
      }

      const cloudElapsedSec = (performance.now() - cloudAnimStartMs) / 1000;
      for (const cloud of cloudSprites) {
        const azimuth = cloud.baseAzimuth + THREE.MathUtils.degToRad(cloud.driftDegPerSec * cloudElapsedSec);
        const pos = cloudPositionForAzimuth(azimuth, cloud.elevationM, cloud.radiusM);
        cloud.bright.position.copy(pos);
        cloud.shadow.position.set(pos.x, pos.y - CLOUD_SHADOW_Y_OFFSET_M, pos.z);
      }
      renderer.render(scene, camera);
      frameCount++;
      const now = performance.now();
      if (now - lastFpsSample >= 500) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsSample));
        frameCount = 0;
        lastFpsSample = now;
        onStatsRef.current?.({
          fps,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          ...geometryStatsRef.current,
        });
      }
    };
    animate();

    let resizeRaf: number | null = null;

    const applyResize = () => {
      resizeRaf = null;

      if (!container || !cameraRef.current) return;

      const camera = cameraRef.current;

      const w = container.clientWidth;
      const h = container.clientHeight;

      if (w <= 0 || h <= 0) return;

      const newAspect = w / h;
      const oldAspect = lastAspectRef.current;

      /*
       * When the workspace changes height, PerspectiveCamera changes
       * its horizontal FOV. That can make the scene appear to "stretch"
       * even though camera.position and controls.target did not move.
       *
       * Compensate by scaling the camera distance inversely with aspect.
       *
       * newDistance = oldDistance * oldAspect / newAspect
       *
       * This keeps the horizontal framing visually stable while the
       * actual Three.js workspace still grows/shrinks normally.
       */
      if (
        oldAspect !== null &&
        Number.isFinite(oldAspect) &&
        Number.isFinite(newAspect) &&
        oldAspect > 0 &&
        newAspect > 0
      ) {
        const isOpening = newAspect > oldAspect;

        const distanceFactor = isOpening
          ? PANEL_OPEN_DISTANCE_FACTOR
          : PANEL_CLOSE_DISTANCE_FACTOR;

        const angleOffset = isOpening
          ? PANEL_OPEN_ANGLE_OFFSET
          : PANEL_CLOSE_ANGLE_OFFSET;

        const distanceRatio = (oldAspect / newAspect) * distanceFactor;

        const controls = controlsRef.current;
        const fly = flyRef.current;

        /*
         * Normal camera state:
         * preserve the current view by scaling the camera offset
         * around the current OrbitControls target.
         */
        if (controls && !fly) {
          const offset = camera.position.clone().sub(controls.target);

          offset.multiplyScalar(distanceRatio);

          if (angleOffset !== 0) {
            offset.applyAxisAngle(
              new THREE.Vector3(0, 1, 0),
              THREE.MathUtils.degToRad(angleOffset)
            );
          }

          camera.position.copy(
            controls.target.clone().add(offset)
          );
        }

        /*
         * If a focus animation is already running, compensate BOTH
         * ends of the animation. This prevents opening the bottom sheet
         * during a flyTo() from visually bending/stretching the path.
         */
        if (fly) {
          const fromOffset = fly.fromPos.clone().sub(fly.fromTarget);
          fly.fromPos.copy(
            fly.fromTarget.clone().add(fromOffset.multiplyScalar(distanceRatio))
          );

          const toOffset = fly.toPos.clone().sub(fly.toTarget);
          fly.toPos.copy(
            fly.toTarget.clone().add(toOffset.multiplyScalar(distanceRatio))
          );

          fly.toDistance *= distanceRatio;
        }
      }

      /*
       * Now apply the real new viewport size.
       * The canvas remains a genuine layout participant.
       */
      camera.aspect = newAspect;
      camera.updateProjectionMatrix();

      renderer.setSize(w, h);

      lastAspectRef.current = newAspect;

      renderer.render(scene, camera);
    };

    const handleResize = () => {
      // Coalesce a burst of ResizeObserver notifications into at most one
      // actual resize per animation frame, instead of running the full
      // resize/paint work synchronously for every single one of them.
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(applyResize);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('wheel', handleWheelZoom, true);
      controls.dispose();
      renderer.dispose();
      scene.environment?.dispose();
     sunMesh.geometry.dispose();
      (sunMesh.material as THREE.Material).dispose();
      moonMesh.geometry.dispose();
      (moonMesh.material as THREE.Material).dispose();
      groundMeshGeo.dispose();
      groundMeshMat.dispose();
      gridMat.dispose();
      skyTexture.dispose();
      haloTexture.dispose();
      sunGlow.material.dispose();
      moonGlow.material.dispose();
      cloudSprites.forEach((c) => {
        (c.bright.material as THREE.Material).dispose();
        (c.shadow.material as THREE.Material).dispose();
      });
      cloudTexture.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Day/night cycle — retunes ambient/sun/moon lights, the sky background
  // color, and the sun/moon marker meshes whenever the person moves the
  // time-of-day control. Pure lighting/background: never touches
  // fenceGroup and never triggers any camera movement.
  useEffect(() => {
    const scene = sceneRef.current;
     const ambient = ambientLightRef.current;
    const sky = sunLightRef.current; // merged sun+moon light — see setup effect
    const sunMesh = sunMeshRef.current;
    const moonMesh = moonMeshRef.current;
    const groundMat = groundMatRef.current;
    const skyCanvas = skyCanvasRef.current;
    const skyTexture = skyTextureRef.current;
    const sunGlow = sunGlowRef.current;
    const moonGlow = moonGlowRef.current;
    if (!scene || !ambient || !sky || !sunMesh || !moonMesh || !groundMat || !skyCanvas || !skyTexture || !sunGlow || !moonGlow) return;

    const sample = sampleDayNight(timeOfDayHours);

    drawSkyGradient(skyCanvas, skyTexture, sample.skyTop, sample.skyMid, sample.skyHorizon);
    ambient.color.copy(sample.ambientColor);
    ambient.intensity = sample.ambientIntensity;
    groundMat.color.copy(sample.groundTint);

   const sunDir = skyDirectionForHour(timeOfDayHours);
    const moonDir = skyDirectionForHour(timeOfDayHours + 12);
    // sample.sunIntensity/moonIntensity already have SUN_BRIGHTNESS_SCALE/
    // MOON_BRIGHTNESS_SCALE folded in by sampleDayNight — the previous
    // version of this block reapplied them here too, silently doubling
    // the scale whenever either constant was set to anything but 1.
    const sunIntensity = sample.sunIntensity;
    const moonIntensity = sample.moonIntensity;

    // Blend weight toward "moon" — only used for the light's POSITION now.
    // Its color no longer needs a separate blend, since sample.sunColor
    // (interpolated straight from each keyframe's own Core token) already
    // carries the sun<->moon color transition on its own.
    const totalIntensity = sunIntensity + moonIntensity;
    const moonWeight = totalIntensity > 0.0001 ? moonIntensity / totalIntensity : 0;

    const mergedDir = sunDir.clone().lerp(moonDir, moonWeight);

    sky.position.copy(mergedDir);
    sky.color.copy(sample.sunColor);
    sky.intensity = totalIntensity;

    // Same near/far fix as the shape-rebuild effect's shadow-frustum
    // block, but keyed here too: the light's POSITION changes on every
    // hour change alone (mergedDir above), with no shape/color/selection
    // change to trigger that other effect — so near/far need refreshing
    // here as well, using the last-known fence bounds (shapeBoundsRef;
    // updated fresh by the shape-rebuild effect whenever it runs).
    const shadowHalfWidth = Math.max(shapeBoundsRef.current.radius, 1) + SHADOW_FRUSTUM_MARGIN_M;
    const lightDistance = sky.position.distanceTo(sky.target.position);
    sky.shadow.camera.near = Math.max(0.1, lightDistance - shadowHalfWidth * 2);
    sky.shadow.camera.far = lightDistance + shadowHalfWidth * 2;
    sky.shadow.camera.updateProjectionMatrix();

    sunMesh.position.copy(sunDir);
    (sunMesh.material as THREE.MeshBasicMaterial).color.copy(sample.sunColor);
    sunMesh.visible = sunIntensity > 0.01;
    moonMesh.position.copy(moonDir);
    (moonMesh.material as THREE.MeshBasicMaterial).color.copy(sample.sunColor);
    moonMesh.visible = moonIntensity > 0.01;

    // Glow halos: same position as their own disc, tinted by the current
    // keyframe's glow color, opacity following that body's own intensity
    // so the halo fades together with the disc instead of popping at the
    // 0.01 visibility threshold above.
    sunGlow.position.copy(sunDir);
    sunGlow.material.color.copy(sample.glowColor);
    sunGlow.material.opacity = Math.min(1, sunIntensity);
     moonGlow.position.copy(moonDir);
    moonGlow.material.color.copy(sample.glowColor);
    moonGlow.material.opacity = Math.min(1, moonIntensity * 1.4);

    // Cloud tint only — position/drift is handled continuously in the
    // render loop (cloudAnimStartMs in the setup effect), not here.
    for (const cloud of cloudSpritesRef.current) {
      (cloud.bright.material as THREE.SpriteMaterial).color.copy(sample.cloudBright);
      (cloud.shadow.material as THREE.SpriteMaterial).color.copy(sample.cloudShadow);
    }

    // Single global scalar — scales scene.environment's contribution to
    // EVERY material in the scene at once. Requires three.js r162+; if
    // your installed version predates that, this silently does nothing
    // (no error) and materials stay at full brightness at night.
    scene.environmentIntensity = sample.envIntensity;
  }, [timeOfDayHours]);

  // Rebuild the procedural geometry whenever the live shape/colors/selection
  // change. Only resets the in-progress fly/controls when SHAPE actually
  // changed — a color pick or a click-to-select must never cancel the
  // fly-to-focus animation that a click just started.
  useEffect(() => {
    const fenceGroup = fenceGroupRef.current;
    if (!fenceGroup) return;
    const isFirstBuildCheck = prevShapeRef.current === null;
    const shapeChangedCheck = !isFirstBuildCheck && prevShapeRef.current !== shape;
    if (isFirstBuildCheck || shapeChangedCheck) {
      flyRef.current = null;
      if (controlsRef.current) controlsRef.current.enabled = true;
    }

    while (fenceGroup.children.length) {
      const child = fenceGroup.children.pop()!;
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    const layout = layoutShape(shape);

   const postMat = new THREE.MeshStandardMaterial({
      color: colorScheme.postColorHex,
      roughness: ALUMINUM_ROUGHNESS,
      metalness: ALUMINUM_METALNESS,
      envMapIntensity: envIntensityRef.current,
    });    // Separate material JUST for the merged post-box geometry (the one
    // carrying the groove). vertexColors:true lives ONLY here — the
    // rosette/cap meshes below keep using the plain postMat, since their
    // geometries carry no 'color' attribute and a vertexColors material on
    // an attribute-less geometry renders solid black (WebGL's default for
    // a disabled vertex attribute is 0,0,0,1). That's what turned
    // everything black last time.
  const postBoxMat = new THREE.MeshStandardMaterial({
      color: colorScheme.postColorHex,
      vertexColors: true,
      roughness: ALUMINUM_ROUGHNESS,
      metalness: ALUMINUM_METALNESS,
      envMapIntensity: envIntensityRef.current,
    });
    function withHighlight(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
      const clone = mat.clone();
      // Kept subtle on purpose — this needs to read as "selected" without
      // hiding the actual color underneath it, since that color is exactly
      // what the person is trying to check by looking at this element.
      clone.emissive = new THREE.Color(0xd9d9d9);
      clone.emissiveIntensity = 0.07;
      return clone;
    }
    const postDisplayMat = selection?.kind === 'post' ? withHighlight(postMat) : postMat;
    const postBoxDisplayMat = selection?.kind === 'post' ? withHighlight(postBoxMat) : postBoxMat;
    // Board color resolution: belowSplit and aboveSplit are two INDEPENDENT
    // boundaries — picking one never touches the other, so skipped-over
    // boards in the middle correctly stay on baseBoardColorHex instead of
    // being swallowed by whichever split was set second.
    const boardMatCache = new Map<string, THREE.MeshStandardMaterial>();
  function boardMaterial(hex: string): THREE.MeshStandardMaterial {
      let mat = boardMatCache.get(hex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: hex,
          roughness: ALUMINUM_ROUGHNESS,
          metalness: ALUMINUM_METALNESS,
          envMapIntensity: envIntensityRef.current,
        });
        boardMatCache.set(hex, mat);
      }
      return mat;
    }
    function resolveHex(legIndex: number, fieldIndex: number, stepIndex: number): string {
      return resolveBoardColorHex(colorScheme, legIndex, fieldIndex, stepIndex);
    }

    const postThicknessM = POST_THICKNESS_CM / 100;
    const boardThicknessM = BOARD_THICKNESS_CM / 100;
    const accessoryWidthM = postThicknessM * POST_ACCESSORY_WIDTH_MULTIPLIER;
    // Placeholder color for the existing wall/base the fence sits on —
    // purely visual reference until the client gives real cladding options.
      const wallMat = new THREE.MeshStandardMaterial({ color: '#696662', envMapIntensity: envIntensityRef.current });    // A true end's wall overhang is Yam's own visual call
    // (WALL_END_OVERHANG_CM), and nothing else. The old reasoning here —
    // flooring it against the rosette's own overhang so the rosette's tip
    // never hangs past the wall's edge — was based on the rosette's
    // SYMMETRIC overhang (accessoryWidthM - postThicknessM) / 2, which is
    // the value at a MIDDLE post. At a true end (rosetteEnd 'start'/'end'),
    // the rosette is shifted so its free-side edge sits FLUSH with the
    // post's own outer face — see rosetteOffsetM below — so there is no
    // rosette overhang to protect against on this side at all. Changing
    // WALL_END_OVERHANG_CM now directly controls how far the wall reaches
    // past the end post, with nothing silently flooring it.
    const rosetteOverhangPastPostFaceM = (accessoryWidthM - postThicknessM) / 2;
    const wallEndOverhangM = WALL_END_OVERHANG_CM / 100;
    const rosetteHeightM = ROSETTE_OFFSET_CM / 100;
    const capHeightM = POST_CAP_HEIGHT_CM / 100;
    // Flat plastic cover — a thin box exactly matching the post's own
    // cross-section (zero overhang, same "sits flush" requirement the
    // pyramid/dome versions had), just capHeightM tall. Built once and
    // reused for every ordinary post.
    const capGeo = new THREE.BoxGeometry(postThicknessM, capHeightM, postThicknessM);
    // First step of a per-part material split: the cap is plastic, not
    // aluminum, so it gets its own fixed color/finish rather than
    // following colorScheme.postColorHex the way the post/rosette do
    // today. roughness/metalness are a rough "matte plastic" starting
    // point, not measured values.
    const capMat = new THREE.MeshStandardMaterial({
      color: CAP_COLOR_HEX,
      roughness: 0.65,
      metalness: 0.05,
      envMapIntensity: envIntensityRef.current,
    });    const capDisplayMat = selection?.kind === 'post' ? withHighlight(capMat) : capMat;

    let totalBoards = 0;
    let totalPosts = 0;
    let totalDoublePosts = 0;
    const boardCountByLeg: Record<number, number> = {};
    const boardCountByField: Record<string, number> = {};

    const legBounds = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number; topM: number }>();
    function includeInLeg(legIndex: number, x: number, z: number, topM: number) {
      const b = legBounds.get(legIndex);
      if (!b) {
        legBounds.set(legIndex, { minX: x, maxX: x, minZ: z, maxZ: z, topM });
        return;
      }
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
      b.topM = Math.max(b.topM, topM);
    }
    function includeInLegs(legIndices: number[], x: number, z: number, topM: number) {
      for (const legIndex of legIndices) includeInLeg(legIndex, x, z, topM);
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const maxTopHeightM = Math.max(0, ...shape.legs.map((leg) => leg.heightCm / 100));

    for (const post of layout.posts) {
      const baseM = post.baseHeightCm / 100;
      const heightM = Math.max(post.heightCm, 1) / 100;
      const activeFaces = post.isDoublePost
        ? activeGrooveFaces({
            postHeadingRad: post.heading,
            legIndices: post.legIndices,
            isDoublePost: true,
            outgoingHeadingRad: post.outgoingHeadingRad,
          })
        : activeGrooveFaces({
            postHeadingRad: post.heading,
            legIndices: post.legIndices,
            rosetteEnd: post.rosetteEnd,
          });
      const postSpec = buildPostSpec(Math.max(post.heightCm, 1), activeFaces);
      const geo = buildPostGeometry(postSpec);
      const mesh = new THREE.Mesh(geo, postBoxDisplayMat);
      mesh.position.set(post.position.x, baseM + heightM / 2, post.position.z);
      mesh.rotation.y = -post.heading;
      mesh.userData.kind = 'post';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      fenceGroup.add(mesh);
      totalPosts++;
      if (post.isDoublePost) totalDoublePosts++;

      // Rosette: covers the post's base bolting/wall holes, and is the
      // physical reason the first board starts ROSETTE_OFFSET_CM above the
      // post's own base rather than right at baseM.
      const rosetteGeo = new THREE.BoxGeometry(
        accessoryWidthM,
        rosetteHeightM,
        accessoryWidthM,
      );
      const rosetteMesh = new THREE.Mesh(rosetteGeo, postDisplayMat);

      /*
       * Endpoint rosette positioning:
       *
       * `post.heading` is the direction in which the fence boards leave the post.
       *
       * For an endpoint post, the rosette is shifted toward the opposite face
       * of the post so that the rosette's outer edge aligns with the corresponding
       * outer face of the post.
       *
       * Important:
       * - The post itself is NOT moved.
       * - The rosette dimensions are NOT changed.
       * - Middle posts and double posts remain centered.
       * - This is purely visual placement.
       */
      const rosetteOverhangM =
        (accessoryWidthM - postThicknessM) / 2;

      let rosetteOffsetM = 0;

      if (post.rosetteEnd === 'start') {
        // Opposite the direction in which the boards leave the post.
        rosetteOffsetM = rosetteOverhangM;
      } else if (post.rosetteEnd === 'end') {
        // Same direction as the fence heading, toward the opposite outer face.
        rosetteOffsetM = -rosetteOverhangM;
      }

      rosetteMesh.position.set(
        post.position.x + Math.cos(post.heading) * rosetteOffsetM,
        baseM + rosetteHeightM / 2,
        post.position.z + Math.sin(post.heading) * rosetteOffsetM,
      );

      rosetteMesh.rotation.y = -post.heading;
      rosetteMesh.userData.kind = 'rosette';
      fenceGroup.add(rosetteMesh);
      rosetteMesh.userData.kind = 'rosette';
      fenceGroup.add(rosetteMesh);

     // Cap: flat plastic cover sealing the post's grooves at the top so
      // the boards can't be pulled back out — exactly the post's own
      // width/depth (not doubled like the rosette), purely cosmetic, sits
      // ABOVE the closing height and never affects the board stack's own
      // math (confirmed: there's no reserved top margin at all). Own
      // capDisplayMat (plastic), not postDisplayMat (aluminum) — see
      // capMat above. BoxGeometry is centered on its own origin, so the
      // mesh sits capHeightM/2 ABOVE the post's top surface, not AT it —
      // otherwise half the cap would be buried inside the post.
      const capMesh = new THREE.Mesh(capGeo, capDisplayMat);
      capMesh.position.set(post.position.x, baseM + heightM + capHeightM / 2, post.position.z);
      capMesh.rotation.y = -post.heading;
      capMesh.userData.kind = 'cap';
      fenceGroup.add(capMesh);

      // The post sits at mergedBaseHeightCm = MIN of its two legs' base
      // heights, and the rosette sits ABOVE that (baseM to baseM +
      // ROSETTE_OFFSET_CM — see rosetteMesh above), never below it. So
      // this filler — which fills the post's own footprint from the
      // ground UP TO baseM — never touches the rosette at all (they meet
      // exactly at y=baseM, not overlapping). It's needed because both
      // adjoining fields' walls now stop flush at this post's own FACE
      // (see the field loop below), leaving the post's central strip
      // (postThicknessM wide) uncovered underneath.
      if (post.isDoublePost && post.legIndices.length === 2) {
        const legA = shape.legs[post.legIndices[0]];
        const legB = shape.legs[post.legIndices[1]];
        if (legA.baseHeightCm !== legB.baseHeightCm && baseM > 0) {
          const lowerLeg = legA.baseHeightCm < legB.baseHeightCm ? legA : legB;
          const fillerThicknessM = lowerLeg.wallWidthCm / 100;
          const fillerGeo = new THREE.BoxGeometry(postThicknessM, baseM, fillerThicknessM);
          const fillerMesh = new THREE.Mesh(fillerGeo, wallMat);
          fillerMesh.position.set(post.position.x, baseM / 2, post.position.z);
          fillerMesh.rotation.y = -post.heading;
          fillerMesh.userData.kind = 'wall';
          fenceGroup.add(fillerMesh);
        }
      }

      minX = Math.min(minX, post.position.x);
      maxX = Math.max(maxX, post.position.x);
      minZ = Math.min(minZ, post.position.z);
      maxZ = Math.max(maxZ, post.position.z);
      includeInLegs(post.legIndices, post.position.x, post.position.z, baseM + heightM);
    }

    for (const field of layout.fields) {
      const leg = shape.legs[field.legIndex];
      // Boards insert into the post's grooves, so they should span face-to-face
      // between the two bounding posts — field.lengthM is measured post-CENTER
      // to post-CENTER, so subtracting one full post thickness gives that.
      // (The old `* 0.96` heuristic wasn't tied to actual post thickness, so
      // the gap it left grew right along with field length.)
      const boardLengthM = Math.max(0.05, field.lengthM - postThicknessM);
      const boardStack = computeBoardStack(field.fillHeightCm, (stepIndex) =>
        resolveBoardStepCandidates(profileScheme, field.legIndex, field.index, stepIndex, leg.modelId, leg.sizeId),
      );
      boardCountByField[`${field.legIndex}:${field.index}`] = boardStack.boards.length;
      const baseM = field.baseHeightCm / 100;

      const startIsMiddle = field.legIndex > 0 && shape.junctions[field.legIndex - 1]?.type !== 'disconnect';
      const endIsMiddle = field.legIndex < shape.legs.length - 1 && shape.junctions[field.legIndex]?.type !== 'disconnect';
      const isFirstFieldOfLeg = field.index === 0;
      const isLastFieldOfLeg = field.index === fieldCountForLeg(leg.lengthM, startIsMiddle, endIsMiddle) - 1;

      if (field.baseHeightCm > 0) {
        const wallThicknessM = leg.wallWidthCm / 100;
        const halfFieldM = field.lengthM / 2;
        const halfFaceM = boardLengthM / 2;
        // Free true end: the rosette sits FLUSH there (zero overhang) —
        // see the comment above wallEndOverhangM's own declaration.
        const pastRosetteM = halfFaceM + postThicknessM + wallEndOverhangM;
        // LOW wall at a height-changing DOUBLE-POST junction is a
        // DIFFERENT case from the free end above: a double post gets no
        // rosetteEnd at all (see the rosette-positioning code below), so
        // rosetteOffsetM stays 0 and the rosette sits CENTERED/symmetric
        // on the post — it genuinely overhangs the post's face by
        // rosetteOverhangPastPostFaceM even on this "low" side. Floored
        // against that real overhang so the wall never ends shorter than
        // the rosette actually sitting above it here.
        const pastRosetteJunctionM =
          halfFaceM + postThicknessM + Math.max(wallEndOverhangM, rosetteOverhangPastPostFaceM);

        /*
  * Wall boundaries at a height-changing junction:
  *
  * The shared post belongs to the LOWER fence level. The two walls
  * must therefore meet at ONE shared physical boundary instead of
  * independently deciding whether they should reach `halfFaceM` or
  * `pastRosetteJunctionM`.
  *
  * `halfFaceM` = the post's face boundary.
  * `pastRosetteJunctionM` = the extra reach needed when the wall is low
  * enough to safely pass the post face and cover the (symmetric, at a
  * double post) rosette area.
  *
  * At a height-changing junction:
  * - the HIGHER wall stops/starts at the post face
  * - the LOWER wall gets the rosette-aware extension
  *
  * This is calculated from the junction's two legs, so the same
  * boundary rule is applied from both sides of the shared post.
  */

        const wallToPostFaceM = halfFaceM;
        const wallToRosetteEdgeM = pastRosetteM;
        const wallToRosetteEdgeJunctionM = pastRosetteJunctionM;

        // At a height-changing junction:
        // LOW wall reaches the rosette edge.
        // HIGH wall stops BEFORE the post, leaving the rosette/post exposed.
        const higherWallJunctionM = Math.max(
          0.01,
          wallToPostFaceM - rosetteOverhangPastPostFaceM,
        );

        let startDistM = halfFieldM;

        if (isFirstFieldOfLeg) {
          if (!startIsMiddle) {
            // Free outer end.
            startDistM = wallToRosetteEdgeM;
          } else {
            const prevLeg = shape.legs[field.legIndex - 1];

            if (prevLeg.baseHeightCm !== leg.baseHeightCm) {
              const currentIsLower =
                leg.baseHeightCm < prevLeg.baseHeightCm;

              startDistM = currentIsLower
                ? wallToRosetteEdgeJunctionM
                : higherWallJunctionM;
            }
          }
        }

        let endDistM = halfFieldM;

        if (isLastFieldOfLeg) {
          if (!endIsMiddle) {
            // Free outer end.
            endDistM = wallToRosetteEdgeM;
          } else {
            const nextLeg = shape.legs[field.legIndex + 1];

            if (nextLeg.baseHeightCm !== leg.baseHeightCm) {
              const currentIsLower =
                leg.baseHeightCm < nextLeg.baseHeightCm;

              endDistM = currentIsLower
                ? wallToRosetteEdgeJunctionM
                : higherWallJunctionM;
            }
          }
        }

        const wallLengthM = startDistM + endDistM;
        const wallCenterOffsetM = (endDistM - startDistM) / 2;
        const wallGeo = new THREE.BoxGeometry(wallLengthM, baseM, wallThicknessM);
         const wallMesh = new THREE.Mesh(wallGeo, wallMat);
        wallMesh.position.set(
          field.position.x + Math.cos(field.heading) * wallCenterOffsetM,
          baseM / 2,
          field.position.z + Math.sin(field.heading) * wallCenterOffsetM,
        );
       wallMesh.rotation.y = -field.heading;
        wallMesh.userData.kind = 'wall';
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        fenceGroup.add(wallMesh);
      }

      for (const board of boardStack.boards) {
        const boardAbsHeightCm = field.baseHeightCm + board.centerCm;
        const hex = resolveHex(field.legIndex, field.index, board.stepIndex);
        const isHighlighted =
          selection?.kind === 'board' &&
          selection.legIndex === field.legIndex &&
          selection.fieldIndex === field.index &&
          selection.stepIndices.includes(board.stepIndex);
        const mat = isHighlighted ? withHighlight(boardMaterial(hex)) : boardMaterial(hex);
        const boardHeightM = board.boardHeightCm / 100;
        const geo = new THREE.BoxGeometry(boardLengthM, boardHeightM, boardThicknessM);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(field.position.x, baseM + board.centerCm / 100, field.position.z);
        mesh.rotation.y = -field.heading;
        mesh.userData.kind = 'board';
        mesh.userData.heightCm = boardAbsHeightCm;
        mesh.userData.stepIndex = board.stepIndex;
        mesh.userData.legIndex = field.legIndex;
        mesh.userData.fieldIndex = field.index;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        fenceGroup.add(mesh);
        totalBoards++;
        boardCountByLeg[field.legIndex] = (boardCountByLeg[field.legIndex] ?? 0) + 1;
      }
      includeInLeg(field.legIndex, field.position.x, field.position.z, baseM + field.fillHeightCm / 100);
    }

    legBoundsRef.current = legBounds;

    geometryStatsRef.current = {
      boardCount: totalBoards,
      postCount: totalPosts,
      doublePostCount: totalDoublePosts,
      fieldCount: layout.fields.length,
      boardCountByLeg,
      boardCountByField,
    };

    if (!isFinite(minX)) {
      minX = maxX = minZ = maxZ = 0;
    }
    const fullBounds: FrameTarget = {
      centerX: (minX + maxX) / 2,
      centerY: maxTopHeightM * 0.4,
      centerZ: (minZ + maxZ) / 2,
      radius: Math.max(Math.sqrt((maxX - minX) ** 2 + (maxZ - minZ) ** 2 + maxTopHeightM ** 2) / 2, 1.5),
    };
 shapeBoundsRef.current = fullBounds;

    // Retarget the shadow camera to the fence's own current bounds
    // instead of a fixed global frustum — the fence's footprint varies
    // wildly (one short leg vs. many long ones), and a frustum sized for
    // the worst case would waste shadow-map resolution on short fences.
    const skyLight = sunLightRef.current;
    if (skyLight) {
      const m = SHADOW_FRUSTUM_MARGIN_M;
      const halfWidth = Math.max(fullBounds.radius, 1) + m;
      skyLight.target.position.set(fullBounds.centerX, fullBounds.centerY, fullBounds.centerZ);
      skyLight.shadow.camera.left = -halfWidth;
      skyLight.shadow.camera.right = halfWidth;
      skyLight.shadow.camera.top = halfWidth;
      skyLight.shadow.camera.bottom = -halfWidth;
      // near/far must bracket the ACTUAL light→target distance — the
      // fixed near=0.5/far=80 set once at creation time never accounted
      // for the light orbiting out to ~120 units at most hours (see
      // skyDirectionForHour), which put the fence geometry beyond the far
      // plane (or right on its unstable edge) most of the time. This is
      // the root cause diagnosed earlier for the shadow-acne / missing-
      // shadow symptom.
      const lightDistance = skyLight.position.distanceTo(skyLight.target.position);
      skyLight.shadow.camera.near = Math.max(0.1, lightDistance - halfWidth * 2);
      skyLight.shadow.camera.far = lightDistance + halfWidth * 2;
      skyLight.shadow.camera.updateProjectionMatrix();
    }
    const isFirstBuild = prevShapeRef.current === null;
    const previousShape = prevShapeRef.current;
    const focusDiff = isFirstBuild ? null : diffFocusLegs(previousShape!, shape);
    prevShapeRef.current = shape;

    let wallHeightOnlyEdit = false;
    let fenceHeightOnlyEdit = false;

    if (!isFirstBuild && previousShape) {
      const sameLegCount =
        previousShape.legs.length === shape.legs.length;

      const sameJunctions =
        previousShape.junctions.length === shape.junctions.length &&
        shape.junctions.every(
          (junction, i) =>
            junction.type === previousShape.junctions[i]?.type,
        );

      if (sameLegCount && sameJunctions) {
        let hasLengthChange = false;
        let hasBaseHeightChange = false;
        let hasHeightChange = false;

        for (let i = 0; i < shape.legs.length; i++) {
          const prevLeg = previousShape.legs[i];
          const nextLeg = shape.legs[i];

          hasLengthChange ||= prevLeg.lengthM !== nextLeg.lengthM;
          hasBaseHeightChange ||= prevLeg.baseHeightCm !== nextLeg.baseHeightCm;
          hasHeightChange ||= prevLeg.heightCm !== nextLeg.heightCm;
        }

        wallHeightOnlyEdit =
          !hasLengthChange &&
          hasBaseHeightChange;

        fenceHeightOnlyEdit =
          !hasLengthChange &&
          !hasBaseHeightChange &&
          hasHeightChange;
      }
    }


    const skipThisFocus = skipNextFocusRef?.current ?? false;
    if (skipNextFocusRef) skipNextFocusRef.current = false;

    if (isFirstBuild) {
      flyTo(fullBounds, FULL_SHAPE_PADDING, { instant: true });
      prevSelectionRef.current = selection;
      return;
    }

    const hadSelection = prevSelectionRef.current !== null;
    const hasSelection = selection !== null;
    prevSelectionRef.current = selection;

    /*
 * Height sliders should not cause a full camera refocus.
 *
 * Wall height:
 * Keep the camera completely untouched.
 */
    if (wallHeightOnlyEdit) {
      return;
    }

    if (focusDiff === null) {
      // Closing an edit sheet (selection -> null) with no shape change: step
      // back to a window around wherever you were just focused — NOT the
      // whole shape. Framing the entire shape here was exactly what made
      // this worse the longer the fence got (and on a background click by
      // mistake, it read as being launched away with no sense of where you'd
      // even been). Reusing the last focused target with the "recent-edit"
      // padding keeps you oriented locally regardless of overall fence size.
      if (hadSelection && !hasSelection) {
        if (isMobileViewport()) {
          return;
        }

        deselectFlyTimeoutRef.current = window.setTimeout(() => {
          deselectFlyTimeoutRef.current = null;
          flyTo(lastFrameTargetRef.current ?? fullBounds, FOCUS_EDIT_PADDING, {
            relativeToCurrent: false,
            preserveAngle: true,
          });
        }, 180);

        return () => {
          if (deselectFlyTimeoutRef.current !== null) {
            window.clearTimeout(deselectFlyTimeoutRef.current);
            deselectFlyTimeoutRef.current = null;
          }
        };
      }
      return;
    }

    if (fenceHeightOnlyEdit) {
      const previousTopM = Math.max(
        0,
        ...previousShape!.legs.map((leg) => leg.heightCm / 100),
      );

      const currentTopM = Math.max(
        0,
        ...shape.legs.map((leg) => leg.heightCm / 100),
      );

      const heightDeltaM = currentTopM - previousTopM;

      /*
       * Move the viewing target only slightly vertically.
       * Keep the exact current camera distance and angle.
       *
       * The multiplier deliberately makes this a subtle visual adjustment,
       * rather than reframing the whole scene.
       */
      const currentTarget = controlsRef.current?.target;

      if (currentTarget) {
        flyTo(
          {
            centerX: currentTarget.x,
            centerY: currentTarget.y + heightDeltaM * 0.18,
            centerZ: currentTarget.z,
            radius: shapeBoundsRef.current.radius,
          },
          lastPaddingRef.current,
          {
            preserveAngle: true,
            preserveDistance: true,
          },
        );
      }

      return;
    }

    let fMinX = Infinity;
    let fMaxX = -Infinity;
    let fMinZ = Infinity;
    let fMaxZ = -Infinity;
    let fTopM = 0;
    for (const idx of focusDiff.legIndices) {
      const b = legBounds.get(idx);
      if (!b) continue;
      fMinX = Math.min(fMinX, b.minX);
      fMaxX = Math.max(fMaxX, b.maxX);
      fMinZ = Math.min(fMinZ, b.minZ);
      fMaxZ = Math.max(fMaxZ, b.maxZ);
      fTopM = Math.max(fTopM, b.topM);
    }
    if (!isFinite(fMinX)) return;

    if (skipThisFocus) {
      return;
    }

    const focusTarget: FrameTarget = {
      centerX: (fMinX + fMaxX) / 2,
      centerY: fTopM * 0.4,
      centerZ: (fMinZ + fMaxZ) / 2,
      radius: Math.max(Math.sqrt((fMaxX - fMinX) ** 2 + (fMaxZ - fMinZ) ** 2 + fTopM ** 2) / 2, 1.5),
    };
    // relativeToCurrent mirrors resetAngle, same as preserveAngle already
    // did: a structural change (leg added, junction changed) frames its OWN
    // natural distance for whatever it's newly focusing on. Reusing the
    // camera's current zoom RATIO only makes sense when the old and new
    // focus targets are similar in scale (an incremental slider edit on the
    // same leg) — applying it to a resetAngle case compounds badly whenever
    // the new target (e.g. just the last two legs) is a very different size
    // than whatever was framed before, which is exactly the "flies even
    // further away when already zoomed out" symptom.
    flyTo(focusTarget, FOCUS_EDIT_PADDING, {
      relativeToCurrent: !focusDiff.resetAngle,
      preserveAngle: !focusDiff.resetAngle,
    });
  }, [shape, colorScheme, profileScheme, selection]);

  // Leg-level camera focus, driven by the panel (opening a leg's accordion
  // tab) — separate from the click-to-select focus above, which only ever
  // frames a single post/step. Reads legBoundsRef rather than recomputing
  // geometry, since opening a tab doesn't change shape/selection and so
  // wouldn't otherwise re-run the effect above.
  useEffect(() => {
    if (!legCameraFocus) return;
    const b = legBoundsRef.current.get(legCameraFocus.legIndex);
    if (!b) return;
    const target: FrameTarget = {
      centerX: (b.minX + b.maxX) / 2,
      centerY: b.topM * 0.4,
      centerZ: (b.minZ + b.maxZ) / 2,
      radius: Math.max(Math.sqrt((b.maxX - b.minX) ** 2 + (b.maxZ - b.minZ) ** 2 + b.topM ** 2) / 2, 1.5),
    };
    flyTo(target, FOCUS_EDIT_PADDING, { preserveAngle: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legCameraFocus]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}