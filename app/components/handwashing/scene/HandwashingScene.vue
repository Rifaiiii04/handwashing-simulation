<script setup lang="ts">
import type * as THREE from 'three'
import type { HandwashingSequenceController } from '~/lib/handwashing/controllers/HandwashingSequenceController'
import WaterSystem from '~/components/handwashing/effects/WaterSystem.vue'

defineProps<{
  /** Loaded GLB scene (sink, faucet, hands). */
  modelScene?: THREE.Object3D
  controller: HandwashingSequenceController
}>()

const CLEAR_COLOR = '#cbd9d8'
const CAMERA_POSITION: [number, number, number] = [1.65, 3.15, 3.35]
const CAMERA_TARGET: [number, number, number] = [0, 1.65, -0.6]
</script>

<template>
  <TresCanvas :clear-color="CLEAR_COLOR">
    <TresPerspectiveCamera :position="CAMERA_POSITION" :fov="45" />

    <!-- Studio lighting. The warm key light must stay first: the cel shaders read directionalLights[0]. -->
    <TresDirectionalLight :position="[4.2, 5.0, 2.6]" :intensity="1.55" color="#FFF2E4" />
    <TresAmbientLight :intensity="0.6" color="#E0E7FF" />
    <TresDirectionalLight :position="[-3.5, 3.5, 2.0]" :intensity="0.45" color="#C7D2FE" />
    <TresDirectionalLight :position="[-2.8, 4.6, -3.8]" :intensity="0.55" color="#E2E8F0" />

    <OrbitControls :target="CAMERA_TARGET" :min-distance="0.65" :max-distance="6" />
    <primitive v-if="modelScene" :object="modelScene" />
    <WaterSystem :controller="controller" />
  </TresCanvas>
</template>
