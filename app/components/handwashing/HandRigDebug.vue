<script setup lang="ts">
import { onUnmounted } from "vue";
import { useLoop, useTres } from "@tresjs/core";
import * as THREE from "three";
import type { HandwashingSequenceController } from "~/lib/handwashing/HandwashingSequenceController";
import type { MappedHandPairRig, MappedHandRig } from "~/lib/handwashing/handRigMapping";

const props = defineProps<{ controller: HandwashingSequenceController }>();
const { scene } = useTres();
const overlay = new THREE.Group();
overlay.name = "HandRigDebugOverlay";
overlay.renderOrder = 1000;
let boundRig: MappedHandPairRig | null = null;
let skeletons: THREE.SkeletonHelper[] = [];
let elapsed = 0.1;

const selectedGeometry = new THREE.SphereGeometry(0.016, 12, 8);
const selectedMaterial = new THREE.MeshBasicMaterial({
  color: 0xffea67, depthTest: false, depthWrite: false, toneMapped: false,
  transparent: true, opacity: 0.9,
});
const selected = new THREE.Mesh(selectedGeometry, selectedMaterial);
const axes = new THREE.AxesHelper(0.17);
for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) {
  material.depthTest = false;
  material.depthWrite = false;
  material.transparent = true;
  material.opacity = 0.9;
}
const palmArrows = [0x53d9ff, 0xffb4e4].map(color => {
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.18, color, 0.045, 0.025);
  for (const child of [arrow.line, arrow.cone]) {
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = true;
      material.opacity = 0.85;
    }
  }
  return arrow;
});
overlay.add(selected, axes, ...palmArrows);

function bindHelpers(rig: MappedHandPairRig): void {
  for (const helper of skeletons) {
    helper.removeFromParent();
    helper.dispose();
  }
  skeletons = [rig.right, rig.left].map((hand, index) => {
    const helper = new THREE.SkeletonHelper(hand.armature);
    for (const material of Array.isArray(helper.material) ? helper.material : [helper.material]) {
      material.opacity = 0.65;
      material.depthTest = false;
      material.depthWrite = false;
    }
    helper.renderOrder = 1000;
    helper.setColors(new THREE.Color(index === 0 ? 0x53d9ff : 0xffb4e4), new THREE.Color(0xffffff));
    return helper;
  });
  boundRig = rig;
}

const raycaster = new THREE.Raycaster();
const hits: THREE.Intersection[] = [];
const up = new THREE.Vector3();
const across = new THREE.Vector3();
const forward = new THREE.Vector3();
const center = new THREE.Vector3();
const origin = new THREE.Vector3();
const direction = new THREE.Vector3();
const lowerSurface = new THREE.Vector3();
const upperSurface = new THREE.Vector3();
const point = new THREE.Vector3();
const sampleOffsets: readonly (readonly [number, number])[] = [[0, 0], [-0.025, 0], [0.025, 0], [0, -0.035], [0, 0.035]];

function surfaceFrom(hand: MappedHandRig, from: THREE.Vector3, along: THREE.Vector3, target: THREE.Vector3): boolean {
  raycaster.set(from, along);
  raycaster.near = 0;
  raycaster.far = 1.3;
  hits.length = 0;
  for (const mesh of hand.skinnedMeshes) raycaster.intersectObject(mesh, false, hits);
  if (!hits.length) return false;
  let closest = hits[0]!;
  for (const hit of hits) if (hit.distance < closest.distance) closest = hit;
  target.copy(closest.point);
  return true;
}

function palmSurfaceGap(rig: MappedHandPairRig): number | null {
  // Five rays through the central palm region use the actual deformed meshes.
  // A negative signed result means those sampled facing surfaces overlap;
  // a positive result is NOT proof that fingers/other triangles do not collide.
  up.copy(rig.left.currentPalmNormal);
  if (up.y < 0) up.negate();
  if (Math.abs(up.y) < 0.5) return null;
  forward.copy(rig.left.currentFingerForward).addScaledVector(up, -rig.left.currentFingerForward.dot(up)).normalize();
  across.crossVectors(up, forward).normalize();
  center.addVectors(rig.right.currentPalmWorld, rig.left.currentPalmWorld).multiplyScalar(0.5);
  const rightIsUpper = rig.right.currentPalmWorld.dot(up) > rig.left.currentPalmWorld.dot(up);
  const upper = rightIsUpper ? rig.right : rig.left;
  const lower = rightIsUpper ? rig.left : rig.right;
  for (const hand of [upper, lower]) {
    for (const mesh of hand.skinnedMeshes) mesh.computeBoundingSphere();
  }
  let minimum = Infinity;
  for (const [x, z] of sampleOffsets) {
    point.copy(center).addScaledVector(across, x).addScaledVector(forward, z);
    origin.copy(point).addScaledVector(up, -0.65);
    if (!surfaceFrom(upper, origin, up, upperSurface)) continue;
    origin.copy(point).addScaledVector(up, 0.65);
    direction.copy(up).negate();
    if (!surfaceFrom(lower, origin, direction, lowerSurface)) continue;
    minimum = Math.min(minimum, upperSurface.sub(lowerSurface).dot(up));
  }
  return Number.isFinite(minimum) ? minimum : null;
}

const thumbPoints = [Array.from({ length: 4 }, () => new THREE.Vector3()), Array.from({ length: 4 }, () => new THREE.Vector3())];
const distalScale = new THREE.Vector3();
// Measured maxima of vertices weighted to each terminal bone in washand.glb.
// A GLB terminal joint marks the DIP, not the end of the visible fingertip.
const tipLocalY = [[.45402, .43552, .41136, .37604], [.43194, .40757, .32907, .34465]];
const thumbTipLocalY = [.55280, .47774];
function distalCapCenter(bone: THREE.Bone, tipY: number, radius: number, target: THREE.Vector3): void {
  bone.getWorldScale(distalScale);
  target.set(0, Math.max(0, tipY - radius / Math.max(1e-6, Math.abs(distalScale.y))), 0);
  bone.localToWorld(target);
}
const d1 = new THREE.Vector3();
const d2 = new THREE.Vector3();
const r = new THREE.Vector3();
const c1 = new THREE.Vector3();
const c2 = new THREE.Vector3();
function segmentDistance(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  r.subVectors(p1, p2);
  const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-10 && e <= 1e-10) return p1.distanceTo(p2);
  if (a <= 1e-10) t = THREE.MathUtils.clamp(f / e, 0, 1);
  else {
    const c = d1.dot(r);
    if (e <= 1e-10) s = THREE.MathUtils.clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2), denominator = a * e - b * b;
      s = denominator > 1e-10 ? THREE.MathUtils.clamp((b * f - c * e) / denominator, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

function thumbClearance(rig: MappedHandPairRig): number | null {
  const hands = [rig.right, rig.left];
  for (let side = 0; side < 2; side++) {
    if (hands[side]!.fingers.thumb.joints.length < 3) return null;
    for (let joint = 0; joint < 3; joint++) hands[side]!.fingers.thumb.joints[joint]!.bone.getWorldPosition(thumbPoints[side]![joint]!);
    distalCapCenter(hands[side]!.fingers.thumb.joints[2]!.bone, thumbTipLocalY[side]!, .028, thumbPoints[side]![3]!);
  }
  let minimum = Infinity;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    minimum = Math.min(minimum, segmentDistance(thumbPoints[0]![i]!, thumbPoints[0]![i + 1]!, thumbPoints[1]![j]!, thumbPoints[1]![j + 1]!));
  }
  // Diagnostic capsule estimate, 2.8 scene cm radius per thumb. It covers only
  // thumb-vs-thumb segments, not thumb-vs-palm or the complete skinned surface.
  return minimum - 0.056;
}

const fingerNames = ["index", "middle", "ring", "pinky"] as const;
const fingerPoints = Array.from({ length: 2 }, () => Array.from({ length: 4 }, () =>
  Array.from({ length: 4 }, () => new THREE.Vector3())));
const fingerRadii = [.019, .020, .019, .016];
let closestFingerPair = "";
function fingerClearance(rig: MappedHandPairRig): number | null {
  // Capsules are a cheap warning for interleaving, not a mesh collision solver.
  for (let s = 0; s < 2; s++) {
    const hand = s === 0 ? rig.right : rig.left;
    for (let f = 0; f < 4; f++) {
      const joints = hand.fingers[fingerNames[f]!].joints;
      if (joints.length < 4) return null;
      for (let j = 0; j < 3; j++) joints[j + 1]!.bone.getWorldPosition(fingerPoints[s]![f]![j]!);
      distalCapCenter(joints[3]!.bone, tipLocalY[s]![f]!, fingerRadii[f]!, fingerPoints[s]![f]![3]!);
    }
  }
  let minimum = Infinity;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const distance = segmentDistance(fingerPoints[0]![a]![i]!, fingerPoints[0]![a]![i + 1]!,
        fingerPoints[1]![b]![j]!, fingerPoints[1]![b]![j + 1]!) - fingerRadii[a]! - fingerRadii[b]!;
      if (distance < minimum) {
        minimum = distance;
        closestFingerPair = `Kanan ${fingerNames[a]} / kiri ${fingerNames[b]}`;
      }
    }
  }
  return Number.isFinite(minimum) ? minimum : null;
}

const { onBeforeRender } = useLoop();
const { off } = onBeforeRender(({ delta }) => {
  const debug = props.controller.debug;
  const rig = props.controller.getRig();
  if (!debug.enabled || !rig || !scene.value) {
    if (overlay.parent) props.controller.setDebugMetrics({});
    overlay.removeFromParent();
    for (const helper of skeletons) helper.removeFromParent();
    elapsed = 0.1;
    return;
  }
  if (boundRig !== rig) bindHelpers(rig);
  if (overlay.parent !== scene.value) scene.value.add(overlay);
  for (const helper of skeletons) {
    if (debug.showSkeleton && helper.parent !== scene.value) scene.value.add(helper);
    if (!debug.showSkeleton) helper.removeFromParent();
  }
  const hand = rig[debug.selectedSide];
  const bone = hand.skeleton.bones.find(candidate => candidate.name === debug.selectedBone);
  selected.visible = Boolean(bone);
  axes.visible = debug.showAxes && Boolean(bone);
  if (bone) {
    bone.getWorldPosition(selected.position);
    axes.position.copy(selected.position);
    bone.getWorldQuaternion(axes.quaternion);
  }
  for (const [i, current] of [rig.right, rig.left].entries()) {
    palmArrows[i]!.visible = debug.showAxes;
    palmArrows[i]!.position.copy(current.currentPalmWorld);
    palmArrows[i]!.setDirection(current.currentPalmNormal);
  }
  elapsed += Math.max(0, delta);
  if (elapsed < 0.1) return;
  elapsed = 0;
  const surfaceGap = palmSurfaceGap(rig);
  const thumbGap = thumbClearance(rig);
  const fingerGap = fingerClearance(rig);
  const warnings: string[] = [];
  if (surfaceGap !== null && surfaceGap < 0) warnings.push("Permukaan telapak bertumpuk pada sampel ray; cek tampilan samping.");
  if (thumbGap !== null && thumbGap < 0) warnings.push("Kapsul perkiraan kedua ibu jari bertumpuk; periksa mesh secara visual.");
  if (fingerGap !== null && fingerGap < 0) warnings.push("Perkiraan sela jari bertumpuk; periksa pasangan jari terdekat.");
  props.controller.setDebugMetrics({
    palmCenterDistance: rig.right.currentPalmWorld.distanceTo(rig.left.currentPalmWorld),
    normalAngleDeg: THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(rig.right.currentPalmNormal.dot(rig.left.currentPalmNormal), -1, 1))),
    surfaceGap, thumbClearance: thumbGap, fingerClearance: fingerGap, closestFingerPair, warnings,
  });
}, 100); // After WaterSystem's controller update in the existing render loop.

onUnmounted(() => {
  off();
  props.controller.setDebugMetrics({});
  overlay.removeFromParent();
  for (const helper of skeletons) { helper.removeFromParent(); helper.dispose(); }
  axes.dispose();
  for (const arrow of palmArrows) arrow.dispose();
  selectedGeometry.dispose();
  selectedMaterial.dispose();
});
</script>

<template><TresGroup /></template>
