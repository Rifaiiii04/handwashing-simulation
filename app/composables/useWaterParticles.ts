import * as THREE from "three";
import { DEFAULT_WATER_CONFIG, type WaterParticleConfig } from "~/components/handwashing/water/waterConfig";
import type { WaterFrameState } from "~/components/handwashing/water/waterRuntime";

export { DEFAULT_WATER_CONFIG } from "~/components/handwashing/water/waterConfig";
export type { WaterParticleConfig, WaterSystemConfig } from "~/components/handwashing/water/waterConfig";

interface Droplet {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravityScale: number;
  age: number;
  lifetime: number;
  size: number;
  active: boolean;
}

export interface WaterDropletSystem {
  readonly object: THREE.Object3D;
  update(frame: WaterFrameState): void;
  dispose(): void;
}

/** A small, collision-free pool of hand-localized splash droplets and soap micro-bubbles. */
export function createWaterDropletSystem(
  config: Partial<WaterParticleConfig> = {},
): WaterDropletSystem {
  const resolved = { ...DEFAULT_WATER_CONFIG, ...config };
  const capacity = THREE.MathUtils.clamp(Math.floor(resolved.particleCount), 12, 128);
  const particles: Droplet[] = Array.from({ length: capacity }, () => ({
    x: 0,
    y: -1000,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    gravityScale: 1,
    age: 0,
    lifetime: resolved.particleLifetime,
    size: 0,
    active: false,
  }));
  const freeSlots = Array.from({ length: capacity }, (_, index) => capacity - index - 1);
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const opacities = new Float32Array(capacity);
  for (let index = 0; index < capacity; index++) positions[index * 3 + 1] = -1000;

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  const opacityAttribute = new THREE.BufferAttribute(opacities, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("aSize", sizeAttribute);
  geometry.setAttribute("aOpacity", opacityAttribute);

  const waterTint = new THREE.Color(0x7ad4ff);
  const foamTint = new THREE.Color(0xe6fbff);
  const activeColor = new THREE.Color(0x9ee5ff);

  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: activeColor } },
    vertexShader: `
      attribute float aSize;
      attribute float aOpacity;
      varying float vOpacity;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = max(1.0, aSize * (250.0 / max(0.001, -viewPosition.z)));
        vOpacity = aOpacity;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vOpacity;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        float edge = 1.0 - smoothstep(0.34, 0.5, radius);
        gl_FragColor = vec4(uColor, edge * vOpacity);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "HandSplashParticlePool";
  points.frustumCulled = false;
  const object = new THREE.Group();
  object.name = "WaterDropletsEffect";
  object.add(points);

  let emissionAccumulator = 0;
  let lastResetToken = -1;
  const gravity = Math.max(0, resolved.particleGravity);
  const baseLifetime = Math.max(0.12, resolved.particleLifetime);
  const baseSize = Math.max(0.006, resolved.particleSize);

  function clearAllParticles(): void {
    emissionAccumulator = 0;
    freeSlots.length = 0;
    for (let index = 0; index < capacity; index++) {
      const particle = particles[index]!;
      particle.active = false;
      particle.age = 0;
      particle.y = -1000;
      positions[index * 3] = 0;
      positions[index * 3 + 1] = -1000;
      positions[index * 3 + 2] = 0;
      sizes[index] = 0;
      opacities[index] = 0;
      freeSlots.push(capacity - index - 1);
    }
    positionAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
    opacityAttribute.needsUpdate = true;
  }

  function spawn(origin: THREE.Vector3, isFoamMode: boolean): void {
    const slot = freeSlots.pop();
    if (slot === undefined) return;
    const particle = particles[slot];
    if (!particle) return;

    const angle = Math.random() * Math.PI * 2;
    if (isFoamMode) {
      // Restrained localized tiny foam/soap micro-bubbles around the rubbing contact area
      const horizontalSpeed = 0.03 + Math.random() * 0.08;
      particle.x = origin.x + (Math.random() - 0.5) * 0.085;
      particle.y = origin.y + (Math.random() - 0.5) * 0.065;
      particle.z = origin.z + (Math.random() - 0.5) * 0.085;
      particle.vx = Math.cos(angle) * horizontalSpeed;
      particle.vy = 0.04 + Math.random() * 0.09;
      particle.vz = Math.sin(angle) * horizontalSpeed;
      particle.gravityScale = 0.1;
      particle.age = 0;
      particle.lifetime = baseLifetime * (0.95 + Math.random() * 0.65);
      particle.size = baseSize * (0.62 + Math.random() * 0.48);
      particle.active = true;
    } else {
      // Dynamic, expansive water splash droplets when washing hands under the stream
      const horizontalSpeed = 0.22 + Math.random() * 0.45;
      particle.x = origin.x + (Math.random() - 0.5) * 0.18;
      particle.y = origin.y + (Math.random() - 0.15) * 0.035;
      particle.z = origin.z - Math.random() * 0.16 + 0.04;
      particle.vx = Math.cos(angle) * horizontalSpeed;
      particle.vy = 0.10 + Math.random() * 0.32;
      particle.vz = Math.sin(angle) * horizontalSpeed;
      particle.gravityScale = 1.0;
      particle.age = 0;
      particle.lifetime = baseLifetime * (0.75 + Math.random() * 0.65);
      particle.size = baseSize * (0.80 + Math.random() * 0.70);
      particle.active = true;
    }
  }

  function update(frame: WaterFrameState): void {
    if (frame.resetToken !== lastResetToken) {
      lastResetToken = frame.resetToken;
      clearAllParticles();
    }
    if (!frame.active) return;

    const isFoamMode = frame.particleMode === "foam";
    activeColor.copy(isFoamMode ? foamTint : waterTint);

    const canEmit =
      frame.ready &&
      frame.splashActive &&
      frame.particleMode !== "none" &&
      frame.particleIntensity > 0.005;

    if (!canEmit) {
      emissionAccumulator = 0;
    } else {
      const effectiveRate = Math.max(0, resolved.particleRate * frame.particleIntensity);
      emissionAccumulator += frame.delta * effectiveRate;
      const spawnOrigin = isFoamMode ? frame.foamWorldCenter : frame.splashOrigin;
      while (emissionAccumulator >= 1) {
        emissionAccumulator -= 1;
        spawn(spawnOrigin, isFoamMode);
      }
    }

    let dirty = false;
    for (let index = 0; index < capacity; index++) {
      const particle = particles[index];
      if (!particle?.active) continue;
      particle.age += frame.delta;
      if (particle.age >= particle.lifetime) {
        particle.active = false;
        particle.y = -1000;
        positions[index * 3 + 1] = -1000;
        sizes[index] = 0;
        opacities[index] = 0;
        freeSlots.push(index);
        dirty = true;
        continue;
      }

      const delta = frame.delta;
      particle.vy -= gravity * particle.gravityScale * delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.z += particle.vz * delta;
      positions[index * 3] = particle.x;
      positions[index * 3 + 1] = particle.y;
      positions[index * 3 + 2] = particle.z;
      sizes[index] = particle.size;
      opacities[index] = 0.78 * (1 - particle.age / particle.lifetime);
      dirty = true;
    }

    if (dirty) {
      positionAttribute.needsUpdate = true;
      sizeAttribute.needsUpdate = true;
      opacityAttribute.needsUpdate = true;
    }
  }

  return {
    object,
    update,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
