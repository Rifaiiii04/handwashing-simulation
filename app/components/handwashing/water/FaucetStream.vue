<script setup lang="ts">
import { inject, onMounted, onUnmounted } from "vue";
import * as THREE from "three";
import { WaterRuntimeKey, type WaterEffect, type WaterFrameState } from "./waterRuntime";
import { createWaterMaterial, disposeWaterMaterial, updateWaterMaterial } from "./waterMaterials";

const runtime = inject(WaterRuntimeKey);
if (!runtime) throw new Error("FaucetStream requires WaterSystem runtime");

const geometry = new THREE.CylinderGeometry(
  runtime.config.streamRadius,
  runtime.config.streamRadius,
  1,
  16,
  16,
  true,
);
const material = createWaterMaterial("stream", runtime.config.color, runtime.config.deepColor);
const mesh = new THREE.Mesh(geometry, material);
mesh.name = "FaucetWaterStream";
mesh.frustumCulled = false;

const object = new THREE.Group();
object.name = "FaucetStreamEffect";
object.add(mesh);

const localAxis = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();
const streamCenter = new THREE.Vector3();
const streamStart = new THREE.Vector3();
const streamCenterOut = new THREE.Vector3();
const tempVec = new THREE.Vector3();

const effect: WaterEffect = {
  order: 0,
  object,
  update(frame: WaterFrameState) {
    object.visible = frame.ready && frame.active;
    if (!object.visible) return;

    direction.copy(frame.streamDirection);
    // Offset start slightly below WaterSpawn so the stream top clears the faucet nozzle
    streamStart.copy(frame.origin).addScaledVector(direction, 0.04);
    const rawLength = tempVec.subVectors(frame.streamEnd, streamStart).dot(direction);
    const length = THREE.MathUtils.clamp(rawLength, 0.08, 3);
    streamCenterOut.copy(streamStart).addScaledVector(direction, length * 0.5);
    object.position.copy(streamCenterOut);
    object.quaternion.setFromUnitVectors(localAxis, direction);
    mesh.scale.set(1, length, 1);
    updateWaterMaterial(material, frame.time);
  },
  dispose() {
    geometry.dispose();
    disposeWaterMaterial(material);
  },
};

let unregister: (() => void) | undefined;
onMounted(() => { unregister = runtime.register(effect); });
onUnmounted(() => { unregister?.(); effect.dispose(); });
</script>

<template></template>
