<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState } from "./waterRuntime";
import { createWaterMaterial, updateWaterMaterialTime } from "./waterMaterials";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("SinkWaterSurface requires WaterSystem runtime");

const rows = 30;
const columns = 7;
const positions = new Float32Array(rows * columns * 3);
const normals = new Float32Array(rows * columns * 3);
const uvs = new Float32Array(rows * columns * 2);
const indices = new Uint16Array((rows - 1) * (columns - 1) * 6);
const geometry = new THREE.BufferGeometry();
const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
const normalAttribute = new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage);
const uvAttribute = new THREE.BufferAttribute(uvs, 2);
let index = 0;
for (let row = 0; row < rows; row++) {
  for (let column = 0; column < columns; column++) {
    const vertex = row * columns + column;
    uvs[vertex * 2] = column / (columns - 1);
    uvs[vertex * 2 + 1] = row / (rows - 1);
    if (row < rows - 1 && column < columns - 1) {
      const a = vertex;
      const b = vertex + 1;
      const c = vertex + columns;
      const d = c + 1;
      indices[index++] = a; indices[index++] = c; indices[index++] = b;
      indices[index++] = b; indices[index++] = c; indices[index++] = d;
    }
  }
}
geometry.setAttribute("position", positionAttribute);
geometry.setAttribute("normal", normalAttribute);
geometry.setAttribute("uv", uvAttribute);
geometry.setIndex(new THREE.BufferAttribute(indices, 1));
geometry.setDrawRange(0, 0);

const material = createWaterMaterial(runtime.config.color, runtime.config.opacity);
const mesh = new THREE.Mesh(geometry, material);
mesh.name = "SinkWaterSurfaceMesh";
mesh.frustumCulled = false;
mesh.renderOrder = 3;
const object = new THREE.Group();
object.name = "SinkWaterSurfaceEffect";
object.add(mesh);

const route = new THREE.Vector3();
const side = new THREE.Vector3();
const center = new THREE.Vector3();
const normal = new THREE.Vector3(0, 1, 0);
const sample = new THREE.Vector3();
const sampleNormal = new THREE.Vector3(0, 1, 0);
const lastStart = new THREE.Vector3(Infinity, 0, Infinity);
const cachedDrainEntry = new THREE.Vector3();
let activeRows = 0;
let lastEntryDistance = Infinity;
let lastEntryHalfWidth = 0.012;
let cachedDrainEntryRadius = 0;
let cachedHasDrainEntry = false;

function sourcePoint(frame: WaterFrameState): THREE.Vector3 | null {
  if (frame.hasHandFlow) return frame.handLanding;
  if (frame.hit?.hit && frame.hit.hitTarget === "sink") return frame.hit.point;
  if (frame.collision?.sampleBasinSurface(frame.origin.x, frame.origin.z, sample, sampleNormal)) {
    return sample;
  }
  return frame.hit ? frame.hit.basinPoint : null;
}

function rebuild(frame: WaterFrameState, start: THREE.Vector3): void {
  const collision = frame.collision;
  if (!collision) {
    activeRows = 0;
    geometry.setDrawRange(0, 0);
    mesh.visible = false;
    cachedHasDrainEntry = false;
    return;
  }

  const drain = collision.drainCenter;
  route.set(drain.x - start.x, 0, drain.z - start.z);
  const distance = Math.hypot(route.x, route.z);
  if (distance > 0.0001) route.multiplyScalar(1 / distance);
  else route.set(0, 0, -1);
  side.set(-route.z, 0, route.x);

  activeRows = 0;
  cachedHasDrainEntry = false;
  cachedDrainEntryRadius = 0;
  lastEntryDistance = Infinity;
  lastEntryHalfWidth = 0.012;
  for (let row = 0; row < rows; row++) {
    const t = row / (rows - 1);
    const x = THREE.MathUtils.lerp(start.x, drain.x, t);
    const z = THREE.MathUtils.lerp(start.z, drain.z, t);
    if (!collision.sampleBasinSurface(x, z, center, normal)) {
      const toDrain = Math.hypot(x - drain.x, z - drain.z);
      if (toDrain <= collision.drainRadius + 0.025 && activeRows > 1) {
        const lastCenter = ((activeRows - 1) * columns + Math.floor(columns / 2)) * 3;
        cachedDrainEntry.set(positions[lastCenter]!, positions[lastCenter + 1]! + 0.001, positions[lastCenter + 2]!);
        cachedDrainEntryRadius = THREE.MathUtils.clamp(lastEntryHalfWidth, 0.006, collision.drainRadius * 0.55);
        cachedHasDrainEntry = true;
      }
      break;
    }

    const spread = THREE.MathUtils.smoothstep(t, 0.0, 0.12);
    const converge = THREE.MathUtils.smoothstep(t, 0.74, 1.0);
    let halfWidth = THREE.MathUtils.lerp(0.042, 0.068, spread);
    halfWidth = THREE.MathUtils.lerp(halfWidth, 0.010, converge);
    let sampled = false;
    for (let attempt = 0; attempt < 4 && !sampled; attempt++) {
      sampled = true;
      for (let column = 0; column < columns; column++) {
        const across = (column / (columns - 1) - 0.5) * 2;
        const vertex = row * columns + column;
        const offset = vertex * 3;
        if (column === Math.floor(columns / 2)) {
          positions[offset] = center.x + normal.x * 0.0028;
          positions[offset + 1] = center.y + normal.y * 0.0028;
          positions[offset + 2] = center.z + normal.z * 0.0028;
          normals[offset] = normal.x;
          normals[offset + 1] = normal.y;
          normals[offset + 2] = normal.z;
          continue;
        }
        const queryX = x + side.x * across * halfWidth;
        const queryZ = z + side.z * across * halfWidth;
        if (!collision.sampleBasinSurface(queryX, queryZ, sample, sampleNormal)) {
          sampled = false;
          break;
        }
        positions[offset] = sample.x + sampleNormal.x * 0.0028;
        positions[offset + 1] = sample.y + sampleNormal.y * 0.0028;
        positions[offset + 2] = sample.z + sampleNormal.z * 0.0028;
        normals[offset] = sampleNormal.x;
        normals[offset + 1] = sampleNormal.y;
        normals[offset + 2] = sampleNormal.z;
      }
      if (!sampled) halfWidth *= 0.58;
    }
    if (!sampled) {
      // Stop on the last complete cross-section; never bridge an invalid
      // basin sample with a collapsed fan at the rim or over the drain.
      break;
    }
    activeRows = row + 1;
    if (Math.hypot(center.x - drain.x, center.z - drain.z) <= collision.drainRadius + halfWidth + 0.003) {
      cachedDrainEntry.set(
        center.x + normal.x * 0.003,
        center.y + normal.y * 0.003,
        center.z + normal.z * 0.003,
      );
      cachedDrainEntryRadius = THREE.MathUtils.clamp(halfWidth, 0.007, collision.drainRadius * 0.55);
      cachedHasDrainEntry = true;
    }
    lastEntryDistance = Math.hypot(center.x - drain.x, center.z - drain.z);
    lastEntryHalfWidth = halfWidth;
  }

  if (!cachedHasDrainEntry && activeRows > 1 && lastEntryDistance <= collision.drainRadius + 0.025) {
    const lastCenter = ((activeRows - 1) * columns + Math.floor(columns / 2)) * 3;
    cachedDrainEntry.set(positions[lastCenter]!, positions[lastCenter + 1]! + 0.001, positions[lastCenter + 2]!);
    cachedDrainEntryRadius = THREE.MathUtils.clamp(lastEntryHalfWidth, 0.006, collision.drainRadius * 0.55);
    cachedHasDrainEntry = true;
  }

  positionAttribute.needsUpdate = true;
  normalAttribute.needsUpdate = true;
  geometry.setDrawRange(0, Math.max(0, activeRows - 1) * (columns - 1) * 6);
  geometry.computeBoundingSphere();
  mesh.visible = activeRows > 1;
}

const effect: WaterEffect = {
  order: 2,
  object,
  update(frame) {
    object.visible = frame.ready && frame.active;
    frame.hasDrainEntry = false;
    if (!object.visible || !frame.collision) {
      mesh.visible = false;
      return;
    }
    const start = sourcePoint(frame);
    if (!start) {
      mesh.visible = false;
      return;
    }
    frame.basinImpact.copy(start);
    if (start.distanceToSquared(lastStart) > 0.000064) {
      lastStart.copy(start);
      rebuild(frame, start);
    }

    const drain = frame.collision.drainCenter;
    const directSource = frame.hasHandFlow
      ? frame.handLanding
      : frame.hit?.hit && frame.hit.hitTarget === "sink"
        ? frame.hit.point
        : null;
    if (!cachedHasDrainEntry && directSource && Math.hypot(directSource.x - drain.x, directSource.z - drain.z) <= frame.collision.drainRadius + 0.008) {
      cachedDrainEntry.copy(directSource);
      cachedDrainEntryRadius = Math.min(runtime.config.radiusBottom ?? 0.042, frame.collision.drainRadius * 0.45);
      cachedHasDrainEntry = true;
    }
    frame.hasDrainEntry = cachedHasDrainEntry;
    if (cachedHasDrainEntry) {
      frame.drainEntry.copy(cachedDrainEntry);
      frame.drainEntryRadius = cachedDrainEntryRadius;
    }
    mesh.visible = activeRows > 1;
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
