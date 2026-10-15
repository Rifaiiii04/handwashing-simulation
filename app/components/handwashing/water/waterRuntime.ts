import type { InjectionKey } from "vue";
import * as THREE from "three";
import type { StreamHit, WaterCollisionSystem } from "~/composables/useWaterCollision";
import type { WaterSystemConfig } from "./waterConfig";

export interface WaterFrameState {
  ready: boolean;
  active: boolean;
  delta: number;
  time: number;
  origin: THREE.Vector3;
  hit: StreamHit | null;
  collision: WaterCollisionSystem | null;
  handExit: THREE.Vector3;
  handLanding: THREE.Vector3;
  handFlowDirection: THREE.Vector3;
  hasHandFlow: boolean;
  basinImpact: THREE.Vector3;
  drainEntry: THREE.Vector3;
  drainEntryRadius: number;
  hasDrainEntry: boolean;
}

export interface WaterEffect {
  readonly order: number;
  readonly object: THREE.Object3D;
  update(frame: WaterFrameState): void;
  dispose(): void;
}

export interface WaterRuntime {
  readonly config: WaterSystemConfig;
  readonly frame: WaterFrameState;
  register(effect: WaterEffect): () => void;
}

export const WaterRuntimeKey: InjectionKey<WaterRuntime> = Symbol("WaterRuntime");
