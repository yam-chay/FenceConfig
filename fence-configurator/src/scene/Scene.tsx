import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { layoutShape, type Shape } from '../geometry/shape';
import { computeBoardStack } from '../geometry/field';
import { POST_THICKNESS_CM, BOARD_THICKNESS_CM } from '../geometry/constants';

interface SceneProps {
  shape: Shape;
  fenceColor: string;
  onStats?: (stats: {
    fps: number;
    drawCalls: number;
    triangles: number;
    boardCount: number;
    postCount: number;
    doublePostCount: number;
  }) => void;
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
const AZIMUTH_RANGE = Math.PI/1.5; // full horizontal rotation — polar stays locked below
const POLAR_RANGE = (15 * Math.PI) / 180;
const ZOOM_IN_FACTOR = 0.55;
const ZOOM_OUT_FACTOR = 1.7;
const FLY_DURATION_MS = 550;
const CLICK_MOVE_THRESHOLD_PX = 6;
const FOCUS_ELEMENT_PADDING = 2.2;
const FOCUS_EDIT_PADDING = 1.7; // recent-edit window: closer than full-shape, looser than a single element
const FULL_SHAPE_PADDING = 1.35;

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Which leg indices changed between two shapes, and whether this kind of change is allowed to reset the viewing angle back to default. Null means nothing in legs/junctions differs (e.g. only color changed). */
function diffFocusLegs(prev: Shape, next: Shape): { legIndices: number[]; resetAngle: boolean } | null {
  if (next.legs.length !== prev.legs.length) {
    const idx = next.legs.length - 1;
    return {
      legIndices: [idx - 1, idx].filter((i) => i >= 0 && i < next.legs.length),
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

export default function Scene({ shape, fenceColor, onStats }: SceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fenceGroupRef = useRef<THREE.Group | null>(null);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const geometryStatsRef = useRef({ boardCount: 0, postCount: 0, doublePostCount: 0 });

  const shapeBoundsRef = useRef<FrameTarget>({ centerX: 4, centerY: 0.8, centerZ: 0, radius: 4 });
  const prevShapeRef = useRef<Shape | null>(null);
  // The target actually used for the last framing operation (snap or fly),
  // regardless of what padding was used — lets the next edit measure the
  // user's CURRENT zoom relative to it, instead of resetting to a fixed one.
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
    // maxDistance is anchored to the FULL shape's scale, not the current
    // target's — otherwise focusing on one tiny element traps zoom-out
    // inside a bubble sized to that element, with no way to scroll back out
    // to see everything. minDistance stays relative (fine close-up control
    // on whatever's currently framed), with a small absolute floor so you
    // can always get reasonably close even when framing the whole shape.
    const fullDistance = distanceForTarget(shapeBoundsRef.current, FULL_SHAPE_PADDING);
    controls.minDistance = Math.min(distance * ZOOM_IN_FACTOR, 1.2);
    controls.maxDistance = Math.max(distance * ZOOM_OUT_FACTOR, fullDistance * 0.95);
    controls.minAzimuthAngle = DEFAULT_AZIMUTH - AZIMUTH_RANGE;
    controls.maxAzimuthAngle = DEFAULT_AZIMUTH + AZIMUTH_RANGE;
    controls.minPolarAngle = DEFAULT_POLAR - POLAR_RANGE;
    controls.maxPolarAngle = DEFAULT_POLAR + POLAR_RANGE;
  }

  function snapTo(target: FrameTarget, padding: number) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera) return;
    const distance = distanceForTarget(target, padding);
    camera.position.set(
      target.centerX + VIEW_DIRECTION.x * distance,
      target.centerY + VIEW_DIRECTION.y * distance,
      target.centerZ + VIEW_DIRECTION.z * distance,
    );
    camera.lookAt(target.centerX, target.centerY, target.centerZ);
    if (controls) {
      controls.target.set(target.centerX, target.centerY, target.centerZ);
      applyConstraints(distance);
      controls.update();
    }
    lastFrameTargetRef.current = target;
    lastPaddingRef.current = padding;
  }

  // relativeToCurrent: preserve however zoomed-in the user currently is,
  // instead of resetting distance to the target's own padding-based one.
  // preserveAngle: keep the user's current viewing angle (rotation) instead
  // of resetting to the default VIEW_DIRECTION — used for edits that don't
  // warrant a "return to default" (see diffFocusLegs' resetAngle).
  function flyTo(
    target: FrameTarget,
    padding: number,
    opts?: { relativeToCurrent?: boolean; preserveAngle?: boolean },
  ) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    // Flush any residual damped rotation/zoom left over from a drag that
    // just ended — otherwise it silently reapplies once update() resumes
    // after the fly, fighting the animation and showing up as jitter.
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
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
      startTime: performance.now(),
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

    snapTo(shapeBoundsRef.current, FULL_SHAPE_PADDING);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, 8, 4);
    scene.add(ambient, sun);

    const ground = new THREE.GridHelper(200, 200, 0xc9d2d8, 0xdfe5e9);
    scene.add(ground);

    const fenceGroup = new THREE.Group();
    fenceGroupRef.current = fenceGroup;
    scene.add(fenceGroup);

    // Click-to-focus: a plain click (not a drag) on a post/board flies the
    // camera in close on it. Clicking empty ground does nothing — no reset
    // to a "default" view.
    const raycaster = new THREE.Raycaster();
    const handlePointerDown = (e: PointerEvent) => {
      pointerDownRef.current = { x: e.clientX, y: e.clientY };
    };
    const handlePointerUp = (e: PointerEvent) => {
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved > CLICK_MOVE_THRESHOLD_PX) return; // was a drag, not a click

      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(fenceGroup.children, false);
      if (hits.length === 0) return;

      const mesh = hits[0].object as THREE.Mesh;
      mesh.geometry.computeBoundingSphere();
      const sphere = mesh.geometry.boundingSphere;
      const radius = Math.max(sphere ? sphere.radius : 0.3, 0.25);
      flyTo(
        { centerX: mesh.position.x, centerY: mesh.position.y, centerZ: mesh.position.z, radius },
        FOCUS_ELEMENT_PADDING,
      );
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
        // While flying, controls.update() is skipped entirely — calling it
        // here would let OrbitControls recompute the camera from its own
        // (stale/damped) internal state and fight this lerp every frame.
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
          controls.update(); // one resync now that position/target are final
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

    const handleResize = () => {
      if (!container || !cameraRef.current) return;
      cameraRef.current.aspect = container.clientWidth / container.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      snapTo(shapeBoundsRef.current, FULL_SHAPE_PADDING);
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Rebuild the procedural geometry whenever the live shape/color changes.
  useEffect(() => {
    const fenceGroup = fenceGroupRef.current;
    if (!fenceGroup) return;
    flyRef.current = null;
    if (controlsRef.current) controlsRef.current.enabled = true;

    while (fenceGroup.children.length) {
      const child = fenceGroup.children.pop()!;
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    const layout = layoutShape(shape);

    const boardMat = new THREE.MeshStandardMaterial({ color: fenceColor });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3f44 });
    const doublePostMat = new THREE.MeshStandardMaterial({ color: 0xb5533c });

    const postThicknessM = POST_THICKNESS_CM / 100;
    const boardThicknessM = BOARD_THICKNESS_CM / 100;

    let totalBoards = 0;
    let totalPosts = 0;
    let totalDoublePosts = 0;

    // Bounds per leg index, so an edit can reframe around just the legs that
    // actually changed instead of the whole shape every time.
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
      const mesh = new THREE.Mesh(geo, post.isDoublePost ? doublePostMat : postMat);
      mesh.position.set(post.position.x, baseM + heightM / 2, post.position.z);
      mesh.rotation.y = -post.heading;
      fenceGroup.add(mesh);
      totalPosts++;
      if (post.isDoublePost) totalDoublePosts++;

      minX = Math.min(minX, post.position.x);
      maxX = Math.max(maxX, post.position.x);
      minZ = Math.min(minZ, post.position.z);
      maxZ = Math.max(maxZ, post.position.z);
      includeInLegs(post.legIndices, post.position.x, post.position.z, baseM + heightM);
    }

    for (const field of layout.fields) {
      const boardStack = computeBoardStack(field.fillHeightCm, field.boardHeightCm, field.spacerHeightCm);
      const boardHeightM = field.boardHeightCm / 100;
      const baseM = field.baseHeightCm / 100;
      for (const boardCenterCm of boardStack.boardCenters) {
        const geo = new THREE.BoxGeometry(field.lengthM * 0.96, boardHeightM, boardThicknessM);
        const mesh = new THREE.Mesh(geo, boardMat);
        mesh.position.set(field.position.x, baseM + boardCenterCm / 100, field.position.z);
        mesh.rotation.y = -field.heading;
        fenceGroup.add(mesh);
        totalBoards++;
      }
      includeInLeg(field.legIndex, field.position.x, field.position.z, baseM + field.fillHeightCm / 100);
    }

    geometryStatsRef.current = {
      boardCount: totalBoards,
      postCount: totalPosts,
      doublePostCount: totalDoublePosts,
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

    if (isFirstBuild) {
      snapTo(fullBounds, FULL_SHAPE_PADDING);
      return;
    }
    if (focusDiff === null) {
      // Nothing in legs/junctions changed (e.g. only the color did) — leave the camera exactly where it is.
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
    if (!isFinite(fMinX)) return; // shouldn't happen, but don't move the camera on bad data

    const focusTarget: FrameTarget = {
      centerX: (fMinX + fMaxX) / 2,
      centerY: fTopM * 0.4,
      centerZ: (fMinZ + fMaxZ) / 2,
      radius: Math.max(Math.sqrt((fMaxX - fMinX) ** 2 + (fMaxZ - fMinZ) ** 2 + fTopM ** 2) / 2, 1.5),
    };
    flyTo(focusTarget, FOCUS_EDIT_PADDING, { relativeToCurrent: true, preserveAngle: !focusDiff.resetAngle });
  }, [shape, fenceColor]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
