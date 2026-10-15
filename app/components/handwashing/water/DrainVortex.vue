<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState } from "./waterRuntime";
import { createWaterMaterial, updateWaterMaterialTime } from "./waterMaterials";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("DrainVortex requires WaterSystem runtime");

const rows = 22;
const radialSegments = 20;
const positions = new Float32Array(rows * radialSegments * 3);
const normals = new Float32Array(positions.length);
const uvs = new Float32Array(rows * radialSegments * 2);
const indices = new Uint16Array((rows - 1) * radialSegments * 6);
const geometry = new THREE.BufferGeometry();
const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
const normalAttribute = new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage);
let index = 0;
for (let row = 0; row < rows; row++) {
  for (let segment = 0; segment < radialSegments; segment++) {
    const vertex = row * radialSegments + segment;
    uvs[vertex * 2] = segment / radialSegments;
    uvs[vertex * 2 + 1] = row / (rows - 1);
    if (row < rows - 1) {
      const next = (segment + 1) % radialSegments;
      const a = vertex;
      const b = row * radialSegments + next;
      const c = a + radialSegments;
      const d = b + radialSegments;
      indices[index++] = a; indices[index++] = c; indices[index++] = b;
      indices[index++] = b; indices[index++] = c; indices[index++] = d;
    }
  }
}
geometry.setAttribute("position", positionAttribute);
geometry.setAttribute("normal", normalAttribute);
geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
geometry.setIndex(new THREE.BufferAttribute(indices, 1));

const material = createWaterMaterial(runtime.config.color, runtime.config.opacity);
const mesh = new THREE.Mesh(geometry, material);
mesh.name = "DrainVortexFlow";
mesh.frustumCulled = false;
mesh.renderOrder = 4;
const object = new THREE.Group();
object.name = "DrainVortexEffect";
object.add(mesh);

const up = new THREE.Vector3(0, 1, 0);
const axisTangent = new THREE.Vector3();
const axisSide = new THREE.Vector3();
const axisUp = new THREE.Vector3();

function updateGeometry(frame: WaterFrameState): void {
  const collision = frame.collision;
  const exitY = collision?.drainExitY;
  if (!collision || exitY === null || exitY === undefined || !frame.hasDrainEntry) {
    mesh.visible = false;
    return;
  }

  const drain = collision.drainCenter;
  const radiusAtInlet = THREE.MathUtils.clamp(
    frame.drainEntryRadius || collision.drainRadius * 0.24,
    0.006,
    Math.max(0.006, collision.drainRadius * 0.62),
  );
  const startY = frame.drainEntry.y - 0.001;
  const endY = Math.min(exitY - 0.008, startY - 0.025);
  const turnAngle = Math.PI * 2.0;
  for (let row = 0; row < rows; row++) {
    const t = row / (rows - 1);
    const converge = THREE.MathUtils.smoothstep(t, 0.02, 0.42);
    const swirlRadius = radiusAtInlet * 0.16 * (1 - t);
    const angle = frame.time * 1.6 + t * turnAngle;
    const centerX = THREE.MathUtils.lerp(frame.drainEntry.x, drain.x, converge) + Math.cos(angle) * swirlRadius;
    const centerZ = THREE.MathUtils.lerp(frame.drainEntry.z, drain.z, converge) + Math.sin(angle) * swirlRadius;
    const centerY = THREE.MathUtils.lerp(startY, endY, t);
    const flowRadius = THREE.MathUtils.lerp(radiusAtInlet, Math.max(0.0025, radiusAtInlet * 0.18), t);
    axisTangent.set(-Math.sin(angle) * swirlRadius * turnAngle, endY - startY, Math.cos(angle) * swirlRadius * turnAngle).normalize();
    axisSide.crossVectors(axisTangent, up);
    if (axisSide.lengthSq() < 0.001) axisSide.set(1, 0, 0);
    else axisSide.normalize();
    axisUp.crossVectors(axisSide, axisTangent).normalize();

    for (let segment = 0; segment < radialSegments; segment++) {
      const around = (segment / radialSegments) * Math.PI * 2;
      const cos = Math.cos(around);
      const sin = Math.sin(around);
      const vertex = row * radialSegments + segment;
      const offset = vertex * 3;
      const nx = axisSide.x * cos + axisUp.x * sin;
      const ny = axisSide.y * cos + axisUp.y * sin;
      const nz = axisSide.z * cos + axisUp.z * sin;
      positions[offset] = centerX + nx * flowRadius;
      positions[offset + 1] = centerY + ny * flowRadius;
      positions[offset + 2] = centerZ + nz * flowRadius;
      normals[offset] = nx;
      normals[offset + 1] = ny;
      normals[offset + 2] = nz;
    }
  }
  positionAttribute.needsUpdate = true;
  normalAttribute.needsUpdate = true;
  geometry.computeBoundingSphere();
  mesh.visible = true;
}

const effect: WaterEffect = {
  order: 3,
  object,
  update(frame) {
    object.visible = frame.ready && frame.active;
    if (!object.visible) {
      mesh.visible = false;
      return;
    }
    updateGeometry(frame);
    updateWaterMaterialTime(material, frame.time);
  },
  dispose() {
    geometry.dispose();
    material.dispose();
  },
};

let unregister: (() => void) | undefined;
onMounted(() => { unregister = runtime.register(effect); });
onUnmounted(() => { unregister?.(); effect.dispose(); });
</script>

<template></template>
