import * as THREE from "three";

export interface BoneDiagnosticNode {
  readonly bone: THREE.Bone;
  readonly name: string;
  readonly parentName: string | null;
  readonly childBoneNames: readonly string[];
  readonly depth: number;
  readonly localPosition: readonly [number, number, number];
  readonly localQuaternion: readonly [number, number, number, number];
  readonly localScale: readonly [number, number, number];
  readonly worldPosition: readonly [number, number, number];
  readonly influencedVertexCount: number;
}

export interface DiscoveredHandCluster {
  /** Inferred anatomical side ('right' or 'left') based on world-space placement and hierarchy. */
  readonly side: "right" | "left";
  /** Top-level transform node for this hand (`r_hand` or `l_hand`). */
  readonly armatureRoot: THREE.Object3D;
  /** Group or Mesh container (`R_Hand` or `L_Hand`). */
  readonly meshContainer: THREE.Object3D;
  /** All SkinnedMesh primitives belonging to this hand (e.g. skin + fingernail primitives). */
  readonly skinnedMeshes: readonly THREE.SkinnedMesh[];
  /** Shared or primary Skeleton instance driving the hand. */
  readonly skeleton: THREE.Skeleton;
  /** Root wrist/palm bone of the skeleton hierarchy. */
  readonly rootBone: THREE.Bone;
  /** Linear bone chains branching from the root bone. */
  readonly branchChains: readonly (readonly THREE.Bone[])[];
  /** Complete diagnostic table for every bone in this hand's skeleton. */
  readonly boneDiagnostics: readonly BoneDiagnosticNode[];
  /** True if every SkinnedMesh has valid `skinIndex` and `skinWeight` attributes connected to this skeleton. */
  readonly hasValidSkinning: boolean;
}

export interface SceneRigInspectionResult {
  readonly rightHand: DiscoveredHandCluster | null;
  readonly leftHand: DiscoveredHandCluster | null;
  readonly allClusters: readonly DiscoveredHandCluster[];
  readonly animationClipCount: number;
}

const scratchWorldPos = new THREE.Vector3();

function round3(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function findRootBone(skeleton: THREE.Skeleton): THREE.Bone | null {
  const boneSet = new Set<THREE.Object3D>(skeleton.bones);
  for (const bone of skeleton.bones) {
    if (!bone.parent || !boneSet.has(bone.parent)) {
      return bone;
    }
  }
  return skeleton.bones[0] ?? null;
}

function computeBoneDepth(bone: THREE.Bone, rootBone: THREE.Bone): number {
  let depth = 0;
  let current: THREE.Object3D | null = bone;
  while (current && current !== rootBone && depth < 32) {
    depth += 1;
    current = current.parent;
  }
  return depth;
}

function traceBranchChains(rootBone: THREE.Bone, validBones: Set<THREE.Object3D>): THREE.Bone[][] {
  const directBoneChildren = rootBone.children.filter(
    (child): child is THREE.Bone => Boolean((child as THREE.Bone).isBone && validBones.has(child)),
  );

  return directBoneChildren.map((branchStart) => {
    const chain: THREE.Bone[] = [branchStart];
    let current: THREE.Bone = branchStart;
    while (current.children.length > 0 && chain.length < 16) {
      const nextBone = current.children.find(
        (child): child is THREE.Bone => Boolean((child as THREE.Bone).isBone && validBones.has(child)),
      );
      if (!nextBone) break;
      chain.push(nextBone);
      current = nextBone;
    }
    return chain;
  });
}

function countInfluencedVerticesPerJoint(
  skinnedMeshes: readonly THREE.SkinnedMesh[],
  jointCount: number,
): number[] {
  const counts = new Array<number>(jointCount).fill(0);
  for (const mesh of skinnedMeshes) {
    const skinIndexAttr = mesh.geometry.getAttribute("skinIndex");
    const skinWeightAttr = mesh.geometry.getAttribute("skinWeight");
    if (!skinIndexAttr || !skinWeightAttr) continue;

    for (let v = 0; v < skinWeightAttr.count; v++) {
      const weights = [
        skinWeightAttr.getX(v),
        skinWeightAttr.getY(v),
        skinWeightAttr.getZ(v),
        skinWeightAttr.getW(v),
      ];
      const indices = [
        skinIndexAttr.getX(v),
        skinIndexAttr.getY(v),
        skinIndexAttr.getZ(v),
        skinIndexAttr.getW(v),
      ];
      for (let k = 0; k < 4; k++) {
        if ((weights[k] ?? 0) > 1e-4) {
          const jointIdx = Math.round(indices[k] ?? -1);
          if (jointIdx >= 0 && jointIdx < jointCount) {
            counts[jointIdx] = (counts[jointIdx] ?? 0) + 1;
          }
        }
      }
    }
  }
  return counts;
}

function inferHandSide(
  armatureRoot: THREE.Object3D,
  meshContainer: THREE.Object3D,
  rootBoneWorldPos: THREE.Vector3,
): "right" | "left" {
  const combinedName = `${armatureRoot.name} ${meshContainer.name}`.toLowerCase();
  if (/(^|[^a-z])(r_hand|right)/.test(combinedName)) return "right";
  if (/(^|[^a-z])(l_hand|left)/.test(combinedName)) return "left";
  return rootBoneWorldPos.x >= 0 ? "right" : "left";
}

/**
 * Recursively traverses a loaded Three.js scene to discover all hand `SkinnedMesh`
 * primitives, their `Skeleton` instances, bone hierarchies, and skinning validity
 * without relying on predefined bone names.
 */
export function inspectSceneHandRigs(
  scene: THREE.Object3D,
  enableDiagnostics = false,
): SceneRigInspectionResult {
  scene.updateMatrixWorld(true);

  const groupedByRootBone = new Map<THREE.Bone, THREE.SkinnedMesh[]>();
  scene.traverse((object) => {
    const skinned = object as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh || !skinned.skeleton || skinned.skeleton.bones.length === 0) {
      return;
    }
    const rootBone = findRootBone(skinned.skeleton);
    if (!rootBone) return;

    const list = groupedByRootBone.get(rootBone) ?? [];
    list.push(skinned);
    groupedByRootBone.set(rootBone, list);
  });

  const clusters: DiscoveredHandCluster[] = [];

  for (const [rootBone, skinnedMeshes] of groupedByRootBone.entries()) {
    const primaryMesh = skinnedMeshes[0]!;
    const skeleton = primaryMesh.skeleton;
    const boneSet = new Set<THREE.Object3D>(skeleton.bones);

    // Resolve the mesh container (`R_Hand` or `L_Hand` Group) and armature root (`r_hand` or `l_hand`)
    const meshContainer =
      primaryMesh.parent && primaryMesh.parent !== scene ? primaryMesh.parent : primaryMesh;
    const armatureRoot =
      rootBone.parent && rootBone.parent !== scene ? rootBone.parent : meshContainer;

    rootBone.getWorldPosition(scratchWorldPos);
    const side = inferHandSide(armatureRoot, meshContainer, scratchWorldPos);
    const branchChains = traceBranchChains(rootBone, boneSet);
    const vertexCounts = countInfluencedVerticesPerJoint(skinnedMeshes, skeleton.bones.length);

    const boneDiagnostics: BoneDiagnosticNode[] = skeleton.bones.map((bone, jointIndex) => {
      bone.getWorldPosition(scratchWorldPos);
      const childBoneNames = bone.children
        .filter((c): c is THREE.Bone => Boolean((c as THREE.Bone).isBone))
        .map((c) => c.name);
      return {
        bone,
        name: bone.name || `Bone_${jointIndex}`,
        parentName: bone.parent ? bone.parent.name : null,
        childBoneNames,
        depth: computeBoneDepth(bone, rootBone),
        localPosition: [
          round3(bone.position.x),
          round3(bone.position.y),
          round3(bone.position.z),
        ],
        localQuaternion: [
          round3(bone.quaternion.x),
          round3(bone.quaternion.y),
          round3(bone.quaternion.z),
          round3(bone.quaternion.w),
        ],
        localScale: [round3(bone.scale.x), round3(bone.scale.y), round3(bone.scale.z)],
        worldPosition: [
          round3(scratchWorldPos.x),
          round3(scratchWorldPos.y),
          round3(scratchWorldPos.z),
        ],
        influencedVertexCount: vertexCounts[jointIndex] ?? 0,
      };
    });

    const totalInfluenced = vertexCounts.reduce((acc, c) => acc + c, 0);
    const hasValidSkinning =
      skinnedMeshes.length > 0 &&
      branchChains.length >= 5 &&
      totalInfluenced > 0;

    clusters.push({
      side,
      armatureRoot,
      meshContainer,
      skinnedMeshes,
      skeleton,
      rootBone,
      branchChains,
      boneDiagnostics,
      hasValidSkinning,
    });
  }

  let rightHand = clusters.find((c) => c.side === "right") ?? null;
  let leftHand = clusters.find((c) => c.side === "left") ?? null;

  // Fallback if both clusters had identical naming: separate by world X coordinate
  if ((!rightHand || !leftHand) && clusters.length >= 2) {
    const sortedByX = [...clusters].sort(
      (a, b) =>
        b.boneDiagnostics[0]!.worldPosition[0] - a.boneDiagnostics[0]!.worldPosition[0],
    );
    rightHand = sortedByX[0] ?? null;
    leftHand = sortedByX[1] ?? null;
  }

  const result: SceneRigInspectionResult = {
    rightHand,
    leftHand,
    allClusters: clusters,
    animationClipCount: Array.isArray((scene as THREE.Object3D & { animations?: unknown[] }).animations)
      ? ((scene as THREE.Object3D & { animations: unknown[] }).animations.length)
      : 0,
  };

  if (enableDiagnostics) {
    console.info(formatRigDiagnosticReport(result));
  }

  return result;
}

export function formatRigDiagnosticReport(result: SceneRigInspectionResult): string {
  const lines: string[] = [
    `[HandRigInspection] Discovered ${result.allClusters.length} hand skeleton cluster(s), clips=${result.animationClipCount}`,
  ];
  for (const cluster of result.allClusters) {
    lines.push(
      `  - ${cluster.side.toUpperCase()} Hand: armature="${cluster.armatureRoot.name}", container="${cluster.meshContainer.name}", meshes=[${cluster.skinnedMeshes.map((m) => m.name).join(", ")}], rootBone="${cluster.rootBone.name}", totalBones=${cluster.skeleton.bones.length}, validSkinning=${cluster.hasValidSkinning}`,
    );
    cluster.branchChains.forEach((chain, idx) => {
      lines.push(
        `    Branch[${idx}] (${chain.length} bones): ${chain.map((b) => b.name).join(" -> ")}`,
      );
    });
  }
  return lines.join("\n");
}
