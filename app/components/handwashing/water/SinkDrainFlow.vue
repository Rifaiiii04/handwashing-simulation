<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState } from "./waterRuntime";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("SinkDrainFlow requires WaterSystem runtime");

// World-space porcelain anchors. The first point is supplied by WaterSystem
// through frame.streamEnd so the 3D runoff starts at the same point as the
// faucet stream, even when the hidden GLB water plane is changed.
const LANDING = new THREE.Vector3(0, 0.824, -0.668);
const DRAIN_LIP = new THREE.Vector3(0, 0.730, -0.320);
const DRAIN = new THREE.Vector3(0, 0.728, -0.250);
const DRAIN_DOWN = new THREE.Vector3(0, 0.430, -0.250);
const SURFACE_LIFT = 0.012;

const object = new THREE.Group();
object.name = "SinkDrainFlowEffect";
object.frustumCulled = false;

const upAxis = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();
const center = new THREE.Vector3();
const basinStart = new THREE.Vector3();
const lipPoint = new THREE.Vector3();
const drainPoint = new THREE.Vector3();
const drainDownPoint = new THREE.Vector3();

function orientTube(
  mesh: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radiusScale: number,
): void {
  direction.subVectors(end, start);
  const length = Math.max(0.001, direction.length());
  direction.normalize();
  center.addVectors(start, end).multiplyScalar(0.5);
  mesh.position.copy(center);
  mesh.quaternion.setFromUnitVectors(upAxis, direction);
  mesh.scale.set(radiusScale, length, radiusScale);
}

function createTubeGeometry(radialSegments = 18): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(1, 1, 1, radialSegments, 8, true);
}

const waterMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: {
    uTime: { value: 0 },
    uStrength: { value: 0 },
    uColor: { value: new THREE.Color(0x087fd1) },
    uHighlight: { value: new THREE.Color(0x43c5ff) },
  },
  vertexShader: `
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vec3 transformed = position;
      float ripple = sin(uv.y * 42.0 - uTime * 15.0) * 0.006;
      transformed.xz *= 1.0 + ripple;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uStrength;
    uniform vec3 uColor;
    uniform vec3 uHighlight;
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      float streak = 0.5 + 0.5 * sin(vUv.y * 56.0 - uTime * 18.0 + vUv.x * 4.0);
      float sideLight = 0.64 + 0.36 * max(dot(normalize(vNormal), normalize(vec3(0.35, 0.8, 0.4))), 0.0);
      vec3 color = mix(uColor, uHighlight, streak * 0.22) * sideLight;
      gl_FragColor = vec4(color, uStrength * 0.9);
    }
  `,
});

const basinTube = new THREE.Mesh(createTubeGeometry(20), waterMaterial);
basinTube.name = "SinkDrainBasinRunoff3D";
const lipTube = new THREE.Mesh(createTubeGeometry(18), waterMaterial);
lipTube.name = "SinkDrainLipRunoff3D";
const drainTube = new THREE.Mesh(createTubeGeometry(18), waterMaterial);
drainTube.name = "SinkDrainDownflow3D";
for (const mesh of [basinTube, lipTube, drainTube]) {
  // The stream is a deliberate visual overlay on the porcelain surface. A
  // small render priority prevents the blue core from disappearing inside the
  // low-poly basin shell at grazing camera angles.
  mesh.renderOrder = 12;
}
object.add(basinTube, lipTube, drainTube);

const impactMesh = new THREE.Mesh(
  new THREE.CircleGeometry(0.06, 32),
  new THREE.MeshBasicMaterial({
    color: 0x19bfe8,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
impactMesh.name = "SinkDrainImpactFlare";
impactMesh.rotation.x = -Math.PI / 2;
object.add(impactMesh);

const poolMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: {
    uTime: { value: 0 },
    uStrength: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv - 0.5;
      float radius = length(p) * 2.0;
      float ring = 0.5 + 0.5 * sin(radius * 35.0 - uTime * 7.0);
      float mask = 1.0 - smoothstep(0.1, 1.0, radius);
      vec3 color = mix(vec3(0.01, 0.25, 0.48), vec3(0.08, 0.72, 0.84), ring * 0.28);
      gl_FragColor = vec4(color, uStrength * mask * 0.72);
    }
  `,
});
const poolMesh = new THREE.Mesh(new THREE.CircleGeometry(0.085, 48), poolMaterial);
poolMesh.name = "SinkDrainSuctionPool";
poolMesh.rotation.x = -Math.PI / 2;
poolMesh.position.copy(DRAIN);
poolMesh.position.y += SURFACE_LIFT;
poolMesh.renderOrder = 13;
object.add(poolMesh);

let flowStrength = 0;
let lastResetToken = -1;

const effect: WaterEffect = {
  order: 1,
  object,
  update(frame: WaterFrameState): void {
    if (frame.resetToken !== lastResetToken) {
      lastResetToken = frame.resetToken;
      flowStrength = 0;
    }

    const shouldFlow = frame.ready && frame.active
      && (frame.streamActive || frame.handContactFactor > 0.02);
    flowStrength = THREE.MathUtils.damp(
      flowStrength,
      shouldFlow ? 1 : 0,
      shouldFlow ? 14 : 18,
      frame.delta,
    );
    const visible = flowStrength > 0.004;
    object.visible = visible;
    if (!visible) return;

    // The 3D basin stream begins at the measured frame.streamEnd landing.
    // It follows the porcelain slope to the drain lip, then enters the hole
    // as a separate downward tube so the flow reads as volumetric water.
    basinStart.copy(frame.streamEnd);
    basinStart.y += SURFACE_LIFT;
    lipPoint.copy(DRAIN_LIP);
    lipPoint.y += SURFACE_LIFT;
    drainPoint.copy(DRAIN);
    drainPoint.y += SURFACE_LIFT;
    drainDownPoint.copy(DRAIN_DOWN);
    drainDownPoint.y += SURFACE_LIFT;
    orientTube(basinTube, basinStart, lipPoint, 0.045 * flowStrength);
    orientTube(lipTube, lipPoint, drainPoint, 0.040 * flowStrength);
    orientTube(drainTube, drainPoint, drainDownPoint, 0.032 * flowStrength);

    waterMaterial.uniforms.uTime.value = frame.time;
    waterMaterial.uniforms.uStrength.value = flowStrength;
    poolMaterial.uniforms.uTime.value = frame.time;
    poolMaterial.uniforms.uStrength.value = flowStrength;

    impactMesh.position.copy(frame.streamEnd);
    impactMesh.position.y += 0.001;
    const pulse = 1 + Math.sin(frame.time * 8.0) * 0.08;
    impactMesh.scale.setScalar(flowStrength * pulse);
    (impactMesh.material as THREE.MeshBasicMaterial).opacity = flowStrength * 0.28;
  },
  dispose(): void {
    basinTube.geometry.dispose();
    lipTube.geometry.dispose();
    drainTube.geometry.dispose();
    waterMaterial.dispose();
    impactMesh.geometry.dispose();
    (impactMesh.material as THREE.Material).dispose();
    poolMesh.geometry.dispose();
    poolMaterial.dispose();
  },
};

let unregister: (() => void) | undefined;
onMounted(() => {
  unregister = runtime.register(effect);
});
onUnmounted(() => {
  unregister?.();
  effect.dispose();
});
</script>

<template></template>

