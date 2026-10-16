<script setup lang="ts">
import { watch } from 'vue'
import * as THREE from 'three'
import { useGLTF } from '@tresjs/cientos'
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'

const { state: model, isLoading } = useGLTF('models/washand.glb')

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
  // Controlled gradient ramp data texture (discrete 4-tone anime ramp)
  const rampWidth = 256
  const rampData = new Uint8Array(rampWidth)
  for (let i = 0; i < rampWidth; i++) {
    const t = i / (rampWidth - 1)
    if (t < 0.24) {
      rampData[i] = 90 // deep crevice shadow
    } else if (t < 0.48) {
      rampData[i] = 145 // warm ceramic shadow
    } else if (t < 0.76) {
      rampData[i] = 215 // warm ivory base
    } else {
      rampData[i] = 255 // glazed highlight
    }
  }
  const gradientMap = new THREE.DataTexture(rampData, rampWidth, 1, THREE.RedFormat)
  gradientMap.minFilter = THREE.NearestFilter
  gradientMap.magFilter = THREE.NearestFilter
  gradientMap.generateMipmaps = false
  gradientMap.needsUpdate = true

  // 1990s anime clean white ceramic porcelain: pristine white with classic periwinkle cel shadows
  const highlightColor = new THREE.Color('#FFFFFF') // Crisp pure white glaze highlight
  const baseColor = new THREE.Color('#F8FAFD') // Clean white porcelain body
  const midtoneColor = new THREE.Color('#DBE4EE') // Classic 90s anime periwinkle white cel shadow
  const shadowColor = new THREE.Color('#B0C2D5') // Cool anime slate-periwinkle shadow
  const deepShadowColor = new THREE.Color('#8298B2') // Deep crevice shadow

  const material = new THREE.MeshToonMaterial({
    color: baseColor,
    gradientMap: gradientMap,
    side: THREE.DoubleSide,
  })

  material.customProgramCacheKey = () => 'anime-porcelain-sink-v4'

  // Hook into shader compilation for precise 90s anime ceramic cel shading with satin glaze
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

        // Sub-pixel smooth transition for crisp anime cel line without jagged pixel artifacts
        float fEdge = fwidth(NdotL) * 0.75 + 0.001;

        // Clean 4-tone anime ceramic light and shadow bands
        float deepStep   = smoothstep(uToneThresholds.x - fEdge, uToneThresholds.x + fEdge, NdotL);
        float shadowStep = smoothstep(uToneThresholds.y - fEdge, uToneThresholds.y + fEdge, NdotL);
        float baseStep   = smoothstep(uToneThresholds.z - fEdge, uToneThresholds.z + fEdge, NdotL);
        float highStep   = smoothstep(uToneThresholds.w - fEdge, uToneThresholds.w + fEdge, NdotL);

        vec3 animeTone = mix(uDeepShadowColor, uShadowColor, deepStep);
        animeTone = mix(animeTone, uMidtoneColor, shadowStep);
        animeTone = mix(animeTone, uBaseColor, baseStep);
        animeTone = mix(animeTone, uHighlightColor, highStep);

        // Tasteful 90s anime cel shadow details (contact shadows, overhang drop shadow)
        // 1. Under-basin overhang shadow on top of pedestal column
        float isPedestal = step(vSinkLocalPosition.y, -1.65);
        float pedestalCollarShadow = smoothstep(-1.95, -1.72, vSinkLocalPosition.y) * isPedestal * 0.35;

        // 2. Subtle lip crease shadow under outer overhang perimeter
        float isUnderLip = smoothstep(-1.20, -1.14, vSinkLocalPosition.y) * (1.0 - smoothstep(-0.98, -0.92, vSinkLocalPosition.y));
        float lipShadow = isUnderLip * smoothstep(0.4, 0.9, length(vSinkLocalPosition.xz)) * 0.30;

        // 3. Subtle basin inner bottom boundary shadow
        float isInnerBasin = smoothstep(-1.16, -1.10, vSinkLocalPosition.y) * (1.0 - smoothstep(-0.70, -0.55, vSinkLocalPosition.y));
        float basinShadow = isInnerBasin * (1.0 - smoothstep(0.2, 0.8, length(vSinkLocalPosition.xz))) * 0.22;

        float celDetailShadow = clamp(pedestalCollarShadow + lipShadow + basinShadow, 0.0, 0.50);
        animeTone = mix(animeTone, uShadowColor, celDetailShadow);

        // Subtle satin highlights and ceramic glaze sheen (stylized ceramic luster, not plastic)
        vec3 H = normalize(L + V);
        float NdotH = max(dot(N, H), 0.0);
        float spec = pow(NdotH, 24.0);
        float fSpec = fwidth(spec) * 0.5 + 0.001;
        float satinGlint = smoothstep(0.55 - fSpec, 0.55 + fSpec, spec);

        // Gentle glaze rim reflection along basin curvature
        float fresnel = 1.0 - max(dot(N, V), 0.0);
        float glazeSheen = smoothstep(0.72, 0.95, fresnel) * 0.16;

        // Subtle crisp anime glaze gleam on top front bevel edge
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
      <!-- Cinematic 90s Anime Sun & Lighting Setup -->
      <!-- 1. Warm Sun Key Light: creates warm daytime cel highlights and crisp shadow angles -->
      <TresDirectionalLight :position="[4.5, 6.0, 3.8]" :intensity="2.4" color="#FFF5E4" />
      <!-- 2. Cool Sky Ambient Light: fills shadows with classic anime periwinkle sky atmosphere -->
      <TresAmbientLight :intensity="0.7" color="#BDD3EB" />
      <!-- 3. Cinematic Rim / Backlight: illuminates silhouettes for anime depth and separation -->
      <TresDirectionalLight :position="[-4.0, 4.5, -3.2]" :intensity="1.0" color="#D0E3FA" />
      <OrbitControls />
      <primitive v-if="model?.scene" :object="model.scene" />
      <HandwashingWaterSystem />
    </TresCanvas>
  </div>
</template>
