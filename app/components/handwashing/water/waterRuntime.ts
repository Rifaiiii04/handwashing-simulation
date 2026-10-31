import type { InjectionKey } from "vue";
import type * as THREE from "three";
import type { HandwashingParticleMode } from "~/lib/handwashing/handwashingConfig";
import type { WaterSystemConfig } from "./waterConfig";

export interface WaterFrameState {
  ready: boolean;
  active: boolean;
  streamActive: boolean;
  delta: number;
  time: number;
  origin: THREE.Vector3;
  streamDirection: THREE.Vector3;
  streamEnd: THREE.Vector3;
  handFoamSurface: THREE.Mesh | null;
  sinkWaterSurface: THREE.Mesh | null;
  sinkMesh: THREE.Mesh | null;
  splashOrigin: THREE.Vector3;
  splashActive: boolean;
  drainLocalPosition: THREE.Vector3;
  drainLocalRadius: number;
  foamIntensity: number;
  foamWorldCenter: THREE.Vector3;
  rightPalmWorld: THREE.Vector3;
  leftPalmWorld: THREE.Vector3;
  rightPalmNormal: THREE.Vector3;
  leftPalmNormal: THREE.Vector3;
  particleMode: HandwashingParticleMode;
  particleIntensity: number;
  pumpPressProgress: number;
  soapBlobVisible: boolean;
  soapBlobProgress: number;
  receivingPalmWorld: THREE.Vector3;
  resetToken: number;
  handsIntersectingStream: boolean;
  handContactFactor: number;
  handImpactPoint: THREE.Vector3;
  handRunoffOrigin: THREE.Vector3;
}

export interface WaterEffect {
  readonly order: number;
  readonly object?: THREE.Object3D;
  update(frame: WaterFrameState): void;
  dispose(): void;
}

export interface WaterRuntime {
  readonly config: WaterSystemConfig;
  readonly frame: WaterFrameState;
  register(effect: WaterEffect): () => void;
}

export const WaterRuntimeKey: InjectionKey<WaterRuntime> = Symbol("WaterRuntime");
