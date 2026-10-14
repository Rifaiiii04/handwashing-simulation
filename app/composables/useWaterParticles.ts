import * as THREE from "three";
import type { StreamHit, WaterCollisionSystem } from "./useWaterCollision";

export interface WaterParticleConfig {
  /** Base vibrant toon water color */
  color: THREE.ColorRepresentation;
  /** Deep water tone */
  deepColor?: THREE.ColorRepresentation;
  /** Water opacity */
  opacity: number;
  /** Top radius at faucet spout */
  radiusTop?: number;
  /** Bottom radius before impact */
  radiusBottom?: number;
  /** Flow speed of water texture and stream */
  flowSpeed?: number;
  /** Max splash particles */
  maxSplashParticles?: number;
  /** Backwards compatibility legacy properties */
  streamLength?: number;
  particleCount?: number;
  spawnRate?: number;
  gravity?: number;
  initialVelocityY?: number;
  particleLifetime?: number;
  particleSize?: number;
  spreadX?: number;
  spreadZ?: number;
  spreadVelocityX?: number;
  spreadVelocityZ?: number;
}

export const DEFAULT_WATER_CONFIG: WaterParticleConfig = {
  color: 0x168dff,
  deepColor: 0x0b5fb3,
  opacity: 0.92,
  // Sized against the actual faucet outlet: visibly strong without covering the hands.
  radiusTop: 0.052,
  radiusBottom: 0.038,
  flowSpeed: 3.5,
  maxSplashParticles: 120,
};

// Particle classifications
const PTYPE_SPLASH = 0; // Outward bounce from impact
const PTYPE_DRIP = 1; // Downward runoff drip
const PTYPE_BASIN = 2; // Basin surface droplet sliding to drain

interface SplashParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  alpha: number;
  active: boolean;
  ptype: number;
}

export function createWaterParticleSystem(
  userConfig: Partial<WaterParticleConfig> = {},
) {
  const config: WaterParticleConfig = { ...DEFAULT_WATER_CONFIG, ...userConfig };

  // Root group for all water visual elements (placed at world origin 0,0,0)
  const group = new THREE.Group();
  group.name = "WaterStreamGroup";

  const radiusTop = config.radiusTop ?? 0.034;
  const radiusBottom = config.radiusBottom ?? 0.024;
  const radialSegments = 16;
  const streamRings = 14;

  // ── 1. Faucet Stream Mesh (Spout → Impact Point) ──────────────────────────
  // A small dynamic tube makes the silhouette react only near a real impact.
  // It is not a scaled primitive, so it avoids the rigid-pipe appearance.
  const streamPositions = new Float32Array(streamRings * radialSegments * 3);
  const streamNormals = new Float32Array(streamRings * radialSegments * 3);
  const streamUvs = new Float32Array(streamRings * radialSegments * 2);
  const streamIndices = new Uint16Array((streamRings - 1) * radialSegments * 6);
  for (let ring = 0; ring < streamRings; ring++) {
    for (let segment = 0; segment < radialSegments; segment++) {
      const vertex = ring * radialSegments + segment;
      const angle = (segment / radialSegments) * Math.PI * 2;
      const normalX = Math.cos(angle);
      const normalZ = Math.sin(angle);
      streamNormals[vertex * 3] = normalX;
      streamNormals[vertex * 3 + 1] = 0;
      streamNormals[vertex * 3 + 2] = normalZ;
      streamUvs[vertex * 2] = segment / radialSegments;
      streamUvs[vertex * 2 + 1] = ring / (streamRings - 1);
      if (ring < streamRings - 1) {
        const nextSegment = (segment + 1) % radialSegments;
        const index = (ring * radialSegments + segment) * 6;
        const nextRing = (ring + 1) * radialSegments;
        streamIndices[index] = vertex;
        streamIndices[index + 1] = nextRing + segment;
        streamIndices[index + 2] = ring * radialSegments + nextSegment;
        streamIndices[index + 3] = ring * radialSegments + nextSegment;
        streamIndices[index + 4] = nextRing + segment;
        streamIndices[index + 5] = nextRing + nextSegment;
      }
    }
  }
  const streamPosAttr = new THREE.BufferAttribute(streamPositions, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const faucetGeometry = new THREE.BufferGeometry();
  faucetGeometry.setAttribute("position", streamPosAttr);
  faucetGeometry.setAttribute("normal", new THREE.BufferAttribute(streamNormals, 3));
  faucetGeometry.setAttribute("uv", new THREE.BufferAttribute(streamUvs, 2));
  faucetGeometry.setIndex(new THREE.BufferAttribute(streamIndices, 1));

  const streamMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,

    uniforms: {
      uDeepColor: { value: new THREE.Color(config.deepColor ?? 0x0b5fb3) },
      uSurfaceColor: { value: new THREE.Color(config.color ?? 0x168dff) },
      uOpacity: { value: config.opacity },
    },

    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vUv = uv;

        vec3 pos = position;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3 uDeepColor;
      uniform vec3 uSurfaceColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);

        // Two blue toon bands keep the stream clean without procedural stripes.
        float NdotV = max(dot(N, V), 0.0);
        float fresnel = 1.0 - NdotV;
        float toonRim = smoothstep(0.42, 0.68, fresnel);
        vec3 lightDir = normalize(vec3(0.4, 0.8, 0.5));
        float NdotL = dot(N, lightDir);
        float lightBand = smoothstep(-0.10, 0.25, NdotL);

        vec3 waterColor = mix(uDeepColor, uSurfaceColor, 0.38 + lightBand * 0.50);
        waterColor = mix(waterColor, uDeepColor, toonRim * 0.18);

        // Soft emergence at spout and smooth bottom fade
        float topFade = 1.0 - smoothstep(0.95, 1.0, vUv.y);
        float bottomFade = smoothstep(0.0, 0.05, vUv.y);
        float streamAlpha = uOpacity * topFade * bottomFade;

        streamAlpha = mix(streamAlpha * 0.8, streamAlpha, toonRim * 0.4 + 0.6);

        gl_FragColor = vec4(waterColor, streamAlpha);
      }
    `,
  });

  const faucetStreamMesh = new THREE.Mesh(faucetGeometry, streamMaterial);
  faucetStreamMesh.name = "FaucetStreamMesh";
  faucetStreamMesh.frustumCulled = false;
  group.add(faucetStreamMesh);

  // ── 2. Contact Sheet (Hand Impact → Surface Runoff) ──────────────────────
  const impactRows = 4;
  const impactColumns = 7;
  const impactPositions = new Float32Array(impactRows * impactColumns * 3);
  const impactUvs = new Float32Array(impactRows * impactColumns * 2);
  const impactIndices = new Uint16Array((impactRows - 1) * (impactColumns - 1) * 6);
  for (let row = 0; row < impactRows; row++) {
    for (let column = 0; column < impactColumns; column++) {
      const vertex = row * impactColumns + column;
      impactUvs[vertex * 2] = column / (impactColumns - 1);
      impactUvs[vertex * 2 + 1] = row / (impactRows - 1);
      if (row < impactRows - 1 && column < impactColumns - 1) {
        const index = (row * (impactColumns - 1) + column) * 6;
        impactIndices[index] = vertex;
        impactIndices[index + 1] = vertex + impactColumns;
        impactIndices[index + 2] = vertex + 1;
        impactIndices[index + 3] = vertex + 1;
        impactIndices[index + 4] = vertex + impactColumns;
        impactIndices[index + 5] = vertex + impactColumns + 1;
      }
    }
  }
  const impactPosAttr = new THREE.BufferAttribute(impactPositions, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const impactGeometry = new THREE.BufferGeometry();
  impactGeometry.setAttribute("position", impactPosAttr);
  impactGeometry.setAttribute("uv", new THREE.BufferAttribute(impactUvs, 2));
  impactGeometry.setIndex(new THREE.BufferAttribute(impactIndices, 1));
  const impactMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uDeepColor: { value: new THREE.Color(config.deepColor ?? 0x0b5fb3) },
      uSurfaceColor: { value: new THREE.Color(config.color ?? 0x168dff) },
      uOpacity: { value: config.opacity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeepColor;
      uniform vec3 uSurfaceColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
        float tail = 1.0 - smoothstep(0.72, 1.0, vUv.y);
        if (edge * tail < 0.015) discard;
        vec3 col = mix(uSurfaceColor, uDeepColor, vUv.y * 0.32);
        gl_FragColor = vec4(col, uOpacity * edge * tail * 0.78);
      }
    `,
  });
  const impactFlowMesh = new THREE.Mesh(impactGeometry, impactMaterial);
  impactFlowMesh.name = "HandImpactFlowMesh";
  impactFlowMesh.visible = false;
  impactFlowMesh.frustumCulled = false;
  group.add(impactFlowMesh);

  // ── 3. Curved Runoff Volumes (Hand Edge → Basin) ─────────────────────────
  // Two tapered swept volumes provide liquid thickness without the identical
  // full-height cylinders that previously read as parallel blue pipes.
  const runoffPathCount = 2;
  const runoffSteps = 7;
  const runoffRadialSegments = 10;
  const runoffPositions = new Float32Array(
    runoffPathCount * (runoffSteps + 1) * runoffRadialSegments * 3,
  );
  const runoffNormals = new Float32Array(
    runoffPathCount * (runoffSteps + 1) * runoffRadialSegments * 3,
  );
  const runoffUvs = new Float32Array(
    runoffPathCount * (runoffSteps + 1) * runoffRadialSegments * 2,
  );
  const runoffIndices = new Uint16Array(
    runoffPathCount * runoffSteps * runoffRadialSegments * 6,
  );
  for (let path = 0; path < runoffPathCount; path++) {
    const vertexOffset = path * (runoffSteps + 1) * runoffRadialSegments;
    for (let step = 0; step <= runoffSteps; step++) {
      for (let segment = 0; segment < runoffRadialSegments; segment++) {
        const vertex = vertexOffset + step * runoffRadialSegments + segment;
        runoffUvs[vertex * 2] = segment / runoffRadialSegments;
        runoffUvs[vertex * 2 + 1] = step / runoffSteps;
        if (step < runoffSteps) {
          const nextSegment = (segment + 1) % runoffRadialSegments;
          const index = (path * runoffSteps * runoffRadialSegments + step * runoffRadialSegments + segment) * 6;
          const nextRing = vertex + runoffRadialSegments;
          runoffIndices[index] = vertex;
          runoffIndices[index + 1] = nextRing;
          runoffIndices[index + 2] = vertexOffset + step * runoffRadialSegments + nextSegment;
          runoffIndices[index + 3] = vertexOffset + step * runoffRadialSegments + nextSegment;
          runoffIndices[index + 4] = nextRing;
          runoffIndices[index + 5] = vertexOffset + (step + 1) * runoffRadialSegments + nextSegment;
        }
      }
    }
  }
  const runoffPosAttr = new THREE.BufferAttribute(runoffPositions, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const runoffGeometry = new THREE.BufferGeometry();
  runoffGeometry.setAttribute("position", runoffPosAttr);
  runoffGeometry.setAttribute("normal", new THREE.BufferAttribute(runoffNormals, 3));
  runoffGeometry.setAttribute("uv", new THREE.BufferAttribute(runoffUvs, 2));
  runoffGeometry.setIndex(new THREE.BufferAttribute(runoffIndices, 1));
  const handRunoffMesh = new THREE.Mesh(runoffGeometry, streamMaterial);
  handRunoffMesh.name = "HandRunoffFlowMesh";
  handRunoffMesh.visible = false;
  handRunoffMesh.frustumCulled = false;
  group.add(handRunoffMesh);

  // ── 4. Basin Flow Sheet (Impact Point → Drain Opening) ────────────────────
  const basinFlowSteps = 20;
  const numFlowVerts = (basinFlowSteps + 1) * 2;
  const flowPositions = new Float32Array(numFlowVerts * 3);
  const flowNormals = new Float32Array(numFlowVerts * 3);
  const flowUvs = new Float32Array(numFlowVerts * 2);
  const flowIndices = new Uint16Array(basinFlowSteps * 6);

  for (let i = 0; i <= basinFlowSteps; i++) {
    const t = i / basinFlowSteps;
    // Left vertex UV & Normal
    flowUvs[i * 4 + 0] = 0.0;
    flowUvs[i * 4 + 1] = t;
    flowNormals[i * 6 + 0] = 0;
    flowNormals[i * 6 + 1] = 1;
    flowNormals[i * 6 + 2] = 0;

    // Right vertex UV & Normal
    flowUvs[i * 4 + 2] = 1.0;
    flowUvs[i * 4 + 3] = t;
    flowNormals[i * 6 + 3] = 0;
    flowNormals[i * 6 + 4] = 1;
    flowNormals[i * 6 + 5] = 0;

    if (i < basinFlowSteps) {
      const row1 = i * 2;
      const row2 = (i + 1) * 2;
      flowIndices[i * 6 + 0] = row1;
      flowIndices[i * 6 + 1] = row2;
      flowIndices[i * 6 + 2] = row1 + 1;
      flowIndices[i * 6 + 3] = row1 + 1;
      flowIndices[i * 6 + 4] = row2;
      flowIndices[i * 6 + 5] = row2 + 1;
    }
  }

  const basinFlowPosAttr = new THREE.BufferAttribute(flowPositions, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const basinFlowNormAttr = new THREE.BufferAttribute(flowNormals, 3);
  const basinFlowUvAttr = new THREE.BufferAttribute(flowUvs, 2);
  const basinFlowIndexAttr = new THREE.BufferAttribute(flowIndices, 1);

  const basinFlowGeometry = new THREE.BufferGeometry();
  basinFlowGeometry.setAttribute("position", basinFlowPosAttr);
  basinFlowGeometry.setAttribute("normal", basinFlowNormAttr);
  basinFlowGeometry.setAttribute("uv", basinFlowUvAttr);
  basinFlowGeometry.setIndex(basinFlowIndexAttr);

  const basinFlowMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uDeepColor: { value: new THREE.Color(config.deepColor ?? 0x0b5fb3) },
      uSurfaceColor: { value: new THREE.Color(config.color ?? 0x168dff) },
      uOpacity: { value: config.opacity },
      uFlowProgress: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uFlowProgress;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeepColor;
      uniform vec3 uSurfaceColor;
      uniform float uOpacity;
      uniform float uFlowProgress;
      varying vec2 vUv;

      void main() {
        float edgeFade = smoothstep(0.0, 0.20, vUv.x) * (1.0 - smoothstep(0.80, 1.0, vUv.x));
        if (edgeFade < 0.01) discard;

        float startFade = smoothstep(0.0, 0.08, vUv.y);
        // Keep the throat visible almost to its lower end, then fade only as
        // it disappears inside the real drain opening.
        float endFade = 1.0 - smoothstep(0.99, 1.0, vUv.y);

        vec3 col = mix(uDeepColor, uSurfaceColor, 0.58 + edgeFade * 0.18);

        // The wetted path advances downstream from the landing point. It is
        // geometry-led progress, not a decorative moving stripe.
        float reached = 1.0 - smoothstep(uFlowProgress + 0.02, uFlowProgress + 0.07, vUv.y);
        float alpha = uOpacity * edgeFade * startFade * endFade * reached * 0.82;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const basinFlowMesh = new THREE.Mesh(basinFlowGeometry, basinFlowMaterial);
  basinFlowMesh.name = "BasinFlowMesh";
  basinFlowMesh.frustumCulled = false;
  group.add(basinFlowMesh);

  // ── 5. Splash & Drip Particle System ──────────────────────────────────────
  const maxParticles = config.maxSplashParticles ?? 120;
  const particles: SplashParticle[] = [];
  const freeList: number[] = [];

  for (let i = 0; i < maxParticles; i++) {
    particles.push({
      x: 0,
      y: -9999,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
      scale: 0.02,
      alpha: 0,
      active: false,
      ptype: PTYPE_SPLASH,
    });
    freeList.push(i);
  }

  const particlePositions = new Float32Array(maxParticles * 3);
  const particleScales = new Float32Array(maxParticles);
  const particleAlphas = new Float32Array(maxParticles);

  for (let i = 0; i < maxParticles; i++) {
    particlePositions[i * 3 + 1] = -9999;
  }

  const particleGeometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(particlePositions, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const scaleAttr = new THREE.BufferAttribute(particleScales, 1).setUsage(
    THREE.DynamicDrawUsage,
  );
  const alphaAttr = new THREE.BufferAttribute(particleAlphas, 1).setUsage(
    THREE.DynamicDrawUsage,
  );

  particleGeometry.setAttribute("position", posAttr);
  particleGeometry.setAttribute("aScale", scaleAttr);
  particleGeometry.setAttribute("aAlpha", alphaAttr);

  const particleMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uDeepColor: { value: new THREE.Color(config.deepColor ?? 0x0b5fb3) },
      uSurfaceColor: { value: new THREE.Color(config.color ?? 0x168dff) },
    },
    vertexShader: /* glsl */ `
      attribute float aScale;
      attribute float aAlpha;
      varying float vAlpha;

      void main() {
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aScale * (120.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeepColor;
      uniform vec3 uSurfaceColor;
      varying float vAlpha;

      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord) * 2.0;
        if (dist > 1.0 || vAlpha <= 0.001) discard;

        float core = 1.0 - smoothstep(0.0, 0.75, dist);
        vec3 col = mix(uDeepColor, uSurfaceColor, 0.35 + core * 0.45);

        float edgeFade = 1.0 - smoothstep(0.8, 1.0, dist);
        gl_FragColor = vec4(col, vAlpha * edgeFade);
      }
    `,
  });

  const particlePoints = new THREE.Points(particleGeometry, particleMaterial);
  particlePoints.name = "WaterSplashPoints";
  particlePoints.frustumCulled = false;

  const pointsRoot = new THREE.Group();
  pointsRoot.name = "WaterSplashPointsRoot";
  pointsRoot.add(particlePoints);

  // ── 5. Reusable temporaries (Zero runtime heap allocations) ────────────────
  const _tempPos = new THREE.Vector3();
  const _tempVel = new THREE.Vector3();
  const _vecDown = new THREE.Vector3(0, -1, 0);
  const _vecUp = new THREE.Vector3(0, 1, 0);
  const _impactTangent = new THREE.Vector3();
  const _impactSide = new THREE.Vector3();
  const _runoffTangent = new THREE.Vector3();
  const _runoffBinormal = new THREE.Vector3();
  const _lastBasinStart = new THREE.Vector3(Infinity, Infinity, Infinity);
  const _fallbackFaucetOrigin = new THREE.Vector3(0, 1.948, -0.668);
  const _fallbackHitPoint = new THREE.Vector3(0, 0.822, -0.668);
  const _fallbackRunoffPoint = new THREE.Vector3(0, 1.357, -0.668);
  const _fallbackBasinPoint = new THREE.Vector3(0, 0.822, -0.668);
  const _fallbackDrainCenter = new THREE.Vector3(0, 0.7282, -0.25);

  let basinFlowProgress = 0;
  let handSplashAccum = 0;
  let handDripAccum = 0;
  let basinSplashAccum = 0;

  function allocParticle(): SplashParticle | null {
    if (freeList.length === 0) return null;
    const idx = freeList.pop();
    if (idx === undefined) return null;
    const p = particles[idx];
    if (p) {
      p.active = true;
      return p;
    }
    return null;
  }

  function spawnImpactSplash(hitPoint: THREE.Vector3, hitNormal: THREE.Vector3): void {
    const p = allocParticle();
    if (!p) return;

    p.ptype = PTYPE_SPLASH;
    p.x = hitPoint.x + (Math.random() - 0.5) * 0.012;
    p.y = hitPoint.y + 0.003 + (Math.random() - 0.5) * 0.006;
    p.z = hitPoint.z + (Math.random() - 0.5) * 0.012;

    const speed = 0.28 + Math.random() * 0.32;
    const angle = Math.random() * Math.PI * 2;
    const tangentX = Math.cos(angle);
    const tangentZ = Math.sin(angle);

    p.vx = hitNormal.x * speed * 0.5 + tangentX * speed * 0.45;
    p.vy = Math.max(0.08, hitNormal.y * speed * 0.4 + 0.06 + Math.random() * 0.08);
    p.vz = hitNormal.z * speed * 0.5 + tangentZ * speed * 0.45;

    const life = 0.16 + Math.random() * 0.22;
    p.life = life;
    p.maxLife = life;
    p.scale = 0.008 + Math.random() * 0.008;
    p.alpha = 0.85;
  }

  function spawnDripRunoff(runoffPoint: THREE.Vector3, basinPoint: THREE.Vector3): void {
    const p = allocParticle();
    if (!p) return;

    p.ptype = PTYPE_DRIP;
    p.x = runoffPoint.x + (Math.random() - 0.5) * 0.025;
    p.y = runoffPoint.y - 0.005 - Math.random() * 0.01;
    p.z = runoffPoint.z + (Math.random() - 0.5) * 0.025;

    // A droplet carries the runoff's downhill direction when it separates.
    p.vx = (basinPoint.x - runoffPoint.x) * 0.45 + (Math.random() - 0.5) * 0.08;
    p.vy = -0.38 - Math.random() * 0.18;
    p.vz = (basinPoint.z - runoffPoint.z) * 0.45 + (Math.random() - 0.5) * 0.08;

    const life = 0.55 + Math.random() * 0.45;
    p.life = life;
    p.maxLife = life;
    p.scale = 0.008 + Math.random() * 0.008;
    p.alpha = 0.8;
  }

  function spawnBasinSplash(basinPoint: THREE.Vector3, drainCenter: THREE.Vector3): void {
    const p = allocParticle();
    if (!p) return;

    p.ptype = PTYPE_BASIN;
    p.x = basinPoint.x + (Math.random() - 0.5) * 0.015;
    p.y = basinPoint.y + 0.003;
    p.z = basinPoint.z + (Math.random() - 0.5) * 0.015;

    // These are travelling rivulets, not a stationary impact sparkle.
    p.vx = (drainCenter.x - basinPoint.x) * 0.8 + (Math.random() - 0.5) * 0.06;
    p.vy = -0.02;
    p.vz = (drainCenter.z - basinPoint.z) * 0.8 + (Math.random() - 0.5) * 0.06;

    const life = 1.0 + Math.random() * 0.45;
    p.life = life;
    p.maxLife = life;
    p.scale = 0.006 + Math.random() * 0.006;
    p.alpha = 0.65;
  }

  // ── 6. Per-Frame Simulation Loop ──────────────────────────────────────────
  function update(
    delta: number,
    spawnWorldPos?: THREE.Vector3,
    streamHit?: StreamHit,
    collisionSystem?: WaterCollisionSystem,
  ) {
    const dt = Math.min(delta, 0.05);

    group.position.set(0, 0, 0);

    const faucetOrigin = spawnWorldPos ?? _fallbackFaucetOrigin;

    // ── Flow Physics & Segment Determination ──
    const isHandHit = streamHit?.hit && streamHit.hitTarget === "hand";
    const primaryHitPoint = streamHit?.point ?? _fallbackHitPoint;
    const primaryHitNormal = streamHit?.normal ?? _vecUp;
    const runoffPoint = streamHit?.runoffPoint ?? _fallbackRunoffPoint;
    const basinPoint = streamHit?.basinPoint ?? _fallbackBasinPoint;
    const drainCenter = collisionSystem?.drainCenter ?? _fallbackDrainCenter;

    // 1. Primary Faucet Stream: Spout → Impact Point
    faucetStreamMesh.position.copy(faucetOrigin);
    const faucetStreamLength = Math.max(0.04, faucetOrigin.y - primaryHitPoint.y);
    faucetStreamMesh.scale.set(1, 1, 1);
    for (let ring = 0; ring < streamRings; ring++) {
      const t = ring / (streamRings - 1);
      // Localised compression/bulge before a real hand collision. The spout
      // and contact endpoints remain fixed, so the stream stays continuous.
      const impactBlend = isHandHit ? Math.max(0, (t - 0.58) / 0.42) : 0;
      const impactShape = impactBlend * (1 - impactBlend) * 4;
      const centreX = primaryHitNormal.x * impactShape * 0.018;
      const centreZ = primaryHitNormal.z * impactShape * 0.018;
      const radius = (radiusTop + (radiusBottom - radiusTop) * t) * (1 + impactShape * 0.16);
      for (let segment = 0; segment < radialSegments; segment++) {
        const angle = (segment / radialSegments) * Math.PI * 2;
        const index = (ring * radialSegments + segment) * 3;
        streamPositions[index] = centreX + Math.cos(angle) * radius;
        streamPositions[index + 1] = -faucetStreamLength * t;
        streamPositions[index + 2] = centreZ + Math.sin(angle) * radius;
      }
    }
    streamPosAttr.needsUpdate = true;

    // 2. Contact sheet and separated runoff strands. The top and bottom hand
    // intersections are real raycast results, so no visible stream crosses the hand.
    if (isHandHit) {
      _impactTangent.copy(_vecDown).addScaledVector(
        primaryHitNormal,
        -_vecDown.dot(primaryHitNormal),
      );
      if (_impactTangent.lengthSq() < 0.0001) {
        _impactTangent.set(0, -0.75, 0.25);
      }
      _impactTangent.normalize();
      _impactSide.crossVectors(primaryHitNormal, _impactTangent);
      if (_impactSide.lengthSq() < 0.0001) {
        _impactSide.set(1, 0, 0);
      } else {
        _impactSide.normalize();
      }

      for (let row = 0; row < impactRows; row++) {
        const t = row / (impactRows - 1);
        const centreX = primaryHitPoint.x + primaryHitNormal.x * 0.008 + _impactTangent.x * 0.145 * t + _vecDown.x * 0.025 * t * t;
        const centreY = primaryHitPoint.y + primaryHitNormal.y * 0.008 + _impactTangent.y * 0.145 * t + _vecDown.y * 0.025 * t * t;
        const centreZ = primaryHitPoint.z + primaryHitNormal.z * 0.008 + _impactTangent.z * 0.145 * t + _vecDown.z * 0.025 * t * t;
        // Rounded, non-zero ends prevent the impact flow from forming a
        // triangular wedge beneath the fingers.
        const halfWidth = 0.020 + Math.sin(t * Math.PI) * 0.034;
        for (let column = 0; column < impactColumns; column++) {
          const side = (column / (impactColumns - 1) - 0.5) * 2.0;
          const index = (row * impactColumns + column) * 3;
          impactPositions[index] = centreX + _impactSide.x * halfWidth * side;
          impactPositions[index + 1] = centreY + _impactSide.y * halfWidth * side;
          impactPositions[index + 2] = centreZ + _impactSide.z * halfWidth * side;
        }
      }
      impactPosAttr.needsUpdate = true;
      impactFlowMesh.visible = true;

      // Two tapered, curved streams form only at the current hand underside.
      // Their directions, widths and endpoints vary so they do not become
      // parallel rods while still carrying the liquid into the basin.
      for (let path = 0; path < runoffPathCount; path++) {
        const lateral = path === 0 ? -0.024 : 0.030;
        const endLateral = path === 0 ? -0.012 : 0.072;
        const pathReach = path === 0 ? 1.0 : 0.72;
        const startX = runoffPoint.x + _impactSide.x * lateral;
        const startY = runoffPoint.y + _impactSide.y * lateral;
        const startZ = runoffPoint.z + _impactSide.z * lateral;
        const basinEndX = basinPoint.x + _impactSide.x * endLateral;
        const basinEndY = basinPoint.y + 0.006;
        const basinEndZ = basinPoint.z + _impactSide.z * endLateral;
        // The primary branch reaches the bowl. The smaller branch narrows and
        // separates earlier, leaving the pooled ballistic droplets to finish it.
        const endX = startX + (basinEndX - startX) * pathReach;
        const endY = startY + (basinEndY - startY) * pathReach;
        const endZ = startZ + (basinEndZ - startZ) * pathReach;
        const vertexOffset = path * (runoffSteps + 1) * runoffRadialSegments;
        const bend = path === 0 ? -0.030 : 0.046;
        const sag = path === 0 ? 0.032 : 0.048;
        const baseRadius = path === 0 ? 0.018 : 0.014;
        for (let step = 0; step <= runoffSteps; step++) {
          const t = step / runoffSteps;
          const curve = Math.sin(t * Math.PI);
          const centreX = startX + (endX - startX) * t + _impactSide.x * bend * curve;
          const centreY = startY + (endY - startY) * t - sag * curve;
          const centreZ = startZ + (endZ - startZ) * t + _impactSide.z * bend * curve;
          _runoffTangent.set(
            endX - startX + _impactSide.x * bend * Math.PI * Math.cos(t * Math.PI),
            endY - startY - sag * Math.PI * Math.cos(t * Math.PI),
            endZ - startZ + _impactSide.z * bend * Math.PI * Math.cos(t * Math.PI),
          ).normalize();
          _runoffBinormal.crossVectors(_runoffTangent, _impactSide).normalize();
          if (_runoffBinormal.lengthSq() < 0.0001) _runoffBinormal.set(0, 0, 1);

          for (let segment = 0; segment < runoffRadialSegments; segment++) {
            const angle = (segment / runoffRadialSegments) * Math.PI * 2;
            const irregularity = 1 + Math.sin(angle * 2 + path * 1.7) * curve * 0.10;
            const taper = path === 0 ? 1 - t * 0.48 : 1 - t * 0.86;
            const radius = baseRadius * taper * irregularity;
            const normalX = _impactSide.x * Math.cos(angle) + _runoffBinormal.x * Math.sin(angle);
            const normalY = _impactSide.y * Math.cos(angle) + _runoffBinormal.y * Math.sin(angle);
            const normalZ = _impactSide.z * Math.cos(angle) + _runoffBinormal.z * Math.sin(angle);
            const vertex = (vertexOffset + step * runoffRadialSegments + segment) * 3;
            runoffPositions[vertex] = centreX + normalX * radius;
            runoffPositions[vertex + 1] = centreY + normalY * radius;
            runoffPositions[vertex + 2] = centreZ + normalZ * radius;
            runoffNormals[vertex] = normalX;
            runoffNormals[vertex + 1] = normalY;
            runoffNormals[vertex + 2] = normalZ;
          }
        }
      }
      runoffPosAttr.needsUpdate = true;
      handRunoffMesh.visible = true;
    } else {
      impactFlowMesh.visible = false;
      handRunoffMesh.visible = false;
    }

    // 3. Smooth, tapered basin flow. It follows a shallow Bezier-like path and
    // terminates at the real drain without adding a pool or radial effect.
    basinFlowMesh.visible = true;
    const startZ = basinPoint.z;
    const endZ = drainCenter.z;
    const startX = basinPoint.x;
    const endX = drainCenter.x;
    const flowX = endX - startX;
    const flowZ = endZ - startZ;
    const flowLength = Math.max(0.001, Math.hypot(flowX, flowZ));
    const sideX = -flowZ / flowLength;
    const sideZ = flowX / flowLength;
    const bend = Math.min(0.065, flowLength * 0.16) * (startX >= 0 ? -1 : 1);

    if (_lastBasinStart.distanceToSquared(basinPoint) > 0.0225) {
      basinFlowProgress = Math.min(basinFlowProgress, 0.35);
      _lastBasinStart.copy(basinPoint);
    }
    basinFlowProgress = Math.min(1, basinFlowProgress + dt * Math.max(1.2, (config.flowSpeed ?? 3.5) * 0.42));
    (basinFlowMaterial.uniforms.uFlowProgress!.value as number) = basinFlowProgress;

    for (let step = 0; step <= basinFlowSteps; step++) {
      const t = step / basinFlowSteps;
      // The first 85% traces porcelain; the final 15% crosses the actual
      // drain rim and descends inside its open centre instead of ending in a cap.
      const surfaceT = Math.min(1, t / 0.85);
      const sinT = Math.sin(surfaceT * Math.PI);
      const cosT = Math.cos(surfaceT * Math.PI);
      const curX = startX + flowX * surfaceT + sideX * bend * sinT;
      const curZ = startZ + flowZ * surfaceT + sideZ * bend * sinT;
      const basinY = (collisionSystem?.getBasinHeightAt(curX, curZ) ?? 0.7282) + 0.003;
      const drainDepth = t > 0.85 ? ((t - 0.85) / 0.15) * 0.10 : 0;
      const curY = basinY - drainDepth;
      const tangentX = flowX + sideX * bend * Math.PI * cosT;
      const tangentZ = flowZ + sideZ * bend * Math.PI * cosT;
      const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentZ));
      const perpendicularX = -tangentZ / tangentLength;
      const perpendicularZ = tangentX / tangentLength;
      const halfWidth = t <= 0.85
        ? 0.066 - (t / 0.85) * 0.028
        : 0.038 - ((t - 0.85) / 0.15) * 0.036;

      const idx = step * 6;
      flowPositions[idx + 0] = curX - perpendicularX * halfWidth;
      flowPositions[idx + 1] = curY;
      flowPositions[idx + 2] = curZ - perpendicularZ * halfWidth;

      flowPositions[idx + 3] = curX + perpendicularX * halfWidth;
      flowPositions[idx + 4] = curY;
      flowPositions[idx + 5] = curZ + perpendicularZ * halfWidth;
    }
    basinFlowPosAttr.needsUpdate = true;

    // ── Particle Spawning ──
    if (isHandHit) {
      handSplashAccum += dt * 36;
      const count = Math.floor(handSplashAccum);
      handSplashAccum -= count;
      for (let i = 0; i < count; i++) {
        spawnImpactSplash(primaryHitPoint, primaryHitNormal);
      }

      handDripAccum += dt * 24;
      const dripCount = Math.floor(handDripAccum);
      handDripAccum -= dripCount;
      for (let i = 0; i < dripCount; i++) {
        spawnDripRunoff(runoffPoint, basinPoint);
      }
    } else {
      handSplashAccum = 0;
      handDripAccum = 0;
    }

    basinSplashAccum += dt * 12;
    const basinCount = Math.floor(basinSplashAccum);
    basinSplashAccum -= basinCount;
    for (let i = 0; i < basinCount; i++) {
      spawnBasinSplash(basinPoint, drainCenter);
    }

    // ── Particle Integration & Collision Response ──
    const gravity = 4.2;
    let anyActive = false;

    for (let i = 0; i < maxParticles; i++) {
      const p = particles[i];
      if (!p || !p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.life = 0;
        p.y = -9999;
        p.alpha = 0;
        posAttr.setXYZ(i, 0, -9999, 0);
        alphaAttr.setX(i, 0);
        scaleAttr.setX(i, 0);
        freeList.push(i);
        continue;
      }

      anyActive = true;
      p.vy -= gravity * dt;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      if (collisionSystem) {
        _tempPos.set(p.x, p.y, p.z);
        _tempVel.set(p.vx, p.vy, p.vz);

        const res = collisionSystem.resolveParticleCollision(_tempPos, _tempVel);
        if (res.collided) {
          p.x = _tempPos.x;
          p.y = _tempPos.y;
          p.z = _tempPos.z;
          p.vx = _tempVel.x;
          p.vy = _tempVel.y;
          p.vz = _tempVel.z;

          if (res.stopped) {
            p.life = 0;
            p.active = false;
            posAttr.setXYZ(i, 0, -9999, 0);
            alphaAttr.setX(i, 0);
            scaleAttr.setX(i, 0);
            freeList.push(i);
            continue;
          }
        }
      }

      const lifeRatio = p.life / p.maxLife;
      p.alpha = Math.max(0, lifeRatio * 0.9);

      if (p.ptype === PTYPE_DRIP) {
        p.vx *= 0.992;
        p.vz *= 0.992;
      }

      posAttr.setXYZ(i, p.x, p.y, p.z);
      scaleAttr.setX(i, p.scale);
      alphaAttr.setX(i, p.alpha);
    }

    if (anyActive || basinCount > 0) {
      posAttr.needsUpdate = true;
      alphaAttr.needsUpdate = true;
      scaleAttr.needsUpdate = true;
    }
  }

  function setLength(_newLength: number) {
    // API compatibility stub
  }

  function dispose() {
    faucetGeometry.dispose();
    streamMaterial.dispose();
    runoffGeometry.dispose();
    impactGeometry.dispose();
    impactMaterial.dispose();
    basinFlowGeometry.dispose();
    basinFlowMaterial.dispose();
    particleGeometry.dispose();
    particleMaterial.dispose();
  }

  return {
    group,
    points: group, // Backwards compatibility
    splashPointsGroup: pointsRoot,
    faucetStreamMesh,
    streamMesh: faucetStreamMesh, // Backwards compatibility
    handRunoffMesh,
    impactFlowMesh,
    basinFlowMesh,
    update,
    setLength,
    dispose,
    config,
  };
}
