import * as THREE from 'three';
import { layoutShape, fieldCountForLeg, type Shape } from '../../geometry/shape';
import { computeBoardStack } from '../../geometry/field';
import { buildPostSpec, activeGrooveFaces } from '../../geometry/post';
import {
  POST_THICKNESS_CM,
  BOARD_THICKNESS_CM,
  ROSETTE_OFFSET_CM,
  POST_ACCESSORY_WIDTH_MULTIPLIER,
  POST_CAP_HEIGHT_CM,
  WALL_END_OVERHANG_CM,
  CAP_COLOR_HEX,
} from '../../geometry/constants';
import type { ColorScheme, ProfileScheme, Selection, FrameTarget, LegBounds } from '../types';
import { resolveBoardColorHex, resolveBoardStepCandidates } from '../resolvers';
import { ALUMINUM_ROUGHNESS, ALUMINUM_METALNESS } from '../materials/materials';
import { buildPostGeometry } from './postGeometry';

export interface FenceGeometryStats {
  boardCount: number;
  postCount: number;
  doublePostCount: number;
  fieldCount: number;
  /** Real per-leg board count — summed across however many fields that leg
   * splits into. */
  boardCountByLeg: Record<number, number>;
  /** Real per-FIELD board count, keyed by `${legIndex}:${fieldIndex}` —
   * not summed across a leg's fields, since sibling fields can differ
   * (field-scoped rules). */
  boardCountByField: Record<string, number>;
}

export interface FenceGeometryResult {
  legBounds: Map<number, LegBounds>;
  fullBounds: FrameTarget;
  stats: FenceGeometryStats;
}

/**
 * Builds every post/rosette/cap/wall/board mesh for the current shape into
 * `fenceGroup` (assumed already empty — the caller disposes/clears old
 * children first, same as before) and returns what the caller needs to
 * update its own refs: per-leg bounds (for per-leg camera focus), the
 * full-shape bounds (for the initial/shadow-frustum framing), and the
 * live stats (board/post counts, per-leg and per-field breakdowns).
 *
 * Pure with respect to the fence group's contents — doesn't touch camera
 * refs, doesn't decide whether/how to fly the camera. That decision stays
 * in Scene.tsx, using the bounds this returns.
 */
export function buildFenceMeshes(
  fenceGroup: THREE.Group,
  shape: Shape,
  colorScheme: ColorScheme,
  profileScheme: ProfileScheme,
  selection: Selection | null,
  envIntensity: number,
): FenceGeometryResult {
  const layout = layoutShape(shape);

  const postMat = new THREE.MeshStandardMaterial({
    color: colorScheme.postColorHex,
    roughness: ALUMINUM_ROUGHNESS,
    metalness: ALUMINUM_METALNESS,
    envMapIntensity: envIntensity,
  });
  // Separate material JUST for the merged post-box geometry (the one
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
    envMapIntensity: envIntensity,
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
        envMapIntensity: envIntensity,
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
  const wallMat = new THREE.MeshStandardMaterial({ color: '#696662', envMapIntensity: envIntensity });
  // A true end's wall overhang is Yam's own visual call
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
    envMapIntensity: envIntensity,
  });
  const capDisplayMat = selection?.kind === 'post' ? withHighlight(capMat) : capMat;

  let totalBoards = 0;
  let totalPosts = 0;
  let totalDoublePosts = 0;
  const boardCountByLeg: Record<number, number> = {};
  const boardCountByField: Record<string, number> = {};

  const legBounds = new Map<number, LegBounds>();
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
    const rosetteGeo = new THREE.BoxGeometry(accessoryWidthM, rosetteHeightM, accessoryWidthM);
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
    const rosetteOverhangM = (accessoryWidthM - postThicknessM) / 2;

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
    rosetteMesh.userData.kind = 'post';
    rosetteMesh.userData.part = 'rosette';
    rosetteMesh.userData.focusY = baseM + heightM / 2;
    rosetteMesh.userData.focusRadius = heightM / 2;
    rosetteMesh.castShadow = true;
    rosetteMesh.receiveShadow = true;
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
    capMesh.userData.kind = 'post';
    capMesh.userData.part = 'cap';
    capMesh.userData.focusY = baseM + heightM / 2;
    capMesh.userData.focusRadius = heightM / 2;
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
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
      // rosetteEnd at all (see the rosette-positioning code above), so
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
      const higherWallJunctionM = Math.max(0.01, wallToPostFaceM - rosetteOverhangPastPostFaceM);

      let startDistM = halfFieldM;

      if (isFirstFieldOfLeg) {
        if (!startIsMiddle) {
          // Free outer end.
          startDistM = wallToRosetteEdgeM;
        } else {
          const prevLeg = shape.legs[field.legIndex - 1];

          if (prevLeg.baseHeightCm !== leg.baseHeightCm) {
            const currentIsLower = leg.baseHeightCm < prevLeg.baseHeightCm;

            startDistM = currentIsLower ? wallToRosetteEdgeJunctionM : higherWallJunctionM;
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
            const currentIsLower = leg.baseHeightCm < nextLeg.baseHeightCm;

            endDistM = currentIsLower ? wallToRosetteEdgeJunctionM : higherWallJunctionM;
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
      wallMesh.userData.legIndex = field.legIndex;
      wallMesh.userData.fieldIndex = field.index;
      // Framing target for a wall click: the FIELD's own column (wall +
      // the board stack above it), centered on the field — not on the
      // wall mesh, which is shifted by wallCenterOffsetM at ends and
      // height-changing junctions.
      wallMesh.userData.focus = {
        centerX: field.position.x,
        centerY: (baseM + field.fillHeightCm / 100) / 2,
        centerZ: field.position.z,
        radius: Math.max(Math.sqrt(field.lengthM ** 2 + (baseM + field.fillHeightCm / 100) ** 2) / 2, 0.5),
      };
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

  if (!isFinite(minX)) {
    minX = maxX = minZ = maxZ = 0;
  }
  const fullBounds: FrameTarget = {
    centerX: (minX + maxX) / 2,
    centerY: maxTopHeightM * 0.4,
    centerZ: (minZ + maxZ) / 2,
    radius: Math.max(Math.sqrt((maxX - minX) ** 2 + (maxZ - minZ) ** 2 + maxTopHeightM ** 2) / 2, 1.5),
  };

  return {
    legBounds,
    fullBounds,
    stats: {
      boardCount: totalBoards,
      postCount: totalPosts,
      doublePostCount: totalDoublePosts,
      fieldCount: layout.fields.length,
      boardCountByLeg,
      boardCountByField,
    },
  };
}
