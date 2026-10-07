import * as THREE from "three";

export interface WaterParticleConfig {
  particleCount: number;
  spawnRate: number;
  gravity: number;
  initialVelocityY: number;
  particleLifetime: number;
  particleSize: number;
  spreadX: number;
  spreadZ: number;
  spreadVelocityX: number;
  spreadVelocityZ: number;
  color: THREE.ColorRepresentation;
  opacity: number;
}

export const DEFAULT_WATER_CONFIG: WaterParticleConfig = {
  particleCount: 400,
  spawnRate: 120,
  gravity: -9.81,
  initialVelocityY: -2.5,
  particleLifetime: 1.5,
  particleSize: 0.018,
  spreadX: 0.008,
  spreadZ: 0.008,
  spreadVelocityX: 0.05,
  spreadVelocityZ: 0.05,
  color: 0x9edcff,
  opacity: 0.9,
};

interface ParticleState {
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  age: number;
  alive: boolean;
}

function getSpawnDirection(source?: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3(0, -1, 0);
}

function getSpawnPosition(
  spawnWorldPos: THREE.Vector3,
  config: WaterParticleConfig,
): THREE.Vector3 {
  return new THREE.Vector3(
    spawnWorldPos.x + (Math.random() - 0.5) * config.spreadX * 2,
    spawnWorldPos.y,
    spawnWorldPos.z + (Math.random() - 0.5) * config.spreadZ * 2,
  );
}

export function createWaterParticleSystem(
  config: WaterParticleConfig = DEFAULT_WATER_CONFIG,
) {
  const count = config.particleCount;

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1);

  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("size", sizeAttribute);

const material = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,

  uniforms: {
    uColor: {
      value: new THREE.Color(config.color),
    },
    uOpacity: {
      value: config.opacity,
    },
    uSize: {
      value: 40.0,
    },
  },

  vertexShader: `
    uniform float uSize;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      gl_Position = projectionMatrix * mvPosition;

      gl_PointSize = max(4.0, uSize / max(-mvPosition.z, 0.1));
    }
  `,

  fragmentShader: `
    uniform vec3 uColor;
    uniform float uOpacity;

    void main() {
      vec2 uv = gl_PointCoord - 0.5;

      float distanceFromCenter = length(uv);

      if (distanceFromCenter > 0.5) {
        discard;
      }

      float alpha = 1.0 - smoothstep(
        0.2,
        0.5,
        distanceFromCenter
      );

      gl_FragColor = vec4(
        uColor,
        alpha * uOpacity
      );
    }
  `,
});

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  const particles: ParticleState[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      age: config.particleLifetime + 1,
      alive: false,
    });
    positions[i * 3] = 0;
    positions[i * 3 + 1] = -9999;
    positions[i * 3 + 2] = 0;
    sizes[i] = 0;
  }

  let spawnAccumulator = 0;

  function resetParticle(
    index: number,
    spawnWorldPos: THREE.Vector3,
    spawnSource?: THREE.Object3D,
  ) {
    const particle = particles[index];
    if (!particle) return;

    const pos = getSpawnPosition(spawnWorldPos, config);
    const dir = getSpawnDirection(spawnSource);

    particle.velocityX =
      dir.x * Math.abs(config.initialVelocityY) +
      (Math.random() - 0.5) * config.spreadVelocityX * 2;
    particle.velocityY = dir.y * Math.abs(config.initialVelocityY);
    particle.velocityZ =
      dir.z * Math.abs(config.initialVelocityY) +
      (Math.random() - 0.5) * config.spreadVelocityZ * 2;
    particle.age = 0;
    particle.alive = true;

    positions[index * 3] = pos.x;
    positions[index * 3 + 1] = pos.y;
    positions[index * 3 + 2] = pos.z;
    sizes[index] = config.particleSize;
  }

  function findDeadParticle(): number {
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      if (p && !p.alive) return i;
    }
    let oldest = 0;
    let maxAge = 0;
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      if (p && p.age > maxAge) {
        maxAge = p.age;
        oldest = i;
      }
    }
    return oldest;
  }

  function update(
    delta: number,
    spawnWorldPos: THREE.Vector3,
    spawnSource?: THREE.Object3D,
  ) {
    const clampedDelta = Math.min(delta, 0.05);

    spawnAccumulator += clampedDelta;
    const spawnInterval = 1 / config.spawnRate;
    while (spawnAccumulator >= spawnInterval) {
      spawnAccumulator -= spawnInterval;
      const idx = findDeadParticle();
      resetParticle(idx, spawnWorldPos, spawnSource);
    }

    for (let i = 0; i < count; i++) {
      const p = particles[i];
      if (!p || !p.alive) continue;

      p.age += clampedDelta;

      const idx3 = i * 3;

      if (p.age >= config.particleLifetime) {
        p.alive = false;
        positions[idx3 + 1] = -9999;
        sizes[i] = 0;
        continue;
      }

      p.velocityY += config.gravity * clampedDelta;

      const currentX = positions[idx3] ?? 0;
      const currentY = positions[idx3 + 1] ?? 0;
      const currentZ = positions[idx3 + 2] ?? 0;

      positions[idx3] = currentX + p.velocityX * clampedDelta;
      positions[idx3 + 1] = currentY + p.velocityY * clampedDelta;
      positions[idx3 + 2] = currentZ + p.velocityZ * clampedDelta;

      const lifeRatio = p.age / config.particleLifetime;
      sizes[i] = config.particleSize * (1 - lifeRatio * 0.3);
    }

    positionAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return {
    points,
    update,
    dispose,
    config,
  };
}
