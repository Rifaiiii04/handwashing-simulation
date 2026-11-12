import * as THREE from "three";
import type { MappedHandPairRig, MappedHandRig } from "./handRigMapping";
import type { HandwashingStageId } from "../config/handwashingConfig";

export type DebugVector3 = [number, number, number];
export type DebugSide = "right" | "left";
export interface DebugBoneOverride {
  /** Raw bone-local translation; these units inherit the armature scale. */
  position: DebugVector3;
  /** XYZ Euler degrees, composed after the procedural bone rotation. */
  rotation: DebugVector3;
}
export interface DebugHandOverride extends DebugBoneOverride {
  /** Hand position uses world units; rotation offsets the pose's ZXY Euler angles. */
  bones: Record<string, DebugBoneOverride>;
}
export interface DebugStageOverride {
  right: DebugHandOverride;
  left: DebugHandOverride;
}
export interface HandPoseDebugSettings {
  enabled: boolean;
  showSkeleton: boolean;
  showAxes: boolean;
  hideFoam: boolean;
  loopStage: boolean;
  playbackRate: number;
  selectedSide: DebugSide;
  selectedBone: string;
}
export interface DebugTransformSnapshot {
  localPosition: DebugVector3;
  localRotation: DebugVector3;
  localQuaternion: [number, number, number, number];
  worldPosition: DebugVector3;
  worldRotation: DebugVector3;
  worldQuaternion: [number, number, number, number];
}
export interface DebugBoneSnapshot extends DebugTransformSnapshot {
  name: string;
  parentName: string | null;
}
export interface DebugHandSnapshot {
  side: DebugSide;
  armature: DebugTransformSnapshot;
  palmWorld: DebugVector3;
  palmNormal: DebugVector3;
  boneNames: string[];
  bones: DebugBoneSnapshot[];
}
export interface DebugMetrics {
  palmCenterDistance: number | null;
  normalAngleDeg: number | null;
  /** Optional geometric approximations supplied by the scene debug overlay. */
  surfaceGap?: number | null;
  thumbClearance?: number | null;
  fingerClearance?: number | null;
  closestFingerPair?: string;
  finiteTransforms: boolean;
  warnings: string[];
}
export interface HandPoseDebugSnapshot {
  stageId: HandwashingStageId;
  progress: number;
  elapsed: number;
  rigAvailable: boolean;
  hands: Record<DebugSide, DebugHandSnapshot> | null;
  selectedBone: DebugBoneSnapshot | null;
  diagnostics: DebugMetrics;
}
export interface DebugOverridesExport {
  schemaVersion: 1;
  units: { handPosition: "world units"; bonePosition: "bone local units"; rotation: "degrees" };
  stages: Partial<Record<HandwashingStageId, DebugStageOverride>>;
}

export function createDebugStageOverride(): DebugStageOverride {
  return {
    right: { position: [0, 0, 0], rotation: [0, 0, 0], bones: {} },
    left: { position: [0, 0, 0], rotation: [0, 0, 0], bones: {} },
  };
}

function transformSnapshot(object: THREE.Object3D): DebugTransformSnapshot {
  const position = object.getWorldPosition(new THREE.Vector3());
  const quaternion = object.getWorldQuaternion(new THREE.Quaternion());
  const localEuler = new THREE.Euler().setFromQuaternion(object.quaternion, "XYZ");
  const worldEuler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    localPosition: object.position.toArray(),
    localRotation: [localEuler.x * THREE.MathUtils.RAD2DEG, localEuler.y * THREE.MathUtils.RAD2DEG, localEuler.z * THREE.MathUtils.RAD2DEG],
    localQuaternion: object.quaternion.toArray(),
    worldPosition: position.toArray(),
    worldRotation: [worldEuler.x * THREE.MathUtils.RAD2DEG, worldEuler.y * THREE.MathUtils.RAD2DEG, worldEuler.z * THREE.MathUtils.RAD2DEG],
    worldQuaternion: quaternion.toArray(),
  };
}

function handSnapshot(hand: MappedHandRig): DebugHandSnapshot {
  return {
    side: hand.side,
    armature: transformSnapshot(hand.armature),
    palmWorld: hand.currentPalmWorld.toArray(),
    palmNormal: hand.currentPalmNormal.toArray(),
    boneNames: hand.skeleton.bones.map((bone) => bone.name),
    bones: hand.skeleton.bones.map((bone) => ({
      name: bone.name,
      parentName: bone.parent?.name ?? null,
      ...transformSnapshot(bone),
    })),
  };
}

/** Allocates only on an explicit inspector refresh/export, never in the render loop. */
export function captureDebugRig(rig: MappedHandPairRig | null, settings: HandPoseDebugSettings) {
  if (!rig) return { hands: null, selectedBone: null, diagnostics: {
    palmCenterDistance: null, normalAngleDeg: null, finiteTransforms: true,
    warnings: ["Rig belum dimuat."],
  } satisfies DebugMetrics };
  const hands = { right: handSnapshot(rig.right), left: handSnapshot(rig.left) };
  const finiteTransforms = [hands.right, hands.left].every((hand) =>
    hand.bones.every((bone) => [...bone.worldPosition, ...bone.worldQuaternion].every(Number.isFinite)),
  );
  return {
    hands,
    selectedBone: hands[settings.selectedSide].bones.find((bone) => bone.name === settings.selectedBone) ?? null,
    diagnostics: {
      palmCenterDistance: rig.right.currentPalmWorld.distanceTo(rig.left.currentPalmWorld),
      normalAngleDeg: THREE.MathUtils.radToDeg(rig.right.currentPalmNormal.angleTo(rig.left.currentPalmNormal)),
      finiteTransforms,
      warnings: finiteTransforms ? [] : ["Ditemukan transformasi tulang yang tidak valid."],
    } satisfies DebugMetrics,
  };
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validatedVector(value: unknown, limit: number): DebugVector3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= limit)) {
    throw new Error(`Vektor harus memuat tiga angka terbatas (maksimum ±${limit}).`);
  }
  return [value[0], value[1], value[2]];
}

/** Validate everything before mutating the live overrides; model names are authoritative. */
export function validateDebugImport(value: unknown, stageIds: readonly HandwashingStageId[], rig: MappedHandPairRig | null): DebugOverridesExport {
  if (!rig) throw new Error("Tunggu model tangan selesai dimuat sebelum impor.");
  if (!objectRecord(value) || value.schemaVersion !== 1 || !objectRecord(value.stages)) {
    throw new Error("Format JSON debug tidak valid atau versi tidak didukung.");
  }
  if (!objectRecord(value.units) || value.units.handPosition !== "world units" || value.units.bonePosition !== "bone local units" || value.units.rotation !== "degrees") {
    throw new Error("Satuan JSON debug tidak sesuai: posisi dunia/lokal tulang dan rotasi derajat diperlukan.");
  }
  const stages: DebugOverridesExport["stages"] = {};
  for (const [stageId, stage] of Object.entries(value.stages)) {
    if (!stageIds.includes(stageId as HandwashingStageId) || !objectRecord(stage)) throw new Error(`Tahap tidak dikenal: ${stageId}`);
    const result = createDebugStageOverride();
    for (const side of ["right", "left"] as const) {
      const hand = stage[side];
      if (!objectRecord(hand) || !objectRecord(hand.bones)) throw new Error(`Data ${side} tidak lengkap.`);
      result[side].position = validatedVector(hand.position, 2);
      result[side].rotation = validatedVector(hand.rotation, 360);
      const names = new Set(rig[side].skeleton.bones.map((bone) => bone.name));
      for (const [name, bone] of Object.entries(hand.bones)) {
        if (!names.has(name) || !objectRecord(bone)) throw new Error(`Tulang ${side} tidak dikenal: ${name}`);
        result[side].bones[name] = { position: validatedVector(bone.position, 10), rotation: validatedVector(bone.rotation, 360) };
      }
    }
    stages[stageId as HandwashingStageId] = result;
  }
  return { schemaVersion: 1, units: { handPosition: "world units", bonePosition: "bone local units", rotation: "degrees" }, stages };
}
