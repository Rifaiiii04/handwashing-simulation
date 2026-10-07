<script setup lang="ts">
import { useGLTF } from '@tresjs/cientos'

const { state: model, isLoading } = useGLTF('models/washand.glb')
</script>

<template>
  <div class="w-screen h-screen bg-gray-900">
    <div
      v-if="isLoading"
      class="absolute inset-0 z-10 flex items-center justify-center text-white"
    >
      Loading 3D Model...
    </div>

    <TresCanvas v-else clear-color="#111111">
      <TresPerspectiveCamera :position="[0, 1, 5]" :fov="45" />
      <TresAmbientLight :intensity="2" />
      <TresDirectionalLight :position="[5, 5, 5]" :intensity="3" />
      <OrbitControls />
      <primitive v-if="model?.scene" :object="model.scene" />
      <HandwashingWaterSystem />
    </TresCanvas>
  </div>
</template>
