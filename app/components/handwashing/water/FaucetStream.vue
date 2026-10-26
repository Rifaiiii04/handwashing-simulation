<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import {
  WaterRuntimeKey,
  type WaterEffect,
  type WaterFrameState,
} from "./waterRuntime";
import {
  createWaterMaterial,
  disposeWaterMaterial,
  updateWaterMaterial,
} from "./waterMaterials";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("FaucetStream requires WaterSystem runtime");

const streamRadius = runtime.config.streamRadius;

// 1. Upper stream (faucet spout down to palms or sink surface)
// Clean straight cylinder, smooth laminar gravitational taper, no lateral sway
const upperGeometry = new THREE.CylinderGeometry(
  streamRadius,
  streamRadius,
  1,
  16,
  24,
  true,
);
const streamMaterial = createWaterMaterial(
  "stream",
  runtime.config.color,
  runtime.config.deepColor,
);
const upperMesh = new THREE.Mesh(upperGeometry, streamMaterial);
upperMesh.name = "FaucetWaterStreamUpper";
upperMesh.frustumCulled = false;

// 2. Runoff stream (cascades cleanly from underneath cupped hands down to sink basin)
const runoffGeometry = new THREE.CylinderGeometry(
  streamRadius * 0.9,
  streamRadius * 0.7,
  1,
  16,
  20,
  true,
);
const runoffMesh = new THREE.Mesh(runoffGeometry, streamMaterial);
runoffMesh.name = "FaucetWaterStreamRunoff";
runoffMesh.frustumCulled = false;
runoffMesh.visible = false;

// 3. Impact contact flare (subtle ripple ring right where stream enters the palm pool)
const impactGeometry = new THREE.CylinderGeometry(
  streamRadius * 1.6,
  streamRadius * 0.8,
  0.016,
  18,
  1,
);
const impactMesh = new THREE.Mesh(impactGeometry, streamMaterial);
impactMesh.name = "FaucetWaterStreamImpactFlare";
impactMesh.frustumCulled = false;
impactMesh.visible = false;

// 4. Expanded procedural palm pool + radiating finger webbing streams (menyebar ke sela-sela jari)
function createPalmWaterSpreadGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Vertex 0: Center of the palm pool
  vertices.push(0, 0.007, 0);
  uvs.push(0.5, 0.5);

  // Central pool: 20 perimeter vertices forming an expansive cupped sheet across both palms
  const poolSegments = 20;
  for (let i = 0; i < poolSegments; i++) {
    const angle = (i / poolSegments) * Math.PI * 2;
    const radiusX = 0.135;
    const radiusZ = 0.115;
    const x = Math.sin(angle) * radiusX;
    const z = Math.cos(angle) * radiusZ;
    // Smooth concave cupping conforming to palms
    const y = (x * x * 0.6 + z * z * 0.4) * 0.45;
    vertices.push(x, y, z);
    uvs.push(0.5 + Math.sin(angle) * 0.5, 0.5 + Math.cos(angle) * 0.5);

    const next = (i + 1) % poolSegments;
    indices.push(0, i + 1, next + 1);
  }

  // 10 Radiating ribbons extending forward (-Z) through each finger cleft (sela-sela jari)
  const clefts = [
    // Left hand crevices (thumb-index, index-mid, mid-ring, ring-pinky)
    {
      startAngle: -2.15,
      endX: -0.165,
      endZ: -0.17,
      endY: -0.024,
      width: 0.028,
    },
    {
      startAngle: -2.55,
      endX: -0.115,
      endZ: -0.21,
      endY: -0.038,
      width: 0.026,
    },
    {
      startAngle: -2.85,
      endX: -0.065,
      endZ: -0.225,
      endY: -0.045,
      width: 0.026,
    },
    { startAngle: -3.1, endX: -0.02, endZ: -0.215, endY: -0.042, width: 0.024 },
    // Central cleft between cupped hands
    { startAngle: -3.2, endX: -0.005, endZ: -0.23, endY: -0.048, width: 0.028 },
    { startAngle: 3.2, endX: 0.015, endZ: -0.23, endY: -0.048, width: 0.028 },
    // Right hand crevices (pinky-ring, ring-mid, mid-index, index-thumb)
    { startAngle: 3.1, endX: 0.035, endZ: -0.215, endY: -0.042, width: 0.024 },
    { startAngle: 2.85, endX: 0.08, endZ: -0.225, endY: -0.045, width: 0.026 },
    { startAngle: 2.55, endX: 0.13, endZ: -0.21, endY: -0.038, width: 0.026 },
    { startAngle: 2.15, endX: 0.175, endZ: -0.17, endY: -0.024, width: 0.028 },
  ];

  for (const c of clefts) {
    const startIdx = vertices.length / 3;
    const startX = Math.sin(c.startAngle) * 0.115;
    const startZ = Math.cos(c.startAngle) * 0.098;
    const startY = 0.008;

    const segments = 5;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const px = THREE.MathUtils.lerp(startX, c.endX, t);
      const pz = THREE.MathUtils.lerp(startZ, c.endZ, t);
      const py = THREE.MathUtils.lerp(startY, c.endY, t * t);
      const curWidth = c.width * (1.0 - t * 0.45);

      const dx = c.endX - startX;
      const dz = c.endZ - startZ;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * curWidth;
      const nz = (dx / len) * curWidth;

      vertices.push(px - nx, py, pz - nz);
      uvs.push(0, t);
      vertices.push(px + nx, py, pz + nz);
      uvs.push(1, t);

      if (s < segments) {
        const row = startIdx + s * 2;
        indices.push(row, row + 1, row + 2);
        indices.push(row + 1, row + 3, row + 2);
      }
    }
  }

  geom.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

const handSpreadGeometry = createPalmWaterSpreadGeometry();
const handSpreadMaterial = createWaterMaterial(
  "handSpread",
  runtime.config.color,
  runtime.config.deepColor,
);
const handSpreadMesh = new THREE.Mesh(handSpreadGeometry, handSpreadMaterial);
handSpreadMesh.name = "HandWaterSpreadSheet";
handSpreadMesh.frustumCulled = false;
handSpreadMesh.visible = false;

const object = new THREE.Group();
object.name = "FaucetStreamEffect";
object.add(upperMesh);
object.add(runoffMesh);
object.add(impactMesh);
object.add(handSpreadMesh);

const upAxis = new THREE.Vector3(0, 1, 0);
const scratchDir = new THREE.Vector3();
const scratchCenter = new THREE.Vector3();
const targetUpperEnd = new THREE.Vector3();

function orientCylinder(
  cylinderMesh: THREE.Mesh,
  topPoint: THREE.Vector3,
  bottomPoint: THREE.Vector3,
  radiusScale = 1.0,
): number {
  const length = THREE.MathUtils.clamp(
    topPoint.distanceTo(bottomPoint),
    0.04,
    3.0,
  );
  scratchCenter.addVectors(topPoint, bottomPoint).multiplyScalar(0.5);
  scratchDir.subVectors(topPoint, bottomPoint).normalize();
  if (scratchDir.lengthSq() < 0.001) scratchDir.set(0, 1, 0);

  cylinderMesh.position.copy(scratchCenter);
  cylinderMesh.quaternion.setFromUnitVectors(upAxis, scratchDir);
  cylinderMesh.scale.set(radiusScale, length, radiusScale);
  return length;
}

const effect: WaterEffect = {
  order: 0,
  object,
  update(frame: WaterFrameState) {
    object.visible = frame.ready && frame.active && frame.streamActive;
    if (!object.visible) return;

    // Smoothly blend upper stream endpoint between sink surface and hand impact point
    targetUpperEnd.lerpVectors(
      frame.streamEnd,
      frame.handImpactPoint,
      frame.handContactFactor,
    );
    orientCylinder(upperMesh, frame.origin, targetUpperEnd, 1.0);

    if (frame.handContactFactor > 0.03) {
      // 1. Expansive, dynamic water sheet spreading across palms and between fingers (sela-sela jari)
      handSpreadMesh.visible = true;
      handSpreadMesh.position.set(
        frame.foamWorldCenter.x,
        frame.foamWorldCenter.y + 0.016,
        frame.foamWorldCenter.z - 0.018,
      );
      const dynamicSurge =
        1.0 +
        0.06 * Math.sin(frame.time * 11.0) +
        0.03 * Math.sin(frame.time * 23.0);
      const spreadScale = frame.handContactFactor * dynamicSurge;
      handSpreadMesh.scale.set(spreadScale, spreadScale, spreadScale);

      // 2. Dynamic impact entry ripple
      impactMesh.visible = true;
      impactMesh.position.copy(frame.handImpactPoint);
      impactMesh.rotation.set(0.12, 0, 0);
      const pulseScale =
        frame.handContactFactor * (1.0 + 0.18 * Math.sin(frame.time * 18.0));
      impactMesh.scale.set(pulseScale, 1.0, pulseScale);

      // 3. Runoff stream cascading cleanly from underneath the cupped hands
      runoffMesh.visible = true;
      orientCylinder(
        runoffMesh,
        frame.handRunoffOrigin,
        frame.streamEnd,
        frame.handContactFactor * 0.88,
      );
    } else {
      handSpreadMesh.visible = false;
      impactMesh.visible = false;
      runoffMesh.visible = false;
    }

    updateWaterMaterial(streamMaterial, frame.time);
    updateWaterMaterial(handSpreadMaterial, frame.time);
  },
  dispose() {
    upperGeometry.dispose();
    runoffGeometry.dispose();
    impactGeometry.dispose();
    handSpreadGeometry.dispose();
    disposeWaterMaterial(streamMaterial);
    disposeWaterMaterial(handSpreadMaterial);
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
