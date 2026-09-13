import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { layoutRun } from '../geometry/run';
import { computeBoardStack } from '../geometry/field';
import { buildPostSpec } from '../geometry/post';
import { POST_THICKNESS_CM, BOARD_THICKNESS_CM, BOARD_HEIGHT_CM } from '../geometry/constants';

interface SceneProps {
  totalLengthM: number;
  heightCm: number;
  bendAngleDeg: number;
  fenceColor: string;
  onStats?: (stats: { fps: number; drawCalls: number; triangles: number; boardCount: number; postCount: number }) => void;
}

export default function Scene({ totalLengthM, heightCm, bendAngleDeg, fenceColor, onStats }: SceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const fenceGroupRef = useRef<THREE.Group | null>(null);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const geometryStatsRef = useRef({ boardCount: 0, postCount: 0 });

  // One-time scene setup. Camera is intentionally fixed — per spec, the user
  // never rotates/pans it; clicking an element triggers a scripted zoom instead
  // (not implemented in this spike).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f4);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(4, 3.2, 7);
    camera.lookAt(3, 0.8, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, 8, 4);
    scene.add(ambient, sun);

    const ground = new THREE.GridHelper(40, 40, 0xc9d2d8, 0xdfe5e9);
    scene.add(ground);

    const fenceGroup = new THREE.Group();
    fenceGroupRef.current = fenceGroup;
    scene.add(fenceGroup);

    let frameCount = 0;
    let lastFpsSample = performance.now();
    let rafId: number;

    const animate = () => {
      rafId = requestAnimationFrame(animate);
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
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Rebuild the procedural geometry whenever the live parameters change.
  // This is the core of the spike: everything below is generated from math,
  // nothing is a pre-baked/imported model.
  useEffect(() => {
    const fenceGroup = fenceGroupRef.current;
    if (!fenceGroup) return;

    // Clear the previous build
    while (fenceGroup.children.length) {
      const child = fenceGroup.children.pop()!;
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    const run = layoutRun(totalLengthM, bendAngleDeg);
    const boardStack = computeBoardStack(heightCm);
    const postSpec = buildPostSpec(heightCm);

    const boardMat = new THREE.MeshStandardMaterial({ color: fenceColor });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3f44 });
    // Spacers are deliberately not rendered — invisible gap piece per spec.

    const postThicknessM = POST_THICKNESS_CM / 100;
    const boardThicknessM = BOARD_THICKNESS_CM / 100;
    const heightM = heightCm / 100;

    for (const post of run.posts) {
      const geo = new THREE.BoxGeometry(postThicknessM, postSpec.heightCm / 100, postThicknessM);
      const mesh = new THREE.Mesh(geo, postMat);
      mesh.position.set(post.position.x, heightM / 2, post.position.z);
      mesh.rotation.y = -post.heading;
      fenceGroup.add(mesh);
    }

    const boardHeightM = BOARD_HEIGHT_CM / 100;
    for (const field of run.fields) {
      for (const boardCenterCm of boardStack.boardCenters) {
        const geo = new THREE.BoxGeometry(field.lengthM * 0.96, boardHeightM, boardThicknessM);
        const mesh = new THREE.Mesh(geo, boardMat);
        mesh.position.set(field.position.x, boardCenterCm / 100, field.position.z);
        mesh.rotation.y = -field.heading;
        fenceGroup.add(mesh);
      }
    }

    geometryStatsRef.current = {
      boardCount: boardStack.boardCount * run.fieldCount,
      postCount: run.posts.length,
    };
  }, [totalLengthM, heightCm, bendAngleDeg, fenceColor]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
