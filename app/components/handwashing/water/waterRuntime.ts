import type { InjectionKey } from "vue";
import * as THREE from "three";
import type { WaterSystemConfig } from "./waterConfig";

export interface WaterFrameState {
  ready: boolean;
  active: boolean;
  delta: number;
  time: number;
  origin: THREE.Vector3;
  streamDirection: THREE.Vector3;
  streamEnd: THREE.Vector3;
  handFoamSurface: THREE.Mesh | null;
  sinkWaterSurface: THREE.Mesh | null;
  splashOrigin: THREE.Vector3;
  splashActive: boolean;
  drainLocalPosition: THREE.Vector3;
  drainLocalRadius: number;
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
