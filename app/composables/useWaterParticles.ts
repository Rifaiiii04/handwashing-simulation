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
  color: 0x00c4ff,
  deepColor: 0x003d99,
  opacity: 0.94,
  radiusTop: 0.054,
  radiusBottom: 0.042,
  flowSpeed: 4.8,
  maxSplashParticles: 350,
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

  const radiusTop = config.radiusTop ?? 0.054;
  const radiusBottom = config.radiusBottom ?? 0.042;
  const radialSegments = 36;
  const streamRings = 80;

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
  const streamNormAttr = new THREE.BufferAttribute(streamNormals, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const faucetGeometry = new THREE.BufferGeometry();
  faucetGeometry.setAttribute("position", streamPosAttr);
  faucetGeometry.setAttribute("normal", streamNormAttr);
  faucetGeometry.setAttribute("uv", new THREE.BufferAttribute(streamUvs, 2));
  faucetGeometry.setIndex(new THREE.BufferAttribute(streamIndices, 1));

  const streamMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,

    uniforms: {
      uDeepColor:      { value: new THREE.Color(config.deepColor ?? 0x0047ab) },
      uSurfaceColor:   { value: new THREE.Color(config.color     ?? 0x00d2ff) },
      uFoamColor:      { value: new THREE.Color(0xffffff) },
      uHighlightColor: { value: new THREE.Color(0x88f5ff) },
      uOpacity:        { value: config.opacity ?? 0.92 },
      uTime:           { value: 0 },
      uFlowSpeed:      { value: config.flowSpeed ?? 5.5 },
    },

    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3  uDeepColor;
      uniform vec3  uSurfaceColor;
      uniform vec3  uFoamColor;
      uniform vec3  uHighlightColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uFlowSpeed;
      varying vec2  vUv;
      varying vec3  vNormal;
      varying vec3  vViewPosition;

      // Screen-space antialiased cel step (eliminates pixelation and jagged edges)
      float aastep(float threshold, float value) {
        float afwidth = fwidth(value) * 0.75 + 0.002;
        return smoothstep(threshold - afwidth, threshold + afwidth, value);
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);
        vec3 L = normalize(vec3(0.35, 0.90, 0.70));

        float NdotL = dot(N, L);
        float NdotV = clamp(dot(N, V), 0.0, 1.0);

        // ── 90s Anime 4-Tone Cel Hierarchy with Sub-Pixel AA ──
        float celShadow = aastep(0.08, NdotL);
        float celLit    = aastep(0.46, NdotL);

        // ── Hand-Drawn Anime Cel Rim Light ──
        float rim = 1.0 - NdotV;
        float celRim = aastep(0.70, rim);

        // ── Bold, Hand-Painted Anime Flow Ribbons (Twisting gracefully, zero fleck noise) ──
        float flowCoord = vUv.y * 3.8 - uTime * uFlowSpeed * 0.65;
        float ribbon1Val = sin(vUv.x * 6.2831853 + sin(flowCoord) * 0.85);
        float ribbon1 = aastep(0.68, ribbon1Val);

        float ribbon2Val = sin(vUv.x * 6.2831853 + 3.14159265 + cos(flowCoord * 0.8) * 0.70);
        float ribbon2 = aastep(0.74, ribbon2Val);

        // ── Smooth Specular Cel Glint ──
        vec3 H = normalize(L + V);
        float NdotH = max(dot(N, H), 0.0);
        float glint = aastep(0.90, pow(NdotH, 48.0));

        float foam = max(ribbon1, max(ribbon2 * 0.85, glint));

        // ── 90s Hand-Inked Cel Layer Composition ──
        vec3 col = uDeepColor;
        col = mix(col, uSurfaceColor, celShadow * 0.82 + 0.18);
        col = mix(col, uHighlightColor, celLit * 0.45);
        col = mix(col, uSurfaceColor * 1.30, celRim * 0.40);
        col = mix(col, uFoamColor, foam);

        float alpha = uOpacity * (0.90 + 0.10 * celRim);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
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
      uDeepColor:    { value: new THREE.Color(config.deepColor ?? 0x0047ab) },
      uSurfaceColor: { value: new THREE.Color(config.color     ?? 0x00d2ff) },
      uFoamColor:    { value: new THREE.Color(0xffffff) },
      uOpacity:      { value: config.opacity ?? 0.92 },
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
      uniform vec3 uFoamColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
        float tail = 1.0 - smoothstep(0.75, 1.0, vUv.y);
        float mask = edge * tail;
        if (mask < 0.02) discard;

        // 90s anime cel foam border on hand sheen
        float foamBorder = step(0.02, mask) * (1.0 - step(0.18, mask));
        vec3 col = mix(uDeepColor, uSurfaceColor, vUv.y * 0.4 + 0.6);
        col = mix(col, uFoamColor, foamBorder * 0.95);

        gl_FragColor = vec4(col, uOpacity * step(0.04, mask));
      }
    `,
  });
  const impactFlowMesh = new THREE.Mesh(impactGeometry, impactMaterial);
  impactFlowMesh.name = "HandImpactFlowMesh";
  impactFlowMesh.visible = false;
  impactFlowMesh.frustumCulled = false;
  group.add(impactFlowMesh);

  // ── 3. Falling Runoff Stream (Hand Underside → Drain Opening) ─────────────
  // High-resolution volumetric anime waterfall cascading from the hand underside
  // directly into the drain opening. Rich, heavy liquid presence with wide body.
  const runoffSteps = 48;
  const runoffRadialSegments = 32;
  const runoffVertexCount = (runoffSteps + 1) * runoffRadialSegments;
  const runoffPositions = new Float32Array(runoffVertexCount * 3);
  const runoffNormals = new Float32Array(runoffVertexCount * 3);
  const runoffUvs = new Float32Array(runoffVertexCount * 2);
  const runoffIndices = new Uint16Array(runoffSteps * runoffRadialSegments * 6);

  for (let step = 0; step <= runoffSteps; step++) {
    for (let segment = 0; segment < runoffRadialSegments; segment++) {
      const vertex = step * runoffRadialSegments + segment;
      runoffUvs[vertex * 2] = segment / runoffRadialSegments;
      runoffUvs[vertex * 2 + 1] = step / runoffSteps;
      if (step < runoffSteps) {
        const nextSegment = (segment + 1) % runoffRadialSegments;
        const index = (step * runoffRadialSegments + segment) * 6;
        const nextRing = (step + 1) * runoffRadialSegments;
        runoffIndices[index]     = vertex;
        runoffIndices[index + 1] = nextRing + segment;
        runoffIndices[index + 2] = step * runoffRadialSegments + nextSegment;
        runoffIndices[index + 3] = step * runoffRadialSegments + nextSegment;
        runoffIndices[index + 4] = nextRing + segment;
        runoffIndices[index + 5] = nextRing + nextSegment;
      }
    }
  }

  const runoffPosAttr = new THREE.BufferAttribute(runoffPositions, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const runoffNormAttr = new THREE.BufferAttribute(runoffNormals, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const runoffGeometry = new THREE.BufferGeometry();
  runoffGeometry.setAttribute("position", runoffPosAttr);
  runoffGeometry.setAttribute("normal", runoffNormAttr);
  runoffGeometry.setAttribute("uv", new THREE.BufferAttribute(runoffUvs, 2));
  runoffGeometry.setIndex(new THREE.BufferAttribute(runoffIndices, 1));
  const handRunoffMesh = new THREE.Mesh(runoffGeometry, streamMaterial);
  handRunoffMesh.name = "HandRunoffFlowMesh";
  handRunoffMesh.visible = false;
  handRunoffMesh.frustumCulled = false;
  group.add(handRunoffMesh);

  // ── 4. Basin Water Spreading Sheet (Impact Point → Flowing Down to Drain) ──
  const basinRows = 24;
  const basinCols = 16;
  const numFlowVerts = basinRows * basinCols;
  const flowPositions = new Float32Array(numFlowVerts * 3);
  const flowNormals = new Float32Array(numFlowVerts * 3);
  const flowUvs = new Float32Array(numFlowVerts * 2);
  const flowIndices = new Uint16Array((basinRows - 1) * (basinCols - 1) * 6);

  for (let r = 0; r < basinRows; r++) {
    const vY = r / (basinRows - 1);
    for (let c = 0; c < basinCols; c++) {
      const vX = c / (basinCols - 1);
      const vIdx = r * basinCols + c;
      flowUvs[vIdx * 2]     = vX;
      flowUvs[vIdx * 2 + 1] = vY;
      flowNormals[vIdx * 3]     = 0;
      flowNormals[vIdx * 3 + 1] = 1;
      flowNormals[vIdx * 3 + 2] = 0;
    }
  }

  let indexOffset = 0;
  for (let r = 0; r < basinRows - 1; r++) {
    for (let c = 0; c < basinCols - 1; c++) {
      const row1 = r * basinCols + c;
      const row2 = (r + 1) * basinCols + c;
      flowIndices[indexOffset++] = row1;
      flowIndices[indexOffset++] = row2;
      flowIndices[indexOffset++] = row1 + 1;
      flowIndices[indexOffset++] = row1 + 1;
      flowIndices[indexOffset++] = row2;
      flowIndices[indexOffset++] = row2 + 1;
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
      uDeepColor:    { value: new THREE.Color(config.deepColor ?? 0x003d99) },
      uSurfaceColor: { value: new THREE.Color(config.color     ?? 0x00c4ff) },
      uFoamColor:    { value: new THREE.Color(0xffffff) },
      uOpacity:      { value: config.opacity ?? 0.94 },
      uTime:         { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3  uDeepColor;
      uniform vec3  uSurfaceColor;
      uniform vec3  uFoamColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2  vUv;

      float aastep(float threshold, float value) {
        float afwidth = fwidth(value) * 0.75 + 0.002;
        return smoothstep(threshold - afwidth, threshold + afwidth, value);
      }

      void main() {
        // Lateral edge contour (left and right curved water margins)
        float edgeDist = abs(vUv.x - 0.5) * 2.0;
        if (edgeDist > 0.98) discard;
        float edgeAlpha = 1.0 - smoothstep(0.85, 0.98, edgeDist);

        // Rear rounded boundary fade & front drain entry fade
        float startFade = smoothstep(0.01, 0.12, vUv.y);
        float endFade   = 1.0 - smoothstep(0.96, 1.00, vUv.y);

        // ── Animated Concentric Anime Ripples Radiating from Impact Point ──
        vec2 impactOffset = vec2((vUv.x - 0.5) * 1.5, (vUv.y - 0.22) * 2.5);
        float distFromImpact = length(impactOffset);
        float rippleWave = sin(distFromImpact * 24.0 - uTime * 8.0);
        float ripple = aastep(0.68, rippleWave) * (1.0 - smoothstep(0.40, 0.90, distFromImpact));

        // ── Longitudinal Downstream Anime Ribbons (flowing into drain) ──
        float streamPhase = vUv.x * 12.56637 + sin(vUv.y * 7.0 - uTime * 6.0) * 1.6;
        float streamStreak = aastep(0.70, sin(streamPhase)) * smoothstep(0.20, 0.45, vUv.y);

        // ── White Cel Foam Crest along Water Margins ──
        float foamEdge = aastep(0.76, edgeDist);

        // ── 90s Cel Layer Composition ──
        vec3 col = mix(uDeepColor, uSurfaceColor, 0.65 + ripple * 0.20);
        col = mix(col, uFoamColor, max(foamEdge * 0.85, max(ripple * 0.75, streamStreak * 0.70)));

        float alpha = uOpacity * edgeAlpha * startFade * endFade * 0.92;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }
    `,
  });

  const basinFlowMesh = new THREE.Mesh(basinFlowGeometry, basinFlowMaterial);
  basinFlowMesh.name = "BasinSpreadFlowMesh";
  basinFlowMesh.frustumCulled = false;
  group.add(basinFlowMesh);

  // ── 5. Splash & Drip Particle System ──────────────────────────────────────
  const maxParticles = config.maxSplashParticles ?? 180;
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
      uDeepColor:    { value: new THREE.Color(config.deepColor ?? 0x0047ab) },
      uSurfaceColor: { value: new THREE.Color(config.color     ?? 0x00d2ff) },
    },
    vertexShader: /* glsl */ `
      attribute float aScale;
      attribute float aAlpha;
      varying float   vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aScale * (260.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3  uDeepColor;
      uniform vec3  uSurfaceColor;
      varying float vAlpha;
      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord) * 2.0;

        // Smooth sub-pixel antialiased circular droplet silhouette (no 1-bit discard jaggies)
        float edge = fwidth(dist) * 0.85 + 0.003;
        float alphaMask = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, dist);
        if (alphaMask <= 0.001 || vAlpha <= 0.001) discard;

        // Smooth cartoon ink outline
        float border = smoothstep(0.74 - edge, 0.74 + edge, dist);

        // Smooth anime crescent gleam (top-left)
        vec2 gleamPos = coord - vec2(-0.18, -0.18);
        float gleamDist = length(gleamPos) * 2.0;
        float gleamEdge = fwidth(gleamDist) * 0.85 + 0.003;
        float gleam = 1.0 - smoothstep(0.42 - gleamEdge, 0.42 + gleamEdge, gleamDist);

        // Inner translucent water reflection
        vec2 innerPos = coord - vec2(0.16, 0.16);
        float innerGlow = (1.0 - smoothstep(0.0, 0.50, length(innerPos) * 2.0)) * 0.35;

        vec3 col = mix(uSurfaceColor, uDeepColor, dist * 0.45);
        col += vec3(0.30, 0.75, 1.0) * innerGlow;
        col = mix(col, vec3(0.01, 0.06, 0.28), border * 0.90);
        col = mix(col, vec3(1.0), gleam);

        gl_FragColor = vec4(col, vAlpha * alphaMask);
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
  const _streamTangent = new THREE.Vector3();
  const _streamSide = new THREE.Vector3();
  const _streamUp = new THREE.Vector3();
  const _runoffTangent = new THREE.Vector3();
  const _runoffSide = new THREE.Vector3();
  const _runoffUp = new THREE.Vector3();
  const _lastBasinStart = new THREE.Vector3(Infinity, Infinity, Infinity);
  const _fallbackFaucetOrigin = new THREE.Vector3(0, 1.948, -0.668);
  const _fallbackHitPoint = new THREE.Vector3(0, 0.822, -0.668);
  const _fallbackRunoffPoint = new THREE.Vector3(-0.012, 1.40, -0.440);
  const _fallbackBasinPoint = new THREE.Vector3(0, 0.822, -0.668);
  const _fallbackDrainCenter = new THREE.Vector3(0, 0.7282, -0.25);

  let elapsedTime = 0;
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
    p.x = hitPoint.x + (Math.random() - 0.5) * 0.035;
    p.y = hitPoint.y + 0.004 + Math.random() * 0.008;
    p.z = hitPoint.z + (Math.random() - 0.5) * 0.035;

    // Gentler splash with more lateral spread, less vertical bounce
    const speed = 0.30 + Math.random() * 0.40;
    const angle = Math.random() * Math.PI * 2;
    const tangentX = Math.cos(angle);
    const tangentZ = Math.sin(angle);

    p.vx = hitNormal.x * speed * 0.35 + tangentX * speed * 0.65;
    p.vy = Math.max(0.10, hitNormal.y * speed * 0.30 + 0.08 + Math.random() * 0.16);
    p.vz = hitNormal.z * speed * 0.35 + tangentZ * speed * 0.65;

    const life = 0.22 + Math.random() * 0.28;
    p.life = life;
    p.maxLife = life;
    p.scale = 0.020 + Math.random() * 0.016;
    p.alpha = 0.92;
  }

  function spawnDripRunoff(runoffPoint: THREE.Vector3, drainCenter: THREE.Vector3): void {
    const p = allocParticle();
    if (!p) return;

    p.ptype = PTYPE_DRIP;
    p.x = runoffPoint.x + (Math.random() - 0.5) * 0.050;
    p.y = runoffPoint.y - 0.004 - Math.random() * 0.012;
    p.z = runoffPoint.z + (Math.random() - 0.5) * 0.050;

    // Gentle drip: mostly gravity, slight forward momentum toward drain
    const toDrainX = (drainCenter.x - runoffPoint.x);
    const toDrainZ = (drainCenter.z - runoffPoint.z);
    p.vx = toDrainX * 0.20 + (Math.random() - 0.5) * 0.08;
    p.vy = -0.30 - Math.random() * 0.25;
    p.vz = toDrainZ * 0.20 + (Math.random() - 0.5) * 0.08;

    const life = 0.50 + Math.random() * 0.35;
    p.life = life;
    p.maxLife = life;
    p.scale = 0.018 + Math.random() * 0.014;
    p.alpha = 0.90;
  }

  function spawnBasinSplash(impactPos: THREE.Vector3): void {
    const p = allocParticle();
    if (!p) return;

    p.ptype = PTYPE_BASIN;
    p.x = impactPos.x + (Math.random() - 0.5) * 0.065;
    p.y = impactPos.y + 0.015 + Math.random() * 0.020;
    p.z = impactPos.z + (Math.random() - 0.5) * 0.065;

    const angle = Math.random() * Math.PI * 2;
    const speed = 0.35 + Math.random() * 0.45;
    p.vx = Math.cos(angle) * speed;
    p.vy = 0.24 + Math.random() * 0.30;
    p.vz = Math.sin(angle) * speed;

    const life = 0.30 + Math.random() * 0.25;
    p.life = life;
    p.maxLife = life;
    p.scale = 0.026 + Math.random() * 0.020;
    p.alpha = 0.95;
  }

  // ── 6. Per-Frame Simulation Loop ──────────────────────────────────────────
  function update(
    delta: number,
    spawnWorldPos?: THREE.Vector3,
    streamHit?: StreamHit,
    collisionSystem?: WaterCollisionSystem,
  ) {
    const dt = Math.min(delta, 0.05);
    elapsedTime += dt;

    group.position.set(0, 0, 0);

    // Update shader time uniforms
    streamMaterial.uniforms.uTime!.value    = elapsedTime;
    basinFlowMaterial.uniforms.uTime!.value = elapsedTime;

    const faucetOrigin = spawnWorldPos ?? _fallbackFaucetOrigin;

    // ── Flow Physics & Segment Determination ──
    const isHandHit = streamHit?.hit && streamHit.hitTarget === "hand";
    const primaryHitPoint = streamHit?.point ?? _fallbackHitPoint;
    const primaryHitNormal = streamHit?.normal ?? _vecUp;
    const runoffPoint = streamHit?.runoffPoint ?? _fallbackRunoffPoint;
    const basinPoint = streamHit?.basinPoint ?? _fallbackBasinPoint;
    const drainCenter = collisionSystem?.drainCenter ?? _fallbackDrainCenter;

    // 1. Primary Faucet Stream: Spout → Impact/Drain
    faucetStreamMesh.position.copy(faucetOrigin);
    faucetStreamMesh.scale.set(1, 1, 1);

    if (!isHandHit) {
      // ── No hand: Faucet water drops STRAIGHT DOWN vertically onto sink surface ──
      const basinHitY = collisionSystem
        ? collisionSystem.getBasinHeightAt(faucetOrigin.x, faucetOrigin.z)
        : basinPoint.y;
      const streamLength = Math.max(0.10, faucetOrigin.y - basinHitY);

      for (let ring = 0; ring < streamRings; ring++) {
        const t = ring / (streamRings - 1);
        const animePulse = 1.0 + Math.sin(t * 12.0 - elapsedTime * 12.0) * 0.04;
        const radius = (radiusTop + (radiusBottom - radiusTop) * t) * animePulse;

        for (let segment = 0; segment < radialSegments; segment++) {
          const angle = (segment / radialSegments) * Math.PI * 2;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const index = (ring * radialSegments + segment) * 3;

          // Pure vertical gravity drop (straight down along -Y)
          streamPositions[index]     = cosA * radius;
          streamPositions[index + 1] = -streamLength * t;
          streamPositions[index + 2] = sinA * radius;

          streamNormals[index]     = cosA;
          streamNormals[index + 1] = 0;
          streamNormals[index + 2] = sinA;
        }
      }
      streamPosAttr.needsUpdate = true;
      streamNormAttr.needsUpdate = true;
      faucetStreamMesh.visible = true;
      impactFlowMesh.visible = false;
      handRunoffMesh.visible = false;
    } else {
      // ── Hand hit: Faucet water drops STRAIGHT DOWN vertically onto hands ──
      const faucetStreamLength = Math.max(0.04, faucetOrigin.y - primaryHitPoint.y);

      for (let ring = 0; ring < streamRings; ring++) {
        const t = ring / (streamRings - 1);
        const flare = Math.max(0, (t - 0.70) / 0.30);
        const animeRipple = 1.0 + Math.sin(t * 14.0 - elapsedTime * 14.0) * 0.035;
        const radius = (radiusTop + (radiusBottom - radiusTop) * t) * (1.0 + flare * 0.35) * animeRipple;

        for (let segment = 0; segment < radialSegments; segment++) {
          const angle = (segment / radialSegments) * Math.PI * 2;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const index = (ring * radialSegments + segment) * 3;

          // Pure vertical drop straight down to hands
          streamPositions[index]     = cosA * radius;
          streamPositions[index + 1] = -faucetStreamLength * t;
          streamPositions[index + 2] = sinA * radius;

          streamNormals[index]     = cosA;
          streamNormals[index + 1] = 0;
          streamNormals[index + 2] = sinA;
        }
      }
      streamPosAttr.needsUpdate = true;
      streamNormAttr.needsUpdate = true;
      faucetStreamMesh.visible = true;

      impactFlowMesh.visible = false;

      // ── Runoff: Volumetric Waterfall cascading from hands into sink basin ──
      const basinFloorUnderHandY = collisionSystem
        ? collisionSystem.getBasinHeightAt(runoffPoint.x, runoffPoint.z)
        : _fallbackBasinPoint.y;
      const runoffDrop = Math.max(0.08, runoffPoint.y - basinFloorUnderHandY);

      // Waterfall curves gently toward drain as it falls (natural forward momentum)
      const drainCenterX = collisionSystem?.drainCenter.x ?? _fallbackDrainCenter.x;
      const drainCenterZ = collisionSystem?.drainCenter.z ?? _fallbackDrainCenter.z;

      for (let step = 0; step <= runoffSteps; step++) {
        const t = step / runoffSteps;
        // Gravity-like acceleration: slow at top, fast at bottom
        const gravT = t * t;
        const cy = runoffPoint.y - runoffDrop * gravT;

        // Horizontal drift toward drain increases with fall distance
        const driftT = t * t * 0.3; // gentle parabolic drift
        const cx = runoffPoint.x + (drainCenterX - runoffPoint.x) * driftT;
        const cz = runoffPoint.z + (drainCenterZ - runoffPoint.z) * driftT;

        // Wide, volumetric cascading waterfall: tapers as it falls
        const animePulse = 1.0 + Math.sin(t * 10.0 - elapsedTime * 12.0) * 0.04;
        const curWidth = (0.065 - t * 0.020) * animePulse;
        const curThick = (0.035 - t * 0.010) * animePulse;

        const waveX = Math.sin(t * 6.0 - elapsedTime * 10.0) * 0.002;
        const waveZ = Math.cos(t * 5.0 - elapsedTime * 8.0) * 0.002;

        for (let segment = 0; segment < runoffRadialSegments; segment++) {
          const angle = (segment / runoffRadialSegments) * Math.PI * 2;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const vIdx = (step * runoffRadialSegments + segment) * 3;

          runoffPositions[vIdx]     = cx + cosA * curWidth + waveX;
          runoffPositions[vIdx + 1] = cy;
          runoffPositions[vIdx + 2] = cz + sinA * curThick + waveZ;

          runoffNormals[vIdx]     = cosA;
          runoffNormals[vIdx + 1] = 0;
          runoffNormals[vIdx + 2] = sinA;
        }
      }
      runoffPosAttr.needsUpdate = true;
      runoffNormAttr.needsUpdate = true;
      handRunoffMesh.visible = true;
    }

    // ── Spreading Water Sheet on Sink Basin Floor (Flows smoothly into Drain) ──
    const impactX = isHandHit ? runoffPoint.x : faucetOrigin.x;
    const impactZ = isHandHit ? runoffPoint.z : faucetOrigin.z;
    const impactY = collisionSystem
      ? collisionSystem.getBasinHeightAt(impactX, impactZ)
      : basinPoint.y;
    const drainZ = drainCenter.z;

    const startZ = impactZ - 0.12;
    const endZ = drainZ + 0.03;

    for (let r = 0; r < basinRows; r++) {
      const tZ = r / (basinRows - 1);
      const z = startZ + (endZ - startZ) * tZ;

      // Widens broadly around the impact point (±18cm), then streams down into the drain
      const pulse = 1.0 + Math.sin(tZ * 6.0 - elapsedTime * 7.0) * 0.04;
      const widthProfile = tZ < 0.26
        ? Math.sin((tZ / 0.26) * Math.PI * 0.5)
        : (1.0 - (tZ - 0.26) * 0.32);
      const halfWidth = Math.max(0.065, 0.18 * widthProfile * pulse);

      for (let c = 0; c < basinCols; c++) {
        const tX = (c / (basinCols - 1) - 0.5) * 2.0;
        const x = impactX + tX * halfWidth;
        const y = (collisionSystem ? collisionSystem.getBasinHeightAt(x, z) : _fallbackBasinPoint.y) + 0.0035;

        const vIdx = (r * basinCols + c) * 3;
        flowPositions[vIdx]     = x;
        flowPositions[vIdx + 1] = y;
        flowPositions[vIdx + 2] = z;
      }
    }
    basinFlowPosAttr.needsUpdate = true;
    basinFlowMesh.visible = true;

    // ── 90s Anime Splash FX (Energetic bursts & droplets) ──
    if (isHandHit) {
      handSplashAccum += dt * 65;
      const count = Math.floor(handSplashAccum);
      handSplashAccum -= count;
      for (let i = 0; i < count; i++) {
        spawnImpactSplash(primaryHitPoint, primaryHitNormal);
      }

      handDripAccum += dt * 45;
      const dripCount = Math.floor(handDripAccum);
      handDripAccum -= dripCount;
      for (let i = 0; i < dripCount; i++) {
        spawnDripRunoff(runoffPoint, drainCenter);
      }
    } else {
      handSplashAccum = 0;
      handDripAccum = 0;
    }

    // Drain / basin splash active whenever water crashes into sink
    const drainSplashRate = isHandHit ? 45 : 65;
    basinSplashAccum += dt * drainSplashRate;
    const basinCount = Math.floor(basinSplashAccum);
    basinSplashAccum -= basinCount;
    _tempPos.set(impactX, impactY, impactZ);
    for (let i = 0; i < basinCount; i++) {
      spawnBasinSplash(_tempPos);
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
