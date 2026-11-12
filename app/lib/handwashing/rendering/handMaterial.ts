import * as THREE from 'three'
import { replaceOutgoingLight } from './toonShaderChunks'

export function createNeoBrutalistHandMaterial(): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  })

  material.customProgramCacheKey = () => 'neobrutalist-hand-v1'

  material.onBeforeCompile = (shader) => {
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
    replaceOutgoingLight(shader, replacementChunk)
  }

  return material
}

export function createNeoBrutalistNailMaterial(): THREE.MeshToonMaterial {
  const nailColor = new THREE.Color('#E8C4BC')
  const material = new THREE.MeshToonMaterial({
    color: nailColor,
    side: THREE.DoubleSide,
  })

  material.customProgramCacheKey = () => 'neobrutalist-nail-v1'

  material.onBeforeCompile = (shader) => {
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
    replaceOutgoingLight(shader, replacementChunk)
  }

  return material
}
