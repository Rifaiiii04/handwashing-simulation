import * as THREE from 'three'
import { replaceOutgoingLight } from './toonShaderChunks'

export function createNeoBrutalistSinkMaterial(): THREE.MeshToonMaterial {
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
    replaceOutgoingLight(shader, replacementChunk)
  }

  return material
}
