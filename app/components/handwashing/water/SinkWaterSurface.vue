<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { WaterRuntimeKey, type WaterEffect } from "./waterRuntime";
import { createWaterMaterial, disposeWaterMaterial, updateWaterMaterial } from "./waterMaterials";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("SinkWaterSurface requires WaterSystem runtime");

const material = createWaterMaterial("surface", runtime.config.color, runtime.config.deepColor);
const localImpact = new THREE.Vector3();
const worldScale = new THREE.Vector3();
let waterMesh: THREE.Mesh | null = null;
let originalMaterial: THREE.Material | THREE.Material[] | null = null;
let originalGeometry: THREE.BufferGeometry | null = null;
let surfaceGeometry: THREE.BufferGeometry | null = null;
let originalVisibility: boolean | null = null;

function makeSurfaceFromGlb(source: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const position = source.getAttribute("position");
  const sourceIndex = source.index;
  if (!position || !sourceIndex) return null;

  source.computeBoundingBox();
  const bounds = source.boundingBox;
  if (!bounds) return null;

  // The checked-in GLB has a coarse 52-triangle box shell (24 triangles on
  // each pair of X/Z walls and two triangles on each rectangular cap) around
  // a separate 172-triangle bowl surface. Validate that topology signature
  // before removing those shell faces so a changed Blender export is never
  // clipped by a loose bounding-box guess.
  const horizontalPlanes = new Map<number, {
    triangleCount: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }>();
  const coord = (vertex: number, axis: number): number =>
    axis === 0 ? position.getX(vertex) : axis === 1 ? position.getY(vertex) : position.getZ(vertex);

  for (let offset = 0; offset < sourceIndex.count; offset += 3) {
    const a = sourceIndex.getX(offset);
    const b = sourceIndex.getX(offset + 1);
    const c = sourceIndex.getX(offset + 2);
    if (Math.abs(position.getY(a) - position.getY(b)) > 1e-4 || Math.abs(position.getY(a) - position.getY(c)) > 1e-4) continue;
    const level = Number(position.getY(a).toFixed(4));
    const plane = horizontalPlanes.get(level) ?? {
      triangleCount: 0,
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    };
    plane.triangleCount++;
    for (const vertex of [a, b, c]) {
      plane.minX = Math.min(plane.minX, position.getX(vertex));
      plane.maxX = Math.max(plane.maxX, position.getX(vertex));
      plane.minZ = Math.min(plane.minZ, position.getZ(vertex));
      plane.maxZ = Math.max(plane.maxZ, position.getZ(vertex));
    }
    horizontalPlanes.set(level, plane);
  }

  const capLevels = new Set<number>();
  for (const [level, plane] of horizontalPlanes) {
    const spansBox =
      Math.abs(plane.minX - bounds.min.x) < 1e-4 && Math.abs(plane.maxX - bounds.max.x) < 1e-4 &&
      Math.abs(plane.minZ - bounds.min.z) < 1e-4 && Math.abs(plane.maxZ - bounds.max.z) < 1e-4;
    if (spansBox && plane.triangleCount === 2) capLevels.add(level);
  }

  const retained: number[] = [];
  let sideTriangles = 0;
  let capTriangles = 0;
  for (let offset = 0; offset < sourceIndex.count; offset += 3) {
    const a = sourceIndex.getX(offset);
    const b = sourceIndex.getX(offset + 1);
    const c = sourceIndex.getX(offset + 2);
    const onOuterWall = [0, 2].some((axis) => {
      const lower = axis === 0 ? bounds.min.x : bounds.min.z;
      const upper = axis === 0 ? bounds.max.x : bounds.max.z;
      return [lower, upper].some((edge) =>
        Math.abs(coord(a, axis) - edge) < 1e-4 &&
        Math.abs(coord(b, axis) - edge) < 1e-4 &&
        Math.abs(coord(c, axis) - edge) < 1e-4,
      );
    });
    const horizontalCap =
      Math.abs(position.getY(a) - position.getY(b)) < 1e-4 &&
      Math.abs(position.getY(a) - position.getY(c)) < 1e-4 &&
      capLevels.has(Number(position.getY(a).toFixed(4)));

    if (onOuterWall) {
      sideTriangles++;
    } else if (horizontalCap) {
      capTriangles++;
    } else {
      retained.push(a, b, c);
    }
  }

  if (sideTriangles !== 48 || capTriangles !== 4 || retained.length / 3 !== 172) {
    console.warn(
      `[SinkWaterSurface] Expected the inspected 172-triangle basin plus 52 box-shell triangles; found ${retained.length / 3} basin, ${sideTriangles} wall, and ${capTriangles} cap triangles. Keeping the source mesh unchanged.`,
    );
    return null;
  }

  return refineSurface(source, retained, 3);
}

/** Subdivide only the verified basin triangles, then weld and smooth their normals. */
function refineSurface(
  source: THREE.BufferGeometry,
  sourceIndices: number[],
  levels: number,
): THREE.BufferGeometry {
  const sourcePosition = source.getAttribute("position");
  if (!sourcePosition) return source.clone();

  const remap = new Map<number, number>();
  let positions: number[] = [];
  let indices: number[] = [];
  const copyVertex = (sourceVertex: number): number => {
    const existing = remap.get(sourceVertex);
    if (existing !== undefined) return existing;
    const next = positions.length / 3;
    positions.push(sourcePosition.getX(sourceVertex), sourcePosition.getY(sourceVertex), sourcePosition.getZ(sourceVertex));
    remap.set(sourceVertex, next);
    return next;
  };
  for (let offset = 0; offset < sourceIndices.length; offset += 3) {
    indices.push(
      copyVertex(sourceIndices[offset]!),
      copyVertex(sourceIndices[offset + 1]!),
      copyVertex(sourceIndices[offset + 2]!),
    );
  }

  for (let level = 0; level < levels; level++) {
    const edgeMidpoints = new Map<string, number>();
    const nextIndices: number[] = [];
    const midpoint = (first: number, second: number): number => {
      const low = Math.min(first, second);
      const high = Math.max(first, second);
      const key = `${low}:${high}`;
      const cached = edgeMidpoints.get(key);
      if (cached !== undefined) return cached;

      const next = positions.length / 3;
      const firstOffset = first * 3;
      const secondOffset = second * 3;
      positions.push(
        (positions[firstOffset]! + positions[secondOffset]!) * 0.5,
        (positions[firstOffset + 1]! + positions[secondOffset + 1]!) * 0.5,
        (positions[firstOffset + 2]! + positions[secondOffset + 2]!) * 0.5,
      );
      edgeMidpoints.set(key, next);
      return next;
    };

    for (let offset = 0; offset < indices.length; offset += 3) {
      const a = indices[offset]!;
      const b = indices[offset + 1]!;
      const c = indices[offset + 2]!;
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      nextIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    indices = nextIndices;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // The Blender export may duplicate boundary vertices to preserve hard
  // normals. Weld position-identical vertices before recomputing smooth water
  // normals so the refined triangles do not read as separate flat facets.
  const smoothGeometry = mergeVertices(geometry, 1e-5);
  geometry.dispose();
  smoothGeometry.computeVertexNormals();
  smoothGeometry.computeBoundingBox();
  smoothGeometry.computeBoundingSphere();
  return smoothGeometry;
}

function detachSurface(): void {
  if (waterMesh) {
    if (waterMesh.material === material && originalMaterial) waterMesh.material = originalMaterial;
    if (surfaceGeometry && waterMesh.geometry === surfaceGeometry && originalGeometry) waterMesh.geometry = originalGeometry;
    if (originalVisibility !== null) waterMesh.visible = originalVisibility;
  }
  surfaceGeometry?.dispose();
  surfaceGeometry = null;
  waterMesh = null;
  originalMaterial = null;
  originalGeometry = null;
  originalVisibility = null;
}

const effect: WaterEffect = {
  order: 2,
  update(frame) {
    if (frame.sinkWaterSurface !== waterMesh) {
      detachSurface();
      if (frame.sinkWaterSurface) {
        waterMesh = frame.sinkWaterSurface;
        originalMaterial = waterMesh.material;
        originalGeometry = waterMesh.geometry;
        originalVisibility = waterMesh.visible;
        surfaceGeometry = makeSurfaceFromGlb(originalGeometry);
        if (surfaceGeometry) waterMesh.geometry = surfaceGeometry;
        waterMesh.material = material;
      }
    }
    if (waterMesh && originalVisibility !== null) {
      waterMesh.visible = Boolean(frame.ready && frame.active && originalVisibility);
    }
    if (!frame.ready || !waterMesh) return;

    waterMesh.updateWorldMatrix(true, false);
    localImpact.copy(frame.origin);
    waterMesh.worldToLocal(localImpact);
    waterMesh.getWorldScale(worldScale);
    const amplitude = runtime.config.surfaceWaveWorldAmplitude / Math.max(0.02, Math.abs(worldScale.y));
    const localBounds = surfaceGeometry?.boundingBox ?? originalGeometry?.boundingBox;
    const impactRadius = localBounds
      ? Math.min(localBounds.max.x - localBounds.min.x, localBounds.max.z - localBounds.min.z)
        * runtime.config.surfaceImpactRadiusFraction
      : 0.2;

    updateWaterMaterial(
      material,
      frame.time,
      frame.drainLocalPosition,
      frame.drainLocalRadius,
      localImpact,
      impactRadius,
      amplitude,
    );
  },
  dispose() {
    detachSurface();
    disposeWaterMaterial(material);
  },
};

let unregister: (() => void) | undefined;
onMounted(() => { unregister = runtime.register(effect); });
onUnmounted(() => { unregister?.(); effect.dispose(); });
</script>

<template></template>
