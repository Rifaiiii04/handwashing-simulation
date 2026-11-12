import * as THREE from 'three'
import { replaceOutgoingLight } from './toonShaderChunks'

export function createNeoBrutalistFaucetMaterial(): THREE.MeshToonMaterial {
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
    replaceOutgoingLight(shader, replacementChunk)
  }

  return material
}
