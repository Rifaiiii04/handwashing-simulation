import * as THREE from "three";
import {
  inspectSceneHandRigs,
  type DiscoveredHandCluster,
  type SceneRigInspectionResult,
} from "./handRigInspection";

export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

export const FINGER_NAMES: readonly FingerName[] = [
  "thumb",
  "index",
  "middle",
  "ring",
  "pinky",
];

export interface MappedBoneJoint {
  readonly bone: THREE.Bone;
  readonly name: string;
  readonly restPosition: THREE.Vector3;
  readonly restQuaternion: THREE.Quaternion;
  readonly restScale: THREE.Vector3;
  readonly targetQuaternion: THREE.Quaternion;
}

export interface MappedFingerChain {
  readonly finger: FingerName;
  readonly joints: readonly MappedBoneJoint[];
}

export interface MappedHandRig {
  readonly side: "right" | "left";
  /**
   * Empirically verified flexion sign around local bone X axis:
   * +1 when positive X rotation curls the fingertip toward the palm,
   * -1 when negative X rotation curls the fingertip toward the palm.
   */
  readonly curlSign: 1 | -1;
  /**
   * Empirically verified spread sign around local bone Z axis:
   * -1 when negative Z rotation abducts the index finger toward the thumb.
   */
  readonly spreadSign: 1 | -1;
  readonly armature: THREE.Object3D;
  readonly meshContainer: THREE.Object3D;
  readonly skinnedMeshes: readonly THREE.SkinnedMesh[];
  readonly skeleton: THREE.Skeleton;
  readonly restPosition: THREE.Vector3;
  readonly restQuaternion: THREE.Quaternion;
  readonly restScale: THREE.Vector3;
  readonly palmWorldRest: THREE.Vector3;
  readonly palmLocalPivot: THREE.Vector3;
  readonly currentPalmWorld: THREE.Vector3;
  readonly currentKnuckleWorld: THREE.Vector3;
  readonly targetPosition: THREE.Vector3;
  readonly targetQuaternion: THREE.Quaternion;
  readonly wristJoint: MappedBoneJoint;
  readonly fingers: Record<FingerName, MappedFingerChain>;
  readonly repairedCrossFingerVertices: number;
}

export interface MappedHandPairRig {
  readonly right: MappedHandRig;
  readonly left: MappedHandRig;
  readonly inspection: SceneRigInspectionResult;
  readonly hasValidSkeleton: boolean;
  readonly contactWorldCenter: THREE.Vector3;
  readonly receivingPalmWorld: THREE.Vector3;
}

interface JointRestCalibration {
  readonly curl: number;
  readonly twist: number;
  readonly spread: number;
}

const DEG2RAD = Math.PI / 180;
const probeTipBefore = new THREE.Vector3();
const probeTipAfter = new THREE.Vector3();
const probeThumbTipWorld = new THREE.Vector3();
const probeDeltaQuat = new THREE.Quaternion();
const probeEuler = new THREE.Euler();

/**
 * Calibrates the raw GLB bind pose (which has wide "starfish" finger splay of 0.30..0.39
 * wrist units, pre-bent 30..41 deg distal flexion, and unaligned MCP axial roll) into a
 * natural, anatomically aligned resting hand posture with parallel fingers, gentle ~10 deg
 * resting curvature, and orthogonalized flexion hinge axes.
 */
const ANATOMICAL_REST_CALIBRATION: Record<
  "right" | "left",
  Record<FingerName, readonly JointRestCalibration[]>
> = {
  right: {
    pinky: [
      { curl: 0, twist: 0, spread: 6.0 },
      { curl: -11, twist: -4, spread: 6.5 },
      { curl: -10, twist: 0, spread: 1.5 },
      { curl: -4, twist: 0, spread: 0 },
    ],
    ring: [
      { curl: 0, twist: 0, spread: 2.0 },
      { curl: -12, twist: -8, spread: -0.5 },
      { curl: -11, twist: -4, spread: -2.0 },
      { curl: -4, twist: 0, spread: 0 },
    ],
    middle: [
      { curl: 0, twist: 0, spread: -1.0 },
      { curl: -10, twist: -9, spread: -1.5 },
      { curl: -10, twist: -5, spread: -3.0 },
      { curl: -4, twist: 0, spread: 0 },
    ],
    index: [
      { curl: 0, twist: 0, spread: -5.0 },
      { curl: -10, twist: -10, spread: -7.5 },
      { curl: -8, twist: -5, spread: -2.0 },
      { curl: -3, twist: 0, spread: 0 },
    ],
    thumb: [
      { curl: 2, twist: 0, spread: -12.0 },
      { curl: -6, twist: 0, spread: -6.0 },
      { curl: -4, twist: 0, spread: -2.0 },
    ],
  },
  left: {
    pinky: [
      { curl: 0, twist: 0, spread: 6.5 },
      { curl: -11, twist: 4, spread: 8.5 },
      { curl: -10, twist: 0, spread: 2.5 },
      { curl: -4, twist: 0, spread: 0 },
    ],
    ring: [
      { curl: 0, twist: 0, spread: 2.0 },
      { curl: -12, twist: -4, spread: -1.0 },
      { curl: -11, twist: 0, spread: 0.5 },
      { curl: -4, twist: 0, spread: 0 },
    ],
    middle: [
      { curl: 0, twist: 0, spread: -1.5 },
      { curl: -10, twist: -10, spread: -1.5 },
      { curl: -10, twist: -6, spread: -1.5 },
      { curl: -4, twist: 0, spread: 0 },
    ],
    index: [
      { curl: 0, twist: 0, spread: -6.5 },
      { curl: -9, twist: -14, spread: -5.5 },
      { curl: -8, twist: -8, spread: -1.5 },
      { curl: -3, twist: 0, spread: 0 },
    ],
    thumb: [
      { curl: 2, twist: 0, spread: -12.0 },
      { curl: -6, twist: 0, spread: -6.0 },
      { curl: -4, twist: 0, spread: -2.0 },
    ],
  },
};

function createMappedJoint(bone: THREE.Bone): MappedBoneJoint {
  return {
    bone,
    name: bone.name,
    restPosition: bone.position.clone(),
    restQuaternion: bone.quaternion.clone(),
    restScale: bone.scale.clone(),
    targetQuaternion: bone.quaternion.clone(),
  };
}

/**
 * Infers which branch chain corresponds to thumb, index, middle, ring, and pinky
 * using chain topology (bone count) and spatial distance from the thumb base,
 * rather than relying on bone names or fixed array indices.
 */
function classifyFingerChains(
  branchChains: readonly (readonly THREE.Bone[])[],
): Record<FingerName, readonly THREE.Bone[]> | null {
  if (branchChains.length < 5) return null;

  // 1. Identify the thumb chain: shortest chain (3 bones vs 4 for fingers),
  // breaking ties by maximum lateral distance from the centroid of all branch bases.
  const baseCentroid = new THREE.Vector3();
  for (const chain of branchChains) {
    baseCentroid.add(chain[0]!.position);
  }
  baseCentroid.divideScalar(branchChains.length);

  const sortedForThumb = [...branchChains].sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return (
      b[0]!.position.distanceToSquared(baseCentroid) -
      a[0]!.position.distanceToSquared(baseCentroid)
    );
  });

  const thumbChain = sortedForThumb[0]!;
  const thumbBasePos = thumbChain[0]!.position;

  // 2. Sort the remaining 4 finger chains by spatial distance of their metacarpal
  // base bone to the thumb base bone: closest -> index, middle, ring, furthest -> pinky.
  const fourFingerChains = branchChains
    .filter((chain) => chain !== thumbChain)
    .slice(0, 4)
    .sort(
      (a, b) =>
        a[0]!.position.distanceToSquared(thumbBasePos) -
        b[0]!.position.distanceToSquared(thumbBasePos),
    );

  if (fourFingerChains.length < 4) return null;

  return {
    thumb: thumbChain,
    index: fourFingerChains[0]!,
    middle: fourFingerChains[1]!,
    ring: fourFingerChains[2]!,
    pinky: fourFingerChains[3]!,
  };
}

/**
 * Repairs cross-finger phalanx skin-weight bleeding on all SkinnedMesh primitives
 * belonging to a hand cluster. In `washand.glb`, Blender's automatic heat weighting
 * assigned 10%-40% weights from neighboring fingers' moving phalanges onto 160 right-hand
 * and 145 left-hand interdigital/finger-base vertices, causing adjacent fingers to stretch
 * each other when articulating or adducting. Reassigning foreign phalanx weights to the
 * vertex's own palm metacarpal bone keeps the webbing anchored to the palm and allows
 * each finger to articulate cleanly without deforming neighboring fingers.
 */
function repairHandSkinWeights(
  skinnedMeshes: readonly THREE.SkinnedMesh[],
  skeleton: THREE.Skeleton,
  classified: Record<FingerName, readonly THREE.Bone[]>,
): number {
  const boneIndexToFinger = new Map<number, FingerName>();
  const phalanxBoneIndices = new Set<number>();
  const fingerMetacarpalIndex = new Map<FingerName, number>();

  for (const fingerName of FINGER_NAMES) {
    const chain = classified[fingerName];
    chain.forEach((bone, depth) => {
      const idx = skeleton.bones.indexOf(bone);
      if (idx < 0) return;
      boneIndexToFinger.set(idx, fingerName);
      if (depth === 0) {
        fingerMetacarpalIndex.set(fingerName, idx);
      } else {
        phalanxBoneIndices.add(idx);
      }
    });
  }

  let totalRepaired = 0;

  for (const mesh of skinnedMeshes) {
    if (mesh.userData.__handWeightsRepaired) continue;
    const idxAttr = mesh.geometry.getAttribute("skinIndex") as THREE.BufferAttribute | undefined;
    const wgtAttr = mesh.geometry.getAttribute("skinWeight") as THREE.BufferAttribute | undefined;
    if (!idxAttr || !wgtAttr) continue;

    let meshModified = false;

    for (let v = 0; v < wgtAttr.count; v++) {
      const fingerTotals: Record<FingerName, number> = {
        thumb: 0,
        index: 0,
        middle: 0,
        ring: 0,
        pinky: 0,
      };

      for (let k = 0; k < 4; k++) {
        const bIdx = Math.round(idxAttr.getComponent(v, k));
        const w = wgtAttr.getComponent(v, k);
        const fName = boneIndexToFinger.get(bIdx);
        if (fName && w > 0) {
          fingerTotals[fName] += w;
        }
      }

      let dominantFinger: FingerName | null = null;
      let maxWeight = 0;
      for (const fName of FINGER_NAMES) {
        if (fingerTotals[fName] > maxWeight) {
          maxWeight = fingerTotals[fName];
          dominantFinger = fName;
        }
      }
      if (!dominantFinger) continue;

      const ownMetacarpalIdx = fingerMetacarpalIndex.get(dominantFinger);
      if (ownMetacarpalIdx === undefined) continue;

      let vertexModified = false;
      const slots: { b: number; w: number }[] = [];
      for (let k = 0; k < 4; k++) {
        slots.push({
          b: Math.round(idxAttr.getComponent(v, k)),
          w: wgtAttr.getComponent(v, k),
        });
      }

      for (let k = 0; k < 4; k++) {
        const slot = slots[k]!;
        if (slot.w <= 0) continue;
        const slotFinger = boneIndexToFinger.get(slot.b);
        if (
          slotFinger &&
          slotFinger !== dominantFinger &&
          phalanxBoneIndices.has(slot.b)
        ) {
          slot.b = ownMetacarpalIdx;
          vertexModified = true;
        }
      }

      if (vertexModified) {
        totalRepaired++;
        meshModified = true;
        const merged = new Map<number, number>();
        for (const s of slots) {
          if (s.w > 0) {
            merged.set(s.b, (merged.get(s.b) ?? 0) + s.w);
          }
        }
        const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = sorted.reduce((acc, item) => acc + item[1], 0) || 1;
        for (let k = 0; k < 4; k++) {
          if (k < sorted.length) {
            idxAttr.setComponent(v, k, sorted[k]![0]);
            wgtAttr.setComponent(v, k, sorted[k]![1] / sum);
          } else {
            idxAttr.setComponent(v, k, 0);
            wgtAttr.setComponent(v, k, 0);
          }
        }
      }
    }

    if (meshModified) {
      idxAttr.needsUpdate = true;
      wgtAttr.needsUpdate = true;
    }
    mesh.userData.__handWeightsRepaired = true;
  }

  return totalRepaired;
}

/**
 * Non-destructively probes a candidate finger bone by applying a small test rotation,
 * measuring world-space fingertip displacement relative to the palm/thumb, and
 * immediately restoring the original rest pose.
 */
function runEmpiricalAxisProbe(
  armature: THREE.Object3D,
  classified: Record<FingerName, readonly THREE.Bone[]>,
  opposingHandWorldPos: THREE.Vector3,
): { curlSign: 1 | -1; spreadSign: 1 | -1 } {
  const middleChain = classified.middle;
  const middleProximal = middleChain[Math.min(1, middleChain.length - 1)]!;
  const middleTip = middleChain[middleChain.length - 1]!;
  const savedMiddleQuat = middleProximal.quaternion.clone();

  middleTip.getWorldPosition(probeTipBefore);
  const distToOpposingBefore = probeTipBefore.distanceTo(opposingHandWorldPos);

  // Test +15 deg rotation around local X axis
  probeEuler.set(15 * DEG2RAD, 0, 0, "XYZ");
  probeDeltaQuat.setFromEuler(probeEuler);
  middleProximal.quaternion.copy(savedMiddleQuat).multiply(probeDeltaQuat);
  armature.updateMatrixWorld(true);

  middleTip.getWorldPosition(probeTipAfter);
  const distToOpposingAfter = probeTipAfter.distanceTo(opposingHandWorldPos);

  // Restore exact rest pose immediately
  middleProximal.quaternion.copy(savedMiddleQuat);
  armature.updateMatrixWorld(true);

  const curlSign: 1 | -1 = distToOpposingAfter < distToOpposingBefore ? 1 : -1;

  // Probe index finger abduction toward thumb around local Z axis
  const indexChain = classified.index;
  const indexProximal = indexChain[Math.min(1, indexChain.length - 1)]!;
  const indexTip = indexChain[indexChain.length - 1]!;
  const thumbTip = classified.thumb[classified.thumb.length - 1]!;
  const savedIndexQuat = indexProximal.quaternion.clone();

  thumbTip.getWorldPosition(probeThumbTipWorld);
  indexTip.getWorldPosition(probeTipBefore);
  const distToThumbBefore = probeTipBefore.distanceTo(probeThumbTipWorld);

  probeEuler.set(0, 0, -10 * DEG2RAD, "XYZ");
  probeDeltaQuat.setFromEuler(probeEuler);
  indexProximal.quaternion.copy(savedIndexQuat).multiply(probeDeltaQuat);
  armature.updateMatrixWorld(true);

  indexTip.getWorldPosition(probeTipAfter);
  const distToThumbAfter = probeTipAfter.distanceTo(probeThumbTipWorld);

  // Restore exact rest pose immediately
  indexProximal.quaternion.copy(savedIndexQuat);
  armature.updateMatrixWorld(true);

  const spreadSign: 1 | -1 = distToThumbAfter < distToThumbBefore ? -1 : 1;

  return { curlSign, spreadSign };
}

/**
 * Applies the one-time anatomical rest-pose calibration to each finger chain and
 * establishes clean baseline separation between the two hands so that the rest pose
 * itself is anatomically natural and free of finger splaying or hand-to-hand mesh overlap.
 */
function applyAnatomicalRestPoseCalibration(
  cluster: DiscoveredHandCluster,
  classified: Record<FingerName, readonly THREE.Bone[]>,
  curlSign: 1 | -1,
  spreadSign: 1 | -1,
): void {
  if (cluster.armatureRoot.userData.__handRestCalibrated) return;

  const sideCalibration = ANATOMICAL_REST_CALIBRATION[cluster.side];
  for (const fingerName of FINGER_NAMES) {
    const chain = classified[fingerName];
    const adjustments = sideCalibration[fingerName];
    for (let i = 0; i < chain.length && i < adjustments.length; i++) {
      const bone = chain[i]!;
      const adj = adjustments[i]!;
      probeEuler.set(
        adj.curl * DEG2RAD * curlSign,
        adj.twist * DEG2RAD,
        adj.spread * DEG2RAD * spreadSign,
        "XYZ",
      );
      probeDeltaQuat.setFromEuler(probeEuler);
      bone.quaternion.multiply(probeDeltaQuat);
    }
  }

  // Eliminate the 11.4 cm raw GLB rest-pose fingertip interpenetration between r_hand and l_hand
  cluster.armatureRoot.position.x += cluster.side === "left" ? -0.028 : 0.028;
  cluster.armatureRoot.updateMatrixWorld(true);
  cluster.skeleton.update();
  cluster.armatureRoot.userData.__handRestCalibrated = true;
}

function buildMappedHandRig(
  cluster: DiscoveredHandCluster,
  opposingRootWorldPos: THREE.Vector3,
): MappedHandRig | null {
  const classified = classifyFingerChains(cluster.branchChains);
  if (!classified) return null;

  // Ensure SkinnedMesh primitives are never erroneously frustum-culled when bones move
  for (const skinnedMesh of cluster.skinnedMeshes) {
    skinnedMesh.frustumCulled = false;
  }

  const { curlSign, spreadSign } = runEmpiricalAxisProbe(
    cluster.armatureRoot,
    classified,
    opposingRootWorldPos,
  );

  // 1. Repair cross-phalanx skin weights so adjacent fingers do not stretch each other
  const repairedCrossFingerVertices = repairHandSkinWeights(
    cluster.skinnedMeshes,
    cluster.skeleton,
    classified,
  );

  // 2. Calibrate the anatomical rest pose (closing wide GLB finger gaps & aligning hinge axes)
  applyAnatomicalRestPoseCalibration(cluster, classified, curlSign, spreadSign);

  const fingers = {} as Record<FingerName, MappedFingerChain>;
  for (const fingerName of FINGER_NAMES) {
    const rawChain = classified[fingerName];
    fingers[fingerName] = {
      finger: fingerName,
      joints: rawChain.map(createMappedJoint),
    };
  }

  // Compute the verified palm center pivot from the middle finger metacarpal base
  // and proximal knuckle in calibrated rest pose so whole-hand rotations pivot cleanly around the palm.
  const palmWorldRest = new THREE.Vector3();
  const middleJoints = fingers.middle.joints;
  if (middleJoints.length >= 2) {
    const mcBase = new THREE.Vector3();
    const knuckle = new THREE.Vector3();
    middleJoints[0]!.bone.getWorldPosition(mcBase);
    middleJoints[1]!.bone.getWorldPosition(knuckle);
    palmWorldRest.copy(mcBase).lerp(knuckle, 0.65);
  } else {
    cluster.rootBone.getWorldPosition(palmWorldRest);
  }

  const palmLocalPivot = palmWorldRest.clone();
  cluster.armatureRoot.worldToLocal(palmLocalPivot);

  return {
    side: cluster.side,
    curlSign,
    spreadSign,
    armature: cluster.armatureRoot,
    meshContainer: cluster.meshContainer,
    skinnedMeshes: cluster.skinnedMeshes,
    skeleton: cluster.skeleton,
    restPosition: cluster.armatureRoot.position.clone(),
    restQuaternion: cluster.armatureRoot.quaternion.clone(),
    restScale: cluster.armatureRoot.scale.clone(),
    palmWorldRest,
    palmLocalPivot,
    currentPalmWorld: palmWorldRest.clone(),
    currentKnuckleWorld: palmWorldRest.clone(),
    targetPosition: cluster.armatureRoot.position.clone(),
    targetQuaternion: cluster.armatureRoot.quaternion.clone(),
    wristJoint: createMappedJoint(cluster.rootBone),
    fingers,
    repairedCrossFingerVertices,
  };
}

/**
 * Discovers, maps, repairs cross-finger skin weights, and calibrates the anatomical rest pose
 * for both hand rigs in a loaded Three.js scene.
 */
export function discoverAndMapHandPairRig(
  scene: THREE.Object3D,
  enableDiagnostics = false,
): MappedHandPairRig | null {
  const inspection = inspectSceneHandRigs(scene, enableDiagnostics);
  if (!inspection.rightHand || !inspection.leftHand) {
    return null;
  }

  const rightRootPos = new THREE.Vector3();
  const leftRootPos = new THREE.Vector3();
  inspection.rightHand.rootBone.getWorldPosition(rightRootPos);
  inspection.leftHand.rootBone.getWorldPosition(leftRootPos);

  const right = buildMappedHandRig(inspection.rightHand, leftRootPos);
  const left = buildMappedHandRig(inspection.leftHand, rightRootPos);
  if (!right || !left) return null;

  const hasValidSkeleton =
    inspection.rightHand.hasValidSkinning &&
    inspection.leftHand.hasValidSkinning &&
    right.fingers.middle.joints.length >= 3 &&
    left.fingers.middle.joints.length >= 3;

  const contactWorldCenter = new THREE.Vector3()
    .addVectors(right.palmWorldRest, left.palmWorldRest)
    .multiplyScalar(0.5);
  contactWorldCenter.z -= 0.1;

  const receivingPalmWorld = left.palmWorldRest.clone();

  if (enableDiagnostics) {
    console.info(
      formatMappedRigSummary({
        right,
        left,
        inspection,
        hasValidSkeleton,
        contactWorldCenter,
        receivingPalmWorld,
      }),
    );
  }

  return {
    right,
    left,
    inspection,
    hasValidSkeleton,
    contactWorldCenter,
    receivingPalmWorld,
  };
}

export function formatMappedRigSummary(rig: MappedHandPairRig): string {
  const lines: string[] = ["[HandRigMapping] Anatomical finger mapping & skin-weight repair summary:"];
  for (const hand of [rig.right, rig.left]) {
    lines.push(
      `  - ${hand.side.toUpperCase()} Hand (wrist="${hand.wristJoint.name}", curlSign=${hand.curlSign}, spreadSign=${hand.spreadSign}, meshes=${hand.skinnedMeshes.length}, repairedVerts=${hand.repairedCrossFingerVertices}):`,
    );
    for (const fingerName of FINGER_NAMES) {
      const chain = hand.fingers[fingerName];
      lines.push(
        `    ${fingerName.padEnd(6)}: ${chain.joints.map((j) => j.name).join(" -> ")}`,
      );
    }
  }
  return lines.join("\n");
}
