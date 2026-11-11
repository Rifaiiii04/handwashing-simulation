<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { useGLTF } from '@tresjs/cientos'
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { HandwashingSequenceController } from '~/lib/handwashing/HandwashingSequenceController'
import { HANDWASHING_SECTIONS, type HandwashingStepSection } from '~/lib/handwashing/handwashingStepsData'
import HandwashingTopbar from '~/components/handwashing/HandwashingTopbar.vue'
import HandwashingStepDock from '~/components/handwashing/HandwashingStepDock.vue'
import HandwashingTipsPanel from '~/components/handwashing/HandwashingTipsPanel.vue'

const { state: model, isLoading } = useGLTF('models/washand.glb')
const controller = new HandwashingSequenceController()
const seqState = controller.state

useHead({
  title: 'Kemenkes RI · Cuci Tangan Pakai Sabun',
  link: [
    { rel: 'icon', type: 'image/png', href: '/logo.png' }
  ]
})

const sections = HANDWASHING_SECTIONS
const activeSectionId = ref<'persiapan' | 'langkah1' | 'langkah2' | 'langkah3' | 'langkah4' | 'langkah5' | 'langkah6'>('persiapan')
const targetEndStageIndex = ref<number | null>(null)
const isTipsOpen = ref(false)

const currentSection = computed<HandwashingStepSection>(() => {
  const found = sections.find((s) => s.id === activeSectionId.value)
  return found || sections[0]!
})

// Automatically keep activeSectionId updated as animation progresses
watch(
  () => seqState.stageIndex,
  (stageIdx) => {
    if (stageIdx <= 1) {
      activeSectionId.value = 'persiapan'
    } else if (stageIdx <= 3) {
      activeSectionId.value = 'langkah1'
    } else if (stageIdx === 4) {
      activeSectionId.value = 'langkah2'
    } else if (stageIdx === 5) {
      activeSectionId.value = 'langkah3'
    } else if (stageIdx === 6) {
      activeSectionId.value = 'langkah4'
    } else if (stageIdx === 7) {
      activeSectionId.value = 'langkah5'
    } else if (stageIdx === 8) {
      activeSectionId.value = 'langkah6'
    }
  }
)

// Section playback end handler: pause smoothly when reaching target end stage
watch(
  [() => seqState.stageIndex, () => seqState.stageProgress],
  ([stageIdx, stageProg]) => {
    if (targetEndStageIndex.value !== null && seqState.isPlaying) {
      if (stageIdx === targetEndStageIndex.value && stageProg >= 0.99) {
        controller.pause()
        targetEndStageIndex.value = null
      }
    }
  }
)

function selectSection(section: HandwashingStepSection) {
  if (!section.enabled) return
  activeSectionId.value = section.id
  // Sections with an authored handoff continue through the destination stage
  // so the release, free-space transfer, and seated contact are visible before
  // the section pauses.
  targetEndStageIndex.value = section.playThroughStageIndex ?? section.endStageIndex
  controller.goToStage(section.startStageIndex, true)
}

function handleReset() {
  targetEndStageIndex.value = null
  activeSectionId.value = 'persiapan'
  controller.reset(false)
}

function handlePrevious() {
  const currentIdx = sections.findIndex((s) => s.id === activeSectionId.value)
  if (currentIdx > 0) {
    const prevSection = sections[currentIdx - 1]
    if (prevSection && prevSection.enabled) {
      selectSection(prevSection)
    }
  }
}

function handleNext() {
  const currentIdx = sections.findIndex((s) => s.id === activeSectionId.value)
  if (currentIdx < sections.length - 1) {
    const nextSection = sections[currentIdx + 1]
    if (nextSection && nextSection.enabled) {
      selectSection(nextSection)
    }
  }
}

function handleTogglePlay() {
  if (seqState.isPlaying) {
    controller.pause()
    targetEndStageIndex.value = null
  } else {
    // If finished or near end of current step, replay from step start
    if (seqState.stageProgress >= 0.99) {
      selectSection(currentSection.value)
    } else {
      controller.play()
    }
  }
}

const cameraPosition = ref<[number, number, number]>([1.65, 3.15, 3.35])
const cameraTarget = ref<[number, number, number]>([0, 1.65, -.6])

/**
 * Subdivide low-poly sink mesh into smooth medium-poly (4,160 triangles),
 * rounding out the 16-sided faceted pedestal cylinder and front corners.
 */
function refineSinkToMediumPoly(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = source.getAttribute('position')
  const idx = source.index
  if (!pos || !idx) return source

  let positions: number[] = []
  for (let i = 0; i < pos.count; i++) {
    positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
  }
  let indices: number[] = []
  for (let i = 0; i < idx.count; i++) {
    indices.push(idx.getX(i))
  }

  // 2 subdivision passes: transforms 16-sided cylinder to 64-sided smooth column
  for (let pass = 0; pass < 2; pass++) {
    const edgeMap = new Map<string, number>()
    const nextPositions = [...positions]

    const getMidpoint = (i1: number, i2: number): number => {
      const min = Math.min(i1, i2)
      const max = Math.max(i1, i2)
      const key = `${min}:${max}`
      const cached = edgeMap.get(key)
      if (cached !== undefined) return cached

      const x1 = positions[i1 * 3]!
      const y1 = positions[i1 * 3 + 1]!
      const z1 = positions[i1 * 3 + 2]!
      const x2 = positions[i2 * 3]!
      const y2 = positions[i2 * 3 + 1]!
      const z2 = positions[i2 * 3 + 2]!
      let mx = (x1 + x2) * 0.5
      let my = (y1 + y2) * 0.5
      let mz = (z1 + z2) * 0.5

      // 1. Pedestal round cylinder curvature (y < -1.5, r in [0.15, 0.35])
      const r1 = Math.hypot(x1, z1)
      const r2 = Math.hypot(x2, z2)
      if (my < -1.5 && Math.abs(r1 - r2) < 0.025 && r1 > 0.15 && r1 < 0.35) {
        const avgR = (r1 + r2) * 0.5
        const angle = Math.atan2(mz, mx)
        mx = Math.cos(angle) * avgR
        mz = Math.sin(angle) * avgR
      }

      // 2. Front corners curvature (x near -1.0 or 1.0, z near -1.0, r in [0.18, 0.32])
      for (const cx of [-1.0, 1.0]) {
        const cz = -1.0
        const cr1 = Math.hypot(x1 - cx, z1 - cz)
        const cr2 = Math.hypot(x2 - cx, z2 - cz)
        if (my > -1.5 && Math.abs(cr1 - cr2) < 0.03 && cr1 > 0.18 && cr1 < 0.32) {
          const avgCR = (cr1 + cr2) * 0.5
          const cAngle = Math.atan2(mz - cz, mx - cx)
          mx = cx + Math.cos(cAngle) * avgCR
          mz = cz + Math.sin(cAngle) * avgCR
        }
      }

      const nextIdx = nextPositions.length / 3
      nextPositions.push(mx, my, mz)
      edgeMap.set(key, nextIdx)
      return nextIdx
    }

    const nextIndices: number[] = []
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]!
      const b = indices[i + 1]!
      const c = indices[i + 2]!
      const ab = getMidpoint(a, b)
      const bc = getMidpoint(b, c)
      const ca = getMidpoint(c, a)
      nextIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
    }
    positions = nextPositions
    indices = nextIndices
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)

  const merged = mergeVertices(geom, 1e-4)
  const creased = toCreasedNormals(merged, THREE.MathUtils.degToRad(35))
  const result = mergeVertices(creased, 1e-4)
  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}

function createAnimeSinkMaterial(): THREE.MeshToonMaterial {
  const rampWidth = 256
  const rampData = new Uint8Array(rampWidth)
  for (let i = 0; i < rampWidth; i++) {
    const t = i / (rampWidth - 1)
    if (t < 0.24) {
      rampData[i] = 90
    } else if (t < 0.48) {
      rampData[i] = 145
    } else if (t < 0.76) {
      rampData[i] = 215
    } else {
      rampData[i] = 255
    }
  }
  const gradientMap = new THREE.DataTexture(rampData, rampWidth, 1, THREE.RedFormat)
  gradientMap.minFilter = THREE.NearestFilter
  gradientMap.magFilter = THREE.NearestFilter
  gradientMap.generateMipmaps = false
  gradientMap.needsUpdate = true

  const highlightColor = new THREE.Color('#FFFFFF')
  const baseColor = new THREE.Color('#F8FAFD')
  const midtoneColor = new THREE.Color('#DBE4EE')
  const shadowColor = new THREE.Color('#B0C2D5')
  const deepShadowColor = new THREE.Color('#8298B2')

  const material = new THREE.MeshToonMaterial({
    color: baseColor,
    gradientMap: gradientMap,
    side: THREE.DoubleSide,
  })

  material.customProgramCacheKey = () => 'anime-porcelain-sink-v4'

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHighlightColor = { value: highlightColor }
    shader.uniforms.uBaseColor = { value: baseColor }
    shader.uniforms.uMidtoneColor = { value: midtoneColor }
    shader.uniforms.uShadowColor = { value: shadowColor }
    shader.uniforms.uDeepShadowColor = { value: deepShadowColor }
    shader.uniforms.uToneThresholds = { value: new THREE.Vector4(-0.28, -0.06, 0.18, 0.52) }

    shader.vertexShader = `
      varying vec3 vSinkLocalPosition;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvSinkLocalPosition = position;'
    )

    shader.fragmentShader = `
      uniform vec3 uHighlightColor;
      uniform vec3 uBaseColor;
      uniform vec3 uMidtoneColor;
      uniform vec3 uShadowColor;
      uniform vec3 uDeepShadowColor;
      uniform vec4 uToneThresholds;
      varying vec3 vSinkLocalPosition;
    ` + shader.fragmentShader

    const targetChunk = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;'
    const replacementChunk = `
      #if NUM_DIR_LIGHTS > 0
        vec3 N = normalize(geometryNormal);
        vec3 L = normalize(directionalLights[0].direction);
        vec3 V = normalize(vViewPosition);
        float NdotL = dot(N, L);

        float fEdge = fwidth(NdotL) * 0.75 + 0.001;

        float deepStep   = smoothstep(uToneThresholds.x - fEdge, uToneThresholds.x + fEdge, NdotL);
        float shadowStep = smoothstep(uToneThresholds.y - fEdge, uToneThresholds.y + fEdge, NdotL);
        float baseStep   = smoothstep(uToneThresholds.z - fEdge, uToneThresholds.z + fEdge, NdotL);
        float highStep   = smoothstep(uToneThresholds.w - fEdge, uToneThresholds.w + fEdge, NdotL);

        vec3 animeTone = mix(uDeepShadowColor, uShadowColor, deepStep);
        animeTone = mix(animeTone, uMidtoneColor, shadowStep);
        animeTone = mix(animeTone, uBaseColor, baseStep);
        animeTone = mix(animeTone, uHighlightColor, highStep);

        float isPedestal = step(vSinkLocalPosition.y, -1.65);
        float pedestalCollarShadow = smoothstep(-1.95, -1.72, vSinkLocalPosition.y) * isPedestal * 0.35;

        float isUnderLip = smoothstep(-1.20, -1.14, vSinkLocalPosition.y) * (1.0 - smoothstep(-0.98, -0.92, vSinkLocalPosition.y));
        float lipShadow = isUnderLip * smoothstep(0.4, 0.9, length(vSinkLocalPosition.xz)) * 0.30;

        float isInnerBasin = smoothstep(-1.16, -1.10, vSinkLocalPosition.y) * (1.0 - smoothstep(-0.70, -0.55, vSinkLocalPosition.y));
        float basinShadow = isInnerBasin * (1.0 - smoothstep(0.2, 0.8, length(vSinkLocalPosition.xz))) * 0.22;

        float celDetailShadow = clamp(pedestalCollarShadow + lipShadow + basinShadow, 0.0, 0.50);
        animeTone = mix(animeTone, uShadowColor, celDetailShadow);

        vec3 H = normalize(L + V);
        float NdotH = max(dot(N, H), 0.0);
        float spec = pow(NdotH, 24.0);
        float fSpec = fwidth(spec) * 0.5 + 0.001;
        float satinGlint = smoothstep(0.55 - fSpec, 0.55 + fSpec, spec);

        float fresnel = 1.0 - max(dot(N, V), 0.0);
        float glazeSheen = smoothstep(0.72, 0.95, fresnel) * 0.16;

        float rimGlint = smoothstep(-0.43, -0.41, vSinkLocalPosition.y) * smoothstep(0.4, 0.8, -vSinkLocalPosition.z) * 0.30;

        vec3 ceramicColor = mix(animeTone, uHighlightColor, clamp(satinGlint * 0.72 + glazeSheen + rimGlint, 0.0, 1.0));

        vec3 outgoingLight = ceramicColor + totalEmissiveRadiance;
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
        const mesh = child as THREE.Mesh
        mesh.geometry = refineSinkToMediumPoly(mesh.geometry)
        mesh.material = createAnimeSinkMaterial()
      }
      if (child.name === 'SinkWaterSurface') {
        child.visible = false
      }
    })
    controller.bindScene(loaded.scene)
    controller.restart(true)
  },
  { immediate: true }
)

onUnmounted(() => {
  const faucet = model.value?.scene?.getObjectByName('faucet')
  if (faucet) faucet.visible = true
  controller.dispose()
})
</script>

<template>
  <!-- Light Mode Studio Gradient Background with Kemenkes Logo Color Harmony (Teal #00A99D + Lime #C4D600) -->
  <div
    class="relative w-full h-dvh overflow-hidden select-none bg-[#edf7f7]"
    style="background: radial-gradient(ellipse 70% 60% at 15% 15%, rgba(0, 169, 157, 0.20) 0%, transparent 65%),
                radial-gradient(ellipse 65% 55% at 85% 85%, rgba(196, 214, 0, 0.18) 0%, transparent 65%),
                radial-gradient(ellipse 60% 50% at 80% 20%, rgba(0, 180, 216, 0.14) 0%, transparent 60%),
                radial-gradient(ellipse 50% 50% at 50% 50%, rgba(255, 255, 255, 0.95) 0%, transparent 100%),
                linear-gradient(135deg, #eaf6f6 0%, #f6fbfb 45%, #f4fbf1 100%);"
  >
    <!-- Loading Screen in Light Mode -->
    <div
      v-if="isLoading"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-slate-800"
    >
      <img src="/logo.png" alt="Logo Kemenkes" class="w-12 h-12 object-contain animate-bounce drop-shadow-sm" />
      <div class="w-8 h-8 rounded-full border-2 border-[#00A99D] border-t-transparent animate-spin" />
      <span class="text-sm font-semibold tracking-wide text-slate-700">Menyiapkan simulasi...</span>
    </div>

    <!-- 3D WebGL Canvas with Light Studio Clear Color -->
    <TresCanvas v-else clear-color="#edf7f7">
      <TresPerspectiveCamera :position="cameraPosition" :fov="45" />
      <!-- Real-time cinematic lighting: bright, open shadows with warm/cool separation. -->
      <!-- Keep the warm side key first: the existing cel shaders use its direction. -->
      <TresDirectionalLight :position="[4.2, 5.0, 2.6]" :intensity="2.6" color="#FFF5E8" />
      <!-- Soft ambient fill keeps the cleaning gestures clearly visible. -->
      <TresAmbientLight :intensity="0.8" color="#E8EEFF" />
      <!-- Cooler opposing fill preserves finger detail without flattening the key. -->
      <TresDirectionalLight :position="[-3.5, 3.5, 2.0]" :intensity="0.7" color="#DCE6FF" />
      <!-- A restrained back rim separates the silhouettes from the bright background. -->
      <TresDirectionalLight :position="[-2.8, 4.6, -3.8]" :intensity="1.1" color="#EEF3FF" />
      <OrbitControls :target="cameraTarget" :min-distance="0.65" :max-distance="6" />
      <primitive v-if="model?.scene" :object="model.scene" />
      <HandwashingWaterSystem :controller="controller" />
    </TresCanvas>

    <!-- Header: identity, restart and tips toggle -->
    <HandwashingTopbar
      v-if="!isLoading"
      :is-tips-open="isTipsOpen"
      @reset="handleReset"
      @toggle-tips="isTipsOpen = !isTipsOpen"
    />

    <!-- Tips for the current step (hidden by default) -->
    <HandwashingTipsPanel
      v-if="!isLoading"
      :section="currentSection"
      :is-open="isTipsOpen"
      @close="isTipsOpen = false"
    />

    <!-- Bottom dock: current step, play and step navigation -->
    <HandwashingStepDock
      v-if="!isLoading"
      :controller="controller"
      :sections="sections"
      :current-section="currentSection"
      :active-section-id="activeSectionId"
      @select-section="selectSection"
      @previous="handlePrevious"
      @next="handleNext"
      @toggle-play="handleTogglePlay"
    />
  </div>
</template>
