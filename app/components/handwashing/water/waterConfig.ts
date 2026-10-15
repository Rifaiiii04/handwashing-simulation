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
  deepColor: 0x0752ad,
  foamColor: 0xffdce8,
  streamRadius: 0.053,
  particleCount: 40,
  particleRate: 28,
  particleLifetime: 0.48,
  particleSize: 0.032,
  particleGravity: 3.2,
  foamPuffCount: 78,
  foamBubbleCount: 118,
  foamUpdateInterval: 1 / 12,
  // Each overlapping puff stays translucent; the dense cluster keeps its silhouette.
  foamOpacity: 0.1,
  // Expand well beyond both GLB hand bounds so the palms and fingers sit inside.
  foamHandCoverageMultiplier: 1.55,
  // Raise the foam slightly above the center of the hand bounds.
  foamVerticalOffsetFraction: 0.08,
  // Displacement is converted to the mesh's local Y scale at runtime.
  surfaceWaveWorldAmplitude: 0.018,
  surfaceImpactRadiusFraction: 0.105,
};

/** Legacy name retained for callers that configure the droplet pool. */
export type WaterParticleConfig = WaterSystemConfig;
