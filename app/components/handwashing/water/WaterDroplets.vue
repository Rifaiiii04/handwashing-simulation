<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import { createWaterDropletSystem } from "~/composables/useWaterParticles";
import { WaterRuntimeKey, type WaterEffect } from "./waterRuntime";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("WaterDroplets requires WaterSystem runtime");

const droplets = createWaterDropletSystem(runtime.config);
const effect: WaterEffect = {
  order: 4,
  object: droplets.object,
  update(frame) {
    droplets.object.visible = frame.ready && frame.active;
    droplets.update(frame);
  },
  dispose: droplets.dispose,
};

let unregister: (() => void) | undefined;
onMounted(() => { unregister = runtime.register(effect); });
onUnmounted(() => { unregister?.(); effect.dispose(); });
</script>

<template></template>
