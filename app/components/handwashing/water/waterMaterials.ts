import * as THREE from "three";

interface WaterTimeUniform {
  value: number;
}

export function createWaterMaterial(
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.25,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.28,
    transparent: opacity < 1,
    opacity,
    depthTest: true,
    // These are transparent water layers; keep opaque scene depth testing,
    // but don't let one water pass stamp depth over the next contact seam.
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const time: WaterTimeUniform = { value: 0 };
  material.userData.waterTime = time;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = time;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nuniform float uWaterTime;",
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      float waterPulse = sin(position.y * 23.0 - uWaterTime * 2.4) * sin(position.x * 31.0 + position.z * 17.0 + uWaterTime * 0.7);
      transformed += normal * waterPulse * 0.0012;`,
    );
  };
  material.customProgramCacheKey = () => "bapelkes-stylized-water-v1";
  return material;
}

export function updateWaterMaterialTime(
  material: THREE.Material,
  time: number,
): void {
  const uniform = material.userData.waterTime as WaterTimeUniform | undefined;
  if (uniform) uniform.value = time;
}
