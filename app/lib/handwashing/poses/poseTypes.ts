export type { FingerName } from "../rig/handRigMapping";
import type { FingerName } from "../rig/handRigMapping";

export interface FingerArticulationTarget {
  /**
   * Flexion in degrees relative to the calibrated anatomical rest pose:
   * positive values curl the finger inward toward the palm,
   * negative values extend/straighten the finger relative to its relaxed rest curve.
   */
  curl: number;
  /**
   * Abduction/adduction spread in degrees relative to the calibrated anatomical rest pose:
   * positive values move the finger toward the radial (thumb) side,
   * negative values move the finger toward the ulnar (pinky) side.
   */
  spread: number;
  /** Optional axial twist in degrees. */
  twist?: number;
  /** Optional distal-heavy multiplier for fingertip-focused curling. */
  distalBias?: number;
  /** Optional calibrated per-joint curl overrides in degrees: [joint0, joint1, joint2, ...] */
  jointCurls?: readonly number[];
  /** Optional calibrated per-joint spread overrides in degrees: [joint0, joint1, joint2, ...] */
  jointSpreads?: readonly number[];
  /** Optional calibrated per-joint twist overrides in degrees: [joint0, joint1, joint2, ...] */
  jointTwists?: readonly number[];
  /** Calibrated offsets from rest, in each joint's parent-local units. */
  jointPositions?: readonly (readonly [number, number, number])[];
}

export interface HandPoseTarget {
  /** World-space translation offset [dx, dy, dz] applied to the verified palm center pivot. */
  palmOffset: [number, number, number];
  /** World-space orientation delta [pitchDeg, yawDeg, rollDeg] around the palm center pivot (ZXY order). */
  palmEulerDeg: [number, number, number];
  /** Wrist bone local rotation delta [flexDeg, twistDeg, radialDeg]. */
  wristEulerDeg: [number, number, number];
  /** Per-finger articulation targets. */
  fingers: Record<FingerName, FingerArticulationTarget>;
}

export interface StagePoseEvaluation {
  right: HandPoseTarget;
  left: HandPoseTarget;
  /** World-space hint offset for the active contact midpoint. */
  contactCenterHintOffset: [number, number, number];
}

export interface HandPoseSceneAnchors {
  readonly pumpStroke: number;
  readonly pumpPressProgress: number;
}
