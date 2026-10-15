<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState } from "./waterRuntime";
import { createWaterMaterial, updateWaterMaterialTime } from "./waterMaterials";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("HandWetness requires WaterSystem runtime");

const surfaceRows = 20;
const surfaceColumns = 5;
const surfacePositions = new Float32Array(surfaceRows * surfaceColumns * 3);
const surfaceUvs = new Float32Array(surfaceRows * surfaceColumns * 2);
const surfaceIndices = new Uint16Array((surfaceRows - 1) * (surfaceColumns - 1) * 6);
const surfaceGeometry = new THREE.BufferGeometry();
const surfacePositionAttribute = new THREE.BufferAttribute(surfacePositions, 3).setUsage(THREE.DynamicDrawUsage);
const surfaceNormalAttribute = new THREE.BufferAttribute(new Float32Array(surfacePositions.length), 3).setUsage(THREE.DynamicDrawUsage);
const surfaceUvAttribute = new THREE.BufferAttribute(surfaceUvs, 2);
let surfaceIndex = 0;
for (let row = 0; row < surfaceRows; row++) {
  for (let column = 0; column < surfaceColumns; column++) {
    const vertex = row * surfaceColumns + column;
    surfaceUvs[vertex * 2] = column / (surfaceColumns - 1);
    surfaceUvs[vertex * 2 + 1] = row / (surfaceRows - 1);
    if (row < surfaceRows - 1 && column < surfaceColumns - 1) {
      const a = vertex;
      const b = vertex + 1;
      const c = vertex + surfaceColumns;
      const d = c + 1;
      surfaceIndices[surfaceIndex++] = a; surfaceIndices[surfaceIndex++] = c; surfaceIndices[surfaceIndex++] = b;
      surfaceIndices[surfaceIndex++] = b; surfaceIndices[surfaceIndex++] = c; surfaceIndices[surfaceIndex++] = d;
    }
  }
}
surfaceGeometry.setAttribute("position", surfacePositionAttribute);
surfaceGeometry.setAttribute("normal", surfaceNormalAttribute);
surfaceGeometry.setAttribute("uv", surfaceUvAttribute);
surfaceGeometry.setIndex(new THREE.BufferAttribute(surfaceIndices, 1));
surfaceGeometry.setDrawRange(0, 0);

const runoffSteps = 18;
const runoffSides = 12;
const runoffPositions = new Float32Array((runoffSteps + 1) * runoffSides * 3);
const runoffUvs = new Float32Array((runoffSteps + 1) * runoffSides * 2);
const runoffIndices = new Uint16Array(runoffSteps * runoffSides * 6);
const runoffGeometry = new THREE.BufferGeometry();
const runoffPositionAttribute = new THREE.BufferAttribute(runoffPositions, 3).setUsage(THREE.DynamicDrawUsage);
const runoffNormalAttribute = new THREE.BufferAttribute(new Float32Array(runoffPositions.length), 3).setUsage(THREE.DynamicDrawUsage);
let runoffIndex = 0;
for (let row = 0; row <= runoffSteps; row++) {
  for (let side = 0; side < runoffSides; side++) {
    const vertex = row * runoffSides + side;
    runoffUvs[vertex * 2] = side / runoffSides;
    runoffUvs[vertex * 2 + 1] = row / runoffSteps;
    if (row < runoffSteps) {
      const nextSide = (side + 1) % runoffSides;
      const a = vertex;
      const b = row * runoffSides + nextSide;
      const c = a + runoffSides;
      const d = b + runoffSides;
      runoffIndices[runoffIndex++] = a; runoffIndices[runoffIndex++] = c; runoffIndices[runoffIndex++] = b;
      runoffIndices[runoffIndex++] = b; runoffIndices[runoffIndex++] = c; runoffIndices[runoffIndex++] = d;
    }
  }
}
runoffGeometry.setAttribute("position", runoffPositionAttribute);
runoffGeometry.setAttribute("normal", runoffNormalAttribute);
runoffGeometry.setAttribute("uv", new THREE.BufferAttribute(runoffUvs, 2));
runoffGeometry.setIndex(new THREE.BufferAttribute(runoffIndices, 1));

const material = createWaterMaterial(runtime.config.color, runtime.config.opacity);
const surface = new THREE.Mesh(surfaceGeometry, material);
surface.name = "HandWetnessFlowSurface";
surface.frustumCulled = false;
surface.renderOrder = 2;
const runoff = new THREE.Mesh(runoffGeometry, material);
runoff.name = "HandRunoffStream";
runoff.frustumCulled = false;
runoff.renderOrder = 2;
const object = new THREE.Group();
object.name = "HandWetnessEffect";
object.add(surface, runoff);

const down = new THREE.Vector3(0, -1, 0);
const up = new THREE.Vector3(0, 1, 0);
const tangent = new THREE.Vector3();
const side = new THREE.Vector3();
const center = new THREE.Vector3();
const normal = new THREE.Vector3(0, 1, 0);
const previousDirection = new THREE.Vector3();
const sampleOrigin = new THREE.Vector3();
const samplePoint = new THREE.Vector3();
const sampleNormal = new THREE.Vector3();
const sampleDirection = new THREE.Vector3();
const candidate = new THREE.Vector3();
const offset = new THREE.Vector3();
const landing = new THREE.Vector3();
const basinSample = new THREE.Vector3();
const basinNormal = new THREE.Vector3(0, 1, 0);
const tubeTangent = new THREE.Vector3();
const tubeSide = new THREE.Vector3();
const tubeUp = new THREE.Vector3();
const lastContact = new THREE.Vector3(Infinity, Infinity, Infinity);
const lastRunoffStart = new THREE.Vector3(Infinity, Infinity, Infinity);
const lastRunoffEnd = new THREE.Vector3(Infinity, Infinity, Infinity);
const lastRunoffDirection = new THREE.Vector3(Infinity, Infinity, Infinity);
let lastMesh: THREE.Mesh | null = null;
let lastRevision = -1;
let activeRows = 0;
let hasRunoffPath = false;
const gravity = runtime.config.gravity ?? 9.81;
const surfaceSpeed = 0.34;
const surfaceHalfWidth = 0.026;
const runoffRadius = 0.008;

function buildHandPath(frame: WaterFrameState): boolean {
  const collision = frame.collision;
  const hit = frame.hit;
  const mesh = hit?.hitObject ?? null;
  if (!collision || !mesh || hit?.hitTarget !== "hand") {
    surface.visible = false;
    runoff.visible = false;
    activeRows = 0;
    lastMesh = null;
    lastRevision = -1;
    return false;
  }

  const revision = collision.handSurfaceRevision;
  const changed = mesh !== lastMesh ||
    hit.point.distanceToSquared(lastContact) > 0.000025 ||
    revision !== lastRevision;
  if (changed) {
    lastMesh = mesh;
    lastRevision = revision;
    lastContact.copy(hit.point);
    activeRows = 0;
    normal.copy(hit.normal).normalize();
    tangent.copy(down).addScaledVector(normal, -down.dot(normal));
    if (tangent.lengthSq() < 0.025) tangent.set(0, 0, 1).addScaledVector(normal, -normal.z);
    if (tangent.lengthSq() < 0.001) tangent.set(1, 0, 0).addScaledVector(normal, -normal.x);
    tangent.normalize();
    previousDirection.copy(tangent);
    center.copy(hit.point);

    for (let row = 0; row < surfaceRows; row++) {
      const progress = row / (surfaceRows - 1);
      if (row > 0) {
        const previousOffset = ((row - 1) * surfaceColumns + 2) * 3;
        normal.fromArray(surfaceNormalAttribute.array, previousOffset).normalize();
        tangent.copy(down).addScaledVector(normal, -down.dot(normal));
        if (tangent.lengthSq() < 0.025) tangent.copy(previousDirection);
        else {
          tangent.normalize();
          if (tangent.dot(previousDirection) < 0) tangent.negate();
          tangent.lerp(previousDirection, 0.35).normalize();
        }
        previousDirection.copy(tangent);
        candidate.fromArray(surfacePositions, previousOffset)
          .addScaledVector(normal, -0.002)
          .addScaledVector(tangent, 0.009);
        sampleOrigin.copy(candidate).addScaledVector(normal, 0.045);
        sampleDirection.copy(normal).negate();
        if (!collision.sampleHandSurface(mesh, sampleOrigin, sampleDirection, samplePoint, sampleNormal, 0.09)) break;
        offset.subVectors(samplePoint, candidate);
        offset.addScaledVector(normal, -offset.dot(normal));
        if (offset.lengthSq() > 0.00015) break;
        center.copy(samplePoint);
        normal.copy(sampleNormal).normalize();
      }

      side.crossVectors(tangent, normal).normalize();
      if (side.lengthSq() < 0.01) break;
      let halfWidth = THREE.MathUtils.lerp(surfaceHalfWidth, runoffRadius, progress);
      let rowSampled = false;
      for (let attempt = 0; attempt < 4 && !rowSampled; attempt++) {
        rowSampled = true;
        for (let column = 0; column < surfaceColumns; column++) {
          const across = (column / (surfaceColumns - 1) - 0.5) * 2;
          candidate.copy(center).addScaledVector(side, across * halfWidth);
          if (column === 2) {
            samplePoint.copy(center);
            sampleNormal.copy(normal);
          } else {
            sampleOrigin.copy(candidate).addScaledVector(normal, 0.045);
            offset.copy(normal).negate();
            if (!collision.sampleHandSurface(mesh, sampleOrigin, offset, samplePoint, sampleNormal, 0.09)) {
              rowSampled = false;
              break;
            }
            offset.subVectors(samplePoint, candidate);
            offset.addScaledVector(normal, -offset.dot(normal));
            if (offset.lengthSq() > 0.0001) {
              rowSampled = false;
              break;
            }
          }
          const vertex = row * surfaceColumns + column;
          const vertexOffset = vertex * 3;
          surfacePositions[vertexOffset] = samplePoint.x + sampleNormal.x * 0.002;
          surfacePositions[vertexOffset + 1] = samplePoint.y + sampleNormal.y * 0.002;
          surfacePositions[vertexOffset + 2] = samplePoint.z + sampleNormal.z * 0.002;
          surfaceNormalAttribute.setXYZ(vertex, sampleNormal.x, sampleNormal.y, sampleNormal.z);
        }
        if (!rowSampled) halfWidth *= 0.68;
      }
      if (!rowSampled) break;
      activeRows = row + 1;
      if (row > 0) {
        const along = progress;
        for (let column = 0; column < surfaceColumns; column++) {
          surfaceUvs[(row * surfaceColumns + column) * 2 + 1] = along;
        }
      }
    }

    surfacePositionAttribute.needsUpdate = true;
    surfaceNormalAttribute.needsUpdate = true;
    surfaceUvAttribute.needsUpdate = true;
    surfaceGeometry.setDrawRange(0, Math.max(0, activeRows - 1) * (surfaceColumns - 1) * 6);
    surfaceGeometry.computeBoundingSphere();
  }

  surface.visible = activeRows > 1;
  if (!surface.visible) {
    runoff.visible = false;
    return false;
  }

  const lastCenterOffset = ((activeRows - 1) * surfaceColumns + 2) * 3;
  frame.handExit.fromArray(surfacePositions, lastCenterOffset);
  frame.handFlowDirection.copy(previousDirection);
  landing.copy(frame.handExit);
  const hasUnderBasinSurface = collision.sampleBasinSurface(
    frame.handExit.x,
    frame.handExit.z,
    basinSample,
    basinNormal,
  );
  const basinY = hasUnderBasinSurface ? basinSample.y : collision.drainCenter.y;
  const drop = Math.max(0.015, frame.handExit.y - basinY);
  const flight = Math.sqrt((2 * drop) / gravity);
  const horizontalDistance = surfaceSpeed * flight;
  let hasLanding = false;
  for (let attempt = 0; attempt <= 5; attempt++) {
    const travel = horizontalDistance * (1 - attempt * 0.2);
    landing.set(
      frame.handExit.x + frame.handFlowDirection.x * travel,
      frame.handExit.y,
      frame.handExit.z + frame.handFlowDirection.z * travel,
    );
    if (collision.sampleBasinSurface(landing.x, landing.z, basinSample, basinNormal)) {
      landing.copy(basinSample).addScaledVector(basinNormal, 0.002);
      hasLanding = true;
      break;
    }
  }
  frame.handLanding.copy(hasLanding ? landing : frame.handExit);
  hasRunoffPath = hasLanding && landing.y < frame.handExit.y - 0.008;
  if (hasRunoffPath && (
    frame.handExit.distanceToSquared(lastRunoffStart) > 0.000001 ||
    landing.distanceToSquared(lastRunoffEnd) > 0.000001 ||
    frame.handFlowDirection.distanceToSquared(lastRunoffDirection) > 0.0004
  )) {
    updateRunoffGeometry(frame.handExit, landing, frame.handFlowDirection);
    lastRunoffStart.copy(frame.handExit);
    lastRunoffEnd.copy(landing);
    lastRunoffDirection.copy(frame.handFlowDirection);
  }
  runoff.visible = hasRunoffPath;
  return true;
}

function updateRunoffGeometry(start: THREE.Vector3, end: THREE.Vector3, direction: THREE.Vector3): void {
  const drop = Math.max(0.001, start.y - end.y);
  const launchSpeed = Math.max(0, -direction.y * surfaceSpeed);
  const flight = (Math.sqrt(launchSpeed * launchSpeed + 2 * gravity * drop) - launchSpeed) / gravity;
  for (let row = 0; row <= runoffSteps; row++) {
    const t = row / runoffSteps;
    const time = flight * t;
    const centerX = THREE.MathUtils.lerp(start.x, end.x, t);
    const centerZ = THREE.MathUtils.lerp(start.z, end.z, t);
    const centerY = start.y - launchSpeed * time - 0.5 * gravity * time * time;
    tubeTangent.set(end.x - start.x, -launchSpeed * flight - gravity * flight * flight * t, end.z - start.z).normalize();
    tubeSide.crossVectors(tubeTangent, up);
    if (tubeSide.lengthSq() < 0.001) tubeSide.set(1, 0, 0);
    else tubeSide.normalize();
    tubeUp.crossVectors(tubeSide, tubeTangent).normalize();
    const radius = THREE.MathUtils.lerp(runoffRadius, 0.0055, t);
    for (let segment = 0; segment < runoffSides; segment++) {
      const angle = (segment / runoffSides) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const vertex = row * runoffSides + segment;
      const at = vertex * 3;
      const nx = tubeSide.x * cos + tubeUp.x * sin;
      const ny = tubeSide.y * cos + tubeUp.y * sin;
      const nz = tubeSide.z * cos + tubeUp.z * sin;
      runoffPositions[at] = centerX + nx * radius;
      runoffPositions[at + 1] = centerY + ny * radius;
      runoffPositions[at + 2] = centerZ + nz * radius;
      runoffNormalAttribute.setXYZ(vertex, nx, ny, nz);
    }
  }
  runoffPositionAttribute.needsUpdate = true;
  runoffNormalAttribute.needsUpdate = true;
  runoffGeometry.computeBoundingSphere();
}

const effect: WaterEffect = {
  order: 1,
  object,
  update(frame) {
    object.visible = frame.ready && frame.active;
    frame.hasHandFlow = false;
    if (!object.visible || !buildHandPath(frame)) return;
    frame.hasHandFlow = true;
    updateWaterMaterialTime(material, frame.time);
  },
  dispose() {
    surfaceGeometry.dispose();
    runoffGeometry.dispose();
    material.dispose();
  },
};

let unregister: (() => void) | undefined;
onMounted(() => { unregister = runtime.register(effect); });
onUnmounted(() => { unregister?.(); effect.dispose(); });
</script>

<template></template>
