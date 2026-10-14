<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { useTres } from "@tresjs/core";
import { useLoop } from "@tresjs/core";
import * as THREE from "three";
import {
  createWaterParticleSystem,
  DEFAULT_WATER_CONFIG,
} from "~/composables/useWaterParticles";
import type { WaterParticleConfig } from "~/composables/useWaterParticles";
import { createWaterCollision } from "~/composables/useWaterCollision";
import type { StreamHit, WaterCollisionSystem } from "~/composables/useWaterCollision";

const props = withDefaults(
  defineProps<{
    config?: Partial<WaterParticleConfig>;
    active?: boolean;
  }>(),
  {
    active: true,
  },
);

const mergedConfig: WaterParticleConfig = {
  ...DEFAULT_WATER_CONFIG,
  ...props.config,
};

const { scene } = useTres();
const waterSystem = createWaterParticleSystem(mergedConfig);
let collisionSystem: WaterCollisionSystem | null = null;

const spawnPosition = new THREE.Vector3();
const waterSpawnObject = ref<THREE.Object3D | null>(null);
const isReady = ref(false);
let hasLoggedFound = false;
let hasLoggedNotFound = false;

function initSystems() {
  if (!scene.value) return;

  // 1. Locate WaterSpawn
  const waterSpawn = scene.value.getObjectByName("WaterSpawn");
  if (waterSpawn) {
    waterSpawnObject.value = waterSpawn;
    waterSpawn.getWorldPosition(spawnPosition);
    waterSystem.points.position.set(0, 0, 0);
    isReady.value = true;

    if (!hasLoggedFound) {
      console.log("[WaterSystem] WaterSpawn found");
      hasLoggedFound = true;
    }
  } else if (!hasLoggedNotFound) {
    console.warn("[WaterSystem] WaterSpawn not found in GLB");
    hasLoggedNotFound = true;
  }

  // 2. Initialize collision system with Hand and Sink objects
  if (!collisionSystem && scene.value) {
    collisionSystem = createWaterCollision(scene.value, ["R_Hand", "L_Hand"], "sink");
  }
}

watch(
  () => scene.value,
  (newScene) => {
    if (!newScene) return;

    initSystems();

    // Attach stream group to scene
    if (!newScene.children.includes(waterSystem.points)) {
      newScene.add(waterSystem.points);
    }
    // Attach splash particles group to scene
    if (!newScene.children.includes(waterSystem.splashPointsGroup)) {
      newScene.add(waterSystem.splashPointsGroup);
    }
  },
  { immediate: true },
);

const { onBeforeRender } = useLoop();

onBeforeRender(({ delta }) => {
  if (!isReady.value) {
    initSystems();
    return;
  }

  const isVisible = props.active;
  waterSystem.points.visible = isVisible;
  waterSystem.splashPointsGroup.visible = isVisible;

  if (!isVisible) return;

  if (waterSpawnObject.value) {
    waterSpawnObject.value.getWorldPosition(spawnPosition);
  }

  // Cast stream ray to detect hand collision, hand exit runoff, and sink basin impact
  let streamHit: StreamHit | undefined = undefined;
  if (collisionSystem) {
    collisionSystem.refreshTargets();
    streamHit = collisionSystem.castStreamRay(spawnPosition, 2.5);
  }

  // Update stream, particles, and collision interactions
  waterSystem.update(delta, spawnPosition, streamHit, collisionSystem ?? undefined);
});

onUnmounted(() => {
  if (scene.value) {
    scene.value.remove(waterSystem.points);
    scene.value.remove(waterSystem.splashPointsGroup);
  }
  waterSystem.dispose();
  collisionSystem = null;
  console.log("[WaterSystem] Cleaned up");
});
</script>

<template>
  <slot />
</template>
