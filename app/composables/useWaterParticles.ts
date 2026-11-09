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
  water: boolean;
}

export interface WaterDropletSystem {
  readonly object: THREE.Object3D;
  update(frame: WaterFrameState): void;
  dispose(): void;
}

/** A small pool of localized splash droplets and soap micro-bubbles. */
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
    water: false,
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
  const previousWaterOrigin = new THREE.Vector3();
  const waterOrigin = new THREE.Vector3();
  let hasPreviousWaterOrigin = false;
  const basinBounds = new THREE.Box3();
  const basinMatrix = new THREE.Matrix4();
  let basinMesh: THREE.Mesh | null = null;
  let basinGeometry: THREE.BufferGeometry | null = null;

  function updateBasin(frame: WaterFrameState): void {
    const surface = frame.sinkWaterSurface;
    if (!surface) {
      basinMesh = null;
      basinGeometry = null;
      basinBounds.makeEmpty();
      return;
    }
    surface.updateWorldMatrix(true, false);
    if (surface === basinMesh && surface.geometry === basinGeometry && basinMatrix.equals(surface.matrixWorld)) return;
    if (!surface.geometry.boundingBox) surface.geometry.computeBoundingBox();
    basinMesh = surface;
    basinGeometry = surface.geometry;
    basinMatrix.copy(surface.matrixWorld);
    if (surface.geometry.boundingBox) basinBounds.copy(surface.geometry.boundingBox).applyMatrix4(surface.matrixWorld);
    else basinBounds.makeEmpty();
  }

  function advanceWater(delta: number, frame: WaterFrameState): boolean {
    let dirty = false;
    for (let index = 0; index < capacity; index++) {
      const particle = particles[index]!;
      if (!particle.active || !particle.water) continue;
      particle.age += delta;
      const nextX = particle.x + particle.vx * delta;
      const nextY = particle.y + particle.vy * delta - gravity * delta * delta * 0.5;
      const nextZ = particle.z + particle.vz * delta;
      const nextVy = particle.vy - gravity * delta;
      let absorbed = false;
      // Merge descending water into the basin's mean water plane. The cached
      // bounds avoid raycasting every particle or affecting the foam particles.
      const waterY = frame.streamEnd.y;
      if (!basinBounds.isEmpty() && nextVy < 0 && nextY <= waterY
        && waterY >= basinBounds.min.y - 0.02 && waterY <= basinBounds.max.y + 0.02) {
        const height = Math.max(0, particle.y - waterY);
        const root = Math.sqrt(particle.vy * particle.vy + 2 * gravity * height);
        const hitTime = height > 0 ? Math.min(delta, 2 * height / Math.max(1e-8, root - particle.vy)) : 0;
        const hitX = particle.x + particle.vx * hitTime, hitZ = particle.z + particle.vz * hitTime;
        absorbed = hitX >= basinBounds.min.x && hitX <= basinBounds.max.x
          && hitZ >= basinBounds.min.z && hitZ <= basinBounds.max.z;
      }
      if (particle.age >= particle.lifetime - 1e-10 || absorbed) {
        particle.active = false;
        particle.y = -1000;
        positions[index * 3 + 1] = -1000;
        sizes[index] = 0;
        opacities[index] = 0;
        freeSlots.push(index);
      } else {
        particle.x = nextX; particle.y = nextY; particle.z = nextZ; particle.vy = nextVy;
        positions[index * 3] = particle.x;
        positions[index * 3 + 1] = particle.y;
        positions[index * 3 + 2] = particle.z;
        sizes[index] = particle.size;
        opacities[index] = 0.78 * (1 - particle.age / particle.lifetime);
      }
      dirty = true;
    }
    return dirty;
  }

  function clearAllParticles(): void {
    emissionAccumulator = 0;
    hasPreviousWaterOrigin = false;
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
    particle.water = !isFoamMode;

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
      // Keep the splash close to the actual stream impact instead of spraying
      // wide, disconnected droplets across the basin.
      const horizontalSpeed = 0.14 + Math.random() * 0.22;
      const sourceSpread = Math.max(0.02, Math.min(0.07, resolved.streamRadius * 1.25));
      particle.x = origin.x + (Math.random() - 0.5) * sourceSpread;
      particle.y = origin.y + 0.004 + Math.random() * 0.018;
      particle.z = origin.z + (Math.random() - 0.5) * sourceSpread;
      particle.vx = Math.cos(angle) * horizontalSpeed;
      particle.vy = 0.10 + Math.random() * 0.22;
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

    updateBasin(frame);
    let dirty = false;
    if (!canEmit) {
      emissionAccumulator = 0;
      hasPreviousWaterOrigin = false;
      dirty = advanceWater(frame.delta, frame) || dirty;
    } else if (isFoamMode) {
      hasPreviousWaterOrigin = false;
      const effectiveRate = Math.max(0, resolved.particleRate * frame.particleIntensity);
      emissionAccumulator += frame.delta * effectiveRate;
      while (emissionAccumulator >= 1) {
        emissionAccumulator -= 1;
        spawn(frame.foamWorldCenter, true);
      }
      dirty = advanceWater(frame.delta, frame) || dirty;
    } else {
      const rate = Math.max(0, resolved.particleRate * frame.particleIntensity);
      const count = Math.floor(emissionAccumulator + frame.delta * rate + 1e-10);
      let advanced = 0;
      if (!hasPreviousWaterOrigin) previousWaterOrigin.copy(frame.splashOrigin);
      // Advance to each birth time so new droplets receive only the remaining
      // frame time. Analytical gravity then follows the same arc at every FPS.
      for (let birth = 0; birth < count; birth++) {
        const at = THREE.MathUtils.clamp((birth + 1 - emissionAccumulator) / rate, advanced, frame.delta);
        dirty = advanceWater(at - advanced, frame) || dirty;
        waterOrigin.lerpVectors(previousWaterOrigin, frame.splashOrigin, frame.delta > 0 ? at / frame.delta : 1);
        spawn(waterOrigin, false);
        advanced = at;
      }
      emissionAccumulator = Math.max(0, emissionAccumulator + frame.delta * rate - count);
      dirty = advanceWater(frame.delta - advanced, frame) || dirty;
      previousWaterOrigin.copy(frame.splashOrigin);
      hasPreviousWaterOrigin = true;
    }

    for (let index = 0; index < capacity; index++) {
      const particle = particles[index];
      if (!particle?.active || particle.water) continue;
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
