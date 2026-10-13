import * as THREE from "three";

export interface WaterParticleConfig {
  /** Base vibrant water color (cyan/sky blue) */
  color: THREE.ColorRepresentation;
  /** Deep water tone */
  deepColor?: THREE.ColorRepresentation;
  /** Highlight / foam streak color */
  highlightColor?: THREE.ColorRepresentation;
  /** Overall stream opacity */
  opacity: number;
  /** Top radius at faucet spout */
  radiusTop?: number;
  /** Bottom radius before impact */
  radiusBottom?: number;
  /** Length of the stream downwards */
  streamLength?: number;
  /** Speed of water flow animation */
  flowSpeed?: number;
  /** Unused legacy properties kept for backwards-compatibility */
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
  color: 0x38bdf8, // Sky-blue / cyan body
  deepColor: 0x0284c7, // Deeper cyan-blue core
  highlightColor: 0xffffff, // White highlights
  opacity: 0.88,
  radiusTop: 0.034,
  radiusBottom: 0.024,
  streamLength: 0.82,
  flowSpeed: 3.5,
};

export function createWaterParticleSystem(
  userConfig: Partial<WaterParticleConfig> = {},
) {
  const config = { ...DEFAULT_WATER_CONFIG, ...userConfig };

  const group = new THREE.Group();
  group.name = "WaterStreamGroup";

  // Shared time uniform for both stream and splash — eliminates indexing errors & ensures exact sync
  const timeUniform = { value: 0 };

  // ── 1. Continuous Stream Geometry (Tapered Cylinder) ────────────────────────
  const length = config.streamLength ?? 0.82;
  const radiusTop = config.radiusTop ?? 0.034;
  const radiusBottom = config.radiusBottom ?? 0.024;
  const radialSegments = 24;
  const heightSegments = 48;

  const streamGeometry = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    length,
    radialSegments,
    heightSegments,
    true, // Open ended for natural tap flow
  );

  // Position top of cylinder at origin (0, 0, 0) so it attaches to WaterSpawn
  streamGeometry.translate(0, -length / 2, 0);

  // ── 2. Stylized Toon-Water Stream Shader ─────────────────────────────────────
  const streamMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,

    uniforms: {
      uDeepColor: { value: new THREE.Color(config.deepColor ?? 0x0284c7) },
      uSurfaceColor: { value: new THREE.Color(config.color ?? 0x38bdf8) },
      uHighlightColor: {
        value: new THREE.Color(config.highlightColor ?? 0xffffff),
      },
      uFoamColor: { value: new THREE.Color(0xa5f3fc) },
      uOpacity: { value: config.opacity },
      uTime: timeUniform,
      uFlowSpeed: { value: config.flowSpeed ?? 3.5 },
    },

    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      uniform float uTime;
      uniform float uFlowSpeed;

      void main() {
        vUv = uv;

        // Subtle fluid wobble along stream length
        // Note: position.y goes from 0 (top) down to -length (bottom).
        // Adding (+ uTime) causes the wave to propagate downward in the direction of flow.
        float yDist = -position.y;
        float waveAngle = position.y * 16.0 + uTime * (uFlowSpeed * 1.5);
        float wobbleScale = smoothstep(0.02, 0.25, yDist);

        float waveX = sin(waveAngle) * 0.0020 * wobbleScale;
        float waveZ = cos(waveAngle * 0.85) * 0.0016 * wobbleScale;

        vec3 pos = position;
        pos.x += waveX;
        pos.z += waveZ;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3 uDeepColor;
      uniform vec3 uSurfaceColor;
      uniform vec3 uHighlightColor;
      uniform vec3 uFoamColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uFlowSpeed;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);

        // In Three.js CylinderGeometry: vUv.y = 1.0 is TOP (spout), vUv.y = 0.0 is BOTTOM (basin).
        // Adding (+ uTime * uFlowSpeed) causes texture features to travel DOWNWARD (from vUv.y 1 -> 0).
        float flowCoord = vUv.y * 4.5 + uTime * uFlowSpeed;

        // 1. Flowing cartoon water caustic streaks along stream surface
        // Adding slight wave curvature so streaks feel like fluid liquid rather than straight stripes
        float waveCurvature = sin(flowCoord * 1.6 + vUv.x * 6.28) * 0.09;
        float streak1 = sin((vUv.x + waveCurvature) * 18.84 + flowCoord * 2.2) * 0.5 + 0.5;
        float streak2 = cos((vUv.x - waveCurvature * 0.75) * 25.13 + flowCoord * 3.0) * 0.5 + 0.5;
        float highlightLines = smoothstep(0.82, 0.93, streak1) * 0.75 + smoothstep(0.85, 0.95, streak2) * 0.65;
        highlightLines = clamp(highlightLines, 0.0, 1.0);

        // 2. Toon Fresnel Rim (crisp anime edge outline)
        float NdotV = max(dot(N, V), 0.0);
        float fresnel = 1.0 - NdotV;
        float toonRim = smoothstep(0.48, 0.60, fresnel);

        // 3. Discrete toon lighting bands (matches anime porcelain shading)
        vec3 lightDir = normalize(vec3(0.4, 0.8, 0.5));
        float NdotL = dot(N, lightDir);
        float lightBand = smoothstep(-0.15, 0.15, NdotL);
        float highBand = smoothstep(0.42, 0.54, NdotL);

        // Blend stylized liquid colors
        vec3 waterColor = mix(uDeepColor, uSurfaceColor, lightBand * 0.65 + 0.35);
        waterColor = mix(waterColor, uHighlightColor, highBand * 0.35);
        waterColor = mix(waterColor, uFoamColor, toonRim * 0.6);
        waterColor = mix(waterColor, uHighlightColor, highlightLines * 0.85);

        // 4. Soft emergence fade at faucet spout & smooth bottom fade
        // vUv.y is 1.0 at spout, 0.0 at basin
        float topFade = smoothstep(1.0, 0.95, vUv.y);
        float bottomFade = smoothstep(0.0, 0.06, vUv.y);
        float streamAlpha = uOpacity * topFade * bottomFade;

        // Enhance alpha at silhouette edges for volumetric fluid look
        streamAlpha = mix(streamAlpha * 0.8, streamAlpha, toonRim * 0.4 + 0.6);

        gl_FragColor = vec4(waterColor, streamAlpha);
      }
    `,
  });

  const streamMesh = new THREE.Mesh(streamGeometry, streamMaterial);
  streamMesh.name = "WaterStreamMesh";
  streamMesh.frustumCulled = false;
  group.add(streamMesh);

  // ── 3. Stylized Impact Splash Ripple (Basin Contact Point) ─────────────────
  const splashRadius = 0.09;
  const splashGeometry = new THREE.PlaneGeometry(
    splashRadius * 2,
    splashRadius * 2,
  );
  splashGeometry.rotateX(-Math.PI / 2); // Horizontal disk

  const splashMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,

    uniforms: {
      uColor: { value: new THREE.Color(config.color ?? 0x38bdf8) },
      uHighlightColor: {
        value: new THREE.Color(config.highlightColor ?? 0xffffff),
      },
      uFoamColor: { value: new THREE.Color(0xa5f3fc) },
      uOpacity: { value: config.opacity },
      uTime: timeUniform,
    },

    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uHighlightColor;
      uniform vec3 uFoamColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        vec2 centeredUv = vUv - 0.5;
        float dist = length(centeredUv) * 2.0;
        if (dist > 1.0) discard;

        // Concentric expanding anime ripple rings (dist - uTime expands outward)
        float ring1 = sin(dist * 16.0 - uTime * 7.0) * 0.5 + 0.5;
        float ring2 = sin(dist * 24.0 - uTime * 9.5) * 0.5 + 0.5;
        float toonRing = smoothstep(0.72, 0.86, ring1) + smoothstep(0.75, 0.88, ring2);
        toonRing = clamp(toonRing, 0.0, 1.0) * (1.0 - smoothstep(0.7, 1.0, dist));

        // Center splash core glow
        float centerGlow = 1.0 - smoothstep(0.0, 0.42, dist);

        vec3 splashColor = mix(uColor, uFoamColor, toonRing * 0.7);
        splashColor = mix(splashColor, uHighlightColor, centerGlow * 0.8);

        float alpha = (centerGlow * 0.75 + toonRing * 0.55) * (1.0 - smoothstep(0.85, 1.0, dist)) * uOpacity;

        gl_FragColor = vec4(splashColor, alpha);
      }
    `,
  });

  const splashMesh = new THREE.Mesh(splashGeometry, splashMaterial);
  splashMesh.name = "WaterStreamSplash";
  splashMesh.position.set(0, -length, 0);
  splashMesh.frustumCulled = false;
  group.add(splashMesh);

  // ── 4. Zero-allocation per-frame update ──────────────────────────────────────
  let totalTime = 0;

  function update(delta: number, spawnWorldPos?: THREE.Vector3) {
    const dt = Math.min(delta, 0.05);
    totalTime += dt;

    // Directly update the shared time uniform — fully type-safe, no indexing errors, syncs both shaders
    timeUniform.value = totalTime;
    // Keep stream perfectly anchored to WaterSpawn position
    if (spawnWorldPos) {
      group.position.copy(spawnWorldPos);
    }
  }

  function setLength(newLength: number) {
    streamGeometry.dispose();
    const updatedGeometry = new THREE.CylinderGeometry(
      radiusTop,
      radiusBottom,
      newLength,
      radialSegments,
      heightSegments,
      true,
    );
    updatedGeometry.translate(0, -newLength / 2, 0);
    streamMesh.geometry = updatedGeometry;
    splashMesh.position.set(0, -newLength, 0);
  }

  function dispose() {
    streamGeometry.dispose();
    streamMaterial.dispose();
    splashGeometry.dispose();
    splashMaterial.dispose();
  }

  return {
    // Aliases for backwards compatibility with WaterSystem.vue
    points: group,
    group,
    streamMesh,
    splashMesh,
    update,
    setLength,
    dispose,
    config,
  };
}
