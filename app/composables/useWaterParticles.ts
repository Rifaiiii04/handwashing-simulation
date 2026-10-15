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
  life: number;
  maxLife: number;
  size: number;
  kind: number;
  active: boolean;
}

export interface WaterDropletSystem {
  readonly object: THREE.Object3D;
  update(frame: WaterFrameState): void;
  dispose(): void;
}

/** Small pooled droplet layer. Continuous flow remains in the dedicated meshes. */
export function createWaterDropletSystem(
  config: Partial<WaterParticleConfig> = {},
): WaterDropletSystem {
  const resolved = { ...DEFAULT_WATER_CONFIG, ...config };
  const capacity = Math.min(400, Math.max(32, resolved.maxSplashParticles ?? 220));
  const particles: Droplet[] = Array.from({ length: capacity }, () => ({
    x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0,
    life: 0, maxLife: 1, size: resolved.particleSize ?? 0.022, kind: 0, active: false,
  }));
  const freeSlots: number[] = Array.from({ length: capacity }, (_, index) => capacity - index - 1);
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const kinds = new Float32Array(capacity);
  for (let i = 0; i < capacity; i++) positions[i * 3 + 1] = -9999;

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  const alphaAttribute = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
  const kindAttribute = new THREE.BufferAttribute(kinds, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("aSize", sizeAttribute);
  geometry.setAttribute("aAlpha", alphaAttribute);
  geometry.setAttribute("aKind", kindAttribute);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uWaterColor: { value: new THREE.Color(resolved.color) },
      uDeepColor: { value: new THREE.Color(resolved.deepColor ?? 0x003d99) },
      uBubbleColor: { value: new THREE.Color(0x55bfff) },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute float aKind;
      varying float vAlpha;
      varying float vKind;
      void main() {
        vAlpha = aAlpha;
        vKind = aKind;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (220.0 / max(1.0, -viewPosition.z));
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uWaterColor;
      uniform vec3 uDeepColor;
      uniform vec3 uBubbleColor;
      varying float vAlpha;
      varying float vKind;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p) * 2.0;
        float edge = fwidth(d) * 0.8 + 0.002;
        float mask = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, d);
        if (mask < 0.002 || vAlpha < 0.002) discard;
        vec3 color = mix(uWaterColor, uDeepColor, smoothstep(0.05, 1.0, d) * 0.45);
        color = mix(color, uBubbleColor, step(0.5, vKind) * 0.55);
        float alpha = mask * vAlpha * mix(1.0, 0.68, step(0.5, vKind));
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.name = "WaterDropletPool";
  points.frustumCulled = false;
  const object = new THREE.Group();
  object.name = "WaterDropletsEffect";
  object.add(points);

  let handSplashAccumulator = 0;
  let bubbleAccumulator = 0;
  let runoffAccumulator = 0;
  let basinSplashAccumulator = 0;
  const gravity = resolved.gravity ?? 9.81;
  const lifetime = resolved.particleLifetime ?? 0.8;
  const tempPosition = new THREE.Vector3();
  const tempVelocity = new THREE.Vector3();
  const splashSide = new THREE.Vector3();
  const drainDirection = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);

  function spawn(
    position: THREE.Vector3,
    velocityX: number,
    velocityY: number,
    velocityZ: number,
    size: number,
    kind = 0,
  ): void {
    const slot = freeSlots.pop();
    if (slot === undefined) return;
    const particle = particles[slot];
    if (!particle) return;
    particle.x = position.x;
    particle.y = position.y;
    particle.z = position.z;
    particle.vx = velocityX;
    particle.vy = velocityY;
    particle.vz = velocityZ;
    particle.life = lifetime * (0.55 + Math.random() * 0.55);
    particle.maxLife = particle.life;
    particle.size = size * (0.75 + Math.random() * 0.5);
    particle.kind = kind;
    particle.active = true;
  }

  const impactPosition = new THREE.Vector3();
  const surfaceNormal = new THREE.Vector3();
  function update(frame: WaterFrameState): void {
    const dt = frame.delta;
    if (!frame.active || !frame.ready) return;

    if (frame.hit?.hit && frame.hit.hitTarget === "hand") {
      handSplashAccumulator += dt * 10;
      const count = Math.floor(handSplashAccumulator);
      handSplashAccumulator -= count;
      impactPosition.copy(frame.hit.point).addScaledVector(frame.hit.normal, 0.004);
      surfaceNormal.copy(frame.hit.normal).normalize();
      splashSide.crossVectors(surfaceNormal, frame.handFlowDirection).normalize();
      for (let i = 0; i < count; i++) {
        const lateral = (Math.random() - 0.5) * 0.22;
        const speed = 0.14 + Math.random() * 0.18;
        spawn(
          impactPosition,
          frame.handFlowDirection.x * speed + surfaceNormal.x * 0.10 + splashSide.x * lateral,
          0.08 + Math.random() * 0.20 + Math.max(0, surfaceNormal.y) * 0.08,
          frame.handFlowDirection.z * speed + surfaceNormal.z * 0.10 + splashSide.z * lateral,
          0.014 + Math.random() * 0.014,
        );
      }
      bubbleAccumulator += dt * 1.6;
      const bubbleCount = Math.floor(bubbleAccumulator);
      bubbleAccumulator -= bubbleCount;
      for (let i = 0; i < bubbleCount; i++) {
        spawn(
          impactPosition,
          surfaceNormal.x * 0.04,
          0.10 + Math.random() * 0.08,
          surfaceNormal.z * 0.04,
          0.010 + Math.random() * 0.005,
          1,
        );
      }
      if (frame.hasHandFlow) {
        runoffAccumulator += dt * 5;
        const dripCount = Math.floor(runoffAccumulator);
        runoffAccumulator -= dripCount;
        for (let i = 0; i < dripCount; i++) {
          const jitterX = (Math.random() - 0.5) * 0.018;
          const jitterZ = (Math.random() - 0.5) * 0.018;
          spawn(
            frame.handExit,
            frame.handFlowDirection.x * 0.22 + jitterX,
            Math.min(-0.04, frame.handFlowDirection.y * 0.28),
            frame.handFlowDirection.z * 0.22 + jitterZ,
            0.012 + Math.random() * 0.012,
          );
        }
      } else {
        runoffAccumulator = 0;
      }
    } else {
      handSplashAccumulator = 0;
      bubbleAccumulator = 0;
      runoffAccumulator = 0;
    }

    if (frame.collision && frame.basinImpact.lengthSq() > 0) {
      basinSplashAccumulator += dt * 7;
      const count = Math.floor(basinSplashAccumulator);
      basinSplashAccumulator -= count;
      impactPosition.copy(frame.basinImpact);
      drainDirection.subVectors(frame.collision.drainCenter, impactPosition);
      drainDirection.y = 0;
      if (drainDirection.lengthSq() > 0.0001) drainDirection.normalize();
      else drainDirection.set(0, 0, -1);
      splashSide.crossVectors(worldUp, drainDirection).normalize();
      for (let i = 0; i < count; i++) {
        const lateral = (Math.random() - 0.5) * 0.14;
        const speed = 0.08 + Math.random() * 0.18;
        spawn(
          impactPosition,
          drainDirection.x * speed + splashSide.x * lateral,
          0.08 + Math.random() * 0.16,
          drainDirection.z * speed + splashSide.z * lateral,
          0.012 + Math.random() * 0.012,
        );
      }
    }

    let dirty = false;
    for (let i = 0; i < capacity; i++) {
      const particle = particles[i];
      if (!particle?.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        particle.y = -9999;
        positions[i * 3 + 1] = -9999;
        alphas[i] = 0;
        sizes[i] = 0;
        freeSlots.push(i);
        dirty = true;
        continue;
      }

      if (particle.kind === 1) particle.vy += 0.42 * dt;
      else particle.vy -= gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      if (frame.collision) {
        tempPosition.set(particle.x, particle.y, particle.z);
        tempVelocity.set(particle.vx, particle.vy, particle.vz);
        const result = frame.collision.resolveParticleCollision(tempPosition, tempVelocity);
        if (result.collided) {
          particle.x = tempPosition.x;
          particle.y = tempPosition.y;
          particle.z = tempPosition.z;
          particle.vx = tempVelocity.x;
          particle.vy = tempVelocity.y;
          particle.vz = tempVelocity.z;
          if (result.stopped) {
            particle.life = 0;
            continue;
          }
        }
      }
      positions[i * 3] = particle.x;
      positions[i * 3 + 1] = particle.y;
      positions[i * 3 + 2] = particle.z;
      sizes[i] = particle.size;
      alphas[i] = THREE.MathUtils.smoothstep(particle.life / particle.maxLife, 0, 0.18) * 0.9;
      kinds[i] = particle.kind;
      dirty = true;
    }
    if (dirty) {
      positionAttribute.needsUpdate = true;
      sizeAttribute.needsUpdate = true;
      alphaAttribute.needsUpdate = true;
      kindAttribute.needsUpdate = true;
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
