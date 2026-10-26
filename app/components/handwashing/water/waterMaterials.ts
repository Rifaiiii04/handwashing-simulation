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
    side: THREE.DoubleSide,
  });

  material.userData.waterMaterial = { uniforms } satisfies WaterMaterialData;
  material.customProgramCacheKey = () => `bapelkes-toon-water-${style}-v9`;
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
        float taper = mix(1.0, 0.85, streamV);
        // Subtle flare right at contact point
        float flare = smoothstep(0.92, 1.0, streamV) * 0.15;
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
          vec3 foamShadowColor = vec3(0.82, 0.86, 0.92) * diffuseColor.rgb;
          vec3 foamLitColor    = vec3(0.97, 0.96, 0.94) * diffuseColor.rgb;

          float shadowStep = smoothstep(-0.15 - fEdge, -0.15 + fEdge, NdotL);
          vec3 animeLather = mix(foamShadowColor, foamLitColor, shadowStep);

          // 2. Layered stylized bubbles
          float fresnel = 1.0 - NdotV;
          float fRim = fwidth(fresnel) * 0.5 + 0.001;
          float bubbleRim = smoothstep(0.66 - fRim, 0.66 + fRim, fresnel);
          animeLather = mix(animeLather, vec3(1.0, 1.0, 1.0), bubbleRim * 0.65);

          // 3. Restrained highlights
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
      shader.fragmentShader = shader.fragmentShader.replace(targetChunk, replacementChunk);
    } else if (style === "surface") {
      const targetChunk = "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;";
      const replacementChunk = `
        #if NUM_DIR_LIGHTS > 0
          vec3 N = normalize(geometryNormal);
          vec3 L = normalize(directionalLights[0].direction);
          vec3 V = normalize(vViewPosition);
          float NdotL = dot(N, L);
          float fEdge = fwidth(NdotL) * 0.5 + 0.001;

          // 1. Distinct 3-tone hard-edged anime cel shadow bands
          float deepShadowStep = smoothstep(-0.28 - fEdge, -0.28 + fEdge, NdotL);
          float litStep        = smoothstep(0.08 - fEdge, 0.08 + fEdge, NdotL);
          vec3 animeTone       = mix(uWaterDeepColor, uWaterMidColor, deepShadowStep);
          animeTone            = mix(animeTone, uWaterBaseColor, litStep);

          // 2. Clean concentric ripple rings at faucet impact
          vec2 impactOffset = vWaterLocalPosition.xz - uImpactLocal.xz;
          float impactDist = length(impactOffset);
          float impactMask = exp(-impactDist * impactDist / max(0.003, uImpactRadius * uImpactRadius * 2.6));

          float ripplePhase = impactDist * 34.0 - uWaterTime * 4.6;
          float rippleWave = sin(ripplePhase);
          float fRipple = fwidth(rippleWave) * 0.5 + 0.001;
          float rippleCrest = smoothstep(0.84 - fRipple, 0.84 + fRipple, rippleWave) * impactMask;
          float rippleShadow = smoothstep(0.84 - fRipple, 0.84 + fRipple, -rippleWave) * impactMask;

          // 3. Clean drain vortex streamlines
          vec2 drainOffset = vWaterLocalPosition.xz - uDrainLocal.xz;
          float drainDist = length(drainOffset);
          float vortexAngle = atan(drainOffset.y, drainOffset.x);
          float vortexMask = exp(-drainDist * drainDist / max(0.008, uDrainRadius * uDrainRadius * 9.0));
          float drainCenterMask = smoothstep(uDrainRadius * 0.9, uDrainRadius * 1.6, drainDist);

          float spiralPhase = drainDist * 26.0 + vortexAngle * 2.0 + uWaterTime * 3.4;
          float spiralWave = sin(spiralPhase);
          float fSpiral = fwidth(spiralWave) * 0.5 + 0.001;
          float spiralCrest = smoothstep(0.85 - fSpiral, 0.85 + fSpiral, spiralWave) * vortexMask * drainCenterMask;
          float spiralShadow = smoothstep(0.85 - fSpiral, 0.85 + fSpiral, -spiralWave) * vortexMask * drainCenterMask;

          // 4. Controlled anime specular glints
          vec3 H = normalize(L + V);
          float NdotH = max(dot(N, H), 0.0);
          float spec = pow(NdotH, 32.0);
          float fSpec = fwidth(spec) * 0.5 + 0.001;
          float celGlint = smoothstep(0.72 - fSpec, 0.72 + fSpec, spec) * 0.65;

          float celShadowAcc = clamp(rippleShadow * 0.60 + spiralShadow * 0.50, 0.0, 1.0);
          vec3 waterShaded = mix(animeTone, uWaterDeepColor * 0.75, celShadowAcc);

          float celHighlightAcc = clamp(rippleCrest * 0.95 + spiralCrest * 0.85 + celGlint, 0.0, 1.0);
          vec3 outgoingLight = mix(waterShaded, uWaterHighlightColor, celHighlightAcc) + totalEmissiveRadiance;
        #else
          vec3 outgoingLight = uWaterBaseColor + totalEmissiveRadiance;
        #endif
      `;
      shader.fragmentShader = shader.fragmentShader.replace(targetChunk, replacementChunk);
    } else if (style === "handSpread") {
      const colorPatch = `
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
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n${colorPatch}`,
      );
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

          // Fast downward vertical laminar streaklines (clean longitudinal light streaks)
          float streamAngle = atan(vWaterLocalPosition.z, vWaterLocalPosition.x);
          float streamV = clamp(0.5 - vWaterLocalPosition.y, 0.0, 1.0);
          float flowSpeed = uWaterTime * 10.0;
          float streak1 = sin(streamAngle * 4.0 + streamV * 6.0 - flowSpeed);
          float streak2 = sin(streamAngle * 7.0 - streamV * 4.0 - flowSpeed * 1.4 + 1.2);
          float combinedStreak = streak1 * 0.6 + streak2 * 0.4;
          float fStreak = fwidth(combinedStreak) * 0.5 + 0.001;
          float streakLine = smoothstep(0.78 - fStreak, 0.78 + fStreak, combinedStreak);

          // Longitudinal specular rim glint
          vec3 H = normalize(L + V);
          float NdotH = max(dot(N, H), 0.0);
          float spec = pow(NdotH, 36.0);
          float fSpec = fwidth(spec) * 0.5 + 0.001;
          float celGlint = smoothstep(0.70 - fSpec, 0.70 + fSpec, spec);

          // Crisp pale aqua anime highlight tone
          vec3 streamHighlightColor = mix(uWaterBaseColor, uWaterHighlightColor, 0.75);
          float highlightMix = clamp(streakLine * 0.45 + celGlint * 0.35, 0.0, 1.0);
          vec3 outgoingLight = mix(streamTone, streamHighlightColor, highlightMix) + totalEmissiveRadiance;
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
