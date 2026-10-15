import * as THREE from "three";

export type WaterMaterialStyle = "stream" | "surface" | "foam";

interface WaterUniforms {
  time: { value: number };
  drainLocal: { value: THREE.Vector3 };
  drainRadius: { value: number };
  impactLocal: { value: THREE.Vector3 };
  impactRadius: { value: number };
  surfaceAmplitude: { value: number };
  deepColor: { value: THREE.Color };
}

interface WaterMaterialData {
  uniforms: WaterUniforms;
}

function createToonRamp(soft = false): THREE.DataTexture {
  // Four restrained blue-light bands keep the water readable under the
  // application's existing ambient and directional lights.
  const ramp = new THREE.DataTexture(
    new Uint8Array([76, 132, 194, 255]),
    4,
    1,
    THREE.RedFormat,
  );
  ramp.minFilter = soft ? THREE.LinearFilter : THREE.NearestFilter;
  ramp.magFilter = soft ? THREE.LinearFilter : THREE.NearestFilter;
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
  const ramp = createToonRamp(style === "surface");
  const uniforms: WaterUniforms = {
    time: { value: 0 },
    drainLocal: { value: new THREE.Vector3() },
    drainRadius: { value: 0.08 },
    impactLocal: { value: new THREE.Vector3() },
    impactRadius: { value: 0.2 },
    surfaceAmplitude: { value: 0.12 },
    deepColor: { value: new THREE.Color(deepColor) },
  };
  const foamOpacity = style === "foam" ? THREE.MathUtils.clamp(opacity, 0, 1) : 1;
  const transparent = style === "foam" && foamOpacity < 1;
  const material = new THREE.MeshToonMaterial({
    color,
    gradientMap: ramp,
    transparent,
    opacity: foamOpacity,
    depthTest: true,
    depthWrite: !transparent,
    side: style === "surface" ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.userData.waterMaterial = { uniforms } satisfies WaterMaterialData;
  material.customProgramCacheKey = () => `bapelkes-toon-water-${style}-${style === "surface" ? "v4" : "v3"}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = uniforms.time;
    shader.uniforms.uDrainLocal = uniforms.drainLocal;
    shader.uniforms.uDrainRadius = uniforms.drainRadius;
    shader.uniforms.uImpactLocal = uniforms.impactLocal;
    shader.uniforms.uImpactRadius = uniforms.impactRadius;
    shader.uniforms.uSurfaceAmplitude = uniforms.surfaceAmplitude;
    shader.uniforms.uWaterDeepColor = uniforms.deepColor;

    const declarations = `
      uniform float uWaterTime;
      uniform vec3 uDrainLocal;
      uniform float uDrainRadius;
      uniform vec3 uImpactLocal;
      uniform float uImpactRadius;
      uniform float uSurfaceAmplitude;
      uniform vec3 uWaterDeepColor;
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
      ` : ""}`,
    );

    let colorPatch: string;
    if (style === "foam") {
      colorPatch = `
        float foamMotion = sin(vWaterLocalPosition.x * 8.0 + uWaterTime * 0.75)
          * sin(vWaterLocalPosition.z * 7.0 - uWaterTime * 0.62);
        diffuseColor.rgb = mix(uWaterDeepColor, diffuseColor.rgb, 0.91 + foamMotion * 0.045);
      `;
    } else if (style === "surface") {
      colorPatch = `
        float phaseA = vWaterLocalPosition.x * 5.2 + vWaterLocalPosition.z * 2.3 - uWaterTime * 1.15;
        float phaseB = vWaterLocalPosition.x * -3.7 + vWaterLocalPosition.z * 6.4 + uWaterTime * 0.92;
        float phaseC = vWaterLocalPosition.x * 9.1 - vWaterLocalPosition.z * 7.8 - uWaterTime * 1.55;
        float waveA = sin(phaseA);
        float waveB = sin(phaseB);
        float waveC = sin(phaseC);
        float waterWave = waveA * 0.55 + waveB * 0.30 + waveC * 0.15;
        vec2 impactOffset = vWaterLocalPosition.xz - uImpactLocal.xz;
        float impactDistance = length(impactOffset);
        float impactAngle = atan(impactOffset.y, impactOffset.x);
        float impactMask = exp(-impactDistance * impactDistance / max(0.01, uImpactRadius * uImpactRadius * 1.8));
        float impactMotion = sin(impactDistance * 36.0 - uWaterTime * 5.0) * impactMask;
        vec2 drainOffset = vWaterLocalPosition.xz - uDrainLocal.xz;
        float drainDistance = length(drainOffset);
        float vortexAngle = atan(drainOffset.y, drainOffset.x);
        float vortexMask = exp(-drainDistance * drainDistance / max(0.015, uDrainRadius * uDrainRadius * 12.0));
        float inwardPattern = sin(vortexAngle * 1.4 + drainDistance * 4.2 + uWaterTime * 0.9);
        float radialFlow = sin(drainDistance * 27.0 + uWaterTime * 3.2 + vortexAngle * 0.4);
        float blueTone = clamp(0.77 + waterWave * 0.105 + impactMotion * 0.035
          + (inwardPattern + radialFlow * 0.5) * vortexMask * 0.06, 0.52, 0.98);
        diffuseColor.rgb = mix(uWaterDeepColor, diffuseColor.rgb, blueTone);

        // Thin broken crests read as stylized foam; radial accents stay outside
        // the real drain opening and move inward instead of forming a fixed ring.
        float waveCrest = smoothstep(0.72, 0.94, waterWave) * 0.16;
        float impactArcWave = sin(impactDistance * 34.0 - uWaterTime * 4.5
          + sin(impactAngle * 2.0 + uWaterTime * 0.35) * 0.42);
        float impactArcGate = 0.56 + 0.44 * sin(impactAngle * 2.6 + uWaterTime * 0.42);
        float impactFoam = smoothstep(0.86, 0.98, impactArcWave) * impactMask * impactArcGate * 0.3;
        float drainArcWave = sin(drainDistance * 38.0 + uWaterTime * 3.8 + vortexAngle * 0.62);
        float drainArea = smoothstep(uDrainRadius * 1.12, uDrainRadius * 1.55, drainDistance)
          * (1.0 - smoothstep(uDrainRadius * 4.0, uDrainRadius * 5.8, drainDistance));
        float drainArcGate = 0.58 + 0.42 * sin(vortexAngle * 2.8 - uWaterTime * 0.5);
        float drainFoam = smoothstep(0.88, 0.99, drainArcWave) * drainArea * drainArcGate * 0.24;
        float foamAmount = clamp(waveCrest + impactFoam + drainFoam, 0.0, 0.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.985, 1.0), foamAmount);
      `;
    } else {
      colorPatch = `
        float streamMotion = sin(vWaterLocalPosition.y * 18.0 - uWaterTime * 3.0)
          * sin(vWaterLocalPosition.x * 11.0 + uWaterTime * 0.7);
        diffuseColor.rgb = mix(uWaterDeepColor, diffuseColor.rgb, 0.84 + streamMotion * 0.06);
      `;
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>\n${colorPatch}`,
    );
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
