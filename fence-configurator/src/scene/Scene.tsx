import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { layoutShape, type Shape } from '../geometry/shape';
import { computeBoardStack, type ResolvedBoardDims } from '../geometry/field';
import { resolveBoardDims, FENCE_CATALOG } from '../geometry/catalog';
import {
  POST_THICKNESS_CM,
  BOARD_THICKNESS_CM,
  ROSETTE_OFFSET_CM,
  POST_ACCESSORY_WIDTH_MULTIPLIER,
  POST_CAP_HEIGHT_CM,
} from '../geometry/constants';

/** What got clicked — a post (color applies to ALL posts) or a board at a given absolute height (color applies via the below/above split). */
export type Selection =
  | { kind: 'post' }
  | {
    kind: 'board';
    legIndex: number;
    fieldIndex: number;
    heightCm: number;
    stepIndex: number;
    stepIndices: number[];
    stepHeights: Record<number, number>;
  };

/**
 * One coloring action, in the order it was taken. Later rules override
 * earlier ones for any board they both match — this is what makes "last
 * action wins" work automatically, including for overlapping below/above
 * ranges, with no separate recency flag needed.
 */
export interface BoardColorRule {
  heightCm: number;
  colorHex: string;
  /** 'exact' = just the one board clicked. 'below'/'above' = that board and everything toward the ground/sky, within this rule's scope. */
  direction: 'exact' | 'below' | 'above';
  /** 'field' = just the column of boards between the 2 posts this was clicked in. 'global' = every field in the whole shape. */
  scope: 'field' | 'global';
  legIndex?: number;
  fieldIndex?: number;
}

export interface ColorScheme {
  postColorHex: string;
  /** Used by any board no rule below applies to. */
  baseBoardColorHex: string;
  boardRules: BoardColorRule[];
}

/** Pure — used by both the scene (to color meshes) and the panel (to seed the color picker with a board's current color on click). */
export function resolveBoardColorHex(
  colorScheme: ColorScheme,
  legIndex: number,
  fieldIndex: number,
  heightCm: number,
): string {
  let color = colorScheme.baseBoardColorHex;
  for (const rule of colorScheme.boardRules) {
    if (rule.scope === 'field' && (rule.legIndex !== legIndex || rule.fieldIndex !== fieldIndex)) continue;
    let matches = false;
    if (rule.direction === 'exact') matches = Math.abs(rule.heightCm - heightCm) < 0.05;
    else if (rule.direction === 'below') matches = heightCm <= rule.heightCm;
    else matches = heightCm >= rule.heightCm;
    if (matches) color = rule.colorHex;
  }
  return color;
}

/**
 * One profile-type action, in the order it was taken — same match semantics
 * as BoardColorRule ('exact'/'below'/'above', 'field'/'global' scope, later
 * rules win), but keyed on STEP INDEX instead of height. Color can safely
 * key on height because it's resolved AFTER geometry is final; profile
 * cannot, because profile DETERMINES geometry — any height key circularly
 * depends on the very types being resolved. Step index (0 = bottom board)
 * is just the stacking walk's loop counter: always known first, matched by
 * plain integer equality, no epsilon anywhere.
 */
export interface BoardProfileRule {
  stepIndex: number;
  modelId: string;
  sizeId: string;
  direction: 'exact' | 'below' | 'above';
  scope: 'field' | 'global';
  legIndex?: number;
  fieldIndex?: number;
}

export interface ProfileScheme {
  rules: BoardProfileRule[];
  spacerRules: SpacerRule[];
}

/**
 * Same rule machinery as BoardProfileRule, but the payload is a multiplier
 * on the spacer BELOW a step (×1 normal, ×2 double, ×0.5 half, etc.). Step
 * 0 has no spacer below it, so a rule matching it simply has no effect.
 */
export interface SpacerRule {
  stepIndex: number;
  multiplier: number;
  direction: 'exact' | 'below' | 'above';
  scope: 'field' | 'global';
  legIndex?: number;
  fieldIndex?: number;
}

/** Pure — resolves the spacer multiplier for one step, default ×1. Later rules win, same as everything else. */
export function resolveSpacerMultiplier(
  profileScheme: ProfileScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
): number {
  let multiplier = 1;
  for (const rule of profileScheme.spacerRules) {
    if (rule.scope === 'field' && (rule.legIndex !== legIndex || rule.fieldIndex !== fieldIndex)) continue;
    let matches = false;
    if (rule.direction === 'exact') matches = rule.stepIndex === stepIndex;
    else if (rule.direction === 'below') matches = stepIndex <= rule.stepIndex;
    else matches = stepIndex >= rule.stepIndex;
    if (matches) multiplier = rule.multiplier;
  }
  return multiplier;
}

/**
 * Pure — used by Scene to resolve each board's dims while stacking, and by
 * the panel to seed the type/size carousel with a clicked board's current
 * profile. `fallbackModelId`/`fallbackSizeId` are the leg's own model/size
 * (the "סוג פרופיל (לכל המקטע)" / "גודל" carousels) — a passive default a
 * rule overrides only at the step indices it targets.
 */
export function resolveBoardProfile(
  profileScheme: ProfileScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
  fallbackModelId: string,
  fallbackSizeId: string,
): { modelId: string; sizeId: string; fromRule: boolean } {
  let modelId = fallbackModelId;
  let sizeId = fallbackSizeId;
  let fromRule = false;
  for (const rule of profileScheme.rules) {
    if (rule.scope === 'field' && (rule.legIndex !== legIndex || rule.fieldIndex !== fieldIndex)) continue;
    let matches = false;
    if (rule.direction === 'exact') matches = rule.stepIndex === stepIndex;
    else if (rule.direction === 'below') matches = stepIndex <= rule.stepIndex;
    else matches = stepIndex >= rule.stepIndex;
    if (matches) {
      modelId = rule.modelId;
      sizeId = rule.sizeId;
      fromRule = true;
    }
  }
  return { modelId, sizeId, fromRule };
}

/**
 * Builds the ordered candidate list computeBoardStack tries for one step.
 * An explicit profile rule is absolute — a single candidate, no fallback,
 * respecting a deliberate manual choice even on the rare step where it
 * doesn't fit. The leg's own passive default is always tried first; when
 * no rule matches AND the default doesn't fit the remaining room, every
 * OTHER model/size in the whole catalog is offered as a fallback too —
 * confirmed: mixing models/profile types for just that last step is fine,
 * closing flush matters more than staying single-profile. Fallbacks are
 * sorted by their own (board + spacer) step size, largest first, so
 * computeBoardStack's "take the first that fits" naturally picks whichever
 * one gets closest to the ceiling without going over — recomputed fresh
 * every render from current geometry, so it never goes stale: moving
 * baseHeightCm again always re-solves for whatever profile now fits best,
 * rather than leaving behind a leftover gap from a stale earlier choice.
 */
export function resolveBoardStepCandidates(
  profileScheme: ProfileScheme,
  legIndex: number,
  fieldIndex: number,
  stepIndex: number,
  fallbackModelId: string,
  fallbackSizeId: string,
): ResolvedBoardDims[] {
  const { modelId, sizeId, fromRule } = resolveBoardProfile(
    profileScheme,
    legIndex,
    fieldIndex,
    stepIndex,
    fallbackModelId,
    fallbackSizeId,
  );
  const spacerMultiplier = resolveSpacerMultiplier(profileScheme, legIndex, fieldIndex, stepIndex);
  const primaryDims = resolveBoardDims(modelId, sizeId);
  const primary: ResolvedBoardDims = {
    modelId,
    sizeId,
    boardHeightCm: primaryDims.boardHeightCm,
    spacerHeightCm: primaryDims.spacerHeightCm * spacerMultiplier,
  };

  if (fromRule) return [primary];

  const alternates: ResolvedBoardDims[] = FENCE_CATALOG.flatMap((model) =>
    model.sizes
      .filter((size) => !(model.id === modelId && size.id === sizeId))
      .map((size) => ({
        modelId: model.id,
        sizeId: size.id,
        boardHeightCm: size.boardHeightCm,
        spacerHeightCm: size.spacerHeightCm * spacerMultiplier,
      })),
  ).sort((a, b) => b.boardHeightCm + b.spacerHeightCm - (a.boardHeightCm + a.spacerHeightCm));

  return [primary, ...alternates];
}

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
}

interface FrameTarget {
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
}

const VIEW_DIRECTION = new THREE.Vector3(2, 4.2, 11).normalize();
const DEFAULT_POLAR = Math.acos(VIEW_DIRECTION.y);
const DEFAULT_AZIMUTH = Math.atan2(VIEW_DIRECTION.x, VIEW_DIRECTION.z);
const AZIMUTH_RANGE = Math.PI / 2; // full horizontal rotation — polar stays locked below
const POLAR_RANGE = (15 * Math.PI) / 180;
const ZOOM_IN_FACTOR = 0.55;
const ZOOM_OUT_FACTOR = 1.7;
const FLY_DURATION_MS = 550;
const CLICK_MOVE_THRESHOLD_PX = 6;
const FOCUS_ELEMENT_PADDING = 1.15; // close zoom-in when selecting a step/post — tight enough to actually see it without manual zooming
const FOCUS_EDIT_PADDING = 1.3; // recent-edit window: closer than full-shape, looser than a single element — reused below for the deselect case too
const FULL_SHAPE_PADDING = 1.35;
const isMobileViewport = () => window.matchMedia('(max-width: 700px)').matches;

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Which leg indices changed between two shapes, and whether this kind of change is allowed to reset the viewing angle back to default. Null means nothing in legs/junctions differs (e.g. only color changed). */
function diffFocusLegs(prev: Shape, next: Shape): { legIndices: number[]; resetAngle: boolean } | null {
  if (next.legs.length !== prev.legs.length) {
    const idx = next.legs.length - 1;
    const added = next.legs.length > prev.legs.length;
    return {
      // Adding a leg: frame ONLY the new leg. Including the neighbor too
      // meant the camera pulled back to fit whichever of the two was
      // longer — irrelevant to what you actually want to see right after
      // adding one. Removing a leg has no single "new" leg to isolate, so
      // that case keeps framing both sides of the removal point for context.
      legIndices: (added ? [idx] : [idx - 1, idx]).filter((i) => i >= 0 && i < next.legs.length),
      resetAngle: true, // adding/removing a leg — "return to default" case
    };
  }
  for (let i = 0; i < next.legs.length; i++) {
    const a = prev.legs[i];
    const b = next.legs[i];
    if (a.lengthM !== b.lengthM || a.baseHeightCm !== b.baseHeightCm || a.heightCm !== b.heightCm) {
      return {
        legIndices: [i - 1, i, i + 1].filter((idx) => idx >= 0 && idx < next.legs.length),
        resetAngle: false, // a slider edit on an existing leg — keep the user's current angle
      };
    }
  }
  for (let i = 0; i < next.junctions.length; i++) {
    if (prev.junctions[i]?.type !== next.junctions[i]?.type) {
      return {
        legIndices: [i, i + 1].filter((idx) => idx >= 0 && idx < next.legs.length),
        resetAngle: true, // junction direction changed — "return to default" case
      };
    }
  }
  return null;
}

export default function Scene({
  shape,
  colorScheme,
  profileScheme,
  selection,
  onSelect,
  onStats,
  skipNextFocusRef,
  legCameraFocus,
}: SceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fenceGroupRef = useRef<THREE.Group | null>(null);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const geometryStatsRef = useRef({ boardCount: 0, postCount: 0, doublePostCount: 0, fieldCount: 0 });

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
    opts?: { relativeToCurrent?: boolean; preserveAngle?: boolean; instant?: boolean },
  ) {

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const hadDamping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = hadDamping;

    let distance = distanceForTarget(target, padding);
    if (opts?.relativeToCurrent && lastFrameTargetRef.current) {
      const currentDistance = camera.position.distanceTo(controls.target);
      const oldNaturalDistance = distanceForTarget(lastFrameTargetRef.current, lastPaddingRef.current);
      const ratio = THREE.MathUtils.clamp(currentDistance / oldNaturalDistance, 0.25, 4);
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
    scene.background = new THREE.Color(0xeef1f4);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 500);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controlsRef.current = controls;

    flyTo(shapeBoundsRef.current, FULL_SHAPE_PADDING, { instant: true });

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, 8, 4);
    scene.add(ambient, sun);

    const ground = new THREE.GridHelper(200, 200, 0xc9d2d8, 0xdfe5e9);
    scene.add(ground);

    const fenceGroup = new THREE.Group();
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
      if (kind !== 'board') return;

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
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

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

    const postMat = new THREE.MeshStandardMaterial({ color: colorScheme.postColorHex });
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

    // Board color resolution: belowSplit and aboveSplit are two INDEPENDENT
    // boundaries — picking one never touches the other, so skipped-over
    // boards in the middle correctly stay on baseBoardColorHex instead of
    // being swallowed by whichever split was set second.
    const boardMatCache = new Map<string, THREE.MeshStandardMaterial>();
    function boardMaterial(hex: string): THREE.MeshStandardMaterial {
      let mat = boardMatCache.get(hex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({ color: hex });
        boardMatCache.set(hex, mat);
      }
      return mat;
    }
    function resolveHex(legIndex: number, fieldIndex: number, heightCm: number): string {
      return resolveBoardColorHex(colorScheme, legIndex, fieldIndex, heightCm);
    }

    const postThicknessM = POST_THICKNESS_CM / 100;
    const boardThicknessM = BOARD_THICKNESS_CM / 100;
    const accessoryWidthM = postThicknessM * POST_ACCESSORY_WIDTH_MULTIPLIER;
    const rosetteHeightM = ROSETTE_OFFSET_CM / 100;
    const capHeightM = POST_CAP_HEIGHT_CM / 100;
    const capRadiusM = postThicknessM / 2;
    // A flat dome: just the top hemisphere (thetaLength = PI/2 sweeps from
    // the pole down to the equator), squashed in Y per-mesh below so its
    // apex sits only capHeightM above the post's top instead of a full
    // hemisphere's height (= its own radius). Built once and reused for
    // every post — same geometry, only position/scale differ per post.
    const capGeo = new THREE.SphereGeometry(capRadiusM, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);

    let totalBoards = 0;
    let totalPosts = 0;
    let totalDoublePosts = 0;

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
      const geo = new THREE.BoxGeometry(postThicknessM, heightM, postThicknessM);
      const mesh = new THREE.Mesh(geo, postDisplayMat);
      mesh.position.set(post.position.x, baseM + heightM / 2, post.position.z);
      mesh.rotation.y = -post.heading;
      mesh.userData.kind = 'post';
      fenceGroup.add(mesh);
      totalPosts++;
      if (post.isDoublePost) totalDoublePosts++;

      // Rosette: covers the post's base bolting/wall holes, and is the
      // physical reason the first board starts ROSETTE_OFFSET_CM above the
      // post's own base rather than right at baseM.
      const rosetteGeo = new THREE.BoxGeometry(accessoryWidthM, rosetteHeightM, accessoryWidthM);
      const rosetteMesh = new THREE.Mesh(rosetteGeo, postDisplayMat);
      rosetteMesh.position.set(post.position.x, baseM + rosetteHeightM / 2, post.position.z);
      rosetteMesh.rotation.y = -post.heading;
      rosetteMesh.userData.kind = 'rosette';
      fenceGroup.add(rosetteMesh);

      // Cap: flat dome sealing the post's grooves at the top so the boards
      // can't be pulled back out — exactly the post's own width/depth (not
      // doubled like the rosette), purely cosmetic, sits ABOVE the closing
      // height and never affects the board stack's own math (confirmed:
      // there's no reserved top margin at all).
      const capMesh = new THREE.Mesh(capGeo, postDisplayMat);
      capMesh.scale.y = capHeightM / capRadiusM;
      capMesh.position.set(post.position.x, baseM + heightM, post.position.z);
      capMesh.rotation.y = -post.heading;
      capMesh.userData.kind = 'cap';
      fenceGroup.add(capMesh);

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
      const baseM = field.baseHeightCm / 100;
      for (const board of boardStack.boards) {
        const boardAbsHeightCm = field.baseHeightCm + board.centerCm;
        const hex = resolveHex(field.legIndex, field.index, boardAbsHeightCm);
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
        fenceGroup.add(mesh);
        totalBoards++;
      }
      includeInLeg(field.legIndex, field.position.x, field.position.z, baseM + field.fillHeightCm / 100);
    }

    legBoundsRef.current = legBounds;

    geometryStatsRef.current = {
      boardCount: totalBoards,
      postCount: totalPosts,
      doublePostCount: totalDoublePosts,
      fieldCount: layout.fields.length,
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

    const isFirstBuild = prevShapeRef.current === null;
    const focusDiff = isFirstBuild ? null : diffFocusLegs(prevShapeRef.current!, shape);
    prevShapeRef.current = shape;

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