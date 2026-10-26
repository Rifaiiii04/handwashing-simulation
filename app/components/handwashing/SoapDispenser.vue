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

const soapMaterial = trackMaterial(
  new THREE.MeshToonMaterial({
    color: cfg.soapLiquidColor,
    gradientMap: toonRamp,
    transparent: true,
    opacity: 0.92,
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

const dropGeometry = trackGeometry(new THREE.SphereGeometry(cfg.soapBlobRadius, 18, 14));
const soapDropMesh = new THREE.Mesh(dropGeometry, soapMaterial);
soapDropMesh.name = "DispensedSoapBlob";

// 90s anime crisp white specular reflection glint on liquid soap drop
const glintMaterial = trackMaterial(
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.96,
  }),
);
const glintGeometry = trackGeometry(new THREE.SphereGeometry(cfg.soapBlobRadius * 0.26, 8, 8));
const glintMesh = new THREE.Mesh(glintGeometry, glintMaterial);
glintMesh.name = "SoapGlintHighlight";
glintMesh.position.set(cfg.soapBlobRadius * 0.38, cfg.soapBlobRadius * 0.48, cfg.soapBlobRadius * 0.38);
soapDropMesh.add(glintMesh);

const strandGeometry = trackGeometry(
  new THREE.CylinderGeometry(cfg.soapBlobRadius * 0.18, cfg.soapBlobRadius * 0.45, 1, 10),
);
const soapStrandMesh = new THREE.Mesh(strandGeometry, soapMaterial);
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
    if (frame.sinkMesh && frame.sinkMesh !== anchoredSink) {
      anchoredSink = frame.sinkMesh;
      positionOnSinkDeck(anchoredSink);
    }

    rootObject.visible = frame.ready;
    if (!frame.ready) return;

    if (frame.resetToken !== lastResetToken) {
      lastResetToken = frame.resetToken;
      pumpMovingGroup.position.y = collarTopY;
      soapEffectGroup.visible = false;
    }

    // 1. Vertical pump head press & return animation (bottle stays completely still)
    const pressOffset = THREE.MathUtils.clamp(frame.pumpPressProgress, 0, 1) * cfg.pumpStroke;
    pumpMovingGroup.position.y = collarTopY - pressOffset;
    pumpMovingGroup.updateMatrixWorld(true);

    // 2. Localized soap blob / viscous strand from nozzle outlet to receiving palm
    if (!frame.soapBlobVisible || frame.soapBlobProgress <= 0.001) {
      soapEffectGroup.visible = false;
      return;
    }

    soapEffectGroup.visible = true;
    outletAnchor.getWorldPosition(outletWorld);
    const p = THREE.MathUtils.clamp(frame.soapBlobProgress, 0, 1);

    if (p <= 0.65) {
      // Falling phase (0 -> 0.65): emerges from nozzle tip, stretches an elastic viscous strand, lands on palm
      const fallT = THREE.MathUtils.smoothstep(p / 0.65, 0, 1);
      dropPos.lerpVectors(outletWorld, frame.receivingPalmWorld, fallT);
      // Gentle natural parabolic curve downward
      dropPos.y += Math.sin(fallT * Math.PI) * 0.008;

      soapDropMesh.position.copy(dropPos);
      // Elastic teardrop: stretches in Y as gravity accelerates it down
      const stretchY = 1.0 + Math.sin(fallT * Math.PI) * 0.60;
      const radiusScale = 0.68 + fallT * 0.32;
      soapDropMesh.scale.set(radiusScale, stretchY, radiusScale);
      soapMaterial.opacity = 0.95;

      // Elastic viscous liquid strand stretching from nozzle opening to the falling droplet
      if (fallT < 0.68) {
        soapStrandMesh.visible = true;
        strandDir.subVectors(dropPos, outletWorld);
        const strandLen = Math.max(0.003, strandDir.length());
        strandMid.copy(outletWorld).addScaledVector(strandDir, 0.5);
        soapStrandMesh.position.copy(strandMid);
        strandDir.normalize();
        soapStrandMesh.quaternion.setFromUnitVectors(upAxis, strandDir);
        // Taper strand dynamically as it stretches and snaps
        const thinFactor = Math.max(0.01, (1.0 - fallT / 0.68) * 1.15);
        soapStrandMesh.scale.set(thinFactor, strandLen, thinFactor);
      } else {
        soapStrandMesh.visible = false;
      }
    } else if (p <= 0.85) {
      // Landed dollop phase on the cupped left palm (0.65 -> 0.85):
      // Stays securely resting on the palm as the hands carry the soap back toward the faucet!
      const settleT = THREE.MathUtils.clamp((p - 0.65) / 0.20, 0, 1);
      soapStrandMesh.visible = false;
      soapDropMesh.position.copy(frame.receivingPalmWorld);
      // Dollop spreads into a smooth, glossy dome on the skin
      const spread = 1.05 + settleT * 0.25;
      const flatten = 0.75 - settleT * 0.22;
      soapDropMesh.scale.set(spread, flatten, spread);
      soapMaterial.opacity = 0.94;
    } else {
      // Dissolving phase as water hits the soap under the faucet (0.85 -> 1.0)
      const fadeT = THREE.MathUtils.clamp((p - 0.85) / 0.15, 0, 1);
      soapStrandMesh.visible = false;
      soapDropMesh.position.copy(frame.receivingPalmWorld);
      const shrink = (1.0 - fadeT * 0.60) * 1.25;
      soapDropMesh.scale.set(shrink, shrink * 0.45, shrink);
      soapMaterial.opacity = 0.94 * (1.0 - fadeT);
    }
  },
  dispose() {
    for (const geo of ownedGeometries) geo.dispose();
    for (const mat of ownedMaterials) mat.dispose();
    toonRamp.dispose();
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
