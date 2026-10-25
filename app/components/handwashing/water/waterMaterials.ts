import * as THREE from "three";

export type WaterMaterialStyle = "stream" | "surface" | "foam" | "handSpread";

interface WaterUniforms {
  time: { value: number };
  drainLocal: { value: THREE.Vector3 };
  drainRadius: { value: number };
  impactLocal: { value: THREE.Vector3 };
  impactRadius: { value: number };
  surfaceAmplitude: { value: number };
  deepColor: { value: THREE.Color };
  midColor: { value: THREE.Color };
  baseColor: { value: THREE.Color };
  highlightColor: { value: THREE.Color };
}

interface WaterMaterialData {
  uniforms: WaterUniforms;
}

function createToonRamp(): THREE.DataTexture {
  // Stepped 4-tone anime ramp with crisp quantized transitions
  const rampData = new Uint8Array([55, 115, 190, 255]);
  const ramp = new THREE.DataTexture(
    rampData,
    4,
    1,
    THREE.RedFormat,
  );
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

export function createWaterMaterial(
  style: WaterMaterialStyle,
  color: THREE.ColorRepresentation,
  deepColor: THREE.ColorRepresentation,
  opacity = 1,
): THREE.MeshToonMaterial {
  const ramp = createToonRamp();
  const baseColorObj = new THREE.Color(color);
  const deepColorObj = new THREE.Color(deepColor);
  // Cohesive anime midtone between deep shadow and lit surface
  const midColorObj = new THREE.Color(deepColor).lerp(baseColorObj, 0.48);
  // Crisp pale ice-aqua anime highlight tone
  const highlightColorObj = new THREE.Color(0xd8f2ff);

  const uniforms: WaterUniforms = {
    time: { value: 0 },
    drainLocal: { value: new THREE.Vector3() },
    drainRadius: { value: 0.08 },
    impactLocal: { value: new THREE.Vector3() },
    impactRadius: { value: 0.2 },
    surfaceAmplitude: { value: 0.12 },
    deepColor: { value: deepColorObj },
    midColor: { value: midColorObj },
    baseColor: { value: baseColorObj },
    highlightColor: { value: highlightColorObj },
  };
  const isHandSpread = style === "handSpread";
  const foamOpacity = style === "foam" ? THREE.MathUtils.clamp(opacity, 0, 1) : 1;
  const transparent = (style === "foam" && foamOpacity < 1) || isHandSpread;
  const material = new THREE.MeshToonMaterial({
    color: style === "foam" ? color : baseColorObj,
    gradientMap: ramp,
    transparent,
    opacity: isHandSpread ? 0.82 : foamOpacity,
    depthTest: true,
    depthWrite: !transparent,
    side: style === "surface" || isHandSpread ? THREE.DoubleSide : THREE.FrontSide,
  });

  material.userData.waterMaterial = { uniforms } satisfies WaterMaterialData;
  material.customProgramCacheKey = () => `bapelkes-toon-water-${style}-v8`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = uniforms.time;
    shader.uniforms.uDrainLocal = uniforms.drainLocal;
    shader.uniforms.uDrainRadius = uniforms.drainRadius;
    shader.uniforms.uImpactLocal = uniforms.impactLocal;
    shader.uniforms.uImpactRadius = uniforms.impactRadius;
    shader.uniforms.uSurfaceAmplitude = uniforms.surfaceAmplitude;
    shader.uniforms.uWaterDeepColor = uniforms.deepColor;
    shader.uniforms.uWaterMidColor = uniforms.midColor;
    shader.uniforms.uWaterBaseColor = uniforms.baseColor;
    shader.uniforms.uWaterHighlightColor = uniforms.highlightColor;

    const declarations = `
      uniform float uWaterTime;
      uniform vec3 uDrainLocal;
      uniform float uDrainRadius;
      uniform vec3 uImpactLocal;
      uniform float uImpactRadius;
      uniform float uSurfaceAmplitude;
      uniform vec3 uWaterDeepColor;
      uniform vec3 uWaterMidColor;
      uniform vec3 uWaterBaseColor;
      uniform vec3 uWaterHighlightColor;
      varying vec3 vWaterLocalPosition;
    `;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>${declarations}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>${declarations}`,
    );

    if (style === "surface") {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <defaultnormal_vertex>",
        `
        float normalPhaseA = position.x * 5.2 + position.z * 2.3 - uWaterTime * 1.15;
        float normalPhaseB = position.x * -3.7 + position.z * 6.4 + uWaterTime * 0.92;
        float normalPhaseC = position.x * 9.1 - position.z * 7.8 - uWaterTime * 1.55;
        float normalSlopeX = cos(normalPhaseA) * 5.2 * 0.46
          + cos(normalPhaseB) * -3.7 * 0.31 + cos(normalPhaseC) * 9.1 * 0.14;
        float normalSlopeZ = cos(normalPhaseA) * 2.3 * 0.46
          + cos(normalPhaseB) * 6.4 * 0.31 - cos(normalPhaseC) * 7.8 * 0.14;
        objectNormal = normalize(objectNormal - vec3(
          normalSlopeX * uSurfaceAmplitude * objectNormal.y,
          0.0,
          normalSlopeZ * uSurfaceAmplitude * objectNormal.y
        ));
        #include <defaultnormal_vertex>`,
      );
    }

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vWaterLocalPosition = position;
      ${style === "surface" ? `
        float phaseA = position.x * 5.2 + position.z * 2.3 - uWaterTime * 1.15;
        float phaseB = position.x * -3.7 + position.z * 6.4 + uWaterTime * 0.92;
        float phaseC = position.x * 9.1 - position.z * 7.8 - uWaterTime * 1.55;
        float broadWave = sin(phaseA) * 0.46;
        float crossingWave = sin(phaseB) * 0.31;
        float fineWave = sin(phaseC) * 0.14;
        float impactDistance = length(position.xz - uImpactLocal.xz);
        float impactMask = exp(-impactDistance * impactDistance / max(0.01, uImpactRadius * uImpactRadius * 1.5));
        float impactRipple = sin(impactDistance * 36.0 - uWaterTime * 5.0) * impactMask * 0.17;
        float drainDistance = length(position.xz - uDrainLocal.xz);
        float drainAngle = atan(position.z - uDrainLocal.z, position.x - uDrainLocal.x);
        float drainMask = exp(-drainDistance * drainDistance / max(0.015, uDrainRadius * uDrainRadius * 7.0));
        float drainRipple = sin(drainDistance * 32.0 + uWaterTime * 3.6 + drainAngle * 0.55) * drainMask * 0.12;
        float drainDepression = 1.0 - smoothstep(uDrainRadius * 0.6, uDrainRadius * 3.2, drainDistance);
        transformed.y += (broadWave + crossingWave + fineWave + impactRipple + drainRipple
          - drainDepression * 0.12) * uSurfaceAmplitude;
      ` : style === "stream" ? `
        float streamV = clamp(0.5 - position.y, 0.0, 1.0);
        // Clean, smooth gravitational taper (narrowing from spout down to contact)
        float taper = mix(1.0, 0.82, streamV);
        // Subtle flare right at contact point
        float flare = smoothstep(0.90, 1.0, streamV) * 0.18;
        transformed.xz = position.xz * (taper + flare);
      ` : style === "handSpread" ? `
        float spreadDist = length(position.xz);
        // Dynamic multi-harmonic fluid waves across the expanded water sheet
        float waveA = sin(spreadDist * 24.0 - uWaterTime * 14.0) * 0.0055;
        float waveB = sin(position.x * 22.0 + position.z * 18.0 - uWaterTime * 10.0) * 0.0035;
        transformed.y += waveA + waveB;
      ` : ""}`,
    );

    if (style === "foam") {
      const foamPatch = `
        // Gentle anime bubble motion shimmer
        float foamMotion = sin(vWaterLocalPosition.x * 6.0 + uWaterTime * 0.8)
          * sin(vWaterLocalPosition.z * 5.0 - uWaterTime * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98, 0.97, 0.95), 0.55 + foamMotion * 0.05);
      `;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n${foamPatch}`,
      );

      const targetChunk = "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;";
      const replacementChunk = `
        #if NUM_DIR_LIGHTS > 0
          vec3 N = normalize(geometryNormal);
          vec3 L = normalize(directionalLights[0].direction);
          vec3 V = normalize(vViewPosition);
          float NdotL = dot(N, L);
          float NdotV = max(dot(N, V), 0.0);
          float fEdge = fwidth(NdotL) * 0.5 + 0.001;

          // 1. Milky off-white foam with defined cel-shaded light and shadow regions
          // Pure milky off-white lit tone, soft creamy periwinkle-slate cel shadow (minimum brightness 0.82)
          vec3 foamShadowColor = vec3(0.82, 0.86, 0.92) * diffuseColor.rgb;
          vec3 foamLitColor    = vec3(0.97, 0.96, 0.94) * diffuseColor.rgb;

          // Defined hard-edged cel shadow step (no blurry gradient, no dark specks)
          float shadowStep = smoothstep(-0.15 - fEdge, -0.15 + fEdge, NdotL);
          vec3 animeLather = mix(foamShadowColor, foamLitColor, shadowStep);

          // 2. Layered stylized bubbles (crisp anime bubble outline on each puff)
          float fresnel = 1.0 - NdotV;
          float fRim = fwidth(fresnel) * 0.5 + 0.001;
          float bubbleRim = smoothstep(0.66 - fRim, 0.66 + fRim, fresnel);
          animeLather = mix(animeLather, vec3(1.0, 1.0, 1.0), bubbleRim * 0.65);

          // 3. Restrained highlights (crisp anime specular dot on bubble crests)
          vec3 H = normalize(L + V);
          float NdotH = max(dot(N, H), 0.0);
          float spec = pow(NdotH, 32.0);
          float fSpec = fwidth(spec) * 0.5 + 0.001;
          float bubbleGlint = smoothstep(0.68 - fSpec, 0.68 + fSpec, spec);
          animeLather = mix(animeLather, vec3(1.0, 1.0, 1.0), bubbleGlint * 0.85);

          vec3 outgoingLight = animeLather + totalEmissiveRadiance;
        #else
          vec3 outgoingLight = diffuseColor.rgb + totalEmissiveRadiance;
        #endif
      `;
    } else if (style === "handSpread") {
      colorPatch = `
        float distFromCenter = length(vWaterLocalPosition.xz);
        // Dynamic expanding ripples radiating from palm impact
        float rippleA = sin(distFromCenter * 28.0 - uWaterTime * 15.0);
        float rippleB = sin(distFromCenter * 52.0 - uWaterTime * 22.0);
        // Outward surging flow along the finger ribbons
        float forwardFlow = sin(-vWaterLocalPosition.z * 36.0 - uWaterTime * 18.0);
        float combinedSpread = rippleA * 0.45 + rippleB * 0.25 + forwardFlow * 0.30;

        float blueMix = clamp(0.82 + combinedSpread * 0.15, 0.65, 0.98);
        diffuseColor.rgb = mix(uWaterDeepColor, diffuseColor.rgb, blueMix);

        // Glistening animated highlights across the wide water sheet & finger gaps
        float glint = smoothstep(0.66, 0.96, max(rippleA, forwardFlow)) * 0.48;
        vec3 whiteTint = vec3(0.95, 0.99, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, whiteTint, glint);

        // Soft, natural edge fade out at the outer boundaries of the fingers
        float edgeFade = 1.0 - smoothstep(0.18, 0.28, distFromCenter);
        diffuseColor.a = clamp(0.65 + edgeFade * 0.28 + glint * 0.20, 0.0, 0.96);
      `;
    } else {
      colorPatch = `
        float streamV = clamp(0.5 - vWaterLocalPosition.y, 0.0, 1.0);
        float streamAngle = atan(vWaterLocalPosition.z, vWaterLocalPosition.x);

        // Smooth downward longitudinal flow lines (clean vertical streaks, no horizontal rings)
        float flowA = sin(streamAngle * 4.0 + streamV * 4.0 - uWaterTime * 12.0);
        float flowB = sin(streamAngle * 7.0 - streamV * 3.0 - uWaterTime * 16.0);
        float streamFlow = flowA * 0.6 + flowB * 0.4;

        float blueTone = clamp(0.86 + streamFlow * 0.08, 0.74, 0.98);
        diffuseColor.rgb = mix(uWaterDeepColor, diffuseColor.rgb, blueTone);

        // Longitudinal specular highlight streak
        float streak = smoothstep(0.76, 0.96, flowA) * 0.30;

        // Subtle glint on outer rim
        float rim = pow(clamp(abs(vWaterLocalPosition.x) / 0.05, 0.0, 1.0), 2.5) * 0.20;

        vec3 highlightTint = vec3(0.92, 0.98, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, highlightTint, clamp(streak + rim, 0.0, 0.48));
      `;
      shader.fragmentShader = shader.fragmentShader.replace(targetChunk, replacementChunk);
    } else if (style === "stream") {
      const targetChunk = "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;";
      const replacementChunk = `
        #if NUM_DIR_LIGHTS > 0
          vec3 N = normalize(geometryNormal);
          vec3 L = normalize(directionalLights[0].direction);
          vec3 V = normalize(vViewPosition);
          float NdotL = dot(N, L);
          float fEdge = fwidth(NdotL) * 0.5 + 0.001;

          // Soft 3-tone anime cel bands
          float deepShadowStep = smoothstep(-0.25 - fEdge, -0.25 + fEdge, NdotL);
          float litStep        = smoothstep(0.10 - fEdge, 0.10 + fEdge, NdotL);
          vec3 streamTone      = mix(uWaterDeepColor, uWaterMidColor, deepShadowStep);
          streamTone           = mix(streamTone, uWaterBaseColor, litStep);

          // Thin flowing streaklines — subtle, not blobby
          float streamAngle = atan(vWaterLocalPosition.z, vWaterLocalPosition.x);
          float flowSpeed = uWaterTime * 8.0;
          float streak1 = sin(streamAngle * 5.0 + vWaterLocalPosition.y * 28.0 - flowSpeed);
          float streak2 = sin(streamAngle * 7.0 - vWaterLocalPosition.y * 20.0 - flowSpeed * 1.3 + 1.5);
          float combinedStreak = streak1 * 0.6 + streak2 * 0.4;
          float fStreak = fwidth(combinedStreak) * 0.5 + 0.001;
          // Higher threshold = thinner lines
          float streakLine = smoothstep(0.88 - fStreak, 0.88 + fStreak, combinedStreak);

          // Gentle cel glint — small and restrained
          vec3 H = normalize(L + V);
          float NdotH = max(dot(N, H), 0.0);
          float spec = pow(NdotH, 48.0);
          float fSpec = fwidth(spec) * 0.5 + 0.001;
          float celGlint = smoothstep(0.75 - fSpec, 0.75 + fSpec, spec);

          // Blend toward a light tint of water color, not pure white
          vec3 streamHighlightColor = mix(uWaterBaseColor, uWaterHighlightColor, 0.5);
          float streamHighlight = clamp(streakLine * 0.35 + celGlint * 0.25, 0.0, 1.0);
          vec3 outgoingLight = mix(streamTone, streamHighlightColor, streamHighlight) + totalEmissiveRadiance;
        #else
          vec3 outgoingLight = uWaterBaseColor + totalEmissiveRadiance;
        #endif
      `;
      shader.fragmentShader = shader.fragmentShader.replace(targetChunk, replacementChunk);
    }
  };
  return material;
}

export function updateWaterMaterial(
  material: THREE.Material,
  time: number,
  drainLocal?: THREE.Vector3,
  drainRadius?: number,
  impactLocal?: THREE.Vector3,
  impactRadius?: number,
  surfaceAmplitude?: number,
): void {
  const data = material.userData.waterMaterial as WaterMaterialData | undefined;
  if (!data) return;
  data.uniforms.time.value = time;
  if (drainLocal) data.uniforms.drainLocal.value.copy(drainLocal);
  if (drainRadius !== undefined) data.uniforms.drainRadius.value = drainRadius;
  if (impactLocal) data.uniforms.impactLocal.value.copy(impactLocal);
  if (impactRadius !== undefined) data.uniforms.impactRadius.value = impactRadius;
  if (surfaceAmplitude !== undefined) data.uniforms.surfaceAmplitude.value = surfaceAmplitude;
}

export function disposeWaterMaterial(material: THREE.Material): void {
  const toonMaterial = material as THREE.MeshToonMaterial;
  toonMaterial.gradientMap?.dispose();
  material.dispose();
}
