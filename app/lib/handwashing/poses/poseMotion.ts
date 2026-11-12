import * as THREE from "three";

// Time-shaping helpers shared by the stage pose evaluators.

export function smoothRoleBlend(progress: number): { swap: number; swapArc: number } {
  const swap = THREE.MathUtils.smoothstep(progress, 0.4, 0.6);
  const swapArc = Math.sin(swap * Math.PI);
  return { swap, swapArc };
}

export function smooth01(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  // Minimum-jerk trajectory: zero velocity AND acceleration at both ends.
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Integrated, deterministic cadence: small tempo changes without phase jumps. */
export function scrubPhase(progress: number, turns: number): number {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const tau = Math.PI * 2;
  const phase = turns * (tau * t + .10 * Math.sin(tau * t) + .04 / 3 * Math.sin(3 * tau * t));
  // Move briskly across the stroke, easing naturally at each reversal.
  return phase + .12 * Math.sin(2 * phase);
}
