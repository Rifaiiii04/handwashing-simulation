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

/** A small, collision-free pool of hand-localized splash points. */
export function createWaterDropletSystem(
  config: Partial<WaterParticleConfig> = {},
): WaterDropletSystem {
  const resolved = { ...DEFAULT_WATER_CONFIG, ...config };
  const capacity = THREE.MathUtils.clamp(Math.floor(resolved.particleCount), 12, 96);
  const particles: Droplet[] = Array.from({ length: capacity }, () => ({
    x: 0,
    y: -1000,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
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

  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(resolved.foamColor) } },
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
  const gravity = Math.max(0, resolved.particleGravity);
  const baseLifetime = Math.max(0.12, resolved.particleLifetime);
  const baseSize = Math.max(0.006, resolved.particleSize);

  function spawn(origin: THREE.Vector3): void {
    const slot = freeSlots.pop();
    if (slot === undefined) return;
    const particle = particles[slot];
    if (!particle) return;

    const angle = Math.random() * Math.PI * 2;
    const horizontalSpeed = 0.08 + Math.random() * 0.2;
    const startOffset = (Math.random() - 0.5) * 0.036;
    particle.x = origin.x + (Math.random() - 0.5) * 0.038;
    particle.y = origin.y + startOffset;
    particle.z = origin.z + (Math.random() - 0.5) * 0.038;
    particle.vx = Math.cos(angle) * horizontalSpeed;
    particle.vy = 0.05 + Math.random() * 0.16;
    particle.vz = Math.sin(angle) * horizontalSpeed;
    particle.age = 0;
    particle.lifetime = baseLifetime * (0.68 + Math.random() * 0.64);
    particle.size = baseSize * (0.72 + Math.random() * 0.62);
    particle.active = true;
  }

  function update(frame: WaterFrameState): void {
    if (!frame.active) return;
    if (!frame.ready || !frame.splashActive) {
      emissionAccumulator = 0;
    }
    if (frame.ready && frame.splashActive) {
      emissionAccumulator += frame.delta * Math.max(0, resolved.particleRate);
      while (emissionAccumulator >= 1) {
        emissionAccumulator -= 1;
        spawn(frame.splashOrigin);
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
      particle.vy -= gravity * delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.z += particle.vz * delta;
      positions[index * 3] = particle.x;
      positions[index * 3 + 1] = particle.y;
      positions[index * 3 + 2] = particle.z;
      sizes[index] = particle.size;
      opacities[index] = 0.8 * (1 - particle.age / particle.lifetime);
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
