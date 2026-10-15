<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { WaterRuntimeKey, type WaterEffect } from "./waterRuntime";
import { createWaterMaterial, disposeWaterMaterial, updateWaterMaterial } from "./waterMaterials";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("HandWetness requires WaterSystem runtime");

interface FoamPuff {
  position: THREE.Vector3;
  phase: number;
  size: number;
}

interface FoamBubble {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  size: number;
}

// The foam body is an instanced pile of small spheres, not one translucent
// metaball shell. Dense overlap keeps the cloud filled while remaining cheap.
const foamMaterial = createWaterMaterial(
  "foam",
  0xfffeff,
  runtime.config.foamColor,
  runtime.config.foamOpacity,
);
foamMaterial.emissive.set(0xffe8ef);
foamMaterial.emissiveIntensity = 0.12;
const foamPuffCount = THREE.MathUtils.clamp(Math.floor(runtime.config.foamPuffCount), 96, 160);
foamMaterial.vertexColors = true;
foamMaterial.needsUpdate = true;
const foamPuffGeometry = new THREE.SphereGeometry(1, 16, 12);
const foamPuffs = new THREE.InstancedMesh(foamPuffGeometry, foamMaterial, foamPuffCount);
foamPuffs.name = "HandFoamPuffCluster";
foamPuffs.count = foamPuffCount;
foamPuffs.frustumCulled = false;
foamPuffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const instanceMatrix = new THREE.Matrix4();
const instanceColor = new THREE.Color();
const foamWhiteTint = new THREE.Color(0xfffeff);
const foamPinkTint = new THREE.Color(runtime.config.foamColor);
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const identity = new THREE.Quaternion();

let foamSeed = 81421;
const foamRandom = (): number => {
  foamSeed = (foamSeed * 16807) % 2147483647;
  return foamSeed / 2147483647;
};
const foamPuffPool: FoamPuff[] = Array.from({ length: foamPuffCount }, (_, index) => {
  const vertical = foamRandom() * 2 - 1;
  const angle = foamRandom() * Math.PI * 2;
  const centerBias = index < foamPuffCount * 0.35 ? 0.48 : 0.78;
  const radius = Math.cbrt(foamRandom()) * centerBias;
  const planarRadius = Math.sqrt(1 - vertical * vertical) * radius;
  const sizeRoll = foamRandom();
  const size = sizeRoll < 0.22
    ? 0.34 + foamRandom() * 0.07
    : sizeRoll < 0.7
      ? 0.26 + foamRandom() * 0.08
      : 0.19 + foamRandom() * 0.07;
  return {
    position: new THREE.Vector3(
      Math.cos(angle) * planarRadius,
      vertical * radius * 0.72,
      Math.sin(angle) * planarRadius,
    ),
    phase: foamRandom() * Math.PI * 2,
    // Three deterministic size bands create small, medium, and large puffs.
    size,
  };
});
for (let index = 0; index < foamPuffPool.length; index++) {
  const puff = foamPuffPool[index]!;
  const radialTint = THREE.MathUtils.clamp(puff.position.length() / 0.78, 0, 1);
  const pinkAmount = THREE.MathUtils.clamp(0.015 + radialTint * 0.14 + foamRandom() * 0.06, 0.01, 0.22);
  instanceColor.copy(foamWhiteTint).lerp(foamPinkTint, pinkAmount);
  foamPuffs.setColorAt(index, instanceColor);
}
if (foamPuffs.instanceColor) foamPuffs.instanceColor.needsUpdate = true;

const bubbleCount = THREE.MathUtils.clamp(Math.floor(runtime.config.foamBubbleCount), 12, 24);
const bubbleGeometry = new THREE.SphereGeometry(0.065, 12, 10);
const bubbleMaterial = createWaterMaterial("foam", 0xfffeff, runtime.config.foamColor, 0.88);
bubbleMaterial.emissive.set(0xffe8ef);
bubbleMaterial.emissiveIntensity = 0.12;
bubbleMaterial.vertexColors = true;
bubbleMaterial.needsUpdate = true;
const bubbles = new THREE.InstancedMesh(bubbleGeometry, bubbleMaterial, bubbleCount);
bubbles.name = "HandFoamBubblePool";
bubbles.count = bubbleCount;
bubbles.frustumCulled = false;
bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

const object = new THREE.Group();
object.name = "HandFoamEffect";
object.matrixAutoUpdate = false;
object.add(foamPuffs, bubbles);

const anchorSize = new THREE.Vector3(2, 2, 2);
const anchorCenter = new THREE.Vector3();
const foamCenter = new THREE.Vector3();
const foamFootprint = new THREE.Vector3(1, 1, 1);
const handWorldBounds = new THREE.Box3();
const handLocalBounds = new THREE.Box3();
const handBoundsScratch = new THREE.Box3();
const anchorWorldInverse = new THREE.Matrix4();
const targetFoamSize = new THREE.Vector3();

const bubblePool: FoamBubble[] = Array.from({ length: bubbleCount }, () => ({
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  age: 0,
  lifetime: 2.5,
  size: 0.7,
}));
const waveInterval = Math.max(1 / 60, Math.min(1 / 30, runtime.config.foamUpdateInterval));
const deterministic = (index: number, offset: number): number =>
  (index * 0.61803398875 + offset) % 1;

function respawnBubble(bubble: FoamBubble, index: number, initial = false): void {
  const random = (offset: number): number => initial
    ? deterministic(index, offset)
    : Math.random();
  const footprintX = foamFootprint.x || anchorSize.x;
  const footprintY = foamFootprint.y || anchorSize.y;
  const footprintZ = foamFootprint.z || anchorSize.z;
  const angle = random(0.17) * Math.PI * 2;
  const radius = 0.22 + random(0.43) * 0.5;
  bubble.position.set(
    foamCenter.x + Math.cos(angle) * footprintX * radius * 0.5,
    foamCenter.y + (random(0.71) - 0.46) * footprintY * 0.4,
    foamCenter.z + Math.sin(angle) * footprintZ * radius * 0.5,
  );
  bubble.velocity.set(
    Math.cos(angle) * footprintX * (0.1 + random(0.31) * 0.16),
    footprintY * (0.1 + random(0.57) * 0.12),
    Math.sin(angle) * footprintZ * (0.1 + random(0.83) * 0.16),
  );
  bubble.age = initial ? random(0.29) * 0.55 : 0;
  bubble.lifetime = 1.8 + random(0.91) * 1.3;
  bubble.size = 0.85 + random(0.63) * 0.65;
}

for (let index = 0; index < bubblePool.length; index++) {
  const bubble = bubblePool[index]!;
  respawnBubble(bubble, index, true);
  const pinkAmount = 0.02 + ((index * 7) % 9) * 0.025;
  instanceColor.copy(foamWhiteTint).lerp(foamPinkTint, pinkAmount);
  bubbles.setColorAt(index, instanceColor);
}
if (bubbles.instanceColor) bubbles.instanceColor.needsUpdate = true;

let attachedMesh: THREE.Mesh | null = null;
let previousMaterial: THREE.Material | THREE.Material[] | null = null;
let previousVisibility: boolean | null = null;
let rebuildAccumulator = waveInterval;

function detachAnchor(): void {
  if (attachedMesh) {
    if (previousMaterial) attachedMesh.material = previousMaterial;
    if (previousVisibility !== null) attachedMesh.visible = previousVisibility;
  }
  attachedMesh = null;
  previousMaterial = null;
  previousVisibility = null;
}

function measureHandBounds(anchor: THREE.Mesh): boolean {
  let root: THREE.Object3D = anchor;
  while (root.parent) root = root.parent;

  handWorldBounds.makeEmpty();
  for (const name of ["R_Hand", "L_Hand"]) {
    const hand = root.getObjectByName(name);
    if (!(hand instanceof THREE.Mesh)) continue;

    hand.updateWorldMatrix(true, false);
    handBoundsScratch.setFromObject(hand, true);
    handWorldBounds.union(handBoundsScratch);
  }

  if (handWorldBounds.isEmpty()) return false;

  anchorWorldInverse.copy(anchor.matrixWorld).invert();
  handLocalBounds.copy(handWorldBounds).applyMatrix4(anchorWorldInverse);
  return !handLocalBounds.isEmpty();
}

function configureForAnchor(anchor: THREE.Mesh): void {
  anchor.geometry.computeBoundingBox();
  const bounds = anchor.geometry.boundingBox;
  if (!bounds) return;

  bounds.getSize(anchorSize);
  bounds.getCenter(anchorCenter);
  anchor.updateWorldMatrix(true, false);

  // The GLB anchor is a small placement marker. Fit the foam around the actual
  // hand meshes so the palms and fingers sit inside the cloud instead of sizing
  // it only from that marker cube.
  if (measureHandBounds(anchor)) {
    handLocalBounds.getSize(targetFoamSize);
    handLocalBounds.getCenter(foamCenter);
  } else {
    targetFoamSize.copy(anchorSize);
    foamCenter.copy(anchorCenter);
  }
  targetFoamSize.multiplyScalar(runtime.config.foamHandCoverageMultiplier);
  foamCenter.y += targetFoamSize.y * runtime.config.foamVerticalOffsetFraction;
  foamFootprint.copy(targetFoamSize);

  // Reposition the bubble pool if the GLB anchor is replaced or reloaded.
  for (let index = 0; index < bubblePool.length; index++) {
    respawnBubble(bubblePool[index]!, index, true);
  }
}

function updateFoamPuffs(time: number): void {
  const footprintX = Math.max(foamFootprint.x, 0.001);
  const footprintY = Math.max(foamFootprint.y, 0.001);
  const footprintZ = Math.max(foamFootprint.z, 0.001);
  for (let index = 0; index < foamPuffPool.length; index++) {
    const puff = foamPuffPool[index]!;
    const drift = Math.sin(time * 0.72 + puff.phase) * 0.012;
    const bob = Math.cos(time * 0.61 + puff.phase * 1.3) * 0.009;
    const pulse = 1 + Math.sin(time * 0.82 + puff.phase * 1.7) * 0.035;
    scratchPosition.set(
      foamCenter.x + puff.position.x * footprintX * 0.5 + drift * footprintX,
      foamCenter.y + puff.position.y * footprintY * 0.5 + bob * footprintY,
      foamCenter.z + puff.position.z * footprintZ * 0.5 + drift * footprintZ * 0.55,
    );
    const radius = Math.min(footprintX, footprintY, footprintZ) * puff.size * pulse;
    scratchScale.setScalar(radius);
    instanceMatrix.compose(scratchPosition, identity, scratchScale);
    foamPuffs.setMatrixAt(index, instanceMatrix);
  }
  foamPuffs.instanceMatrix.needsUpdate = true;
}

function updateBubbles(delta: number): void {
  for (let index = 0; index < bubblePool.length; index++) {
    const bubble = bubblePool[index]!;
    bubble.age += delta;
    bubble.position.addScaledVector(bubble.velocity, delta);
    bubble.velocity.x += Math.sin(bubble.age * 2.1 + index) * delta * 0.1;
    bubble.velocity.z += Math.cos(bubble.age * 1.8 + index * 0.7) * delta * 0.08;
    if (
      bubble.age >= bubble.lifetime ||
      bubble.position.y > foamCenter.y + foamFootprint.y * 0.5 + anchorSize.y * 0.3 ||
      bubble.position.x < foamCenter.x - foamFootprint.x * 0.6 ||
      bubble.position.x > foamCenter.x + foamFootprint.x * 0.6 ||
      bubble.position.z < foamCenter.z - foamFootprint.z * 0.6 ||
      bubble.position.z > foamCenter.z + foamFootprint.z * 0.6
    ) {
      respawnBubble(bubble, index);
    }

    const lifetime = THREE.MathUtils.clamp(bubble.age / bubble.lifetime, 0, 1);
    const fade = 1 - THREE.MathUtils.smoothstep(lifetime, 0.72, 1);
    const birth = THREE.MathUtils.smoothstep(bubble.age, 0, 0.22);
    const pulse = 0.92 + Math.sin(bubble.age * 2.3 + index * 1.7) * 0.08;
    scratchPosition.copy(bubble.position);
    scratchScale.setScalar(bubble.size * pulse * (0.2 + birth * 0.8) * fade);
    instanceMatrix.compose(scratchPosition, identity, scratchScale);
    bubbles.setMatrixAt(index, instanceMatrix);
  }
  bubbles.instanceMatrix.needsUpdate = true;
}

const effect: WaterEffect = {
  order: 1,
  object,
  update(frame) {
    const nextMesh = frame.handFoamSurface;
    if (nextMesh !== attachedMesh) {
      detachAnchor();
      if (nextMesh) {
        attachedMesh = nextMesh;
        previousMaterial = nextMesh.material;
        previousVisibility = nextMesh.visible;
        configureForAnchor(nextMesh);
        nextMesh.visible = false;
      }
    }

    object.visible = Boolean(frame.ready && frame.active && attachedMesh);
    if (!object.visible || !attachedMesh) return;

    attachedMesh.updateWorldMatrix(true, false);
    object.matrix.copy(attachedMesh.matrixWorld);
    object.matrixWorldNeedsUpdate = true;
    updateWaterMaterial(foamMaterial, frame.time);
    updateWaterMaterial(bubbleMaterial, frame.time);
    rebuildAccumulator += frame.delta;
    if (rebuildAccumulator >= waveInterval) {
      rebuildAccumulator %= waveInterval;
      updateFoamPuffs(frame.time);
    }
    updateBubbles(frame.delta);
  },
  dispose() {
    detachAnchor();
    foamPuffGeometry.dispose();
    bubbleGeometry.dispose();
    disposeWaterMaterial(bubbleMaterial);
    disposeWaterMaterial(foamMaterial);
  },
};

let unregister: (() => void) | undefined;
onMounted(() => { unregister = runtime.register(effect); });
onUnmounted(() => { unregister?.(); effect.dispose(); });
</script>

<template></template>
