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
const spawnPosition = new THREE.Vector3();
const waterSpawnObject = ref<THREE.Object3D | null>(null);
const isReady = ref(false);
let hasLoggedFound = false;
let hasLoggedNotFound = false;

function findWaterSpawn() {
  if (!scene.value) return;

  const waterSpawn = scene.value.getObjectByName("WaterSpawn");

  if (waterSpawn) {
    waterSpawnObject.value = waterSpawn;
    waterSpawn.getWorldPosition(spawnPosition);
    waterSystem.points.position.copy(spawnPosition);

    isReady.value = true;
    if (!hasLoggedFound) {
      console.log("[WaterSystem] WaterSpawn found");
      hasLoggedFound = true;
    }
  } else if (!hasLoggedNotFound) {
    console.warn("[WaterSystem] WaterSpawn not found in GLB");
    hasLoggedNotFound = true;
  }
}

watch(
  () => scene.value,
  () => findWaterSpawn(),
  { immediate: true },
);

watch(
  () => scene.value,
  (newScene) => {
    if (newScene && !newScene.children.includes(waterSystem.points)) {
      newScene.add(waterSystem.points);
    }
  },
  { immediate: true },
);

const { onBeforeRender } = useLoop();

onBeforeRender(({ delta }) => {
  if (!isReady.value) {
    findWaterSpawn();
    return;
  }

  waterSystem.points.visible = props.active;
  if (!props.active) return;

  if (waterSpawnObject.value) {
    waterSpawnObject.value.getWorldPosition(spawnPosition);
  }

  // Smooth GPU continuous stream update (zero allocations, 60fps)
  waterSystem.update(delta, spawnPosition);
});

onUnmounted(() => {
  if (scene.value) {
    scene.value.remove(waterSystem.points);
  }
  waterSystem.dispose();
  console.log("[WaterSystem] Cleaned up");
});
</script>

<template>
  <slot />
</template>
