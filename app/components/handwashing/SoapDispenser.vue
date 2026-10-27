<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import {
  DEFAULT_SOAP_DISPENSER_CONFIG,
  type SoapDispenserConfig,
} from "~/lib/handwashing/handwashingConfig";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState } from "./water/waterRuntime";

const props = defineProps<{
  config?: Partial<SoapDispenserConfig>;
}>();

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("SoapDispenser requires WaterSystem runtime");

const cfg: SoapDispenserConfig = {
  ...DEFAULT_SOAP_DISPENSER_CONFIG,
  ...props.config,
};

function createToonGradientTexture(): THREE.DataTexture {
  // 4-band anime cel-shading ramp: ascending dark→bright (UV 0=shadow, UV 1=highlight).
  const data = new Uint8Array([88, 152, 212, 255]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const toonRamp = createToonGradientTexture();
const ownedGeometries: THREE.BufferGeometry[] = [];
const ownedMaterials: THREE.Material[] = [];

function trackGeometry<T extends THREE.BufferGeometry>(geo: T): T {
  ownedGeometries.push(geo);
  return geo;
}

function trackMaterial<T extends THREE.Material>(mat: T): T {
  ownedMaterials.push(mat);
  return mat;
}

const bottleMaterial = trackMaterial(
  new THREE.MeshToonMaterial({
    color: cfg.bottleColor,
    gradientMap: toonRamp,
  }),
);

const accentMaterial = trackMaterial(
  new THREE.MeshToonMaterial({
    color: cfg.bottleAccentColor,
    gradientMap: toonRamp,
  }),
);

const pumpMaterial = trackMaterial(
  new THREE.MeshToonMaterial({
    color: cfg.pumpMetalColor,
    gradientMap: toonRamp,
  }),
);

const outletMaterial = trackMaterial(
  new THREE.MeshToonMaterial({
    color: cfg.outletDarkColor,
    gradientMap: toonRamp,
  }),
);



// 1. Rounded bottle body + shoulder + neck using LatheGeometry
function createBottleGeometry(): THREE.LatheGeometry {
  const r0 = cfg.bodyRadiusBottom;
  const rBelly = cfg.bodyRadiusBelly;
  const rShoulder = cfg.bodyRadiusShoulder;
  const rNeck = cfg.neckRadius;
  const hBody = cfg.bodyHeight;
  const hNeck = cfg.neckHeight;

  const points: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r0 * 0.82, 0),
    new THREE.Vector2(r0 * 0.96, hBody * 0.03),
    new THREE.Vector2(r0, hBody * 0.08),
    new THREE.Vector2(rBelly * 0.96, hBody * 0.24),
    new THREE.Vector2(rBelly, hBody * 0.46),
    new THREE.Vector2(rBelly * 0.97, hBody * 0.66),
    new THREE.Vector2(rShoulder * 1.08, hBody * 0.80),
    new THREE.Vector2(rShoulder * 0.94, hBody * 0.88),
    new THREE.Vector2(rShoulder * 0.72, hBody * 0.95),
    new THREE.Vector2(rNeck * 1.12, hBody * 0.99),
    new THREE.Vector2(rNeck, hBody + hNeck * 0.15),
    new THREE.Vector2(rNeck, hBody + hNeck),
  ];
  const geometry = new THREE.LatheGeometry(points, 28);
  geometry.computeVertexNormals();
  return trackGeometry(geometry);
}

// 2. Beveled pump collar using LatheGeometry
function createCollarGeometry(): THREE.LatheGeometry {
  const rCollar = cfg.collarRadius;
  const hCollar = cfg.collarHeight;
  const rInner = cfg.stemRadius * 1.15;
  const points: THREE.Vector2[] = [
    new THREE.Vector2(rCollar * 0.92, 0),
    new THREE.Vector2(rCollar, hCollar * 0.12),
    new THREE.Vector2(rCollar, hCollar * 0.78),
    new THREE.Vector2(rCollar * 0.86, hCollar * 0.96),
    new THREE.Vector2(rInner, hCollar),
  ];
  const geometry = new THREE.LatheGeometry(points, 24);
  geometry.computeVertexNormals();
  return trackGeometry(geometry);
}

// 3. Ergonomic pump head actuator cap using LatheGeometry
function createPumpHeadGeometry(): THREE.LatheGeometry {
  const rHead = cfg.headRadius;
  const hHead = cfg.headHeight;
  const points: THREE.Vector2[] = [
    new THREE.Vector2(cfg.stemRadius, 0),
    new THREE.Vector2(rHead * 0.92, hHead * 0.08),
    new THREE.Vector2(rHead, hHead * 0.26),
    new THREE.Vector2(rHead * 0.98, hHead * 0.74),
    new THREE.Vector2(rHead * 0.82, hHead * 0.92),
    new THREE.Vector2(rHead * 0.45, hHead * 0.98),
    new THREE.Vector2(0, hHead),
  ];
  const geometry = new THREE.LatheGeometry(points, 24);
  geometry.computeVertexNormals();
  return trackGeometry(geometry);
}

const dispenserGroup = new THREE.Group();
dispenserGroup.name = "ProceduralSoapDispenser";

const bottleMesh = new THREE.Mesh(createBottleGeometry(), bottleMaterial);
bottleMesh.name = "SoapDispenserBottle";

// Subtle wrap-around label band on the middle of the bottle
const labelHeight = cfg.bodyHeight * 0.34;
const labelGeometry = trackGeometry(
  new THREE.CylinderGeometry(
    cfg.bodyRadiusBelly * 0.992,
    cfg.bodyRadiusBelly * 1.004,
    labelHeight,
    28,
    1,
    true,
  ),
);
const labelMesh = new THREE.Mesh(labelGeometry, accentMaterial);
labelMesh.name = "SoapDispenserLabelBand";
labelMesh.position.y = cfg.bodyHeight * 0.45;

// Stationary pump collar seated on the neck
const collarBaseY = cfg.bodyHeight + cfg.neckHeight * 0.35;
const collarMesh = new THREE.Mesh(createCollarGeometry(), pumpMaterial);
collarMesh.name = "SoapDispenserCollar";
collarMesh.position.y = collarBaseY;

dispenserGroup.add(bottleMesh, labelMesh, collarMesh);

// Moving pump assembly (stem + head + nozzle + outlet opening)
const collarTopY = collarBaseY + cfg.collarHeight;
const pumpMovingGroup = new THREE.Group();
pumpMovingGroup.name = "SoapDispenserPumpPlunger";
pumpMovingGroup.position.y = collarTopY;

// Stem
const stemTotalLen = cfg.stemHeight + cfg.pumpStroke * 1.1;
const stemGeometry = trackGeometry(
  new THREE.CylinderGeometry(cfg.stemRadius, cfg.stemRadius, stemTotalLen, 16),
);
const stemMesh = new THREE.Mesh(stemGeometry, pumpMaterial);
stemMesh.name = "SoapDispenserStem";
stemMesh.position.y = cfg.stemHeight - stemTotalLen * 0.5;

// Head cap
const headMesh = new THREE.Mesh(createPumpHeadGeometry(), pumpMaterial);
headMesh.name = "SoapDispenserHead";
headMesh.position.y = cfg.stemHeight;

// Nozzle & outlet sub-group rotated by nozzleYawRadians toward the basin
const nozzleYawGroup = new THREE.Group();
nozzleYawGroup.name = "SoapDispenserNozzleAssembly";
nozzleYawGroup.position.y = cfg.stemHeight + cfg.headHeight * 0.58;
nozzleYawGroup.rotation.y = cfg.nozzleYawRadians;

const nozzleCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, cfg.headRadius * 0.55),
  new THREE.Vector3(0, 0.003, cfg.nozzleLength * 0.42),
  new THREE.Vector3(0, -cfg.nozzleDrop * 0.35, cfg.nozzleLength * 0.78),
  new THREE.Vector3(0, -cfg.nozzleDrop, cfg.nozzleLength),
]);
const nozzleGeometry = trackGeometry(
  new THREE.TubeGeometry(nozzleCurve, 16, cfg.nozzleRadius, 12, false),
);
const nozzleMesh = new THREE.Mesh(nozzleGeometry, pumpMaterial);
nozzleMesh.name = "SoapDispenserNozzle";

// Small outlet opening at the nozzle tip
const tipPoint = nozzleCurve.getPoint(1);
const tipTangent = nozzleCurve.getTangent(1).normalize();
const outletGeometry = trackGeometry(
  new THREE.CylinderGeometry(cfg.outletRadius, cfg.outletRadius * 0.92, 0.008, 12),
);
const outletMesh = new THREE.Mesh(outletGeometry, outletMaterial);
outletMesh.name = "SoapDispenserOutlet";
outletMesh.position.copy(tipPoint);
outletMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tipTangent);

// Anchor at the exact outlet opening for soap emission
const outletAnchor = new THREE.Object3D();
outletAnchor.name = "SoapDispenserOutletAnchor";
outletAnchor.position.copy(tipPoint).addScaledVector(tipTangent, 0.004);

nozzleYawGroup.add(nozzleMesh, outletMesh, outletAnchor);
pumpMovingGroup.add(stemMesh, headMesh, nozzleYawGroup);
dispenserGroup.add(pumpMovingGroup);

// 4. Localized soap blob & viscous strand visual effect (in world space under root)
const soapEffectGroup = new THREE.Group();
soapEffectGroup.name = "SoapDispenseVisualEffect";
soapEffectGroup.visible = false;

// Separate low-step toon ramp for soap: strong 2-tone light/shadow split
// that reads clearly as a liquid dollop in anime cel style.
const soapToonRamp = (function (): THREE.DataTexture {
  // 3 steps: dark shadow → mid → bright highlight (ascending — UV 0=shadow, UV 1=highlight).
  // Three.js MeshToonMaterial maps NdotL 0→1 directly to gradientMap UV 0→1,
  // so values MUST be ascending or the lit face renders darkest (inverted shading).
  const d = new Uint8Array([80, 155, 220]);
  const tex = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const soapBlobMaterial = trackMaterial(
  new THREE.MeshToonMaterial({
    color: cfg.soapLiquidColor,
    gradientMap: soapToonRamp,
    transparent: true,
    opacity: 0.93,
  }),
);

// 90s anime crisp white specular glint — a flat crescent disc
const glintMaterial = trackMaterial(
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  }),
);
// Flattened disc for a clean crescent glint
const glintGeometry = trackGeometry(
  new THREE.CircleGeometry(cfg.soapBlobRadius * 0.28, 10),
);
const glintMesh = new THREE.Mesh(glintGeometry, glintMaterial);
glintMesh.name = "SoapGlintHighlight";
// Offset toward upper-left of the blob, rotated to face camera-roughly
glintMesh.position.set(
  -cfg.soapBlobRadius * 0.30,
  cfg.soapBlobRadius * 0.50,
   cfg.soapBlobRadius * 0.45,
);
glintMesh.rotation.x = -0.45;

// Shadow disc underneath the dollop — grounds it on the skin
const shadowMaterial = trackMaterial(
  new THREE.MeshBasicMaterial({
    color: 0x1a5260,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
const shadowGeometry = trackGeometry(
  new THREE.CircleGeometry(cfg.soapBlobRadius * 0.82, 14),
);
const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
shadowMesh.name = "SoapDollopShadow";
shadowMesh.rotation.x = -Math.PI / 2;
shadowMesh.position.y = -cfg.soapBlobRadius * 0.48;

// Main blob: use a sphere squashed into an oblate shape in the dollop phase
const dropGeometry = trackGeometry(new THREE.SphereGeometry(cfg.soapBlobRadius, 20, 16));
const soapDropMesh = new THREE.Mesh(dropGeometry, soapBlobMaterial);
soapDropMesh.name = "DispensedSoapBlob";
soapDropMesh.add(glintMesh, shadowMesh);

// Viscous strand: wider and more tapered for a thick-liquid feel
const strandGeometry = trackGeometry(
  new THREE.CylinderGeometry(
    cfg.soapBlobRadius * 0.22,   // top radius (near nozzle) – narrow
    cfg.soapBlobRadius * 0.52,   // bottom radius (near blob) – wide
    1,
    12,
  ),
);
const soapStrandMesh = new THREE.Mesh(strandGeometry, soapBlobMaterial);
soapStrandMesh.name = "DispensedSoapStrand";

soapEffectGroup.add(soapDropMesh, soapStrandMesh);

const rootObject = new THREE.Group();
rootObject.name = "SoapDispenserSystemRoot";
rootObject.add(dispenserGroup, soapEffectGroup);

let anchoredSink: THREE.Mesh | null = null;
let lastResetToken = -1;
const deckBaseWorld = new THREE.Vector3();
const outletWorld = new THREE.Vector3();
const dropPos = new THREE.Vector3();
const strandMid = new THREE.Vector3();
const strandDir = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);

function positionOnSinkDeck(sink: THREE.Mesh): void {
  sink.geometry.computeBoundingBox();
  const bounds = sink.geometry.boundingBox;
  if (!bounds) return;

  sink.updateWorldMatrix(true, false);
  // In the verified GLB `sink` mesh:
  // bounds.max.y (-0.4122 local -> 1.500 world) is the flat horizontal back deck,
  // and bounds.min.z + 0.145 (-1.118 local -> -1.291 world) is the center of the back ledge.
  deckBaseWorld.set(0, bounds.max.y, bounds.min.z + 0.145);
  sink.localToWorld(deckBaseWorld);

  dispenserGroup.position.set(
    deckBaseWorld.x + cfg.deckOffset[0],
    deckBaseWorld.y + cfg.deckOffset[1],
    deckBaseWorld.z + cfg.deckOffset[2],
  );
  dispenserGroup.updateMatrixWorld(true);
}

const effect: WaterEffect = {
  order: 3,
  object: rootObject,
  update(frame: WaterFrameState) {
    if (frame.sinkMesh && (frame.sinkMesh !== anchoredSink || dispenserGroup.position.lengthSq() < 0.001)) {
      anchoredSink = frame.sinkMesh;
      positionOnSinkDeck(anchoredSink);
    }

    rootObject.visible = frame.ready;
    if (!frame.ready) return;

    if (frame.resetToken !== lastResetToken) {
      lastResetToken = frame.resetToken;
      pumpMovingGroup.position.y = collarTopY;
      soapEffectGroup.visible = false;
      soapStrandMesh.visible = false;
    }

    // 1. Vertical pump head press & return animation (bottle stays completely still)
    const pressOffset = THREE.MathUtils.clamp(frame.pumpPressProgress, 0, 1) * cfg.pumpStroke;
    pumpMovingGroup.position.y = collarTopY - pressOffset;
    pumpMovingGroup.updateMatrixWorld(true);

    // 2. Localized soap blob / viscous strand from nozzle outlet to receiving palm
    if (!frame.soapBlobVisible || frame.soapBlobProgress <= 0.001) {
      soapEffectGroup.visible = false;
      soapStrandMesh.visible = false;
      return;
    }

    soapEffectGroup.visible = true;
    outletAnchor.getWorldPosition(outletWorld);
    const p = THREE.MathUtils.clamp(frame.soapBlobProgress, 0, 1);

    if (p <= 0.65) {
      // Falling phase (0 -> 0.65): emerges from nozzle tip as a thick liquid strand
      const fallT = THREE.MathUtils.smoothstep(p / 0.65, 0, 1);
      dropPos.lerpVectors(outletWorld, frame.receivingPalmWorld, fallT);
      // Gentle natural parabolic arc
      dropPos.y += Math.sin(fallT * Math.PI) * 0.01;

      soapDropMesh.position.copy(dropPos);
      // Teardrop stretch: elongates along travel direction during free fall
      const stretchY = 1.0 + Math.sin(fallT * Math.PI) * 0.55;
      const radiusScale = 0.72 + fallT * 0.28;
      soapDropMesh.scale.set(radiusScale, stretchY, radiusScale);
      soapBlobMaterial.opacity = 0.96;

      // Thick viscous strand from nozzle to blob – visible even at distance
      if (fallT < 0.70) {
        soapStrandMesh.visible = true;
        strandDir.subVectors(dropPos, outletWorld);
        const strandLen = Math.max(0.004, strandDir.length());
        strandMid.copy(outletWorld).addScaledVector(strandDir, 0.5);
        soapStrandMesh.position.copy(strandMid);
        strandDir.normalize();
        soapStrandMesh.quaternion.setFromUnitVectors(upAxis, strandDir);
        // Strand thins as it stretches and snaps, but stays chunky
        const thinFactor = Math.max(0.08, (1.0 - fallT / 0.70) * 1.2);
        soapStrandMesh.scale.set(thinFactor, strandLen, thinFactor);
      } else {
        soapStrandMesh.visible = false;
      }
    } else if (p <= 0.85) {
      // Settled dollop on the cupped left palm (0.65 -> 0.85):
      // Spreads into a wide, flat anime-style gel blob resting on skin.
      const settleT = THREE.MathUtils.clamp((p - 0.65) / 0.20, 0, 1);
      soapStrandMesh.visible = false;
      soapDropMesh.position.copy(frame.receivingPalmWorld);
      // Wide oblate dollop — more visible and clearly liquid-like
      const spread = 1.10 + settleT * 0.30;
      const flatten = 0.68 - settleT * 0.20;
      soapDropMesh.scale.set(spread, flatten, spread);
      soapBlobMaterial.opacity = 0.95;
    } else {
      // Dissolving as water hits it under the faucet (0.85 -> 1.0)
      const fadeT = THREE.MathUtils.clamp((p - 0.85) / 0.15, 0, 1);
      soapStrandMesh.visible = false;
      soapDropMesh.position.copy(frame.receivingPalmWorld);
      const shrink = (1.0 - fadeT * 0.65) * 1.35;
      soapDropMesh.scale.set(shrink, shrink * 0.42, shrink);
      soapBlobMaterial.opacity = 0.95 * (1.0 - fadeT);
    }
  },
  dispose() {
    for (const geo of ownedGeometries) geo.dispose();
    for (const mat of ownedMaterials) mat.dispose();
    toonRamp.dispose();
    soapToonRamp.dispose();
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
