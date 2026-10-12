<script setup lang="ts">
import { watch } from 'vue'
import * as THREE from 'three'
import { useGLTF } from '@tresjs/cientos'

const { state: model, isLoading } = useGLTF('models/washand.glb')

function createAnimeSinkMaterial(): THREE.MeshToonMaterial {
  // Controlled gradient ramp data texture (discrete 4-tone anime ramp)
  const rampWidth = 256
  const rampData = new Uint8Array(rampWidth)
  for (let i = 0; i < rampWidth; i++) {
    const t = i / (rampWidth - 1)
    if (t < 0.28) {
      rampData[i] = 100 // shadow
    } else if (t < 0.50) {
      rampData[i] = 160 // midtone
    } else if (t < 0.78) {
      rampData[i] = 220 // base
    } else {
      rampData[i] = 255 // highlight
    }
  }
  const gradientMap = new THREE.DataTexture(rampData, rampWidth, 1, THREE.RedFormat)
  gradientMap.minFilter = THREE.NearestFilter
  gradientMap.magFilter = THREE.NearestFilter
  gradientMap.generateMipmaps = false
  gradientMap.needsUpdate = true

  // Porcelain palette colors: base #E8E3D9, highlights #FFF9EF, midtones #D4CEC3, shadows #A6A6A3
  const highlightColor = new THREE.Color('#FFF9EF')
  const baseColor = new THREE.Color('#E8E3D9')
  const midtoneColor = new THREE.Color('#D4CEC3')
  const shadowColor = new THREE.Color('#A6A6A3')

  const material = new THREE.MeshToonMaterial({
    color: baseColor,
    gradientMap: gradientMap,
    side: THREE.DoubleSide,
  })

  // Hook into shader compilation to guarantee precise anime porcelain tonal bands
  // under existing ambient and directional lights without changing global settings
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHighlightColor = { value: highlightColor }
    shader.uniforms.uBaseColor = { value: baseColor }
    shader.uniforms.uMidtoneColor = { value: midtoneColor }
    shader.uniforms.uShadowColor = { value: shadowColor }
    shader.uniforms.uToneThresholds = { value: new THREE.Vector3(-0.25, 0.05, 0.48) }

    shader.fragmentShader = `
      uniform vec3 uHighlightColor;
      uniform vec3 uBaseColor;
      uniform vec3 uMidtoneColor;
      uniform vec3 uShadowColor;
      uniform vec3 uToneThresholds;
    ` + shader.fragmentShader

    const targetChunk = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;'
    const replacementChunk = `
      #if NUM_DIR_LIGHTS > 0
        vec3 N = normalize(geometryNormal);
        vec3 L = normalize(directionalLights[0].direction);
        float NdotL = dot(N, L);

        // Sub-pixel smooth transition for crisp anime cel line without jagged pixel artifacts
        float fEdge = fwidth(NdotL) * 0.75 + 0.002;

        float shadowStep = smoothstep(uToneThresholds.x - fEdge, uToneThresholds.x + fEdge, NdotL);
        float baseStep   = smoothstep(uToneThresholds.y - fEdge, uToneThresholds.y + fEdge, NdotL);
        float highStep   = smoothstep(uToneThresholds.z - fEdge, uToneThresholds.z + fEdge, NdotL);

        vec3 animeTone = mix(uShadowColor, uMidtoneColor, shadowStep);
        animeTone = mix(animeTone, uBaseColor, baseStep);
        animeTone = mix(animeTone, uHighlightColor, highStep);

        vec3 outgoingLight = animeTone + totalEmissiveRadiance;
      #else
        vec3 outgoingLight = uBaseColor + totalEmissiveRadiance;
      #endif
    `
    shader.fragmentShader = shader.fragmentShader.replace(targetChunk, replacementChunk)
  }

  return material
}

watch(
  () => model.value,
  (loaded) => {
    if (!loaded?.scene) return
    loaded.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.name.toLowerCase() === 'sink') {
        ;(child as THREE.Mesh).material = createAnimeSinkMaterial()
      }
    })
  },
  { immediate: true }
)
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
