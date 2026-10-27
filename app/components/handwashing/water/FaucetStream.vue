<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import {
  WaterRuntimeKey,
  type WaterEffect,
  type WaterFrameState,
} from "./waterRuntime";
import {
  createWaterMaterial,
  disposeWaterMaterial,
  updateWaterMaterial,
} from "./waterMaterials";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("FaucetStream requires WaterSystem runtime");

const streamRadius = runtime.config.streamRadius;

// ── 1. Upper stream (faucet nozzle down to hand contact or sink) ─────────────
const upperGeometry = new THREE.CylinderGeometry(
  streamRadius, streamRadius, 1, 16, 24, true,
);
const streamMaterial = createWaterMaterial(
  "stream", runtime.config.color, runtime.config.deepColor,
);
const upperMesh = new THREE.Mesh(upperGeometry, streamMaterial);
upperMesh.name = "FaucetWaterStreamUpper";
upperMesh.frustumCulled = false;

// ── 2. Runoff stream (cascades from underside of hands to sink basin) ────────
const runoffGeometry = new THREE.CylinderGeometry(
  streamRadius * 0.95, streamRadius * 0.75, 1, 16, 20, true,
);
const runoffMesh = new THREE.Mesh(runoffGeometry, streamMaterial);
runoffMesh.name = "FaucetWaterStreamRunoff";
runoffMesh.frustumCulled = false;
runoffMesh.visible = false;

// ── 3. Runoff collar / meniscus (bridges underside of hands into stream) ─────
function createRunoffCollarGeometry(radius: number): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  const SEGS = 18;
  const HEIGHT = 0.038;
  const R_TOP = radius * 1.35;
  const R_BOT = radius * 0.95;

  for (let s = 0; s <= 3; s++) {
    const t = s / 3;
    const curve = Math.pow(t, 1.8);
    const r = THREE.MathUtils.lerp(R_TOP, R_BOT, curve);
    const y = -t * HEIGHT;

    for (let i = 0; i <= SEGS; i++) {
      const angle = (i / SEGS) * Math.PI * 2;
      verts.push(Math.sin(angle) * r, y, Math.cos(angle) * r);
      uvs.push(i / SEGS, t);
    }
  }

  const stride = SEGS + 1;
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < SEGS; i++) {
      const a = s * stride + i;
      const b = s * stride + (i + 1);
      const c = (s + 1) * stride + i;
      const d = (s + 1) * stride + (i + 1);
      idx.push(a, b, c, b, d, c);
    }
  }

  geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geom.setAttribute("uv",       new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

const runoffCollarGeometry = createRunoffCollarGeometry(streamRadius);
const runoffCollarMesh = new THREE.Mesh(runoffCollarGeometry, streamMaterial);
runoffCollarMesh.name = "FaucetWaterStreamRunoffCollar";
runoffCollarMesh.frustumCulled = false;
runoffCollarMesh.visible = false;

// ── 4. Compact Cupped Palm Water Pool ────────────────────────────────────────
// Natural, compact water pool nesting inside the cupped palm hollow without protruding
function createCuppedPalmPoolGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  const RINGS = 8;
  const SEGS  = 28;
  const RADIUS_X = 0.082; // compact: stays inside cupped palm
  const RADIUS_Z = 0.072; // compact: stays inside cupped palm

  verts.push(0, 0, 0);
  uvs.push(0.5, 0.5);

  for (let r = 1; r <= RINGS; r++) {
    const nr = r / RINGS;
    for (let i = 0; i <= SEGS; i++) {
      const angle = (i / SEGS) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Organic liquid perimeter contour
      const wobble = 1.0 + 0.05 * Math.sin(angle * 3.0) + 0.025 * Math.cos(angle * 5.0);
      const px = sinA * RADIUS_X * nr * wobble;
      const pz = cosA * RADIUS_Z * nr * wobble;

      // Gentle concave bowl following cupped palm cradle
      const py = (px * px * 0.4 + pz * pz * 0.4) * 0.22;

      verts.push(px, py, pz);
      uvs.push(0.5 + (px / (RADIUS_X * 1.1)) * 0.5, 0.5 + (pz / (RADIUS_Z * 1.1)) * 0.5);
    }
  }

  const stride = SEGS + 1;
  for (let i = 0; i < SEGS; i++) {
    idx.push(0, 1 + (i + 1) % SEGS, 1 + i);
  }
  for (let r = 0; r < RINGS - 1; r++) {
    for (let i = 0; i < SEGS; i++) {
      const a = 1 + r * stride + i;
      const b = 1 + r * stride + (i + 1);
      const c = 1 + (r + 1) * stride + i;
      const d = 1 + (r + 1) * stride + (i + 1);
      idx.push(a, b, c, b, d, c);
    }
  }

  geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geom.setAttribute("uv",       new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

const poolGeometry = createCuppedPalmPoolGeometry();
const poolMaterial = createWaterMaterial(
  "handSpread", runtime.config.color, runtime.config.deepColor,
);
const poolMesh = new THREE.Mesh(poolGeometry, poolMaterial);
poolMesh.name = "HandPalmPool";
poolMesh.renderOrder = 3;
poolMesh.frustumCulled = false;
poolMesh.visible = false;

// ── 5. Small Controlled 90s Anime Splash Droplets & Crests ──────────────────
// Subtle, stylized anime splash droplets around the entry point (no giant horns)
function createCompactAnimeSplashGeometry(radius: number): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  // Low entry collar right around stream perimeter
  const SEGS = 18;
  const rBase = radius * 0.96;
  const rTop  = radius * 1.20;
  const hCollar = 0.010;

  for (let s = 0; s <= 2; s++) {
    const t = s / 2;
    const r = THREE.MathUtils.lerp(rBase, rTop, t);
    const y = t * hCollar;
    for (let i = 0; i <= SEGS; i++) {
      const angle = (i / SEGS) * Math.PI * 2;
      verts.push(Math.sin(angle) * r, y, Math.cos(angle) * r);
      uvs.push(i / SEGS, t);
    }
  }
  const stride = SEGS + 1;
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < SEGS; i++) {
      const a = s * stride + i;
      const b = s * stride + (i + 1);
      const c = (s + 1) * stride + i;
      const d = (s + 1) * stride + (i + 1);
      idx.push(a, b, c, b, d, c);
    }
  }

  // 5 small, controlled anime splash droplets / crests
  const crests = [
    { angle:  0.4,  tipR: radius * 1.42, height: 0.022, halfW: 0.015 },
    { angle:  1.7,  tipR: radius * 1.32, height: 0.016, halfW: 0.013 },
    { angle:  2.9,  tipR: radius * 1.45, height: 0.024, halfW: 0.015 },
    { angle: -2.1,  tipR: radius * 1.35, height: 0.018, halfW: 0.013 },
    { angle: -0.8,  tipR: radius * 1.44, height: 0.022, halfW: 0.014 },
  ];

  for (const c of crests) {
    const baseVertIdx = verts.length / 3;
    const ox = Math.sin(c.angle);
    const oz = Math.cos(c.angle);
    const px = -oz;
    const pz =  ox;

    const STEPS = 4;
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      const curR = THREE.MathUtils.lerp(radius * 0.98, c.tipR, Math.pow(t, 0.8));
      const curY = Math.sin(t * Math.PI * 0.65) * c.height;
      const curW = c.halfW * (1.0 - t * 0.85);

      const cx = ox * curR;
      const cz = oz * curR;

      verts.push(cx - px * curW, curY, cz - pz * curW);
      uvs.push(0.0, t);
      verts.push(cx + px * curW, curY, cz + pz * curW);
      uvs.push(1.0, t);

      if (s < STEPS) {
        const row = baseVertIdx + s * 2;
        idx.push(row, row + 1, row + 2);
        idx.push(row + 1, row + 3, row + 2);
      }
    }
  }

  geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geom.setAttribute("uv",       new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

const splashGeometry = createCompactAnimeSplashGeometry(streamRadius);
const splashMaterial = createWaterMaterial(
  "stream", runtime.config.color, runtime.config.deepColor,
);
const splashMesh = new THREE.Mesh(splashGeometry, splashMaterial);
splashMesh.name = "HandImpactAnimeSplash";
splashMesh.renderOrder = 4;
splashMesh.frustumCulled = false;
splashMesh.visible = false;

// ── Root Group ──────────────────────────────────────────────────────────────
const object = new THREE.Group();
object.name = "FaucetStreamEffect";
object.add(upperMesh);
object.add(runoffMesh);
object.add(runoffCollarMesh);
object.add(poolMesh);
object.add(splashMesh);

const upAxis     = new THREE.Vector3(0, 1, 0);
const scratchDir = new THREE.Vector3();
const scratchMid = new THREE.Vector3();
const targetEnd  = new THREE.Vector3();

function orientCylinder(
  mesh: THREE.Mesh,
  top: THREE.Vector3,
  bot: THREE.Vector3,
  rs = 1.0,
): void {
  const len = THREE.MathUtils.clamp(top.distanceTo(bot), 0.04, 3.0);
  scratchMid.addVectors(top, bot).multiplyScalar(0.5);
  scratchDir.subVectors(top, bot).normalize();
  if (scratchDir.lengthSq() < 0.001) scratchDir.set(0, 1, 0);
  mesh.position.copy(scratchMid);
  mesh.quaternion.setFromUnitVectors(upAxis, scratchDir);
  mesh.scale.set(rs, len, rs);
}

const effect: WaterEffect = {
  order: 0,
  object,
  update(frame: WaterFrameState) {
    object.visible = frame.ready && frame.active && frame.streamActive;
    if (!object.visible) return;

    // Upper stream endpoint smoothly blends to hand impact point
    targetEnd.lerpVectors(frame.streamEnd, frame.handImpactPoint, frame.handContactFactor);
    orientCylinder(upperMesh, frame.origin, targetEnd);

    if (frame.handContactFactor > 0.03) {
      const cf = frame.handContactFactor;
      const t  = frame.time;

      // ── 1. Cupped Palm Water Pool ──
      // Compact anime water pool resting in the cupped palm hollow
      poolMesh.visible = true;
      poolMesh.position.set(
        frame.handImpactPoint.x,
        frame.handImpactPoint.y + 0.002,
        frame.handImpactPoint.z,
      );
      poolMesh.rotation.set(-0.04, 0.02, -0.03);
      const poolPulse = cf * (1.0 + 0.03 * Math.sin(t * 6.0));
      poolMesh.scale.set(poolPulse, 1.0, poolPulse);

      // ── 2. Controlled Anime Splash at Impact Entry ──
      splashMesh.visible = true;
      splashMesh.position.copy(frame.handImpactPoint);
      splashMesh.rotation.y = t * 1.2;
      const splashPulse = cf * (1.0 + 0.08 * Math.sin(t * 9.0));
      splashMesh.scale.set(splashPulse, splashPulse, splashPulse);

      // ── 3. Runoff stream beneath hands ──
      runoffMesh.visible = true;
      orientCylinder(runoffMesh, frame.handRunoffOrigin, frame.streamEnd, cf * 0.90);

      // ── 4. Runoff collar (bridges underside of hands into stream) ──
      runoffCollarMesh.visible = true;
      runoffCollarMesh.position.copy(frame.handRunoffOrigin);
      runoffCollarMesh.quaternion.copy(runoffMesh.quaternion);
      runoffCollarMesh.scale.set(cf, cf, cf);

    } else {
      poolMesh.visible         = false;
      splashMesh.visible       = false;
      runoffMesh.visible       = false;
      runoffCollarMesh.visible = false;
    }

    updateWaterMaterial(streamMaterial, frame.time);
    updateWaterMaterial(poolMaterial,   frame.time);
    updateWaterMaterial(splashMaterial, frame.time);
  },

  dispose() {
    upperGeometry.dispose();
    runoffGeometry.dispose();
    runoffCollarGeometry.dispose();
    poolGeometry.dispose();
    splashGeometry.dispose();
    disposeWaterMaterial(streamMaterial);
    disposeWaterMaterial(poolMaterial);
    disposeWaterMaterial(splashMaterial);
  },
};

let unregister: (() => void) | undefined;
onMounted(() => { unregister = runtime.register(effect); });
onUnmounted(() => { unregister?.(); effect.dispose(); });
</script>

<template></template>
