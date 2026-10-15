<script setup lang="ts">
import { onUnmounted, provide, ref, watch } from "vue";
import { useLoop, useTres } from "@tresjs/core";
import * as THREE from "three";
import FaucetStream from "./water/FaucetStream.vue";
import HandWetness from "./water/HandWetness.vue";
import SinkWaterSurface from "./water/SinkWaterSurface.vue";
import DrainVortex from "./water/DrainVortex.vue";
import WaterDroplets from "./water/WaterDroplets.vue";
import { DEFAULT_WATER_CONFIG, type WaterSystemConfig } from "./water/waterConfig";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState, type WaterRuntime } from "./water/waterRuntime";
import { createWaterCollision, type WaterCollisionSystem } from "~/composables/useWaterCollision";

const props = withDefaults(
  defineProps<{
    config?: Partial<WaterSystemConfig>;
    active?: boolean;
  }>(),
  { active: true },
);

const config: WaterSystemConfig = { ...DEFAULT_WATER_CONFIG, ...props.config };
const { scene } = useTres();
const waterSpawn = ref<THREE.Object3D | null>(null);
let collisionSystem: WaterCollisionSystem | null = null;
let loggedSpawnFound = false;
let loggedSpawnMissing = false;
let loggedReferencesMissing = false;

const frame: WaterFrameState = {
  ready: false,
  active: true,
  delta: 0,
  time: 0,
  origin: new THREE.Vector3(),
  hit: null,
  collision: null,
  handExit: new THREE.Vector3(),
  handLanding: new THREE.Vector3(),
  handFlowDirection: new THREE.Vector3(0, -1, 0),
  hasHandFlow: false,
  basinImpact: new THREE.Vector3(),
  drainEntry: new THREE.Vector3(),
  drainEntryRadius: 0,
  hasDrainEntry: false,
};

const effects: WaterEffect[] = [];
const runtime: WaterRuntime = {
  config,
  frame,
  register(effect) {
    effects.push(effect);
    effects.sort((a, b) => a.order - b.order);
    if (scene.value && effect.object.parent !== scene.value) scene.value.add(effect.object);
    return () => {
      const index = effects.indexOf(effect);
      if (index !== -1) effects.splice(index, 1);
      if (effect.object.parent) effect.object.parent.remove(effect.object);
    };
  },
};
provide(WaterRuntimeKey, runtime);

function initSceneReferences(): void {
  const activeScene = scene.value;
  if (!activeScene) return;
  const emitter = activeScene.getObjectByName("WaterSpawn");
  const rightHand = activeScene.getObjectByName("R_Hand");
  const leftHand = activeScene.getObjectByName("L_Hand");
  const sink = activeScene.getObjectByName("sink");

  if (emitter) {
    waterSpawn.value = emitter;
    if (!loggedSpawnFound) {
      console.info("[WaterSystem] WaterSpawn found");
      loggedSpawnFound = true;
    }
  } else if (!loggedSpawnMissing) {
    console.warn("[WaterSystem] WaterSpawn not found in GLB");
    loggedSpawnMissing = true;
  }

  if (!collisionSystem && emitter && rightHand && leftHand && sink) {
    activeScene.updateMatrixWorld(true);
    collisionSystem = createWaterCollision(activeScene, ["R_Hand", "L_Hand"], "sink");
  } else if ((!rightHand || !leftHand || !sink) && !loggedReferencesMissing) {
    console.warn("[WaterSystem] Waiting for R_Hand, L_Hand, and sink scene references");
    loggedReferencesMissing = true;
  }

  frame.ready = Boolean(emitter && collisionSystem);
  frame.collision = collisionSystem;
  for (const effect of effects) {
    if (effect.object.parent !== activeScene) activeScene.add(effect.object);
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

  const emitter = waterSpawn.value;
  if (emitter) emitter.getWorldPosition(frame.origin);
  if (collisionSystem) {
    collisionSystem.refreshTargets();
    frame.hit = collisionSystem.castStreamRay(frame.origin, 2.5);
  } else {
    frame.hit = null;
  }

  frame.hasHandFlow = false;
  frame.hasDrainEntry = false;
  frame.drainEntryRadius = 0;
  frame.basinImpact.set(0, 0, 0);
  for (const effect of effects) effect.update(frame);
});

onUnmounted(() => {
  for (const effect of effects) {
    if (effect.object.parent) effect.object.parent.remove(effect.object);
  }
  effects.length = 0;
  collisionSystem = null;
  frame.collision = null;
  frame.hit = null;
  frame.ready = false;
});
</script>

<template>
  <FaucetStream />
  <HandWetness />
  <SinkWaterSurface />
  <DrainVortex />
  <WaterDroplets />
</template>
