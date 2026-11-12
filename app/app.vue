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

function selectSection(section: HandwashingStepSection) {
  if (!section.enabled) return
  activeSectionId.value = section.id
  controller.goToStage(section.startStageIndex, true)
}

function handleReset() {
  activeSectionId.value = 'persiapan'
  controller.restart(true)
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

function createNeoBrutalistSinkMaterial(): THREE.MeshToonMaterial {
  // Soft, teal-tinted porcelain tones: shadows stay readable (no near-black blocks)
  const baseColor = new THREE.Color('#E9F0EE')
  const midtoneColor = new THREE.Color('#C3D2D0')
  const shadowColor = new THREE.Color('#9DB2B1')
  const deepShadowColor = new THREE.Color('#7F9897')
  const highlightColor = new THREE.Color('#F7FBFA')
  const inkColor = new THREE.Color('#2F4547')

  const material = new THREE.MeshToonMaterial({
    color: baseColor,
    side: THREE.DoubleSide,
  })

  material.customProgramCacheKey = () => 'neobrutalist-porcelain-sink-v1'

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBaseColor = { value: baseColor }
    shader.uniforms.uMidtoneColor = { value: midtoneColor }
    shader.uniforms.uShadowColor = { value: shadowColor }
    shader.uniforms.uDeepShadowColor = { value: deepShadowColor }
    shader.uniforms.uHighlightColor = { value: highlightColor }
    shader.uniforms.uInkColor = { value: inkColor }
    shader.uniforms.uToneThresholds = { value: new THREE.Vector4(-0.35, -0.02, 0.32, 0.75) }

    shader.vertexShader = `
      varying vec3 vSinkLocalPosition;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvSinkLocalPosition = position;'
    )

    shader.fragmentShader = `
      uniform vec3 uBaseColor;
      uniform vec3 uMidtoneColor;
      uniform vec3 uShadowColor;
      uniform vec3 uDeepShadowColor;
      uniform vec3 uHighlightColor;
      uniform vec3 uInkColor;
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
        float NdotV = max(dot(N, V), 0.0);

        float fEdge = fwidth(NdotL) * 0.75 + 0.001;

        float deepStep   = smoothstep(uToneThresholds.x - fEdge, uToneThresholds.x + fEdge, NdotL);
        float shadowStep = smoothstep(uToneThresholds.y - fEdge, uToneThresholds.y + fEdge, NdotL);
        float highStep   = smoothstep(uToneThresholds.z - fEdge, uToneThresholds.z + fEdge, NdotL);

        vec3 neoTone = mix(uDeepShadowColor, uShadowColor, deepStep);
        neoTone = mix(neoTone, uMidtoneColor, shadowStep);
        neoTone = mix(neoTone, uBaseColor, highStep);

        // Basin & structural contact block shadows
        float isInnerBasin = smoothstep(-1.16, -1.10, vSinkLocalPosition.y) * (1.0 - smoothstep(-0.70, -0.55, vSinkLocalPosition.y));
        float basinShadow = isInnerBasin * (1.0 - smoothstep(0.2, 0.8, length(vSinkLocalPosition.xz))) * 0.22;

        float isUnderLip = smoothstep(-1.20, -1.14, vSinkLocalPosition.y) * (1.0 - smoothstep(-0.98, -0.92, vSinkLocalPosition.y));
        float lipShadow = isUnderLip * smoothstep(0.4, 0.9, length(vSinkLocalPosition.xz)) * 0.25;

        float blockShadow = clamp(basinShadow + lipShadow, 0.0, 0.35);
        neoTone = mix(neoTone, uDeepShadowColor, blockShadow);

        // Crisp specular highlight cut
        vec3 H = normalize(L + V);
        float NdotH = max(dot(N, H), 0.0);
        float spec = pow(NdotH, 32.0);
        float fSpec = fwidth(spec) * 0.5 + 0.001;
        float crispGlint = smoothstep(0.60 - fSpec, 0.60 + fSpec, spec) * 0.55;

        vec3 litSurface = mix(neoTone, uHighlightColor, crispGlint);

        // Thin neo-brutalist ink outline along the silhouette
        float fOutline = fwidth(NdotV) * 0.85 + 0.001;
        float outlineEdge = smoothstep(0.11 - fOutline, 0.11 + fOutline, NdotV);
        vec3 finalColor = mix(uInkColor, litSurface, outlineEdge);

        vec3 outgoingLight = finalColor + totalEmissiveRadiance;
      #else
        vec3 outgoingLight = uBaseColor + totalEmissiveRadiance;
      #endif
    `
    shader.fragmentShader = shader.fragmentShader.replace(targetChunk, replacementChunk)
  }

  return material
}

function createNeoBrutalistHandMaterial(): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  })

  material.customProgramCacheKey = () => 'neobrutalist-hand-v1'

  material.onBeforeCompile = (shader) => {
    const targetChunk = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;'
    const replacementChunk = `
      #if NUM_DIR_LIGHTS > 0
        vec3 N = normalize(geometryNormal);
        vec3 L = normalize(directionalLights[0].direction);
        vec3 V = normalize(vViewPosition);
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);

        float fEdge = fwidth(NdotL) * 0.75 + 0.001;
        float shadowStep = smoothstep(0.10 - fEdge, 0.10 + fEdge, NdotL);
        float highStep = smoothstep(0.50 - fEdge, 0.50 + fEdge, NdotL);

        vec3 baseCol = diffuseColor.rgb;
        // Warm graphic block shadow (neo-brutalist without excessive brown darkness)
        vec3 shadowCol = baseCol * vec3(0.76, 0.68, 0.66);
        vec3 midCol = baseCol * 0.92;
        vec3 litCol = baseCol * 1.02;

        vec3 celColor = mix(shadowCol, midCol, shadowStep);
        celColor = mix(celColor, litCol, highStep);

        // Neo-brutalist ink outline along the silhouette
        float fOutline = fwidth(NdotV) * 0.85 + 0.001;
        float outlineEdge = smoothstep(0.12 - fOutline, 0.12 + fOutline, NdotV);
        vec3 inkOutlineColor = vec3(0.30, 0.18, 0.14);

        vec3 finalColor = mix(inkOutlineColor, celColor, outlineEdge);
        vec3 outgoingLight = finalColor + totalEmissiveRadiance;
      #else
        vec3 outgoingLight = diffuseColor.rgb + totalEmissiveRadiance;
      #endif
    `
    shader.fragmentShader = shader.fragmentShader.replace(targetChunk, replacementChunk)
  }

  return material
}

function createNeoBrutalistFaucetMaterial(): THREE.MeshToonMaterial {
  const baseColor = new THREE.Color('#8FA3A8')
  const shadowColor = new THREE.Color('#5C7076')
  const highlightColor = new THREE.Color('#F4F9F8')
  const inkColor = new THREE.Color('#2F4547')

  const material = new THREE.MeshToonMaterial({
    color: baseColor,
    side: THREE.DoubleSide,
  })

  material.customProgramCacheKey = () => 'neobrutalist-faucet-v1'

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBaseColor = { value: baseColor }
    shader.uniforms.uShadowColor = { value: shadowColor }
    shader.uniforms.uHighlightColor = { value: highlightColor }
    shader.uniforms.uInkColor = { value: inkColor }

    shader.fragmentShader = `
      uniform vec3 uBaseColor;
      uniform vec3 uShadowColor;
      uniform vec3 uHighlightColor;
      uniform vec3 uInkColor;
    ` + shader.fragmentShader

    const targetChunk = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;'
    const replacementChunk = `
      #if NUM_DIR_LIGHTS > 0
        vec3 N = normalize(geometryNormal);
        vec3 L = normalize(directionalLights[0].direction);
        vec3 V = normalize(vViewPosition);
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);

        float fEdge = fwidth(NdotL) * 0.75 + 0.001;
        float shadowStep = smoothstep(0.15 - fEdge, 0.15 + fEdge, NdotL);

        vec3 chromeTone = mix(uShadowColor, uBaseColor, shadowStep);

        vec3 H = normalize(L + V);
        float NdotH = max(dot(N, H), 0.0);
        float spec = pow(NdotH, 48.0);
        float fSpec = fwidth(spec) * 0.5 + 0.001;
        float glint = smoothstep(0.50 - fSpec, 0.50 + fSpec, spec);
        chromeTone = mix(chromeTone, uHighlightColor, glint * 0.90);

        // Neo-brutalist ink outline
        float fOutline = fwidth(NdotV) * 0.85 + 0.001;
        float outlineEdge = smoothstep(0.12 - fOutline, 0.12 + fOutline, NdotV);
        vec3 finalColor = mix(uInkColor, chromeTone, outlineEdge);

        vec3 outgoingLight = finalColor + totalEmissiveRadiance;
      #else
        vec3 outgoingLight = uBaseColor + totalEmissiveRadiance;
      #endif
    `
    shader.fragmentShader = shader.fragmentShader.replace(targetChunk, replacementChunk)
  }

  return material
}

function createNeoBrutalistNailMaterial(): THREE.MeshToonMaterial {
  const nailColor = new THREE.Color('#E8C4BC')
  const material = new THREE.MeshToonMaterial({
    color: nailColor,
    side: THREE.DoubleSide,
  })

  material.customProgramCacheKey = () => 'neobrutalist-nail-v1'

  material.onBeforeCompile = (shader) => {
    const targetChunk = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;'
    const replacementChunk = `
      #if NUM_DIR_LIGHTS > 0
        vec3 N = normalize(geometryNormal);
        vec3 L = normalize(directionalLights[0].direction);
        vec3 V = normalize(vViewPosition);
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);

        float fEdge = fwidth(NdotL) * 0.75 + 0.001;
        float shadowStep = smoothstep(0.12 - fEdge, 0.12 + fEdge, NdotL);

        vec3 shadowColor = diffuseColor.rgb * vec3(0.65, 0.52, 0.48);
        vec3 celNail = mix(shadowColor, diffuseColor.rgb, shadowStep);

        // Ink outline
        float fOutline = fwidth(NdotV) * 0.85 + 0.001;
        float outlineEdge = smoothstep(0.12 - fOutline, 0.12 + fOutline, NdotV);
        vec3 inkOutlineColor = vec3(0.30, 0.18, 0.14);

        vec3 finalColor = mix(inkOutlineColor, celNail, outlineEdge);
        vec3 outgoingLight = finalColor + totalEmissiveRadiance;
      #else
        vec3 outgoingLight = diffuseColor.rgb + totalEmissiveRadiance;
      #endif
    `
    shader.fragmentShader = shader.fragmentShader.replace(targetChunk, replacementChunk)
  }

  return material
}

function applyHandTwoToneColors(mesh: THREE.SkinnedMesh, isRight: boolean) {
  const norm = mesh.geometry.attributes.normal
  if (!norm) return
  // Palm normal in rest pose:
  // Right hand points inward-left: (-0.956, 0.293, 0)
  // Left hand points inward-right: (0.943, 0.333, 0)
  const palmNormal = isRight
    ? new THREE.Vector3(-0.956, 0.293, 0).normalize()
    : new THREE.Vector3(0.943, 0.333, 0).normalize()

  // Neo-Brutalist palette: natural, healthy skin tones with gentle contrast
  // Dorsal (punggung tangan & pergelangan): warm honey-sand tan tone (not dark brown)
  const dorsalColor = new THREE.Color('#D9A28A')
  // Palmar (telapak tangan): warm natural peach-sand tone (distinctly lighter, soft & natural)
  const palmarColor = new THREE.Color('#ECD2C0')

  const colors = new Float32Array(norm.count * 3)
  const tempColor = new THREE.Color()

  for (let i = 0; i < norm.count; i++) {
    const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i)
    const dot = nx * palmNormal.x + ny * palmNormal.y + nz * palmNormal.z
    const t = THREE.MathUtils.smoothstep(dot, -0.30, 0.30)
    tempColor.copy(dorsalColor).lerp(palmarColor, t)

    colors[i * 3] = tempColor.r
    colors[i * 3 + 1] = tempColor.g
    colors[i * 3 + 2] = tempColor.b
  }

  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  if (mesh.geometry.attributes.color) {
    mesh.geometry.attributes.color.needsUpdate = true
  }
}

watch(
  () => model.value,
  (loaded) => {
    if (!loaded?.scene) return
    loaded.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.name.toLowerCase() === 'sink') {
        const mesh = child as THREE.Mesh
        mesh.geometry = refineSinkToMediumPoly(mesh.geometry)
        mesh.material = createNeoBrutalistSinkMaterial()
      }
      if (child.name === 'SinkWaterSurface') {
        child.visible = true
      }
      if (child.name === 'Hand_AR_V2') {
        const mesh = child as THREE.SkinnedMesh
        applyHandTwoToneColors(mesh, true)
        mesh.material = createNeoBrutalistHandMaterial()
      }
      if (child.name === 'Hand_AR_V2001') {
        const mesh = child as THREE.SkinnedMesh
        applyHandTwoToneColors(mesh, false)
        mesh.material = createNeoBrutalistHandMaterial()
      }
      if (child.name === 'Hand_AR_V2_1' || child.name === 'Hand_AR_V2001_1') {
        const mesh = child as THREE.SkinnedMesh
        mesh.material = createNeoBrutalistNailMaterial()
      }
      if (child.name === 'faucet') {
        const mesh = child as THREE.Mesh
        mesh.material = createNeoBrutalistFaucetMaterial()
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
  <!-- Calibrated Studio Gradient Background with Kemenkes Color Harmony (Teal #00A99D + Lime #C4D600) -->
  <div
    class="relative w-full h-dvh overflow-hidden select-none bg-[#cad9d8]"
    style="background: radial-gradient(ellipse 65% 55% at 15% 15%, rgba(0, 169, 157, 0.22) 0%, transparent 65%),
                radial-gradient(ellipse 60% 50% at 85% 85%, rgba(196, 214, 0, 0.14) 0%, transparent 65%),
                radial-gradient(ellipse 55% 45% at 80% 20%, rgba(0, 150, 180, 0.12) 0%, transparent 60%),
                radial-gradient(ellipse 70% 60% at 50% 45%, rgba(240, 247, 246, 0.40) 0%, transparent 80%),
                linear-gradient(135deg, #c5d7d5 0%, #d4e3e2 45%, #cadbd6 100%);"
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

    <!-- 3D WebGL Canvas with Balanced Studio Clear Color -->
    <TresCanvas v-else clear-color="#cbd9d8">
      <TresPerspectiveCamera :position="cameraPosition" :fov="45" />
      <!-- Neo-brutalist studio lighting: crisp directional key with deep, graphic block shadows -->
      <!-- Keep the warm side key first: the cel shaders use directionalLights[0]. -->
      <TresDirectionalLight :position="[4.2, 5.0, 2.6]" :intensity="1.55" color="#FFF2E4" />
      <!-- Clean, controlled ambient fill so graphic block shadows retain strong contrast. -->
      <TresAmbientLight :intensity="0.6" color="#E0E7FF" />
      <!-- Subtle opposing cool fill for edge separation. -->
      <TresDirectionalLight :position="[-3.5, 3.5, 2.0]" :intensity="0.45" color="#C7D2FE" />
      <!-- Crisp back rim accentuating silhouette contours. -->
      <TresDirectionalLight :position="[-2.8, 4.6, -3.8]" :intensity="0.55" color="#E2E8F0" />
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
