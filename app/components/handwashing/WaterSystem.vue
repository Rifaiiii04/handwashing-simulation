<script setup lang="ts">
import { onUnmounted, provide, watch } from "vue";
import { useLoop, useTres } from "@tresjs/core";
import * as THREE from "three";
import FaucetStream from "./water/FaucetStream.vue";
import HandWetness from "./water/HandWetness.vue";
import SinkWaterSurface from "./water/SinkWaterSurface.vue";
import WaterDroplets from "./water/WaterDroplets.vue";
import { DEFAULT_WATER_CONFIG, type WaterSystemConfig } from "./water/waterConfig";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState, type WaterRuntime } from "./water/waterRuntime";

const props = withDefaults(
  defineProps<{
    config?: Partial<WaterSystemConfig>;
    active?: boolean;
  }>(),
  { active: true },
);

const config: WaterSystemConfig = { ...DEFAULT_WATER_CONFIG, ...props.config };
const { scene } = useTres();
let emitter: THREE.Object3D | null = null;
let handFoamSurface: THREE.Mesh | null = null;
let sinkWaterSurface: THREE.Mesh | null = null;
let sinkMesh: THREE.Mesh | null = null;
const streamEndpointLocal = new THREE.Vector3();
let streamReady = false;
let referencesReady = false;
let warnedMissingNodes = false;
const emitterQuaternion = new THREE.Quaternion();
const localEmitterPoint = new THREE.Vector3();
const localFoamPoint = new THREE.Vector3();
const foamBounds = new THREE.Box3();

const frame: WaterFrameState = {
  ready: false,
  active: true,
  delta: 0,
  time: 0,
  origin: new THREE.Vector3(),
  streamDirection: new THREE.Vector3(0, -1, 0),
  streamEnd: new THREE.Vector3(),
  handFoamSurface: null,
  sinkWaterSurface: null,
  splashOrigin: new THREE.Vector3(),
  splashActive: false,
  drainLocalPosition: new THREE.Vector3(),
  drainLocalRadius: 0.08,
};

const effects: WaterEffect[] = [];
const runtime: WaterRuntime = {
  config,
  frame,
  register(effect) {
    effects.push(effect);
    effects.sort((a, b) => a.order - b.order);
    if (effect.object && scene.value && effect.object.parent !== scene.value) {
      scene.value.add(effect.object);
    }
    return () => {
      const index = effects.indexOf(effect);
      if (index !== -1) effects.splice(index, 1);
      if (effect.object?.parent) effect.object.parent.remove(effect.object);
    };
  },
};
provide(WaterRuntimeKey, runtime);

function asMesh(object: THREE.Object3D | undefined): THREE.Mesh | null {
  return object && (object as THREE.Mesh).isMesh ? object as THREE.Mesh : null;
}

function findStreamEndpoint(surface: THREE.Mesh, sourceWorld: THREE.Vector3): boolean {
  const position = surface.geometry.getAttribute("position");
  if (!position || position.count === 0) return false;
  surface.geometry.computeBoundingBox();
  if (!surface.geometry.boundingBox) return false;

  localEmitterPoint.copy(sourceWorld);
  surface.worldToLocal(localEmitterPoint);

  let nearestDistanceSq = Infinity;
  for (let index = 0; index < position.count; index++) {
    const dx = position.getX(index) - localEmitterPoint.x;
    const dz = position.getZ(index) - localEmitterPoint.z;
    nearestDistanceSq = Math.min(nearestDistanceSq, dx * dx + dz * dz);
  }

  const bounds = surface.geometry.boundingBox;
  const sampleRadius = Math.max(
    Math.sqrt(nearestDistanceSq) + 0.035,
    Math.min(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 0.075,
  );
  const sampleRadiusSq = sampleRadius * sampleRadius;
  let surfaceY = -Infinity;
  for (let index = 0; index < position.count; index++) {
    const dx = position.getX(index) - localEmitterPoint.x;
    const dz = position.getZ(index) - localEmitterPoint.z;
    if (dx * dx + dz * dz > sampleRadiusSq) continue;
    surfaceY = Math.max(surfaceY, position.getY(index));
  }
  if (!Number.isFinite(surfaceY)) return false;

  streamEndpointLocal.set(localEmitterPoint.x, surfaceY, localEmitterPoint.z);
  return true;
}

function findDrainReference(sink: THREE.Mesh, surface: THREE.Mesh): void {
  const surfacePosition = surface.geometry.getAttribute("position");
  const sinkPosition = sink.geometry.getAttribute("position");
  if (!surfacePosition || surfacePosition.count === 0 || !sinkPosition || sinkPosition.count === 0) return;
  surface.geometry.computeBoundingBox();
  const bounds = surface.geometry.boundingBox;
  if (!bounds) return;

  let lowestY = Infinity;
  for (let index = 0; index < surfacePosition.count; index++) {
    lowestY = Math.min(lowestY, surfacePosition.getY(index));
  }

  let depressionX = 0;
  let depressionZ = 0;
  let depressionCount = 0;
  for (let index = 0; index < surfacePosition.count; index++) {
    if (surfacePosition.getY(index) > lowestY + 0.001) continue;
    depressionX += surfacePosition.getX(index);
    depressionZ += surfacePosition.getZ(index);
    depressionCount++;
  }
  if (depressionCount === 0) return;
  depressionX /= depressionCount;
  depressionZ /= depressionCount;

  let radius = 0;
  const drainBand = lowestY + Math.max(0.2, (bounds.max.y - bounds.min.y) * 0.018);
  for (let index = 0; index < surfacePosition.count; index++) {
    if (surfacePosition.getY(index) > drainBand) continue;
    const dx = surfacePosition.getX(index) - depressionX;
    const dz = surfacePosition.getZ(index) - depressionZ;
    radius = Math.max(radius, Math.hypot(dx, dz));
  }
  frame.drainLocalRadius = Math.max(0.045, radius);

  // The sink mesh's lowest broad horizontal floor is the basin center; use
  // that actual GLB transform for the drain axis, then express it in the
  // water-surface mesh's local coordinates for the shader.
  sink.updateWorldMatrix(true, false);
  surface.updateWorldMatrix(true, false);
  let minWorldY = Infinity;
  let maxWorldY = -Infinity;
  const worldPoint = new THREE.Vector3();
  const floorLevels = new Map<number, { count: number; x: number; y: number; z: number }>();
  for (let index = 0; index < sinkPosition.count; index++) {
    worldPoint.fromBufferAttribute(sinkPosition, index).applyMatrix4(sink.matrixWorld);
    minWorldY = Math.min(minWorldY, worldPoint.y);
    maxWorldY = Math.max(maxWorldY, worldPoint.y);
    const level = Math.round(worldPoint.y * 1000) / 1000;
    const floor = floorLevels.get(level) ?? { count: 0, x: 0, y: 0, z: 0 };
    floor.count++;
    floor.x += worldPoint.x;
    floor.y += worldPoint.y;
    floor.z += worldPoint.z;
    floorLevels.set(level, floor);
  }

  const basinFloorThreshold = minWorldY + (maxWorldY - minWorldY) * 0.2;
  let drainFloor: { count: number; x: number; y: number; z: number } | null = null;
  let drainFloorLevel = Infinity;
  for (const [level, floor] of floorLevels) {
    if (floor.count < 8 || level <= basinFloorThreshold || level >= drainFloorLevel) continue;
    drainFloor = floor;
    drainFloorLevel = level;
  }
  if (drainFloor) {
    worldPoint.set(
      drainFloor.x / drainFloor.count,
      drainFloor.y / drainFloor.count,
      drainFloor.z / drainFloor.count,
    );
    surface.worldToLocal(worldPoint);
    frame.drainLocalPosition.copy(worldPoint);
  } else {
    // Preserve the named water mesh's own depression center if the sink
    // geometry does not expose a broad horizontal basin-floor sample.
    frame.drainLocalPosition.set(depressionX, lowestY, depressionZ);
  }
}

function initSceneReferences(): void {
  const activeScene = scene.value;
  if (!activeScene) return;

  const nextEmitter = activeScene.getObjectByName("WaterSpawn") ?? null;
  const nextFoam = asMesh(activeScene.getObjectByName("HandFoamSurface"));
  const nextWaterSurface = asMesh(activeScene.getObjectByName("SinkWaterSurface"));
  const nextSink = asMesh(activeScene.getObjectByName("sink"));
  if (!nextEmitter || !nextFoam || !nextWaterSurface || !nextSink) {
    frame.ready = false;
    if (!warnedMissingNodes) {
      const missing = [
        !nextEmitter && "WaterSpawn",
        !nextFoam && "HandFoamSurface mesh",
        !nextWaterSurface && "SinkWaterSurface mesh",
        !nextSink && "sink mesh",
      ].filter(Boolean);
      console.warn(`[WaterSystem] Missing required GLB objects: ${missing.join(", ")}`);
      warnedMissingNodes = true;
    }
    return;
  }

  if (
    referencesReady && nextEmitter === emitter && nextFoam === handFoamSurface &&
    nextWaterSurface === sinkWaterSurface && nextSink === sinkMesh
  ) return;

  activeScene.updateMatrixWorld(true);
  emitter = nextEmitter;
  handFoamSurface = nextFoam;
  sinkWaterSurface = nextWaterSurface;
  sinkMesh = nextSink;
  nextFoam.geometry.computeBoundingBox();
  foamBounds.copy(nextFoam.geometry.boundingBox ?? new THREE.Box3());

  nextEmitter.getWorldPosition(frame.origin);
  streamReady = findStreamEndpoint(nextWaterSurface, frame.origin);
  findDrainReference(nextSink, nextWaterSurface);
  frame.handFoamSurface = nextFoam;
  frame.sinkWaterSurface = nextWaterSurface;
  frame.ready = streamReady;
  referencesReady = streamReady;
  warnedMissingNodes = false;

  for (const effect of effects) {
    if (effect.object && effect.object.parent !== activeScene) activeScene.add(effect.object);
  }
}

watch(() => scene.value, initSceneReferences, { immediate: true });

const { onBeforeRender } = useLoop();
onBeforeRender(({ delta }) => {
  if (!frame.ready) initSceneReferences();
  frame.active = props.active;
  frame.delta = Math.min(Math.max(delta, 0), 0.05);
  if (!frame.active) {
    for (const effect of effects) effect.update(frame);
    return;
  }

  frame.time += frame.delta;
  if (emitter && sinkWaterSurface && handFoamSurface) {
    emitter.getWorldPosition(frame.origin);
    emitter.getWorldQuaternion(emitterQuaternion);
    frame.streamDirection.set(0, -1, 0).applyQuaternion(emitterQuaternion).normalize();
    if (frame.streamDirection.y > -0.35) frame.streamDirection.set(0, -1, 0);

    frame.streamEnd.copy(streamEndpointLocal);
    sinkWaterSurface.localToWorld(frame.streamEnd);

    localFoamPoint.copy(frame.origin);
    handFoamSurface.worldToLocal(localFoamPoint);
    const insideFoamFootprint =
      localFoamPoint.x >= foamBounds.min.x && localFoamPoint.x <= foamBounds.max.x &&
      localFoamPoint.z >= foamBounds.min.z && localFoamPoint.z <= foamBounds.max.z;
    frame.splashActive = insideFoamFootprint;
    if (frame.splashActive) {
      localFoamPoint.y = foamBounds.max.y;
      frame.splashOrigin.copy(handFoamSurface.localToWorld(localFoamPoint));
    } else {
      handFoamSurface.getWorldPosition(frame.splashOrigin);
    }
  } else {
    frame.splashActive = false;
  }

  for (const effect of effects) effect.update(frame);
});

onUnmounted(() => {
  for (const effect of effects) {
    if (effect.object?.parent) effect.object.parent.remove(effect.object);
  }
  effects.length = 0;
  emitter = null;
  handFoamSurface = null;
  sinkWaterSurface = null;
  sinkMesh = null;
  frame.handFoamSurface = null;
  frame.sinkWaterSurface = null;
  frame.splashActive = false;
  frame.ready = false;
});
</script>

<template>
  <FaucetStream />
  <HandWetness />
  <SinkWaterSurface />
  <WaterDroplets />
</template>
