import * as THREE from 'three';
import { VIEW_FACES, VIEW_FACE_LABELS, type ViewFace } from './viewGizmo';

/**
 * The navigation gizmo's own little world: a fence segment that exactly
 * fills an invisible cube, with each clickable face's name floating on it.
 * Drawn by the main renderer into the gizmo's corner box (scissor pass in
 * Scene.tsx), so it costs no second WebGL context.
 */
export interface ViewGizmoScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Point the gizmo camera the same way as the main camera (offset = main camera minus its target). */
  orient(offset: THREE.Vector3, quaternion: THREE.Quaternion): void;
  /** Highlight state: the face the view is locked on, and the face under the pointer. */
  setState(aligned: ViewFace | null, hovered: ViewFace | null): void;
  /** Face under a point given in the gizmo box's own NDC (-1..1), or null. */
  pick(ndc: THREE.Vector2): ViewFace | null;
  dispose(): void;
}

const CUBE = 1.55;
const CAMERA_DISTANCE = 5.2;
const ACCENT = 0xbb2931;
const POST_COLOR = 0x2f353b;
const CAP_COLOR = 0x1b1f22;

const FACE_PLACEMENT: Record<
  ViewFace,
  { position: [number, number, number]; rotation: [number, number, number]; normal: [number, number, number] }
> = {
  front: { position: [0, CUBE / 2, CUBE / 2], rotation: [0, 0, 0], normal: [0, 0, 1] },
  back: { position: [0, CUBE / 2, -CUBE / 2], rotation: [0, Math.PI, 0], normal: [0, 0, -1] },
  right: { position: [CUBE / 2, CUBE / 2, 0], rotation: [0, Math.PI / 2, 0], normal: [1, 0, 0] },
  left: { position: [-CUBE / 2, CUBE / 2, 0], rotation: [0, -Math.PI / 2, 0], normal: [-1, 0, 0] },
  top: { position: [0, CUBE, 0], rotation: [-Math.PI / 2, 0, 0], normal: [0, 1, 0] },
};
/** A name fades out as its face turns edge-on — at a grazing angle the text only reads as a row of dots. */
const LABEL_FADE_FROM = 0.3;
const LABEL_FADE_TO = 0.55;

/** Face tint per state. Idle faces are fully clear: only their names float. */
const FACE_OPACITY = { idle: 0, hover: 0.22, active: 0.38 };
const LABEL_OPACITY = { idle: 0.8, hover: 1, active: 1 };

function paintLabel(canvas: HTMLCanvasElement, text: string, fontFamily: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // White glyphs; the material color tints them per state.
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 60px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
}

/** Two posts, rosettes touching the side walls, caps touching the lid, boards filling the height. */
function buildSegment(disposables: { dispose(): void }[]): THREE.Group {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: POST_COLOR, metalness: 0.35, roughness: 0.5 });
  const capMat = new THREE.MeshStandardMaterial({ color: CAP_COLOR, roughness: 0.6 });
  const postW = 0.13;
  const rosetteW = postW * 1.6;
  const capRadius = postW * 0.62;
  const capSquash = 0.45;
  const base = 0.04;
  const postH = CUBE - base - capRadius * capSquash;
  const postX = CUBE / 2 - rosetteW / 2;

  const postGeo = new THREE.BoxGeometry(postW, postH, postW);
  const rosetteGeo = new THREE.BoxGeometry(rosetteW, 0.05, rosetteW);
  const capGeo = new THREE.SphereGeometry(capRadius, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, metal);
    post.position.set(side * postX, base + postH / 2, 0);
    const rosette = new THREE.Mesh(rosetteGeo, metal);
    rosette.position.set(side * postX, 0.025, 0);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.scale.set(1, capSquash, 1);
    cap.position.set(side * postX, base + postH, 0);
    group.add(post, rosette, cap);
  }

  const boardH = 0.062;
  const boardGeo = new THREE.BoxGeometry(postX * 2 - postW, boardH, 0.035);
  for (let y = 0.1; y + boardH / 2 < base + postH - 0.02; y += 0.082) {
    const board = new THREE.Mesh(boardGeo, metal);
    board.position.y = y;
    group.add(board);
  }
  disposables.push(metal, capMat, postGeo, rosetteGeo, capGeo, boardGeo);
  return group;
}

export function createViewGizmoScene(fontFamily: string): ViewGizmoScene {
  const disposables: { dispose(): void }[] = [];
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a99a5, 1.4));
  const light = new THREE.DirectionalLight(0xffffff, 1.4);
  light.position.set(3, 6, 5);
  scene.add(light);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  const lookAt = new THREE.Vector3(0, CUBE / 2, 0);

  scene.add(buildSegment(disposables));

  const faceGeo = new THREE.PlaneGeometry(CUBE, CUBE);
  disposables.push(faceGeo);
  const faces = new Map<ViewFace, { face: THREE.Mesh; label: THREE.Mesh; normal: THREE.Vector3; baseOpacity: number }>();
  const labelCanvases: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; text: string }[] = [];

  for (const name of VIEW_FACES) {
    const faceMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: FACE_OPACITY.idle,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const face = new THREE.Mesh(faceGeo, faceMat);
    const { position, rotation } = FACE_PLACEMENT[name];
    face.position.set(...position);
    face.rotation.set(...rotation);
    face.renderOrder = 5;
    face.userData.face = name;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    paintLabel(canvas, VIEW_FACE_LABELS[name], fontFamily);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    labelCanvases.push({ canvas, texture, text: VIEW_FACE_LABELS[name] });
    // A hair outside the face and front-side only: read from outside,
    // never shown mirrored through the near face.
    const labelMat = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      opacity: LABEL_OPACITY.idle,
      depthWrite: false,
    });
    const label = new THREE.Mesh(faceGeo, labelMat);
    label.position.z = 0.003;
    label.renderOrder = 6;
    face.add(label);

    scene.add(face);
    faces.set(name, { face, label, normal: new THREE.Vector3(...FACE_PLACEMENT[name].normal), baseOpacity: LABEL_OPACITY.idle });
    disposables.push(faceMat, labelMat, texture);
  }

  // Cube floor: visible, never clickable — there is no view from below.
  const floorMat = new THREE.MeshBasicMaterial({
    color: 0x9aa6af,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const floor = new THREE.Mesh(faceGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  scene.add(floor);

  const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE, CUBE, CUBE));
  const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const edges = new THREE.LineSegments(edgesGeo, edgesMat);
  edges.position.y = CUBE / 2;
  scene.add(edges);
  disposables.push(floorMat, edgesGeo, edgesMat);

  // Labels are painted before the web font may have arrived — repaint once it has.
  let disposed = false;
  document.fonts?.load(`700 60px ${fontFamily}`).then(() => {
    if (disposed) return;
    for (const l of labelCanvases) {
      paintLabel(l.canvas, l.text, fontFamily);
      l.texture.needsUpdate = true;
    }
  }).catch(() => {});

  let lastState = '';
  const raycaster = new THREE.Raycaster();
  const faceMeshes = [...faces.values()].map((f) => f.face);

  return {
    scene,
    camera,
    orient(offset, quaternion) {
      const dir = offset.clone().normalize();
      camera.position.copy(lookAt).addScaledVector(dir, CAMERA_DISTANCE);
      camera.quaternion.copy(quaternion);
      for (const f of faces.values()) {
        const facing = THREE.MathUtils.smoothstep(f.normal.dot(dir), LABEL_FADE_FROM, LABEL_FADE_TO);
        (f.label.material as THREE.MeshBasicMaterial).opacity = f.baseOpacity * facing;
      }
    },
    setState(aligned, hovered) {
      const key = `${aligned}|${hovered}`;
      if (key === lastState) return;
      lastState = key;
      for (const [name, f] of faces) {
        const { face, label } = f;
        const state = name === aligned ? 'active' : name === hovered ? 'hover' : 'idle';
        const faceMat = face.material as THREE.MeshBasicMaterial;
        faceMat.color.set(state === 'idle' ? 0xffffff : ACCENT);
        faceMat.opacity = FACE_OPACITY[state];
        const labelMat = label.material as THREE.MeshBasicMaterial;
        labelMat.color.set(state === 'hover' ? ACCENT : 0xffffff);
        f.baseOpacity = LABEL_OPACITY[state];
      }
    },
    pick(ndc) {
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(faceMeshes, false)[0];
      return (hit?.object.userData.face as ViewFace | undefined) ?? null;
    },
    dispose() {
      disposed = true;
      disposables.forEach((d) => d.dispose());
    },
  };
}
