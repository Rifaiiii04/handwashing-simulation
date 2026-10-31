<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState } from "./waterRuntime";
import { createWaterMaterial, disposeWaterMaterial, updateWaterMaterial } from "./waterMaterials";

const runtime = inject(WaterRuntimeKey)!;
if (!runtime) throw new Error("HandWetness requires WaterSystem runtime");

interface FoamPuff {
  side: "left" | "right";
  planarU: number;
  planarV: number;
  normalLift: number;
  phase: number;
  size: number;
  radialOrder: number;
}

interface FoamBubble {
  side: "left" | "right";
  localOffset: THREE.Vector3;
  localVelocity: THREE.Vector3;
  age: number;
  lifetime: number;
  size: number;
}

// Cohesive toon-style white/cyan soap foam appearance kept subtle so hand motion stays clear
const baseFoamOpacity = THREE.MathUtils.clamp(
  Math.min(runtime.config.foamOpacity, 0.42),
  0.18,
  0.45,
);
const foamCyanColor = new THREE.Color(0x9cecff);
const foamMaterial = createWaterMaterial(
  "foam",
  0xf8feff,
  foamCyanColor,
  baseFoamOpacity,
);
foamMaterial.emissive.set(0xcef6ff);
foamMaterial.emissiveIntensity = 0.12;
const foamPuffCount = THREE.MathUtils.clamp(Math.floor(runtime.config.foamPuffCount), 28, 72);
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
const foamWhiteTint = new THREE.Color(0xfaffff);
const foamCyanTint = new THREE.Color(0x88e8ff);
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const identityQuat = new THREE.Quaternion();
const upAxis = new THREE.Vector3(0, 1, 0);
const fallbackRef = new THREE.Vector3(0, 0, -1);
const fallbackAlt = new THREE.Vector3(1, 0, 0);

const leftNormal = new THREE.Vector3(0.4, 0.9, 0.1).normalize();
const leftTangentU = new THREE.Vector3();
const leftTangentV = new THREE.Vector3();
const leftSurfaceOrigin = new THREE.Vector3();

const rightNormal = new THREE.Vector3(-0.4, 0.9, 0.1).normalize();
const rightTangentU = new THREE.Vector3();
const rightTangentV = new THREE.Vector3();
const rightSurfaceOrigin = new THREE.Vector3();

let foamSeed = 81421;
const foamRandom = (): number => {
  foamSeed = (foamSeed * 16807) % 2147483647;
  return foamSeed / 2147483647;
};

const rawPuffs: FoamPuff[] = Array.from({ length: foamPuffCount }, (_, index) => {
  // First 4 puffs seed on the soap-receiving left palm; remaining puffs alternate left/right palms
  const side: "left" | "right" = index < 4 ? "left" : index % 2 === 0 ? "left" : "right";
  const angle = foamRandom() * Math.PI * 2;
  const centerBias = index < foamPuffCount * 0.45 ? 0.58 : 0.95;
  const radius = Math.sqrt(foamRandom()) * centerBias;
  const planarU = Math.cos(angle) * radius;
  const planarV = Math.sin(angle) * radius * 0.85;
  const normalLift = (foamRandom() - 0.35) * 0.35;
  const sizeRoll = foamRandom();
  const size =
    sizeRoll < 0.25
      ? 0.022 + foamRandom() * 0.006
      : sizeRoll < 0.72
        ? 0.017 + foamRandom() * 0.005
        : 0.013 + foamRandom() * 0.004;

  return {
    side,
    planarU,
    planarV,
    normalLift,
    phase: foamRandom() * Math.PI * 2,
    size,
    radialOrder: Math.hypot(planarU, planarV) + (side === "right" ? 0.04 : 0),
  };
});

// Sort puffs from innermost palm core outward so foam spreads organically across both palms
const foamPuffPool = rawPuffs.sort((a, b) => a.radialOrder - b.radialOrder);

for (let index = 0; index < foamPuffPool.length; index++) {
  const puff = foamPuffPool[index]!;
  const radialTint = THREE.MathUtils.clamp(puff.radialOrder / 0.95, 0, 1);
  const cyanAmount = THREE.MathUtils.clamp(
    0.05 + radialTint * 0.18 + foamRandom() * 0.06,
    0.04,
    0.28,
  );
  instanceColor.copy(foamWhiteTint).lerp(foamCyanTint, cyanAmount);
  foamPuffs.setColorAt(index, instanceColor);
}
if (foamPuffs.instanceColor) foamPuffs.instanceColor.needsUpdate = true;

const bubbleCount = THREE.MathUtils.clamp(Math.floor(runtime.config.foamBubbleCount), 10, 24);
const bubbleGeometry = new THREE.SphereGeometry(0.0085, 12, 10);
const bubbleMaterial = createWaterMaterial("foam", 0xfafeff, foamCyanColor, 0.78);
bubbleMaterial.emissive.set(0xd4f7ff);
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
object.add(foamPuffs, bubbles);

const bubblePool: FoamBubble[] = Array.from({ length: bubbleCount }, (_, index) => ({
  side: index % 2 === 0 ? "left" : "right",
  localOffset: new THREE.Vector3(),
  localVelocity: new THREE.Vector3(),
  age: 0,
  lifetime: 1.8,
  size: 0.85,
}));

const waveInterval = Math.max(1 / 60, Math.min(1 / 30, runtime.config.foamUpdateInterval));
const deterministic = (index: number, offset: number): number =>
  (index * 0.61803398875 + offset) % 1;

function buildPalmBasis(
  palmWorld: THREE.Vector3,
  palmNormalInput: THREE.Vector3,
  outOrigin: THREE.Vector3,
  outNormal: THREE.Vector3,
  outU: THREE.Vector3,
  outV: THREE.Vector3,
): void {
  outNormal.copy(palmNormalInput);
  if (outNormal.lengthSq() < 1e-4) {
    outNormal.set(0, 1, 0);
  } else {
    outNormal.normalize();
  }
  const ref = Math.abs(outNormal.dot(fallbackRef)) < 0.9 ? fallbackRef : fallbackAlt;
  outU.crossVectors(outNormal, ref).normalize();
  outV.crossVectors(outNormal, outU).normalize();
  // Offset above the skeletal palm centerline so foam sits right on the palmar skin surface
  outOrigin.copy(palmWorld).addScaledVector(outNormal, 0.016);
}

function respawnBubble(bubble: FoamBubble, index: number, initial = false): void {
  const random = (offset: number): number =>
    initial ? deterministic(index, offset) : Math.random();
  const angle = random(0.17) * Math.PI * 2;
  const radius = (0.012 + random(0.43) * 0.042);
  bubble.side = index % 2 === 0 ? "left" : "right";
  bubble.localOffset.set(
    Math.cos(angle) * radius,
    0.004 + random(0.71) * 0.012,
    Math.sin(angle) * radius * 0.85,
  );
  bubble.localVelocity.set(
    Math.cos(angle) * (0.008 + random(0.31) * 0.012),
    0.005 + random(0.57) * 0.008,
    Math.sin(angle) * (0.008 + random(0.83) * 0.012),
  );
  bubble.age = initial ? random(0.29) * 0.55 : 0;
  bubble.lifetime = 1.4 + random(0.91) * 0.9;
  bubble.size = 0.75 + random(0.63) * 0.55;
}

for (let index = 0; index < bubblePool.length; index++) {
  const bubble = bubblePool[index]!;
  respawnBubble(bubble, index, true);
  const cyanAmount = 0.06 + ((index * 7) % 9) * 0.025;
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

function updateFoamPuffs(frame: WaterFrameState, intensity: number): void {
  const clampedIntensity = THREE.MathUtils.clamp(intensity, 0, 1);
  const activeCount = Math.max(
    1,
    Math.ceil(foamPuffPool.length * THREE.MathUtils.smoothstep(clampedIntensity, 0.0, 0.85)),
  );
  foamPuffs.count = activeCount;

  buildPalmBasis(
    frame.leftPalmWorld,
    frame.leftPalmNormal,
    leftSurfaceOrigin,
    leftNormal,
    leftTangentU,
    leftTangentV,
  );
  buildPalmBasis(
    frame.rightPalmWorld,
    frame.rightPalmNormal,
    rightSurfaceOrigin,
    rightNormal,
    rightTangentU,
    rightTangentV,
  );

  // Tangential spread across each palm surface (from ~28mm early to ~62mm when fully lathered)
  const palmRadiusU = 0.028 + clampedIntensity * 0.036;
  const palmRadiusV = 0.024 + clampedIntensity * 0.030;
  const normalThickness = 0.008 + clampedIntensity * 0.008;
  const sizeEnvelope = 0.55 + Math.sqrt(clampedIntensity) * 0.65;
  const time = frame.time;

  for (let index = 0; index < activeCount; index++) {
    const puff = foamPuffPool[index]!;
    const puffThreshold = (index / foamPuffPool.length) * 0.72;
    const localGrowth = THREE.MathUtils.smoothstep(
      clampedIntensity,
      puffThreshold,
      Math.min(1, puffThreshold + 0.28),
    );

    const isLeft = puff.side === "left";
    const origin = isLeft ? leftSurfaceOrigin : rightSurfaceOrigin;
    const normal = isLeft ? leftNormal : rightNormal;
    const tangentU = isLeft ? leftTangentU : rightTangentU;
    const tangentV = isLeft ? leftTangentV : rightTangentV;

    const swirlU = Math.sin(time * 2.2 + puff.phase) * 0.004;
    const swirlV = Math.cos(time * 2.0 + puff.phase * 1.3) * 0.004;
    const pulse = 1 + Math.sin(time * 2.6 + puff.phase * 1.7) * 0.06;

    const offsetU = puff.planarU * palmRadiusU + swirlU;
    const offsetV = puff.planarV * palmRadiusV + swirlV;
    const offsetN = puff.normalLift * normalThickness;

    scratchPosition
      .copy(origin)
      .addScaledVector(tangentU, offsetU)
      .addScaledVector(tangentV, offsetV)
      .addScaledVector(normal, offsetN);

    const radius = Math.max(0.0005, puff.size * pulse * sizeEnvelope * localGrowth);
    scratchQuat.setFromUnitVectors(upAxis, normal);
    // Flatten puff slightly along the palm normal so foam hugs the palm surface naturally
    scratchScale.set(radius * 1.15, radius * 0.52, radius * 1.15);
    instanceMatrix.compose(scratchPosition, scratchQuat, scratchScale);
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
    bubble.localOffset.addScaledVector(bubble.localVelocity, delta);

    if (
      bubble.age >= bubble.lifetime ||
      Math.hypot(bubble.localOffset.x, bubble.localOffset.z) > 0.062 ||
      bubble.localOffset.y > 0.024
    ) {
      respawnBubble(bubble, index);
    }

    const isLeft = bubble.side === "left";
    const origin = isLeft ? leftSurfaceOrigin : rightSurfaceOrigin;
    const normal = isLeft ? leftNormal : rightNormal;
    const tangentU = isLeft ? leftTangentU : rightTangentU;
    const tangentV = isLeft ? leftTangentV : rightTangentV;

    const lifetime = THREE.MathUtils.clamp(bubble.age / bubble.lifetime, 0, 1);
    const fade = 1 - THREE.MathUtils.smoothstep(lifetime, 0.72, 1);
    const birth = THREE.MathUtils.smoothstep(bubble.age, 0, 0.22);
    const pulse = 0.92 + Math.sin(bubble.age * 2.5 + index * 1.7) * 0.08;

    scratchPosition
      .copy(origin)
      .addScaledVector(tangentU, bubble.localOffset.x)
      .addScaledVector(tangentV, bubble.localOffset.z)
      .addScaledVector(normal, bubble.localOffset.y);

    scratchScale.setScalar(
      Math.max(0.0002, bubble.size * pulse * (0.25 + birth * 0.75) * fade * Math.sqrt(clampedIntensity)),
    );
    instanceMatrix.compose(scratchPosition, identityQuat, scratchScale);
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
        nextMesh.visible = false;
      }
    }

    if (frame.resetToken !== lastResetToken) {
      lastResetToken = frame.resetToken;
      for (let index = 0; index < bubblePool.length; index++) {
        respawnBubble(bubblePool[index]!, index, true);
      }
    }

    const intensity = THREE.MathUtils.clamp(frame.foamIntensity, 0, 1);
    object.visible = Boolean(
      frame.ready && frame.active && attachedMesh && intensity > 0.002,
    );
    if (!object.visible || !attachedMesh) return;

    foamMaterial.opacity = baseFoamOpacity * (0.35 + intensity * 0.65);
    bubbleMaterial.opacity = 0.78 * intensity;

    updateWaterMaterial(foamMaterial, frame.time);
    updateWaterMaterial(bubbleMaterial, frame.time);
    rebuildAccumulator += frame.delta;
    if (rebuildAccumulator >= waveInterval) {
      rebuildAccumulator %= waveInterval;
      updateFoamPuffs(frame, intensity);
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
