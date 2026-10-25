<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { WaterRuntimeKey, type WaterEffect } from "./waterRuntime";
import { createWaterMaterial, disposeWaterMaterial, updateWaterMaterial } from "./waterMaterials";

const runtime = inject(WaterRuntimeKey)!;
if (!runtime) throw new Error("HandWetness requires WaterSystem runtime");
const config = runtime.config;

interface FoamPuff {
  position: THREE.Vector3;
  phase: number;
  size: number;
  radialOrder: number;
}

interface FoamBubble {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  size: number;
}

// Cohesive toon-style cyan/light-blue foam appearance kept subtle so hand motion stays clear
const baseFoamOpacity = THREE.MathUtils.clamp(
  Math.min(runtime.config.foamOpacity, 0.36),
  0.12,
  0.42,
);
const foamCyanColor = new THREE.Color(0x8be9ff);
const foamMaterial = createWaterMaterial(
  "foam",
  0xf4fdff,
  foamCyanColor,
  baseFoamOpacity,
);
foamMaterial.emissive.set(0xb8f2ff);
foamMaterial.emissiveIntensity = 0.1;
const foamPuffCount = THREE.MathUtils.clamp(Math.floor(runtime.config.foamPuffCount), 20, 72);
foamMaterial.vertexColors = true;
foamMaterial.needsUpdate = true;
const foamPuffGeometry = new THREE.SphereGeometry(1, 14, 10);
const foamPuffs = new THREE.InstancedMesh(foamPuffGeometry, foamMaterial, foamPuffCount);
foamPuffs.name = "HandFoamPuffCluster";
foamPuffs.count = foamPuffCount;
foamPuffs.frustumCulled = false;
foamPuffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

const instanceMatrix = new THREE.Matrix4();
const instanceColor = new THREE.Color();
const foamWhiteTint = new THREE.Color(0xf6feff);
const foamCyanTint = new THREE.Color(0x76e4ff);
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const identity = new THREE.Quaternion();
const localContactOffset = new THREE.Vector3();

let foamSeed = 81421;
const foamRandom = (): number => {
  foamSeed = (foamSeed * 16807) % 2147483647;
  return foamSeed / 2147483647;
};

const rawPuffs: FoamPuff[] = Array.from({ length: foamPuffCount }, (_, index) => {
  const vertical = foamRandom() * 2 - 1;
  const angle = foamRandom() * Math.PI * 2;
  const centerBias = index < foamPuffCount * 0.45 ? 0.42 : 0.72;
  const radius = Math.cbrt(foamRandom()) * centerBias;
  const planarRadius = Math.sqrt(1 - vertical * vertical) * radius;
  const sizeRoll = foamRandom();
  // Restrained puff sizes so the cluster stays localized between the palms/fingers without obscuring motion
  const size =
    sizeRoll < 0.22
      ? 0.16 + foamRandom() * 0.03
      : sizeRoll < 0.7
        ? 0.12 + foamRandom() * 0.03
        : 0.09 + foamRandom() * 0.025;
  const pos = new THREE.Vector3(
    Math.cos(angle) * planarRadius,
    vertical * radius * 0.65,
    Math.sin(angle) * planarRadius,
  );
  return {
    position: pos,
    phase: foamRandom() * Math.PI * 2,
    size,
    radialOrder: pos.length(),
  };
});

// Sort puffs from innermost to outermost so as foamIntensity increases,
// puffs appear organically from the palm contact core outward
const foamPuffPool = rawPuffs.sort((a, b) => a.radialOrder - b.radialOrder);

for (let index = 0; index < foamPuffPool.length; index++) {
  const puff = foamPuffPool[index]!;
  const radialTint = THREE.MathUtils.clamp(puff.radialOrder / 0.72, 0, 1);
  const cyanAmount = THREE.MathUtils.clamp(
    0.08 + radialTint * 0.24 + foamRandom() * 0.08,
    0.05,
    0.38,
  );
  instanceColor.copy(foamWhiteTint).lerp(foamCyanTint, cyanAmount);
  foamPuffs.setColorAt(index, instanceColor);
}
if (foamPuffs.instanceColor) foamPuffs.instanceColor.needsUpdate = true;

const bubbleCount = THREE.MathUtils.clamp(Math.floor(runtime.config.foamBubbleCount), 8, 24);
const bubbleGeometry = new THREE.SphereGeometry(0.048, 12, 10);
const bubbleMaterial = createWaterMaterial("foam", 0xf6feff, foamCyanColor, 0.78);
bubbleMaterial.emissive.set(0xc4f5ff);
bubbleMaterial.emissiveIntensity = 0.1;
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
const baseFoamCenter = new THREE.Vector3();
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
  lifetime: 2.2,
  size: 0.65,
}));
const waveInterval = Math.max(1 / 60, Math.min(1 / 30, runtime.config.foamUpdateInterval));
const deterministic = (index: number, offset: number): number =>
  (index * 0.61803398875 + offset) % 1;

function respawnBubble(bubble: FoamBubble, index: number, initial = false): void {
  const random = (offset: number): number =>
    initial ? deterministic(index, offset) : Math.random();
  const footprintX = foamFootprint.x || anchorSize.x;
  const footprintY = foamFootprint.y || anchorSize.y;
  const footprintZ = foamFootprint.z || anchorSize.z;
  const angle = random(0.17) * Math.PI * 2;
  const radius = 0.18 + random(0.43) * 0.42;
  bubble.position.set(
    foamCenter.x + Math.cos(angle) * footprintX * radius * 0.45,
    foamCenter.y + (random(0.71) - 0.46) * footprintY * 0.35,
    foamCenter.z + Math.sin(angle) * footprintZ * radius * 0.45,
  );
  bubble.velocity.set(
    Math.cos(angle) * footprintX * (0.08 + random(0.31) * 0.14),
    footprintY * (0.08 + random(0.57) * 0.1),
    Math.sin(angle) * footprintZ * (0.08 + random(0.83) * 0.14),
  );
  bubble.age = initial ? random(0.29) * 0.55 : 0;
  bubble.lifetime = 1.6 + random(0.91) * 1.1;
  bubble.size = 0.72 + random(0.63) * 0.5;
}

for (let index = 0; index < bubblePool.length; index++) {
  const bubble = bubblePool[index]!;
  respawnBubble(bubble, index, true);
  const cyanAmount = 0.08 + ((index * 7) % 9) * 0.03;
  instanceColor.copy(foamWhiteTint).lerp(foamCyanTint, cyanAmount);
  bubbles.setColorAt(index, instanceColor);
}
if (bubbles.instanceColor) bubbles.instanceColor.needsUpdate = true;

let attachedMesh: THREE.Mesh | null = null;
let previousMaterial: THREE.Material | THREE.Material[] | null = null;
let previousVisibility: boolean | null = null;
let rebuildAccumulator = waveInterval;
let lastResetToken = -1;

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
    if (!hand) continue;

    hand.updateMatrixWorld(true);
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

  if (measureHandBounds(anchor)) {
    handLocalBounds.getSize(targetFoamSize);
    handLocalBounds.getCenter(baseFoamCenter);
  } else {
    targetFoamSize.copy(anchorSize);
    baseFoamCenter.copy(anchorCenter);
  }
  // Restrained coverage around the palm contact seam so foam never covers the backs of the hands
  const coverage = THREE.MathUtils.clamp(runtime.config.foamHandCoverageMultiplier, 0.35, 0.52);
  targetFoamSize.set(
    targetFoamSize.x * coverage * 0.58,
    targetFoamSize.y * coverage * 0.85,
    targetFoamSize.z * coverage * 0.82,
  );
  baseFoamCenter.y += targetFoamSize.y * runtime.config.foamVerticalOffsetFraction;
  foamCenter.copy(baseFoamCenter);
  foamFootprint.copy(targetFoamSize);

  for (let index = 0; index < bubblePool.length; index++) {
    respawnBubble(bubblePool[index]!, index, true);
  }
}

function updateFoamPuffs(time: number, intensity: number): void {
  const clampedIntensity = THREE.MathUtils.clamp(intensity, 0, 1);
  const activeCount = Math.max(
    1,
    Math.ceil(foamPuffPool.length * THREE.MathUtils.smoothstep(clampedIntensity, 0.0, 0.85)),
  );
  foamPuffs.count = activeCount;

  const spreadScale = 0.48 + clampedIntensity * 0.52;
  const footprintX = Math.max(foamFootprint.x * spreadScale, 0.001);
  const footprintY = Math.max(foamFootprint.y * spreadScale, 0.001);
  const footprintZ = Math.max(foamFootprint.z * spreadScale, 0.001);
  const sizeEnvelope = 0.35 + Math.sqrt(clampedIntensity) * 0.65;

  for (let index = 0; index < activeCount; index++) {
    const puff = foamPuffPool[index]!;
    const puffThreshold = (index / foamPuffPool.length) * 0.75;
    const localGrowth = THREE.MathUtils.smoothstep(
      clampedIntensity,
      puffThreshold,
      Math.min(1, puffThreshold + 0.32),
    );
    const drift = Math.sin(time * 0.95 + puff.phase) * 0.015;
    const bob = Math.cos(time * 0.82 + puff.phase * 1.3) * 0.012;
    const pulse = 1 + Math.sin(time * 1.2 + puff.phase * 1.7) * 0.045;
    scratchPosition.set(
      foamCenter.x + puff.position.x * footprintX * 0.5 + drift * footprintX,
      foamCenter.y + puff.position.y * footprintY * 0.5 + bob * footprintY,
      foamCenter.z + puff.position.z * footprintZ * 0.5 + drift * footprintZ * 0.55,
    );
    const radius =
      Math.min(footprintX, footprintY, footprintZ) *
      puff.size *
      pulse *
      sizeEnvelope *
      localGrowth;
    scratchScale.setScalar(Math.max(0.0001, radius));
    instanceMatrix.compose(scratchPosition, identity, scratchScale);
    foamPuffs.setMatrixAt(index, instanceMatrix);
  }
  foamPuffs.instanceMatrix.needsUpdate = true;
}

function updateBubbles(delta: number, intensity: number): void {
  const clampedIntensity = THREE.MathUtils.clamp(intensity, 0, 1);
  const activeBubbles = Math.max(0, Math.round(bubblePool.length * clampedIntensity));
  bubbles.count = activeBubbles;
  if (activeBubbles === 0) return;

  for (let index = 0; index < activeBubbles; index++) {
    const bubble = bubblePool[index]!;
    bubble.age += delta;
    bubble.position.addScaledVector(bubble.velocity, delta);
    bubble.velocity.x += Math.sin(bubble.age * 2.1 + index) * delta * 0.1;
    bubble.velocity.z += Math.cos(bubble.age * 1.8 + index * 0.7) * delta * 0.08;
    if (
      bubble.age >= bubble.lifetime ||
      bubble.position.y > foamCenter.y + foamFootprint.y * 0.5 + anchorSize.y * 0.25 ||
      bubble.position.x < foamCenter.x - foamFootprint.x * 0.55 ||
      bubble.position.x > foamCenter.x + foamFootprint.x * 0.55 ||
      bubble.position.z < foamCenter.z - foamFootprint.z * 0.55 ||
      bubble.position.z > foamCenter.z + foamFootprint.z * 0.55
    ) {
      respawnBubble(bubble, index);
    }

    const lifetime = THREE.MathUtils.clamp(bubble.age / bubble.lifetime, 0, 1);
    const fade = 1 - THREE.MathUtils.smoothstep(lifetime, 0.72, 1);
    const birth = THREE.MathUtils.smoothstep(bubble.age, 0, 0.22);
    const pulse = 0.92 + Math.sin(bubble.age * 2.3 + index * 1.7) * 0.08;
    scratchPosition.copy(bubble.position);
    scratchScale.setScalar(
      bubble.size * pulse * (0.2 + birth * 0.8) * fade * Math.sqrt(clampedIntensity),
    );
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

    if (frame.resetToken !== lastResetToken) {
      lastResetToken = frame.resetToken;
      foamCenter.copy(baseFoamCenter);
      for (let index = 0; index < bubblePool.length; index++) {
        respawnBubble(bubblePool[index]!, index, true);
      }
    }

    const intensity = THREE.MathUtils.clamp(frame.foamIntensity, 0, 1);
    object.visible = Boolean(
      frame.ready && frame.active && attachedMesh && intensity > 0.002,
    );
    if (!object.visible || !attachedMesh) return;

    attachedMesh.updateWorldMatrix(true, false);
    object.matrix.copy(attachedMesh.matrixWorld);
    object.matrixWorldNeedsUpdate = true;

    // Follow the live hand-rubbing contact center in the anchor's local space
    localContactOffset.copy(frame.foamWorldCenter);
    attachedMesh.worldToLocal(localContactOffset);
    foamCenter.copy(baseFoamCenter).lerp(localContactOffset, 0.75);

    foamMaterial.opacity = baseFoamOpacity * (0.25 + intensity * 0.75);
    bubbleMaterial.opacity = 0.78 * intensity;

    updateWaterMaterial(foamMaterial, frame.time);
    updateWaterMaterial(bubbleMaterial, frame.time);
    rebuildAccumulator += frame.delta;
    if (rebuildAccumulator >= waveInterval) {
      rebuildAccumulator %= waveInterval;
      updateFoamPuffs(frame.time, intensity);
    }
    updateBubbles(frame.delta, intensity);
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
onMounted(() => {
  unregister = runtime.register(effect);
});
onUnmounted(() => {
  unregister?.();
  effect.dispose();
});
</script>

<template></template>
