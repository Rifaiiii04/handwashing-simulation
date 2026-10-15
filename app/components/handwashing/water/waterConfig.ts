import * as THREE from "three";

export interface WaterSystemConfig {
  color: THREE.ColorRepresentation;
  deepColor?: THREE.ColorRepresentation;
  opacity: number;
  radiusTop?: number;
  radiusBottom?: number;
  flowSpeed?: number;
  maxSplashParticles?: number;
  particleCount?: number;
  gravity?: number;
  particleLifetime?: number;
  particleSize?: number;
}

/** Legacy name retained for callers that previously configured particles only. */
export type WaterParticleConfig = WaterSystemConfig;

export const DEFAULT_WATER_CONFIG: WaterSystemConfig = {
  color: 0x168dff,
  deepColor: 0x003d99,
  opacity: 0.94,
  radiusTop: 0.054,
  radiusBottom: 0.042,
  flowSpeed: 4.8,
  maxSplashParticles: 220,
  gravity: 9.81,
  particleLifetime: 0.8,
  particleSize: 0.022,
};
