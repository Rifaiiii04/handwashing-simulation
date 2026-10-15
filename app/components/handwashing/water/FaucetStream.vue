<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState } from "./waterRuntime";
import { createWaterMaterial, updateWaterMaterialTime } from "./waterMaterials";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("FaucetStream requires WaterSystem runtime");

const ringCount = 48;
const radialCount = 24;
const positions = new Float32Array(ringCount * radialCount * 3);
const uvs = new Float32Array(ringCount * radialCount * 2);
const indices = new Uint16Array((ringCount - 1) * radialCount * 6);
const geometry = new THREE.BufferGeometry();
const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
let index = 0;

for (let ring = 0; ring < ringCount; ring++) {
  const t = ring / (ringCount - 1);
  for (let side = 0; side < radialCount; side++) {
    const vertex = ring * radialCount + side;
    const uvIndex = vertex * 2;
    uvs[uvIndex] = side / radialCount;
    uvs[uvIndex + 1] = t;
    if (ring < ringCount - 1) {
      const nextSide = (side + 1) % radialCount;
      const a = ring * radialCount + side;
      const b = ring * radialCount + nextSide;
      const c = (ring + 1) * radialCount + side;
      const d = (ring + 1) * radialCount + nextSide;
      indices[index++] = a; indices[index++] = c; indices[index++] = b;
      indices[index++] = b; indices[index++] = c; indices[index++] = d;
    }
  }
}

geometry.setAttribute("position", positionAttribute);
geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
geometry.setIndex(new THREE.BufferAttribute(indices, 1));

const material = createWaterMaterial(runtime.config.color, runtime.config.opacity);
const mesh = new THREE.Mesh(geometry, material);
mesh.name = "FaucetStreamMesh";
mesh.frustumCulled = false;
mesh.renderOrder = 1;

const object = new THREE.Group();
object.name = "FaucetStreamEffect";
object.add(mesh);

const _impact = new THREE.Vector3();
const _basinNormal = new THREE.Vector3(0, 1, 0);
let cachedHandContact: boolean | null = null;

function rebuildProfile(handContact: boolean): void {
  const topRadius = runtime.config.radiusTop ?? 0.054;
  const bottomRadius = runtime.config.radiusBottom ?? 0.042;
  const contactRadius = bottomRadius * 0.60;
  for (let ring = 0; ring < ringCount; ring++) {
    const t = ring / (ringCount - 1);
    const baseRadius = THREE.MathUtils.lerp(topRadius, bottomRadius, t);
    const blend = handContact ? THREE.MathUtils.smoothstep(t, 0.80, 1) : 0;
    const radius = THREE.MathUtils.lerp(baseRadius, contactRadius, blend);
    for (let side = 0; side < radialCount; side++) {
      const angle = (side / radialCount) * Math.PI * 2;
      const vertex = (ring * radialCount + side) * 3;
      positions[vertex] = Math.cos(angle) * radius;
      positions[vertex + 1] = -t;
      positions[vertex + 2] = Math.sin(angle) * radius;
    }
  }
  positionAttribute.needsUpdate = true;
  geometry.computeVertexNormals();
  cachedHandContact = handContact;
}

rebuildProfile(false);

const effect: WaterEffect = {
  order: 0,
  object,
  update(frame: WaterFrameState) {
    object.visible = frame.ready && frame.active;
    if (!object.visible) return;

    const handContact = frame.hit?.hit === true && frame.hit.hitTarget === "hand";
    if (cachedHandContact !== handContact) rebuildProfile(handContact);

    let endY = frame.origin.y - 1.1;
    if (frame.hit?.hit) {
      _impact.copy(frame.hit.point);
      // Let the open tube end just beneath the hand surface. The skin depth
      // test hides its rim and joins the surface ribbon without a flat cap.
      endY = _impact.y - (handContact ? 0.004 : -0.001);
    } else if (frame.collision?.sampleBasinSurface(
      frame.origin.x,
      frame.origin.z,
      _impact,
      _basinNormal,
    )) {
      endY = _impact.y;
    } else if (frame.hit) {
      endY = frame.hit.basinPoint.y;
    }

    const length = Math.max(0.04, frame.origin.y - endY);
    object.position.copy(frame.origin);
    mesh.scale.set(1, length, 1);
    updateWaterMaterialTime(material, frame.time);
  },
  dispose() {
    geometry.dispose();
    material.dispose();
  },
};

let unregister: (() => void) | undefined;
onMounted(() => { unregister = runtime.register(effect); });
onUnmounted(() => { unregister?.(); effect.dispose(); });
</script>

<template></template>
