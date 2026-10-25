import * as THREE from "three";

export interface WaterSystemConfig {
  color: THREE.ColorRepresentation;
  deepColor: THREE.ColorRepresentation;
  foamColor: THREE.ColorRepresentation;
  streamRadius: number;
  particleCount: number;
  particleRate: number;
  particleLifetime: number;
  particleSize: number;
  particleGravity: number;
  foamPuffCount: number;
  foamBubbleCount: number;
  foamUpdateInterval: number;
  foamOpacity: number;
  foamHandCoverageMultiplier: number;
  foamVerticalOffsetFraction: number;
  surfaceWaveWorldAmplitude: number;
  surfaceImpactRadiusFraction: number;
}

export const DEFAULT_WATER_CONFIG: WaterSystemConfig = {
  color: 0x168dff,
  deepColor: 0x0952a5,
  foamColor: 0xffffff,
  streamRadius: 0.053,
  particleCount: 84,
  particleRate: 64,
  particleLifetime: 0.58,
  particleSize: 0.038,
  particleGravity: 3.4,
  foamPuffCount: 24,
  foamBubbleCount: 8,
  foamUpdateInterval: 1 / 12,
  foamOpacity: 0.05,
  foamHandCoverageMultiplier: 0.9,
  foamVerticalOffsetFraction: 0.001,
  surfaceWaveWorldAmplitude: 0.018,
  surfaceImpactRadiusFraction: 0.105,
};

export type WaterParticleConfig = WaterSystemConfig;
