import * as THREE from "three";
import type { HandwashingStageId } from "./handwashingConfig";
import type { FingerName } from "./handRigMapping";
import { INTERLACE_CONTACT_FRAMES, INTERLACE_ENTRY_POSE } from "./interlaceCalibration";
import { HAND_CONTACT_CLIPS, THUMB_CONTACT_AXES as FITTED_THUMB_AXES, type ContactTechnique, type ContactSide, type ContactHandFrame } from "./handwashingContactCalibration";

export type { FingerName } from "./handRigMapping";

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

function buildFingerSet(
  baseCurl: number,
  fanSpread: number,
  waveTime = 0,
  waveAmplitude = 0,
  thumbCurl = baseCurl * 0.5,
  thumbSpread = fanSpread * 0.5,
  distalBias = 1.0,
): Record<FingerName, FingerArticulationTarget> {
  const w0 = waveAmplitude * Math.sin(waveTime);
  const w1 = waveAmplitude * Math.sin(waveTime + 0.75);
  const w2 = waveAmplitude * Math.sin(waveTime + 1.5);
  const w3 = waveAmplitude * Math.sin(waveTime + 2.25);
  const w4 = waveAmplitude * Math.sin(waveTime + 3.0);

  return {
    thumb: {
      curl: thumbCurl + w0 * 0.4,
      spread: thumbSpread,
      twist: 0,
      distalBias,
    },
    index: {
      curl: baseCurl + w1,
      spread: fanSpread * 0.75,
      twist: 0,
      distalBias,
    },
    middle: {
      curl: baseCurl * 1.04 + w2,
      spread: fanSpread * 0.08,
      twist: 0,
      distalBias,
    },
    ring: {
      curl: baseCurl + w3,
      spread: -fanSpread * 0.32,
      twist: 0,
      distalBias,
    },
    pinky: {
      curl: baseCurl * 0.95 + w4,
      spread: -fanSpread * 0.78,
      twist: 0,
      distalBias,
    },
  };
}

function smoothRoleBlend(progress: number): { swap: number; swapArc: number } {
  const swap = THREE.MathUtils.smoothstep(progress, 0.4, 0.6);
  const swapArc = Math.sin(swap * Math.PI);
  return { swap, swapArc };
}

function smooth01(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  // Minimum-jerk trajectory: zero velocity AND acceleration at both ends.
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const MOVING_FINGERS = ["index", "middle", "ring", "pinky"] as const;
const HAND_SIDES = ["right", "left"] as const;
const BACK_NORMAL = [0, .965926, .258819] as const;

/** Integrated, deterministic cadence: small tempo changes without phase jumps. */
function scrubPhase(progress: number, turns: number): number {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const tau = Math.PI * 2;
  const phase = turns * (tau * t + .10 * Math.sin(tau * t) + .04 / 3 * Math.sin(3 * tau * t));
  // Move briskly across the stroke, easing naturally at each reversal.
  return phase + .12 * Math.sin(2 * phase);
}

/** Shared arm follow-through preserves the relative hand/finger contact. */
function followContact(pose: StagePoseEvaluation, progress: number, weight: number,
  normal: readonly [number, number, number] = PALM_SEP_AXIS): StagePoseEvaluation {
  const lift = .004 * Math.sin(progress * Math.PI * 2) * weight;
  const sway = .002 * Math.sin(progress * Math.PI * 4) * weight;
  for (const side of HAND_SIDES) {
    const offset = pose[side].palmOffset;
    offset[0] += normal[0] * lift + sway;
    offset[1] += normal[1] * lift;
    offset[2] += normal[2] * lift;
  }
  return pose;
}

/** Gentle sequential flexion when fingers are free of the opposing hand/pump. */
function freeFingerFollow(pose: StagePoseEvaluation, phase: number, weight: number, amplitude: number): void {
  if (weight <= 0) return;
  for (const side of HAND_SIDES) {
    const hand = pose[side];
    const lag = side === "left" ? .65 : 0;
    hand.wristEulerDeg[0] += .7 * Math.sin(phase - lag - .4) * weight;
    for (let i = 0; i < MOVING_FINGERS.length; i++) {
      const finger = hand.fingers[MOVING_FINGERS[i]!];
      const ripple = Math.sin(phase - lag - i * .55) * weight * amplitude;
      if (finger.jointCurls) {
        const j = finger.jointCurls;
        finger.jointCurls = [j[0]!, j[1]! + ripple * .3, j[2]! + ripple * .65, j[3]! + ripple * .4];
      } else {
        finger.curl += ripple;
      }
    }
    const thumb = hand.fingers.thumb;
    if (!thumb.jointCurls) thumb.curl += .3 * amplitude * Math.sin(phase - lag + .5) * weight;
  }
}

const blendEuler = new THREE.Euler(0, 0, 0, "ZXY");
const blendQuatA = new THREE.Quaternion();
const blendQuatB = new THREE.Quaternion();
const ZERO_JOINT_POSITION = [0, 0, 0] as const;
function blendOrientation(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  const rad = Math.PI / 180;
  blendQuatA.setFromEuler(blendEuler.set(a[0]! * rad, a[1]! * rad, a[2]! * rad, "ZXY"));
  blendQuatB.setFromEuler(blendEuler.set(b[0]! * rad, b[1]! * rad, b[2]! * rad, "ZXY"));
  blendEuler.setFromQuaternion(blendQuatA.slerp(blendQuatB, t), "ZXY");
  return [blendEuler.x / rad, blendEuler.y / rad, blendEuler.z / rad];
}

// Resolve overrides using the very same anatomical weights as the animator.
// Treating curl/spread as a full rotation on every joint caused jumps whenever
// a pose with explicit thumb joints blended into a pose without overrides.
function jointValue(f: FingerArticulationTarget, name: FingerName, k: number, axis: "curl" | "spread" | "twist"): number {
  const thumb = name === "thumb";
  const bias = f.distalBias ?? 1;
  if (axis === "curl") return f.jointCurls?.[k] ?? f.curl * (thumb
    ? k === 0 ? .65 : k === 1 ? .85 * bias : .65 * bias
    : k === 0 ? .02 : k === 1 ? .7 : k === 2 ? .85 * bias : .55 * bias);
  if (axis === "spread") return f.jointSpreads?.[k] ?? f.spread * (thumb
    ? k === 0 ? .9 : k === 1 ? .5 : .2 : k === 1 ? 1 : 0);
  return f.jointTwists?.[k] ?? (f.twist ?? 0) * (thumb
    ? k === 0 ? .75 : k === 1 ? .85 : .5 : k === 1 ? .5 : 0);
}

function lerpVec3Tuple(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    THREE.MathUtils.lerp(a[0], b[0], t),
    THREE.MathUtils.lerp(a[1], b[1], t),
    THREE.MathUtils.lerp(a[2], b[2], t),
  ];
}

function lerpFingerTargets(
  a: Record<FingerName, FingerArticulationTarget>,
  b: Record<FingerName, FingerArticulationTarget>,
  t: number,
): Record<FingerName, FingerArticulationTarget> {
  const names: FingerName[] = ["thumb", "index", "middle", "ring", "pinky"];
  const out = {} as Record<FingerName, FingerArticulationTarget>;
  for (const name of names) {
    const aCurls = a[name].jointCurls;
    const bCurls = b[name].jointCurls;
    let jointCurls: number[] | undefined;
    if (aCurls || bCurls) {
      const len = Math.max(aCurls?.length ?? 0, bCurls?.length ?? 0);
      jointCurls = [];
      for (let k = 0; k < len; k++) {
        const vA = jointValue(a[name], name, k, "curl");
        const vB = jointValue(b[name], name, k, "curl");
        jointCurls.push(THREE.MathUtils.lerp(vA, vB, t));
      }
    }

    const aSpreads = a[name].jointSpreads;
    const bSpreads = b[name].jointSpreads;
    let jointSpreads: number[] | undefined;
    if (aSpreads || bSpreads) {
      const len = Math.max(aSpreads?.length ?? 0, bSpreads?.length ?? 0);
      jointSpreads = [];
      for (let k = 0; k < len; k++) {
        const vA = jointValue(a[name], name, k, "spread");
        const vB = jointValue(b[name], name, k, "spread");
        jointSpreads.push(THREE.MathUtils.lerp(vA, vB, t));
      }
    }

    const aTwists = a[name].jointTwists;
    const bTwists = b[name].jointTwists;
    let jointTwists: number[] | undefined;
    if (aTwists || bTwists) {
      const len = Math.max(aTwists?.length ?? 0, bTwists?.length ?? 0);
      jointTwists = [];
      for (let k = 0; k < len; k++) {
        const vA = jointValue(a[name], name, k, "twist");
        const vB = jointValue(b[name], name, k, "twist");
        jointTwists.push(THREE.MathUtils.lerp(vA, vB, t));
      }
    }

    out[name] = {
      curl: THREE.MathUtils.lerp(a[name].curl, b[name].curl, t),
      spread: THREE.MathUtils.lerp(a[name].spread, b[name].spread, t),
      twist: THREE.MathUtils.lerp(a[name].twist ?? 0, b[name].twist ?? 0, t),
      distalBias: THREE.MathUtils.lerp(a[name].distalBias ?? 1, b[name].distalBias ?? 1, t),
      jointCurls,
      jointSpreads,
      jointTwists,
      jointPositions: a[name].jointPositions || b[name].jointPositions
        ? Array.from({ length: Math.max(a[name].jointPositions?.length ?? 0, b[name].jointPositions?.length ?? 0) }, (_, k) =>
          lerpVec3Tuple(a[name].jointPositions?.[k] ?? ZERO_JOINT_POSITION, b[name].jointPositions?.[k] ?? ZERO_JOINT_POSITION, t))
        : undefined,
    };
  }
  return out;
}

export interface RubPalmsLiveTuning {
  // Right Hand Base
  rightOffsetX: number;
  rightOffsetY: number;
  rightOffsetZ: number;
  rightPitch: number;
  rightYaw: number;
  rightRoll: number;

  // Left Hand Base
  leftOffsetX: number;
  leftOffsetY: number;
  leftOffsetZ: number;
  leftPitch: number;
  leftYaw: number;
  leftRoll: number;

  // Right Hand Fingers
  rightThumbCurl: number;
  rightThumbSpread: number;
  rightThumbTwist: number;
  rightIndexCurl: number;
  rightIndexSpread: number;
  rightIndexTwist: number;
  rightMiddleCurl: number;
  rightMiddleSpread: number;
  rightMiddleTwist: number;
  rightRingCurl: number;
  rightRingSpread: number;
  rightRingTwist: number;
  rightPinkyCurl: number;
  rightPinkySpread: number;
  rightPinkyTwist: number;

  // Left Hand Fingers
  leftThumbCurl: number;
  leftThumbSpread: number;
  leftThumbTwist: number;
  leftIndexCurl: number;
  leftIndexSpread: number;
  leftIndexTwist: number;
  leftMiddleCurl: number;
  leftMiddleSpread: number;
  leftMiddleTwist: number;
  leftRingCurl: number;
  leftRingSpread: number;
  leftRingTwist: number;
  leftPinkyCurl: number;
  leftPinkySpread: number;
  leftPinkyTwist: number;

  // Individual Thumb Bones - Right Hand (Bone.017 base, Bone.018 mid, Bone.019 tip)
  rightThumbBaseCurl: number;
  rightThumbBaseSpread: number;
  rightThumbBaseTwist: number;
  rightThumbMidCurl: number;
  rightThumbMidSpread: number;
  rightThumbMidTwist: number;
  rightThumbTipCurl: number;
  rightThumbTipSpread: number;
  rightThumbTipTwist: number;

  // Individual Thumb Bones - Left Hand (Bone.017 base, Bone.018 mid, Bone.019 tip)
  leftThumbBaseCurl: number;
  leftThumbBaseSpread: number;
  leftThumbBaseTwist: number;
  leftThumbMidCurl: number;
  leftThumbMidSpread: number;
  leftThumbMidTwist: number;
  leftThumbTipCurl: number;
  leftThumbTipSpread: number;
  leftThumbTipTwist: number;
}

export const DEFAULT_RUB_PALMS_TUNING: Readonly<RubPalmsLiveTuning> = {
  rightOffsetX: -0.17506,
  rightOffsetY: 0.0514353,
  rightOffsetZ: -0.1127204,
  rightPitch: 18.3996,
  rightYaw: -2.0866,
  rightRoll: 83.9162,
  leftOffsetX: 0.0871,
  leftOffsetY: -0.04298,
  leftOffsetZ: -0.09642,
  leftPitch: 18.2922,
  leftYaw: -14.1266,
  leftRoll: 61.8375,
  rightThumbCurl: 0,
  rightThumbSpread: 10,
  rightThumbTwist: 0,
  rightIndexCurl: -11.83,
  rightIndexSpread: 0,
  rightIndexTwist: 0,
  rightMiddleCurl: -19.93,
  rightMiddleSpread: 0,
  rightMiddleTwist: 0,
  rightRingCurl: -18.88,
  rightRingSpread: 0,
  rightRingTwist: 0,
  rightPinkyCurl: -18.37,
  rightPinkySpread: 0,
  rightPinkyTwist: 0,
  leftThumbCurl: 0,
  leftThumbSpread: 10,
  leftThumbTwist: 0,
  leftIndexCurl: -10.42,
  leftIndexSpread: 0,
  leftIndexTwist: 0,
  leftMiddleCurl: -16.52,
  leftMiddleSpread: 0,
  leftMiddleTwist: 0,
  leftRingCurl: -18.43,
  leftRingSpread: 0,
  leftRingTwist: 0,
  leftPinkyCurl: -15.24,
  leftPinkySpread: 0,
  leftPinkyTwist: 0,
  rightThumbBaseCurl: -22.17,
  rightThumbBaseSpread: -8.64,
  rightThumbBaseTwist: 16.90,
  rightThumbMidCurl: 0,
  rightThumbMidSpread: -24.55,
  rightThumbMidTwist: 0,
  rightThumbTipCurl: 0.40,
  rightThumbTipSpread: 2,
  rightThumbTipTwist: 0,
  leftThumbBaseCurl: -16.57,
  leftThumbBaseSpread: -2.84,
  leftThumbBaseTwist: -13.95,
  leftThumbMidCurl: -3.50,
  leftThumbMidSpread: -24.35,
  leftThumbMidTwist: 0,
  leftThumbTipCurl: -9.25,
  leftThumbTipSpread: 2,
  leftThumbTipTwist: 0,
};

export const rubPalmsLiveTuning: RubPalmsLiveTuning = {
  ...DEFAULT_RUB_PALMS_TUNING,
};

export function updateRubPalmsTuning(patch: Partial<RubPalmsLiveTuning>): void {
  Object.assign(rubPalmsLiveTuning, patch);
}

export function resetRubPalmsTuning(): void {
  Object.assign(rubPalmsLiveTuning, DEFAULT_RUB_PALMS_TUNING);
}

// Orthonormal basis of the horizontal palm contact plane:
// - PALM_SEP_AXIS: fitted normal of the facing skin surfaces
// - PALM_U_AXIS: finger direction tangent to that tilted contact plane
// - PALM_V_AXIS: lateral tangent across palm width (+X)
// Fit to facing skin surfaces, not the metacarpal normal (the sculpted palms
// slope relative to their bones). Rubbing follows this shared tangent plane.
const PALM_SEP_AXIS: readonly [number, number, number] = [.166595, .982572, .082449];
const PALM_U_AXIS: readonly [number, number, number] = [0, .083618, -.996498];
const PALM_V_AXIS: readonly [number, number, number] = [.986025, -.166012, -.013930];

// MCP, PIP and DIP corrections relative to the existing weighted curl. The
// distal phalanges must follow the contact plane too; using one extension value
// for the entire chain made the fingertips bend away from the opposite hand.
// Keep the scalar tuning and small friction wave active around this flat pose.
const PALM_FINGER_CURL_CORRECTIONS = {
  right: {
    index: [-1.3235, 9.5752, 10.0304],
    middle: [1.0202, 10.0683, 17.8611],
    ring: [-1.1211, 13.5759, 9.6946],
    pinky: [.9879, 18.0459, 6.9316],
  },
  left: {
    index: [.3571, .7863, 8.2686],
    middle: [-1.2841, 5.4262, 19.5919],
    ring: [-4.3618, 14.8991, 8.3048],
    pinky: [1.8206, 2.3293, 3.8070],
  },
} as const;

function evaluatePalmContactOrbit(
  theta: number,
  orbitWeight: number,
  spreadBoost = 1.0,
): {
  right: HandPoseTarget;
  left: HandPoseTarget;
} {
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  // ─── 1. HORIZONTAL CIRCULAR SCRUBBING ORBIT (PALM ON PALM) ────────────────
  // Right hand moves in a vigorous circular orbit across the stationary receiving left palm:
  // Longitudinal stroke along Z axis: rU = 16mm
  // Lateral sweep across X axis: rV = 12mm
  const rU = 0.016 * orbitWeight * spreadBoost;
  const rV = 0.012 * orbitWeight * spreadBoost;

  // Small pressure variation along the contact normal
  const dn = 0.0008 * Math.cos(2 * theta) * orbitWeight + 0.0008 * orbitWeight;

  // Right hand drives the full scrubbing orbit across the left palm:
  const rOff: [number, number, number] = [
    rubPalmsLiveTuning.rightOffsetX + PALM_V_AXIS[0] * rV * c + PALM_U_AXIS[0] * rU * s + PALM_SEP_AXIS[0] * dn,
    rubPalmsLiveTuning.rightOffsetY + PALM_V_AXIS[1] * rV * c + PALM_U_AXIS[1] * rU * s + PALM_SEP_AXIS[1] * dn,
    rubPalmsLiveTuning.rightOffsetZ + PALM_V_AXIS[2] * rV * c + PALM_U_AXIS[2] * rU * s + PALM_SEP_AXIS[2] * dn,
  ];

  // Compliant left palm provides 20% subtle supportive counter-yielding under right palm pressure:
  const lOff: [number, number, number] = [
    rubPalmsLiveTuning.leftOffsetX - PALM_V_AXIS[0] * .2 * rV * c - PALM_U_AXIS[0] * .2 * rU * s - PALM_SEP_AXIS[0] * dn * .5,
    rubPalmsLiveTuning.leftOffsetY - PALM_V_AXIS[1] * .2 * rV * c - PALM_U_AXIS[1] * .2 * rU * s - PALM_SEP_AXIS[1] * dn * .5,
    rubPalmsLiveTuning.leftOffsetZ - PALM_V_AXIS[2] * .2 * rV * c - PALM_U_AXIS[2] * .2 * rU * s - PALM_SEP_AXIS[2] * dn * .5,
  ];

  // ─── 2. TANGENTIAL SCRUB ROTATION (SHEAR & PIVOT) ──────────────────────────
  // Right palm tilts and shears dynamically as it circles over the left palm:
  const rEuler: [number, number, number] = [
    rubPalmsLiveTuning.rightPitch + c * .6 * orbitWeight,
    rubPalmsLiveTuning.rightYaw - s * .8 * orbitWeight,
    rubPalmsLiveTuning.rightRoll + s * .5 * orbitWeight,
  ];

  const lEuler: [number, number, number] = [
    rubPalmsLiveTuning.leftPitch - c * .2 * orbitWeight,
    rubPalmsLiveTuning.leftYaw + s * .3 * orbitWeight,
    rubPalmsLiveTuning.leftRoll - s * .2 * orbitWeight,
  ];

  // ─── 3. ACTIVE WRIST BIOMECHANICS ──────────────────────────────────────────
  const rWrist: [number, number, number] = [
    c * .3 * orbitWeight,
    -s * .3 * orbitWeight,
    s * .2 * orbitWeight,
  ];
  const lWrist: [number, number, number] = [
    -c * .1 * orbitWeight,
    s * .1 * orbitWeight,
    -s * .1 * orbitWeight,
  ];

  // ─── 4. FINGER & THUMB ARTICULATION (STACKED PALM-ON-PALM) ────────────────
  // In the stacked configuration:
  // - Left Hand (Receiving Palm): Sits flat facing UP (+Y), fingers extended naturally with gentle cupping.
  //   Left thumb abducts out to the side completely clear of all rubbing action.
  // - Right Hand (Scrubbing Palm): Sits ON TOP facing DOWN (-Y), fingers relaxed over the left palm.
  //   Fingers flex/extend with scrubbing friction as the hand circles over the lather.
  const fL: Record<FingerName, FingerArticulationTarget> = {
    thumb: {
      curl: rubPalmsLiveTuning.leftThumbCurl,
      spread: rubPalmsLiveTuning.leftThumbSpread,
      twist: rubPalmsLiveTuning.leftThumbTwist,
      jointCurls: [
        rubPalmsLiveTuning.leftThumbBaseCurl,
        rubPalmsLiveTuning.leftThumbMidCurl + Math.sin(theta - .35) * .6 * orbitWeight,
        rubPalmsLiveTuning.leftThumbTipCurl + Math.sin(theta - .6) * .35 * orbitWeight,
      ],
      jointSpreads: [
        rubPalmsLiveTuning.leftThumbBaseSpread,
        rubPalmsLiveTuning.leftThumbMidSpread,
        rubPalmsLiveTuning.leftThumbTipSpread,
      ],
      jointTwists: [
        rubPalmsLiveTuning.leftThumbBaseTwist,
        rubPalmsLiveTuning.leftThumbMidTwist,
        rubPalmsLiveTuning.leftThumbTipTwist,
      ],
      distalBias: 1.0,
    },
    index: {
      curl: rubPalmsLiveTuning.leftIndexCurl - c * 0.5 * orbitWeight,
      spread: rubPalmsLiveTuning.leftIndexSpread,
      twist: rubPalmsLiveTuning.leftIndexTwist,
      distalBias: 1.0,
    },
    middle: {
      curl: rubPalmsLiveTuning.leftMiddleCurl - Math.cos(theta - 0.20) * 0.5 * orbitWeight,
      spread: rubPalmsLiveTuning.leftMiddleSpread,
      twist: rubPalmsLiveTuning.leftMiddleTwist,
      distalBias: 1.0,
    },
    ring: {
      curl: rubPalmsLiveTuning.leftRingCurl - Math.cos(theta - 0.40) * 0.5 * orbitWeight,
      spread: rubPalmsLiveTuning.leftRingSpread,
      twist: rubPalmsLiveTuning.leftRingTwist,
      distalBias: 1.0,
    },
    pinky: {
      curl: rubPalmsLiveTuning.leftPinkyCurl - Math.cos(theta - 0.60) * 0.4 * orbitWeight,
      spread: rubPalmsLiveTuning.leftPinkySpread,
      twist: rubPalmsLiveTuning.leftPinkyTwist,
      distalBias: 1.0,
    },
  };

  const fR: Record<FingerName, FingerArticulationTarget> = {
    thumb: {
      curl: rubPalmsLiveTuning.rightThumbCurl + c * 1.0 * orbitWeight,
      spread: rubPalmsLiveTuning.rightThumbSpread,
      twist: rubPalmsLiveTuning.rightThumbTwist,
      jointCurls: [
        rubPalmsLiveTuning.rightThumbBaseCurl,
        rubPalmsLiveTuning.rightThumbMidCurl + c * 1.0 * orbitWeight,
        rubPalmsLiveTuning.rightThumbTipCurl,
      ],
      jointSpreads: [
        rubPalmsLiveTuning.rightThumbBaseSpread,
        rubPalmsLiveTuning.rightThumbMidSpread,
        rubPalmsLiveTuning.rightThumbTipSpread,
      ],
      jointTwists: [
        rubPalmsLiveTuning.rightThumbBaseTwist,
        rubPalmsLiveTuning.rightThumbMidTwist,
        rubPalmsLiveTuning.rightThumbTipTwist,
      ],
      distalBias: 1.0,
    },
    index: {
      curl: rubPalmsLiveTuning.rightIndexCurl + c * 0.4 * orbitWeight,
      spread: rubPalmsLiveTuning.rightIndexSpread,
      twist: rubPalmsLiveTuning.rightIndexTwist,
      distalBias: 1.10,
    },
    middle: {
      curl: rubPalmsLiveTuning.rightMiddleCurl + Math.cos(theta - 0.20) * 0.4 * orbitWeight,
      spread: rubPalmsLiveTuning.rightMiddleSpread,
      twist: rubPalmsLiveTuning.rightMiddleTwist,
      distalBias: 1.10,
    },
    ring: {
      curl: rubPalmsLiveTuning.rightRingCurl + Math.cos(theta - 0.40) * 0.4 * orbitWeight,
      spread: rubPalmsLiveTuning.rightRingSpread,
      twist: rubPalmsLiveTuning.rightRingTwist,
      distalBias: 1.10,
    },
    pinky: {
      curl: rubPalmsLiveTuning.rightPinkyCurl + Math.cos(theta - 0.60) * 0.36 * orbitWeight,
      spread: rubPalmsLiveTuning.rightPinkySpread,
      twist: rubPalmsLiveTuning.rightPinkyTwist,
      distalBias: 1.10,
    },
  };

  for (const [side, fingers] of [["right", fR], ["left", fL]] as const) {
    for (const name of ["index", "middle", "ring", "pinky"] as const) {
      const finger = fingers[name];
      const bias = finger.distalBias ?? 1;
      const correction = PALM_FINGER_CURL_CORRECTIONS[side][name];
      // Preserve the palm/knuckle shape, including the fifth-metacarpal lift
      // that keeps the sculpted pinky knuckles clear of the opposing palm.
      const metacarpal = name === "pinky" ? (side === "right" ? -6 : -3) : finger.curl * .02;
      finger.jointCurls = [
        metacarpal,
        finger.curl * .7 + correction[0],
        finger.curl * .85 * bias + correction[1],
        finger.curl * .55 * bias + correction[2],
      ];
    }
  }

  return {
    right: {
      palmOffset: rOff,
      palmEulerDeg: rEuler,
      wristEulerDeg: rWrist,
      fingers: fR,
    },
    left: {
      palmOffset: lOff,
      palmEulerDeg: lEuler,
      wristEulerDeg: lWrist,
      fingers: fL,
    },
  };
}

function evaluateRubPalmsPose(progress: number): StagePoseEvaluation {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const liveHintY = (rubPalmsLiveTuning.rightOffsetY + rubPalmsLiveTuning.leftOffsetY) * .5 + .015;
  // The dispenser return already joins the palms. Start rubbing in that same
  // contact pose. Keep its orbit and flat fingertips; increase the cadence,
  // varying the pace slightly while fading the stroke smoothly at both ends.
  const rampIn = smooth01(p / .10);
  const rampOut = smooth01((1 - p) / .08);
  const theta = scrubPhase(p, 14);
  const contact = evaluatePalmContactOrbit(theta, rampIn * rampOut);
  return followContact({ ...contact, contactCenterHintOffset: [0, liveHintY, -.06] }, p, rampIn * rampOut);
}
/**
 * Finger articulation tuning (degrees, relative to the calibrated rest pose).
 * Verified against `washand.glb`: 1 deg of `curl` moves a fingertip ~3.9 scene-mm along
 * the palm normal, so the knead amplitudes below produce clearly visible joint motion.
 */
const IDLE_FINGER_CURL = 4;

function blendHandPose(a: HandPoseTarget, b: HandPoseTarget, t: number): HandPoseTarget {
  return {
    palmOffset: lerpVec3Tuple(a.palmOffset, b.palmOffset, t),
    palmEulerDeg: blendOrientation(a.palmEulerDeg, b.palmEulerDeg, t),
    wristEulerDeg: lerpVec3Tuple(a.wristEulerDeg, b.wristEulerDeg, t),
    fingers: lerpFingerTargets(a.fingers, b.fingers, t),
  };
}

function blendPair(a: StagePoseEvaluation, b: StagePoseEvaluation, t: number): StagePoseEvaluation {
  return {
    right: blendHandPose(a.right, b.right, t),
    left: blendHandPose(a.left, b.left, t),
    contactCenterHintOffset: lerpVec3Tuple(a.contactCenterHintOffset, b.contactCenterHintOffset, t),
  };
}

// Authored against the actual GLB, with stable metacarpals and straight
// phalanges. Rows: [MCP/PIP/DIP curl, MCP/PIP/DIP spread], in degrees.
// The PIP/DIP spread corrections cancel sideways bends baked into the rig;
// only the MCP adds the small animated pressure response. The upper fingers
// descend ~25 degrees into alternating lanes of the supporting hand's fan.
// Its index/middle/ring occupy the three inner gaps; its pinky follows the
// outside of the opposite index, without forcing four fingers into three gaps.
const BACK_INTERLACED_FINGERS = {
  rightLower: [
    [-8.64, -2.42, 2.77, 16.93, 9.31, 1],
    [-8.19, -8.66, 5.11, 5.86, .53, 3.98],
    [-8.83, -3.54, -1.8, -4.96, -2.79, .34],
    [-4.75, 2.32, -3.81, -21.23, -7.46, -1.9],
  ],
  rightUpper: [
    [17.11, -2.43, 2.78, 23.02, 9.31, 1],
    [16.19, -8.66, 5.11, 11.99, .53, 3.98],
    [15.18, -3.55, -1.79, 1.56, -2.8, .34],
    [16.46, 2.32, -3.81, -5.3, -7.45, -1.9],
  ],
  leftLower: [
    [-4.13, -8.13, 2.48, 17.92, 1.37, .7],
    [-6.25, -8.31, 10.21, 4.33, -4.65, 5.36],
    [-9.28, -.44, -.54, -5.93, -1.43, -6.42],
    [2.47, -8.25, -2.44, -13.32, -9.59, -8.5],
  ],
  leftUpper: [
    [21.58, -8.13, 2.48, 25.24, 1.37, .71],
    [17.91, -8.31, 10.21, 11.06, -4.65, 5.36],
    [15.08, -.43, -.54, -.8, -1.43, -6.42],
    [24.4, -8.25, -2.45, -.66, -9.59, -8.5],
  ],
} as const;

function backFingers(upper: boolean, left: boolean, pulse: number, cycle = 0, weight = 0): Record<FingerName, FingerArticulationTarget> {
  const key = left ? (upper ? "leftUpper" : "leftLower") : (upper ? "rightUpper" : "rightLower");
  const rows = BACK_INTERLACED_FINGERS[key];
  const finger = (i: number): FingerArticulationTarget => {
    const row = rows[i]!;
    const drag = Math.sin(cycle - .28 * i - (upper ? 0 : .35)) * weight;
    return { curl: 0, spread: 0, distalBias: 1,
      jointCurls: [0, row[0] + pulse * (upper ? .35 : -.09),
        row[1] + drag * (upper ? .85 : .25), row[2] + drag * (upper ? .55 : .18)],
      jointSpreads: [0, row[3], row[4], row[5]] };
  };
  return {
    thumb: { curl: -4 + Math.sin(cycle - .4) * weight * .8, spread: 10, twist: 0 },
    index: finger(0), middle: finger(1), ring: finger(2), pinky: finger(3),
  };
}

function backContact(leftOnTop: boolean, cycle = 0, weight = 0): StagePoseEvaluation {
  const strokeAxis = [0, .258819, -.965926] as const;
  const stroke = Math.sin(cycle) * .038 * weight;
  const lateral = Math.sin(cycle * 2) * .004 * weight;
  const pulse = Math.sin(cycle) * weight;
  const right: HandPoseTarget = {
    palmOffset: leftOnTop ? [-.17506, -.05616, -.14155] : [-.21506, .072299258, -.107129923],
    palmEulerDeg: [12.1996, -19.7866, 104.7162],
    wristEulerDeg: [0, 0, 0],
    fingers: backFingers(!leftOnTop, false, pulse, cycle, weight),
  };
  const left: HandPoseTarget = {
    // Move the whole left hand half a finger lane, instead of bending every
    // finger toward the thumb to compensate for a misplaced palm.
    palmOffset: leftOnTop ? [.12710, .08258148, -.06277638] : [.08710, -.04298, -.09642],
    palmEulerDeg: [2.73693, 12.06083, -123.0685],
    wristEulerDeg: [0, 0, 0],
    fingers: backFingers(leftOnTop, true, pulse, cycle, weight),
  };
  const upper = leftOnTop ? left : right;
  const lower = leftOnTop ? right : left;
  for (let axis = 0; axis < 3; axis++) {
    upper.palmOffset[axis]! += strokeAxis[axis]! * stroke;
    lower.palmOffset[axis]! -= strokeAxis[axis]! * stroke * .06;
  }
  upper.palmOffset[0] += lateral;
  lower.palmOffset[0] -= lateral * .06;
  return { right, left, contactCenterHintOffset: [0, 0, -.12] };
}

function evaluateBacksPose(progress: number): StagePoseEvaluation {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  if (p < .14) {
    const phase = p / .14;
    // Lift first, reorient while clear, then descend into already aligned
    // finger lanes. A single lateral arc swept the deep fingertips sideways
    // through the other hand near the end of the approach.
    const t = smooth01((phase - .25) / .5);
    const pose = blendPair(evaluateRubPalmsPose(1), backContact(false), t);
    const lift = .20 * smooth01(phase / .25) * (1 - smooth01((phase - .75) / .25));
    pose.right.palmOffset[1] += .965926 * lift;
    pose.right.palmOffset[2] += .258819 * lift;
    const arc = Math.sin(Math.PI * t);
    pose.right.palmOffset[0] += .18 * arc;
    pose.left.palmOffset[0] -= .18 * arc;
    freeFingerFollow(pose, phase * Math.PI * 2, arc * arc * (lift / .20) ** 2, 1.8);
    return pose;
  }
  if (p < .43) {
    const t = (p - .14) / .29;
    const weight = smooth01(t / .15) * smooth01((1 - t) / .15);
    return followContact(backContact(false, scrubPhase(t, 6), weight), p, weight, BACK_NORMAL);
  }
  if (p < .59) {
    const phase = (p - .43) / .16;
    const t = smooth01((phase - .25) / .5);
    const pose = blendPair(backContact(false), backContact(true), t);
    // Withdraw the current fingers vertically before moving laterally. The
    // next upper hand stays lifted until its fingers line up with their gaps.
    const lift = .20 * smooth01(phase / .25) * (1 - smooth01((phase - .75) / .25));
    pose.right.palmOffset[1] += .965926 * lift * (1 - t);
    pose.right.palmOffset[2] += .258819 * lift * (1 - t);
    pose.left.palmOffset[1] += .965926 * lift * t;
    pose.left.palmOffset[2] += .258819 * lift * t;
    // Keep the forearms apart while exchanging height.
    const arc = Math.sin(Math.PI * t);
    pose.right.palmOffset[0] += .32 * arc;
    pose.left.palmOffset[0] -= .32 * arc;
    pose.right.palmOffset[2] += .07 * arc;
    pose.left.palmOffset[2] += .07 * arc;
    const release = smooth01(arc);
    pose.right.fingers = lerpFingerTargets(pose.right.fingers, backFingers(false, false, 0), release);
    pose.left.fingers = lerpFingerTargets(pose.left.fingers, backFingers(false, true, 0), release);
    freeFingerFollow(pose, phase * Math.PI * 2, arc * arc * (lift / .20) ** 2, 1.8);
    return pose;
  }
  if (p < 1) {
    const t = (p - .59) / .41;
    const weight = smooth01(t / .10) * smooth01((1 - t) / .10);
    return followContact(backContact(true, scrubPhase(t, 8), weight), p, weight, BACK_NORMAL);
  }
  return backContact(true);
}

// Palm-to-palm interdigitation: open knuckles keep one lane per finger, while
// the middle/distal phalanges curve through those lanes into a loose clasp.
// Based on debug/sela_jari_1.json. Its bone XYZ corrections were composed as
// quaternions after the original pose, then baked into these anatomical angles.
function interlaceContact(cycle = 0, weight = 0): StagePoseEvaluation {
  // Finger joints follow the longitudinal stroke to preserve side contact.
  // A separate rigid-hand stroke would pull these curved fingers apart or
  // intersect their knuckles. The five frames already include that travel.
  const phase = Math.sin(cycle) * weight;
  const cursor = (phase + 1) * 2;
  const index = Math.min(3, Math.floor(cursor));
  const t = cursor - index, t2 = t * t, t3 = t2 * t;
  const a = INTERLACE_CONTACT_FRAMES[Math.max(0, index - 1)]!;
  const b = INTERLACE_CONTACT_FRAMES[index]!;
  const c = INTERLACE_CONTACT_FRAMES[index + 1]!;
  const d = INTERLACE_CONTACT_FRAMES[Math.min(4, index + 2)]!;
  const wa = -.5 * t3 + t2 - .5 * t;
  const wb = 1 + 1.5 * t3 - 2.5 * t2;
  const wc = -1.5 * t3 + 2 * t2 + .5 * t;
  const wd = .5 * t3 - .5 * t2;
  const sample = (av: number, bv: number, cv: number, dv: number) => av * wa + bv * wb + cv * wc + dv * wd;
  const offset = (side: "right" | "left", axis: number) => sample(
    a[side].palmOffset[axis]!, b[side].palmOffset[axis]!, c[side].palmOffset[axis]!, d[side].palmOffset[axis]!,
  );
  const fingers = (side: "right" | "left"): Record<FingerName, FingerArticulationTarget> => {
    const finger = (i: number): FingerArticulationTarget => {
      const ar = a[side].fingers[i]!, br = b[side].fingers[i]!;
      const cr = c[side].fingers[i]!, dr = d[side].fingers[i]!;
      const channel = (j: number) => sample(ar[j]!, br[j]!, cr[j]!, dr[j]!);
      return { curl: 0, spread: 0,
        jointCurls: [channel(0), channel(1), channel(2), channel(3)],
        jointSpreads: [0, channel(4), channel(5), channel(6)],
        jointTwists: [0, channel(7), 0, 0] };
    };
    return {
      thumb: side === "right"
        ? { curl: 0, spread: 0,
          jointCurls: [1.62354, 0, .4], jointSpreads: [19.02740, -24.55, 2], jointTwists: [54.20172, 0, 0],
          jointPositions: [[-.0730169139, 0, 0], [0, 0, 0], [0, 0, 0]] }
        : { curl: 0, spread: 0,
          jointCurls: [-18.15607, -3.5, 38.73264], jointSpreads: [26.37630, -24.35, -14.66144], jointTwists: [-6.61391, 0, 1.48615],
          jointPositions: [[0, 0, 0], [0, 0, 0], [-.0243389724, 0, 0]] },
      index: finger(0), middle: finger(1), ring: finger(2), pinky: finger(3),
    };
  };
  const right: HandPoseTarget = {
    palmOffset: [offset("right", 0), offset("right", 1), offset("right", 2)],
    palmEulerDeg: [12.02173, 1.44121, 87.01405],
    wristEulerDeg: [0, 0, 0], fingers: fingers("right"),
  };
  const left: HandPoseTarget = {
    palmOffset: [offset("left", 0), offset("left", 1), offset("left", 2)],
    palmEulerDeg: [14.87365, -4.31950, 59.17064],
    wristEulerDeg: [0, 0, 0], fingers: fingers("left"),
  };
  return { right, left, contactCenterHintOffset: [0, .01922765, -.06] };
}

function evaluateInterlacePose(progress: number): StagePoseEvaluation {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  if (p < .20) {
    const phase = p / .20;
    const t = smooth01((phase - .22) / .42);
    const grip = .35 + .65 * smooth01((phase - .70) / .30);
    const entry = blendPair(INTERLACE_ENTRY_POSE, INTERLACE_ENTRY_POSE, 0);
    for (const side of ["right", "left"] as const) for (const name of ["index", "middle", "ring", "pinky"] as const) {
      const joints = entry[side].fingers[name].jointCurls!;
      entry[side].fingers[name].jointCurls = [joints[0]!, joints[1]!, joints[2]! * grip, joints[3]! * grip];
    }
    const pose = blendPair(backContact(true), entry, t);
    // Insert with wider finger lanes before tightening into the contact pose.
    // Descending straight into the tight clasp makes the fingertips hook through
    // the opposite knuckles even though the final pose itself is clear.
    const lift = .28 * smooth01(phase / .22) * (1 - smooth01((phase - .64) / .36));
    pose.left.palmOffset[1] += .965926 * lift * (1 - t);
    pose.left.palmOffset[2] += .258819 * lift * (1 - t);
    for (let axis = 0; axis < 3; axis++) pose.right.palmOffset[axis]! += PALM_SEP_AXIS[axis]! * lift * t;
    const arc = Math.sin(Math.PI * t);
    pose.right.palmOffset[0] += .34 * arc;
    pose.left.palmOffset[0] -= .34 * arc;
    freeFingerFollow(pose, phase * Math.PI * 2, arc * arc * (lift / .28) ** 2, 1.8);
    return pose;
  }
  if (p < .28) return blendPair(INTERLACE_ENTRY_POSE, interlaceContact(), smooth01((p - .20) / .08));
  if (p < 1) {
    const t = (p - .28) / .72;
    const weight = smooth01(t / .10) * smooth01((1 - t) / .08);
    // Retiming the fitted joint/hand frames together keeps the narrow finger
    // contacts intact; independent finger noise would break this calibration.
    return followContact(interlaceContact(scrubPhase(t, 13), weight), p, weight);
  }
  return interlaceContact();
}

const contactRotationA = new THREE.Quaternion();
const contactRotationB = new THREE.Quaternion();
const contactRotationEuler = new THREE.Euler();

function blendContactFingers(a: Record<FingerName, FingerArticulationTarget>,
  b: Record<FingerName, FingerArticulationTarget>, t: number, side: ContactSide,
  jointWeights?: readonly number[]): Record<FingerName, FingerArticulationTarget> {
  const out = lerpFingerTargets(a, b, t), rad = Math.PI / 180;
  const curlSign = side === "right" ? 1 : -1, spreadSign = -1;
  for (const name of ["thumb", ...MOVING_FINGERS] as FingerName[]) {
    const curls: number[] = [], spreads: number[] = [], twists: number[] = [];
    for (let k = 0; k < (name === "thumb" ? 3 : 4); k++) {
      contactRotationA.setFromEuler(contactRotationEuler.set(jointValue(a[name], name, k, "curl") * rad * curlSign,
        jointValue(a[name], name, k, "twist") * rad, jointValue(a[name], name, k, "spread") * rad * spreadSign, "XYZ"));
      contactRotationB.setFromEuler(contactRotationEuler.set(jointValue(b[name], name, k, "curl") * rad * curlSign,
        jointValue(b[name], name, k, "twist") * rad, jointValue(b[name], name, k, "spread") * rad * spreadSign, "XYZ"));
      contactRotationA.slerp(contactRotationB, name === "thumb" ? t : jointWeights?.[k] ?? t);
      contactRotationEuler.setFromQuaternion(contactRotationA, "XYZ");
      curls.push(contactRotationEuler.x / rad / curlSign);
      spreads.push(contactRotationEuler.z / rad / spreadSign);
      twists.push(contactRotationEuler.y / rad);
    }
    out[name].jointCurls = curls; out[name].jointSpreads = spreads; out[name].jointTwists = twists;
  }
  return out;
}

function blendContactPair(a: StagePoseEvaluation, b: StagePoseEvaluation, t: number): StagePoseEvaluation {
  const pose = blendPair(a, b, t);
  for (const side of HAND_SIDES) pose[side].fingers = blendContactFingers(a[side].fingers, b[side].fingers, t, side);
  return pose;
}

/** Small fitted clips use the same anatomical channels as the earlier stages. */
function fittedContact(kind: ContactTechnique, active: ContactSide, phase = 0, weight = 0): StagePoseEvaluation {
  const clip = HAND_CONTACT_CLIPS[kind][active];
  const frames = clip.frames;
  const cursor = clip.cyclic
    ? ((phase / (Math.PI * 2) % 1 + 1) % 1) * frames.length
    : (Math.sin(phase) * weight + 1) * (frames.length - 1) / 2;
  const index = Math.floor(cursor), t = cursor - index, t2 = t * t, t3 = t2 * t;
  const frame = (i: number) => frames[clip.cyclic
    ? (i % frames.length + frames.length) % frames.length
    : THREE.MathUtils.clamp(i, 0, frames.length - 1)]!;
  const a = frame(index - 1), b = frame(index), c = frame(index + 1), d = frame(index + 2);
  const sample = (av: number, bv: number, cv: number, dv: number) =>
    av * (-.5 * t3 + t2 - .5 * t) + bv * (1.5 * t3 - 2.5 * t2 + 1)
    + cv * (-1.5 * t3 + 2 * t2 + .5 * t) + dv * (.5 * t3 - .5 * t2);
  const hand = (side: ContactSide): HandPoseTarget => {
    const channel = (get: (f: ContactHandFrame) => number) => sample(get(a[side]), get(b[side]), get(c[side]), get(d[side]));
    const root = (i: number) => channel(f => f.root[i]!);
    const finger = (i: number): FingerArticulationTarget => {
      const count = i === 0 ? 3 : 4;
      const curls: number[] = [], spreads: number[] = [], twists: number[] = [];
      // The preserved GLB has mirrored flexion axes and negative-Z abduction.
      // Interpolate in the actual bone-delta frame. Baked hinge corrections can
      // cross Euler +/-180: cubic angle interpolation would unfold an otherwise
      // valid hook or drive it through the opposing palm between contact frames.
      const curlSign = side === "right" ? 1 : -1, spreadSign = -1, rad = Math.PI / 180;
      for (let joint = 0; joint < count; joint++) {
        const from = b[side].fingers[i]!, to = c[side].fingers[i]!;
        contactRotationA.setFromEuler(contactRotationEuler.set(from[joint]! * rad * curlSign,
          from[8 + joint]! * rad, from[4 + joint]! * rad * spreadSign, "XYZ"));
        contactRotationB.setFromEuler(contactRotationEuler.set(to[joint]! * rad * curlSign,
          to[8 + joint]! * rad, to[4 + joint]! * rad * spreadSign, "XYZ"));
        contactRotationA.slerp(contactRotationB, t);
        contactRotationEuler.setFromQuaternion(contactRotationA, "XYZ");
        curls.push(contactRotationEuler.x / rad / curlSign);
        spreads.push(contactRotationEuler.z / rad / spreadSign);
        twists.push(contactRotationEuler.y / rad);
      }
      return { curl: 0, spread: 0, jointCurls: curls, jointSpreads: spreads, jointTwists: twists };
    };
    const fingers = { thumb: finger(0), index: finger(1), middle: finger(2), ring: finger(3), pinky: finger(4) };
    const rad = Math.PI / 180, from = b[side].root, to = c[side].root;
    contactRotationA.setFromEuler(contactRotationEuler.set(from[3]! * rad, from[4]! * rad, from[5]! * rad, "ZXY"));
    contactRotationB.setFromEuler(contactRotationEuler.set(to[3]! * rad, to[4]! * rad, to[5]! * rad, "ZXY"));
    contactRotationA.slerp(contactRotationB, t);
    contactRotationEuler.setFromQuaternion(contactRotationA, "ZXY");
    return {
      palmOffset: [root(0), root(1), root(2)],
      palmEulerDeg: [contactRotationEuler.x / rad, contactRotationEuler.y / rad, contactRotationEuler.z / rad],
      wristEulerDeg: [0, 0, 0],
      fingers,
    };
  };
  const pose: StagePoseEvaluation = { right: hand("right"), left: hand("left"), contactCenterHintOffset: [0, .02, -.12] };
  // The circular clip starts at its stationary contact pose. Fade its radius
  // and compensating joint channels together when establishing/releasing contact.
  if (clip.cyclic && weight < 1) {
    const rest = fittedContact(kind, active, 0, 1);
    return blendContactPair(rest, pose, weight);
  }
  return pose;
}

const THUMB_CONTACT_AXES = {
  right: { pivot: new THREE.Vector3(...FITTED_THUMB_AXES.right.pivot), axis: new THREE.Vector3(...FITTED_THUMB_AXES.right.axis).normalize() },
  left: { pivot: new THREE.Vector3(...FITTED_THUMB_AXES.left.pivot), axis: new THREE.Vector3(...FITTED_THUMB_AXES.left.axis).normalize() },
};
function visibleContactMotion(kind: ContactTechnique, active: ContactSide, phase: number, weight: number): StagePoseEvaluation {
  // Keep the fitted stroke and its finger compensation together. A fuller
  // range makes the rubbing readable while the receiving hand stays steady.
  const motionWeight = weight * (kind === "knuckles" ? 1 : kind === "thumbs" ? .4 : .9);
  return fittedContact(kind, active, phase, motionWeight);
}

function releasedContact(contact: StagePoseEvaluation, kind: ContactTechnique, active: ContactSide): StagePoseEvaluation {
  const pose = blendContactPair(contact, contact, 0);
  for (const side of HAND_SIDES) {
    const h = pose[side], direction = side === "right" ? -1 : 1;
    // Open room around the clasp before turning either long forearm. Thumb
    // withdrawal follows the radial opening of the grip; palm contact lifts off.
    h.palmOffset[0] += direction * (side === active ? .30 : .25);
    h.palmOffset[1] += side === active ? kind === "thumbs" ? .34 : .22 : -.035;
    h.palmOffset[2] += side === active ? .08 : -.04;
    h.fingers = buildFingerSet(25, 2, 0, 0, 15, 8);
  }
  if (kind === "knuckles") {
    for (const side of HAND_SIDES) {
      pose[side].palmOffset = [contact[side].palmOffset[0] + (side === "right" ? -.18 : .18),
        contact[side].palmOffset[1] + (side === active ? .25 : -.18),
        contact[side].palmOffset[2] + (side === active ? .04 : -.04)];
    }
  } else if (kind === "thumbs") {
    const end = CONTACT_WITHDRAWAL[kind][active][3];
    for (const side of HAND_SIDES) for (let axis = 0; axis < 3; axis++)
      pose[side].palmOffset[axis] = contact[side].palmOffset[axis]! + end[axis]! * (side === active ? 1 : -.8);
  }
  return pose;
}

function articulateBetween(from: StagePoseEvaluation, to: StagePoseEvaluation, rootT: number,
  active: ContactSide, activeFingerT: number, otherFingerT: number): StagePoseEvaluation {
  const pose = blendContactPair(from, to, rootT);
  for (const side of HAND_SIDES) pose[side].fingers = blendContactFingers(
    from[side].fingers, to[side].fingers, side === active ? activeFingerT : otherFingerT, side,
  );
  return pose;
}

// Withdrawal waypoints in world space, fitted with the fingers still hooked.
// Opening the PIP joints in place would sweep the distal phalanges through the
// opposite hand. The thumb grip similarly slides off before it opens.
function thumbWithdrawal(side: ContactSide): readonly (readonly [number, number, number])[] {
  const axis = THUMB_CONTACT_AXES[side].axis;
  return [0, .024, .12, .34].map(distance => [axis.x * distance, axis.y * distance, axis.z * distance] as const);
}

const CONTACT_WITHDRAWAL = {
  thumbs: {
    right: thumbWithdrawal("right"),
    left: thumbWithdrawal("left"),
  },
} as const;

function departContact(contact: StagePoseEvaluation, released: StagePoseEvaluation,
  kind: ContactTechnique, active: ContactSide, t: number): StagePoseEvaluation {
  if (kind === "knuckles") {
    // Unhook at the MCP first: the curved phalanges move forward out of the
    // clasp as the palms separate. Opening the distal joints in place drags
    // the fingertips through the opposite palm.
    const pose = blendContactPair(contact, released, smooth01(t / .75));
    const weights = [smooth01((t - .5) / .5), smooth01(t / .65),
      smooth01((t - .55) / .45), smooth01((t - .65) / .35)];
    for (const side of HAND_SIDES) pose[side].fingers = blendContactFingers(
      contact[side].fingers, released[side].fingers, smooth01((t - .5) / .5), side, weights,
    );
    return pose;
  }
  // Baked XYZ channels compensate imported hinge roll; a raw local-X angle
  // cannot reliably decide whether an anatomically posed finger is hooked.
  if (kind === "thumbs") {
    const slide = smooth01(t / .6), opening = smooth01((t - .6) / .2);
    const fingers = smooth01((t - .8) / .2);
    const pose = articulateBetween(contact, released, opening, active, fingers, fingers);
    // Loosen the seated middle/ring pads slightly before sliding off the thumb.
    // In reverse, this leaves room for the thumb tip to enter the clasp, then
    // closes the pad onto it. Keep the normal release timing for the other digits.
    const unclasp = .03 * smooth01(t / .15);
    const unclaspFingers = blendContactFingers(contact[active].fingers,
      released[active].fingers, THREE.MathUtils.lerp(unclasp, 1, fingers), active);
    pose[active].fingers.middle = unclaspFingers.middle;
    pose[active].fingers.ring = unclaspFingers.ring;
    const points = CONTACT_WITHDRAWAL[kind][active], lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(
      ...points[i]!.map((v, axis) => v - points[i - 1]![axis]!),
    ));
    const distance = slide * lengths[3]!;
    const segment = distance < lengths[1]! ? 0 : distance < lengths[2]! ? 1 : 2;
    const local = (distance - lengths[segment]!) / (lengths[segment + 1]! - lengths[segment]!);
    for (let axis = 0; axis < 3; axis++) pose[active].palmOffset[axis] +=
      THREE.MathUtils.lerp(points[segment]![axis]!, points[segment + 1]![axis]!, local) * (1 - opening);
    return pose;
  }
  return articulateBetween(contact, released, smooth01(t / .75), active,
    smooth01((t - .25) / .75), smooth01((t - .45) / .55));
}

/** Withdraw, open in free space, turn, then establish the next contact. */
function contactTransfer(from: StagePoseEvaluation, fromKind: ContactTechnique, fromActive: ContactSide,
  to: StagePoseEvaluation, toKind: ContactTechnique, toActive: ContactSide, progress: number): StagePoseEvaluation {
  const exit = releasedContact(from, fromKind, fromActive), entry = releasedContact(to, toKind, toActive);
  if (progress < .28) {
    return departContact(from, exit, fromKind, fromActive, progress / .28);
  }
  if (progress < .72) {
    // Technique changes need a readable free-space turn as well as the
    // release. Give the hands a shallow opposing depth arc so the thumb grip
    // visibly clears before the fingertip cluster seats on the opposite palm.
    const t = fromKind === toKind
      ? smooth01((progress - .28) / .44)
      : freeHandTravel((progress - .28) / .44);
    const pose = blendContactPair(exit, entry, t);
    const clearance = fromKind === toKind
      ? (toKind === "knuckles" ? -.15 : .15)
      : toKind === "tips" ? .18 : .14;
    const arc = clearance * Math.sin(Math.PI * t);
    pose.right.palmOffset[2] += arc;
    pose.left.palmOffset[2] -= arc;
    return pose;
  }
  const t = (progress - .72) / .28;
  if (toKind !== "tips") return departContact(to, entry, toKind, toActive, 1 - t);
  return articulateBetween(entry, to,
    smooth01((t - .25) / .75), toActive, smooth01(t / .65), smooth01(t / .6));
}

/** Uncurl the interlaced tips along their exit lanes before turning the palms. */
function releaseInterlacedFingers(progress: number): StagePoseEvaluation {
  const t = smooth01(THREE.MathUtils.clamp(progress, 0, 1));
  const seated = interlaceContact();
  const pose = blendContactPair(seated, seated, 0);
  // A rigid upward pull catches the hooked tips in the opposing palm. Couple
  // the lift to distal extension; metacarpals keep their lanes until clear.
  const knuckles = smooth01((t - .65) / .35);
  const open = buildFingerSet(12, 6, 0, 0, 8, 12);
  for (const side of HAND_SIDES) {
    pose[side].fingers = blendContactFingers(seated[side].fingers, open, t, side,
      [knuckles, knuckles, t, t]);
    pose[side].palmOffset[1] += (side === "right" ? 1 : -1) * .16 * t;
  }
  return pose;
}

function releaseKnuckleContact(contact: StagePoseEvaluation, released: StagePoseEvaluation,
  progress: number): StagePoseEvaluation {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const pose = blendContactPair(contact, released, smooth01(t / .85));
  // Extend at the MCP as the hooks move out of their seated lanes. Keep the
  // distal shape until they clear; opening those joints early catches the rings.
  // The longer release/seat phases give the tips room to uncurl gently.
  const opening = smooth01((t - .4) / .6);
  const joints = [opening, smooth01(t / .65),
    smooth01((t - .3) / .7), smooth01((t - .35) / .65)];
  for (const side of HAND_SIDES) pose[side].fingers = blendContactFingers(
    contact[side].fingers, released[side].fingers, opening, side, joints,
  );
  return pose;
}

function freeHandTravel(progress: number): number {
  const t = THREE.MathUtils.clamp(progress, 0, 1), ramp = .14;
  // Integrate a smooth velocity ramp, cruise, then decelerate. The free turn
  // retains zero velocity/acceleration at its ends without a fast midpoint.
  if (t > 1 - ramp) return 1 - freeHandTravel(1 - t);
  if (t >= ramp) return (t - ramp * .5) / (1 - ramp);
  const u = t / ramp;
  return ramp * u * u * u * (1 - u * .5) / (1 - ramp);
}

function exchangeKnuckleContact(first: StagePoseEvaluation, second: StagePoseEvaluation,
  progress: number): StagePoseEvaluation {
  const exit = releasedContact(first, "knuckles", "right");
  const entry = releasedContact(second, "knuckles", "left");
  if (progress < .36) return releaseKnuckleContact(first, exit, progress / .36);
  if (progress < .64) {
    const t = freeHandTravel((progress - .36) / .28);
    const pose = blendContactPair(exit, entry, t);
    const clearance = -.15 * Math.sin(Math.PI * t);
    pose.right.palmOffset[2] += clearance;
    pose.left.palmOffset[2] -= clearance;
    return pose;
  }
  return releaseKnuckleContact(second, entry, (1 - progress) / .36);
}

function enterKnuckleContact(contact: StagePoseEvaluation, progress: number): StagePoseEvaluation {
  if (progress < .055) return releaseInterlacedFingers(progress / .055);
  const released = releaseInterlacedFingers(1);
  const approach = releasedContact(contact, "knuckles", "right");
  if (progress < .16) {
    const t = freeHandTravel((progress - .055) / .105);
    const pose = blendContactPair(released, approach, t);
    // Turning the free forearms at different depths keeps their silhouettes
    // from sweeping through one another during the change of grip.
    const arc = Math.sin(Math.PI * t) * .06;
    pose.right.palmOffset[2] += arc;
    pose.left.palmOffset[2] -= arc;
    return pose;
  }
  return releaseKnuckleContact(contact, approach, 1 - (progress - .16) / .10);
}

/**
 * Step 4 enters from the exact interlaced endpoint of step 3. The short
 * withdrawal clears the hooked tips, then the calibrated contact frames seat
 * the curled fingertips on the opposite palm while the fingers remain locked.
 */
function evaluateLateContact(kind: ContactTechnique, progress: number): StagePoseEvaluation {
  const first = fittedContact(kind, "right"), second = fittedContact(kind, "left");
  // Keep the fingertip contact seated early in its stage; the visible release
  // and free turn are authored inside this short entry window.
  const entryEnd = kind === "knuckles" ? .26 : .12;
  const swapStart = kind === "knuckles" ? .48 : .43, swapEnd = kind === "knuckles" ? .76 : .59;
  if (kind === "knuckles" && progress < entryEnd) return enterKnuckleContact(first, progress);
  if (progress < entryEnd) {
    const previous = fittedContact(kind === "thumbs" ? "knuckles" : "thumbs", "left");
    return contactTransfer(previous, kind === "tips" ? "thumbs" : "knuckles", "left",
      first, kind, "right", progress / entryEnd);
  }
  if (progress >= swapStart && progress < swapEnd) {
    const t = (progress - swapStart) / (swapEnd - swapStart);
    return kind === "knuckles" ? exchangeKnuckleContact(first, second, t)
      : contactTransfer(first, kind, "right", second, kind, "left", t);
  }
  const active = progress < swapStart ? "right" : "left";
  const t = progress < swapStart ? (progress - entryEnd) / (swapStart - entryEnd) : (progress - swapEnd) / (1 - swapEnd);
  // Establish the fitted rub a little sooner, then settle gently before release.
  const weight = smooth01(t / .10) * smooth01((1 - t) / .14);
  const turns = kind === "tips" ? active === "right" ? 5 : 6
    : kind === "knuckles" ? active === "right" ? 3 : 4 : active === "right" ? 4 : 5;
  const phase = t * Math.PI * 2 * turns;
  // Slightly soften each back-and-forth reversal without changing the fitted
  // contact path or cycle count. Fingertip circles keep an even angular speed.
  const contactPhase = kind === "tips" ? phase : phase + .03 * Math.sin(2 * phase);
  return visibleContactMotion(kind, active, contactPhase, weight);
}

/**
 * Evaluates the procedural hand and finger pose targets for any stage at a given
 * normalized stage progress (0..1) and elapsed stage time (seconds).
 */
function evaluateBaseStagePose(
  stageId: HandwashingStageId,
  progress: number,
  elapsed: number,
  anchors: HandPoseSceneAnchors,
): StagePoseEvaluation {
  const breathe = Math.sin(elapsed * 2.4);
  const rubFast = Math.sin(elapsed * 6.8);
  const rubFastCos = Math.cos(elapsed * 6.8);
  const rubMed = Math.sin(elapsed * 5.2);

  switch (stageId) {
    case "idle": {
      // Initial pose: hands rest naturally in front of the basin, fingers relaxed in a
      // gentle resting curl with a slow, barely-visible breathing ripple.
      return {
        right: {
          palmOffset: [-0.012, -0.04 + breathe * 0.004, 0.11],
          palmEulerDeg: [12, -2, 8],
          wristEulerDeg: [breathe * 1.2, 0, breathe * 1.5],
          fingers: buildFingerSet(IDLE_FINGER_CURL, 0.3, elapsed * 1.6, 1.5, -6, -2),
        },
        left: {
          palmOffset: [-0.048, -0.04 + breathe * 0.004, 0.11],
          palmEulerDeg: [8, 0, -4],
          wristEulerDeg: [breathe * 1.2, 0, -breathe * 1.5],
          fingers: buildFingerSet(IDLE_FINGER_CURL, 0.3, elapsed * 1.6 + 1.1, 1.5, -6, -2),
        },
        contactCenterHintOffset: [-0.03, -0.04, 0.1],
      };
    }

    case "moveHandsToFaucet": {
      // Stage 1 — Move hands directly under faucet:
      // Both hands move smoothly from their initial rest pose into the washing position directly
      // under WaterSpawn [0, 2.383, -0.668]. Left palm cups UP (menampan 🫴) and right palm positions above it.
      // Water turns ON automatically at progress >= 0.85 when hands arrive right under the faucet.
      // Right hand moves smoothly toward the faucet; Left hand follows with an organic delay
      const rEase = smooth01(progress / .82);
      const lEase = smooth01((progress - .06) / .82);

      const rIdleOff: [number, number, number] = [-0.012, -0.04, 0.11];
      const rWashingOff: [number, number, number] = [-0.016, 0.038, -0.060];
      const rIdleEuler: [number, number, number] = [12, -2, 8];
      const rWashingEuler: [number, number, number] = [8, -5, -66];

      const lIdleOff: [number, number, number] = [-0.048, -0.04, 0.11];
      const lCupOff: [number, number, number] = [-0.036, -0.012, -0.058];
      const lIdleEuler: [number, number, number] = [8, 0, -4];
      const lCupEuler: [number, number, number] = [10, -2, 46];

      const unfurl = Math.sin(progress * Math.PI) * 4.0;

      return {
        right: {
          palmOffset: [
            THREE.MathUtils.lerp(rIdleOff[0], rWashingOff[0], rEase),
            THREE.MathUtils.lerp(rIdleOff[1], rWashingOff[1], rEase) + Math.sin(rEase * Math.PI) * .025,
            THREE.MathUtils.lerp(rIdleOff[2], rWashingOff[2], rEase),
          ],
          palmEulerDeg: [
            THREE.MathUtils.lerp(rIdleEuler[0], rWashingEuler[0], rEase),
            THREE.MathUtils.lerp(rIdleEuler[1], rWashingEuler[1], rEase),
            THREE.MathUtils.lerp(rIdleEuler[2], rWashingEuler[2], rEase),
          ],
          wristEulerDeg: [-unfurl * 0.25, 0, 0],
          fingers: {
            thumb: {
              curl: THREE.MathUtils.lerp(-6, -4, rEase),
              spread: THREE.MathUtils.lerp(-2, -3, rEase),
              distalBias: 1.0,
            },
            index: {
              curl: THREE.MathUtils.lerp(4, 12, rEase) + unfurl,
              spread: THREE.MathUtils.lerp(0.2, 0.1, rEase),
              distalBias: 1.0,
            },
            middle: {
              curl: THREE.MathUtils.lerp(4, 13, rEase) + unfurl,
              spread: 0,
              distalBias: 1.0,
            },
            ring: {
              curl: THREE.MathUtils.lerp(4, 13, rEase) + unfurl,
              spread: THREE.MathUtils.lerp(-0.2, -0.1, rEase),
              distalBias: 1.0,
            },
            pinky: {
              curl: THREE.MathUtils.lerp(4, 11, rEase) + unfurl,
              spread: THREE.MathUtils.lerp(-0.4, -0.2, rEase),
              distalBias: 1.0,
            },
          },
        },
        left: {
          palmOffset: [
            THREE.MathUtils.lerp(lIdleOff[0], lCupOff[0], lEase),
            THREE.MathUtils.lerp(lIdleOff[1], lCupOff[1], lEase) + Math.sin(lEase * Math.PI) * .018,
            THREE.MathUtils.lerp(lIdleOff[2], lCupOff[2], lEase),
          ],
          palmEulerDeg: [
            THREE.MathUtils.lerp(lIdleEuler[0], lCupEuler[0], lEase),
            THREE.MathUtils.lerp(lIdleEuler[1], lCupEuler[1], lEase),
            THREE.MathUtils.lerp(lIdleEuler[2], lCupEuler[2], lEase),
          ],
          wristEulerDeg: [0, 0, 0],
          fingers: {
            thumb: {
              curl: THREE.MathUtils.lerp(-6, -4, lEase),
              spread: THREE.MathUtils.lerp(-2, -3, lEase),
              distalBias: 1.0,
            },
            index: {
              curl: THREE.MathUtils.lerp(4, 12, lEase),
              spread: THREE.MathUtils.lerp(0.3, 0.1, lEase),
              distalBias: 1.0,
            },
            middle: {
              curl: THREE.MathUtils.lerp(4, 13, lEase),
              spread: 0,
              distalBias: 1.0,
            },
            ring: {
              curl: THREE.MathUtils.lerp(4, 13, lEase),
              spread: THREE.MathUtils.lerp(-0.2, -0.1, lEase),
              distalBias: 1.0,
            },
            pinky: {
              curl: THREE.MathUtils.lerp(4, 11, lEase),
              spread: THREE.MathUtils.lerp(-0.4, -0.2, lEase),
              distalBias: 1.0,
            },
          },
        },
        contactCenterHintOffset: [0.0, 0.02, -0.06],
      };
    }

    case "wetHands": {
      // Stage 2 — Menampan Air & Basuh Tangan (cupping hands under faucet stream 🫴🤲 reference illustration):
      // Both hands cup together side-by-side to hold/basin water directly under WaterSpawn [0, 2.383, -0.668].
      // Right hand sits slightly higher, while Left hand sits comfortably lower (~5cm) in a natural layered
      // cradle, with an organic animation delay to completely eliminate pinky collision and unnatural rigidity.
      const wetWeight = smooth01(progress / .13) * smooth01((1 - progress) / .15);
      // A slow rinse beneath the stream, without the brisk rubbing cadence.
      const rWashTime = progress * Math.PI * 3;
      const rSin = Math.sin(rWashTime) * wetWeight;
      const rCos = Math.cos(rWashTime) * wetWeight;

      const rSwayX = rSin * 0.005;
      const rBobY = rCos * 0.003;
      const rSurgeZ = rCos * 0.007;
      const rCupBreath = rSin;

      // The receiving hand follows with a small phase lag.
      const lWashTime = rWashTime - 0.6;
      const lSin = Math.sin(lWashTime) * wetWeight;
      const lCos = Math.cos(lWashTime) * wetWeight;

      const lSwayX = lSin * 0.005;
      const lBobY = lCos * 0.0025;
      const lSurgeZ = lCos * 0.006;
      const lCupBreath = lSin;

      const rBaseOff = [-0.016, 0.038, -0.060];
      const lBaseOff = [-0.036, -0.012, -0.058];

      return {
        right: {
          palmOffset: [
            rBaseOff[0] + rSwayX,
            rBaseOff[1] + rBobY,
            rBaseOff[2] + rSurgeZ,
          ],
          palmEulerDeg: [8 + rCos, -5 + rSin, -66 + rSin * 3],
          wristEulerDeg: [rCos * .45, 0, 0],
          fingers: {
            thumb: { curl: -4 + rCupBreath * 0.2, spread: -3, distalBias: 1.0 },
            index: { curl: 12 + rCupBreath, spread: 0.1, distalBias: 1.0 },
            middle: { curl: 13 + rCupBreath, spread: 0.0, distalBias: 1.0 },
            ring: { curl: 13 + rCupBreath, spread: -0.1, distalBias: 1.0 },
            pinky: { curl: 11 + rCupBreath, spread: -0.2, distalBias: 1.0 },
          },
        },
        left: {
          palmOffset: [
            lBaseOff[0] + lSwayX,
            lBaseOff[1] + lBobY,
            lBaseOff[2] + lSurgeZ,
          ],
          palmEulerDeg: [10 + lCos, -2 - lSin, 46 - lSin * 3],
          wristEulerDeg: [lCos * .45, 0, 0],
          fingers: {
            thumb: { curl: -4 + lCupBreath * 0.2, spread: -3, distalBias: 1.0 },
            index: { curl: 12 + lCupBreath, spread: 0.1, distalBias: 1.0 },
            middle: { curl: 13 + lCupBreath, spread: 0.0, distalBias: 1.0 },
            ring: { curl: 13 + lCupBreath, spread: -0.1, distalBias: 1.0 },
            pinky: { curl: 11 + lCupBreath, spread: -0.2, distalBias: 1.0 },
          },
        },
        contactCenterHintOffset: [rSwayX * 0.5, 0.013 + (rBobY + lBobY) * 0.5, -0.059 + (rSurgeZ + lSurgeZ) * 0.5],
      };
    }

    case "activateSoapDispenser": {
      return {
        right: {
          palmOffset: [0.350, 0.215, -0.675],
          palmEulerDeg: [14, 8, 66],
          wristEulerDeg: [0, 0, 0],
          fingers: {
            thumb: { curl: -12, spread: -8, twist: 0, distalBias: 1.0 },
            index: { curl: -7, spread: 0.1, twist: 0, distalBias: 1.0 },
            middle: { curl: -6, spread: 0, twist: 0, distalBias: 1.0 },
            ring: { curl: -5, spread: -0.1, twist: 0, distalBias: 1.0 },
            pinky: { curl: -5, spread: -0.2, twist: 0, distalBias: 1.0 },
          },
        },
        left: {
          palmOffset: [0.415, -0.095, -0.455],
          palmEulerDeg: [10, -14, 42],
          wristEulerDeg: [0, 0, 0],
          fingers: {
            thumb: { curl: -10, spread: -6, twist: 0, distalBias: 1.0 },
            index: { curl: -5, spread: 0.1, twist: 0, distalBias: 1.0 },
            middle: { curl: -4, spread: 0, twist: 0, distalBias: 1.0 },
            ring: { curl: -4, spread: -0.1, twist: 0, distalBias: 1.0 },
            pinky: { curl: -5, spread: -0.2, twist: 0, distalBias: 1.0 },
          },
        },
        contactCenterHintOffset: [0.38, 0.06, -0.56],
      };
    }

    case "dispenseSoap": {
      if (progress > .68) {
        const t = smooth01((progress - .68) / .32);
        const from = evaluateStagePose("dispenseSoap", .68, elapsed, { ...anchors, pumpPressProgress: 0 });
        const pose = blendPair(from, evaluateRubPalmsPose(0), t);
        // Release the pump above the receiving hand and travel straight into
        // palm contact, without returning through the old washing/rest pose.
        const lift = Math.sin(Math.PI * t) ** 2;
        pose.right.palmOffset[1] += .055 * lift;
        pose.left.palmOffset[1] -= .020 * lift;
        return pose;
      }

      // Stage 3 — Apply Soap (Pakai Sabun dari Dispenser):
      // Exact world coordinates of ProceduralSoapDispenser:
      // - Bottle belly: center [0.490, 1.500..1.777, -1.311], radius 0.088 (front Z = -1.223)
      // - White pump cap top (SoapDispenserHead): [0.490, 1.917, -1.311] (strokes down to Y = 1.875)
      // - Nozzle outlet (SoapDispenserOutletAnchor): [0.394, 1.873, -1.165]
      //
      // Calibrated hand targets & non-intersecting high/low trajectories:
      // - Right hand (R_hand) lifts HIGH (+Y/+X arc) so the underside of its index/middle finger pads
      //   lands directly on top of the white pump plunger cap [0.490, 1.917, -1.311] with level horizontal fingers.
      // - Left hand (L_hand) travels LOW (-Y arc underneath R_hand) and cups 14cm below the nozzle outlet
      //   [0.394, 1.873, -1.165] at Y = 1.730 (26cm below R_hand and 5cm in front of the bottle belly).
      // - Because R_hand arcs UP (+0.065m) and L_hand arcs DOWN (-0.045m) during both reach and return,
      //   the two hands stay >18cm apart vertically and never collide or penetrate!

      const reachT = smooth01(progress / .28);
      const returnT = 0; // The direct contact return is handled above.
      const dispWeight = reachT * (1.0 - returnT);

      // Opposite-signed vertical separation arcs during reach & return so R_hand goes OVER and L_hand goes UNDER
      const rReachSin = Math.sin(reachT * Math.PI) * (1.0 - returnT);
      const rReturnSin = Math.sin(returnT * Math.PI) * reachT;
      const rArcY = 0.065 * rReachSin + 0.060 * rReturnSin;
      const rArcX = 0.040 * rReachSin + 0.035 * rReturnSin;

      const lReachSin = Math.sin(reachT * Math.PI) * (1.0 - returnT);
      const lReturnSin = Math.sin(returnT * Math.PI) * reachT;
      const lArcY = -0.045 * lReachSin - 0.045 * lReturnSin;

      // Pump press displacement and gentle finger flexion on the cap
      const pressDepth = anchors.pumpStroke * anchors.pumpPressProgress;
      const pressFlex = anchors.pumpPressProgress * 4.0;

      // Left palm cushioning bounce when soap lands (around progress 0.50..0.62)
      const landNorm = THREE.MathUtils.clamp((progress - 0.50) / 0.12, 0, 1);
      const landRecoil = Math.sin(landNorm * Math.PI) * 0.008;

      // Rest / washing offsets (shared with Stage 2 wetHands and Stage 4 rubPalms start)
      const rWashOff: [number, number, number] = [-0.016, 0.038, -0.060];
      const lWashOff: [number, number, number] = [-0.036, -0.012, -0.058];
      const rWashEuler: [number, number, number] = [8, -5, -66];
      const lWashEuler: [number, number, number] = [10, -2, 46];

      // Calibrated dispenser target offsets:
      // - rDispOff places R_hand palm at [0.525, 1.999, -1.153] so index/middle finger pads sit right on top of pump cap [0.490, 1.917, -1.311]
      // - lDispOff places L_hand palm at [0.328, 1.676, -0.978] so upward palm hollow sits at [0.380, 1.730, -1.085] right under nozzle [0.394, 1.873, -1.165]
      const rDispOff: [number, number, number] = [0.350, 0.215, -0.675];
      const lDispOff: [number, number, number] = [0.415, -0.095, -0.455];
      const rDispEuler: [number, number, number] = [14, 8, 66];
      const lDispEuler: [number, number, number] = [10, -14, 42];

      return {
        right: {
          palmOffset: [
            THREE.MathUtils.lerp(rWashOff[0], rDispOff[0], dispWeight) + rArcX,
            THREE.MathUtils.lerp(rWashOff[1], rDispOff[1] - pressDepth, dispWeight) + rArcY,
            THREE.MathUtils.lerp(rWashOff[2], rDispOff[2], dispWeight),
          ],
          palmEulerDeg: [
            THREE.MathUtils.lerp(rWashEuler[0], rDispEuler[0] + anchors.pumpPressProgress * 2.5, dispWeight),
            THREE.MathUtils.lerp(rWashEuler[1], rDispEuler[1], dispWeight),
            THREE.MathUtils.lerp(rWashEuler[2], rDispEuler[2], dispWeight),
          ],
          wristEulerDeg: [
            THREE.MathUtils.lerp(0, anchors.pumpPressProgress * 3.0, dispWeight),
            0,
            0,
          ],
          fingers: {
            thumb: {
              curl: THREE.MathUtils.lerp(-4, -12, dispWeight),
              spread: THREE.MathUtils.lerp(-3, -8, dispWeight),
              twist: 0,
              distalBias: 1.0,
            },
            index: {
              curl: THREE.MathUtils.lerp(12, -7 + pressFlex, dispWeight),
              spread: 0.1,
              twist: 0,
              distalBias: 1.0,
            },
            middle: {
              curl: THREE.MathUtils.lerp(13, -6 + pressFlex, dispWeight),
              spread: 0,
              twist: 0,
              distalBias: 1.0,
            },
            ring: {
              curl: THREE.MathUtils.lerp(13, -5 + pressFlex * 0.6, dispWeight),
              spread: -0.1,
              twist: 0,
              distalBias: 1.0,
            },
            pinky: {
              curl: THREE.MathUtils.lerp(11, -5 + pressFlex * 0.5, dispWeight),
              spread: -0.2,
              twist: 0,
              distalBias: 1.0,
            },
          },
        },
        left: {
          palmOffset: [
            THREE.MathUtils.lerp(lWashOff[0], lDispOff[0], dispWeight),
            THREE.MathUtils.lerp(lWashOff[1], lDispOff[1] - landRecoil, dispWeight) + lArcY,
            THREE.MathUtils.lerp(lWashOff[2], lDispOff[2], dispWeight),
          ],
          palmEulerDeg: [
            THREE.MathUtils.lerp(lWashEuler[0], lDispEuler[0], dispWeight),
            THREE.MathUtils.lerp(lWashEuler[1], lDispEuler[1], dispWeight),
            THREE.MathUtils.lerp(lWashEuler[2], lDispEuler[2], dispWeight),
          ],
          wristEulerDeg: [
            THREE.MathUtils.lerp(0, 2 + landRecoil * 120, dispWeight),
            0,
            0,
          ],
          fingers: {
            thumb: {
              curl: THREE.MathUtils.lerp(-4, -10, dispWeight),
              spread: -3,
              twist: 0,
              distalBias: 1.0,
            },
            index: {
              curl: THREE.MathUtils.lerp(12, -5 + landRecoil * 120, dispWeight),
              spread: 0.1,
              twist: 0,
              distalBias: 1.0,
            },
            middle: {
              curl: THREE.MathUtils.lerp(13, -4 + landRecoil * 140, dispWeight),
              spread: 0,
              twist: 0,
              distalBias: 1.0,
            },
            ring: {
              curl: THREE.MathUtils.lerp(13, -4 + landRecoil * 120, dispWeight),
              spread: -0.1,
              twist: 0,
              distalBias: 1.0,
            },
            pinky: {
              curl: THREE.MathUtils.lerp(11, -5, dispWeight),
              spread: -0.2,
              twist: 0,
              distalBias: 1.0,
            },
          },
        },
        contactCenterHintOffset: [
          THREE.MathUtils.lerp(-0.01, 0.38, dispWeight),
          THREE.MathUtils.lerp(0.015, 0.06, dispWeight),
          THREE.MathUtils.lerp(-0.059, -0.56, dispWeight),
        ],
      };
    }

    case "rubPalms": {
      return evaluateRubPalmsPose(progress);
    }

    case "rubBacksOfHands": {
      return evaluateBacksPose(progress);
    }

    case "interlaceFingers": {
      return evaluateInterlacePose(progress);
    }

    case "rubBacksOfFingers": {
      return evaluateLateContact("knuckles", progress);
    }

    case "rubThumbs": {
      return evaluateLateContact("thumbs", progress);
    }

    case "rubFingertips": {
      return evaluateLateContact("tips", progress);
    }
    case "rinseHands": {
      // 13a. Rinse hands: return to a relaxed, open position beneath the water stream
      const rinseWave = Math.sin(elapsed * 4.8);
      const rinseCos = Math.cos(elapsed * 4.8);
      return {
        right: {
          palmOffset: [
            -0.013 + Math.abs(rinseCos) * 0.012,
            -0.006 + rinseWave * 0.01,
            -0.075 + rinseWave * 0.018,
          ],
          palmEulerDeg: [14 + rinseWave * 3, -5, -42 + rinseWave * 16],
          wristEulerDeg: [rinseWave * 4.5, 0, rinseCos * 3.5],
          fingers: buildFingerSet(1 + rinseWave * 4, 1.2, elapsed * 5.8, 3.5),
        },
        left: {
          palmOffset: [
            0.013 - Math.abs(rinseCos) * 0.012,
            -0.026 - rinseWave * 0.01,
            -0.05 - rinseWave * 0.018,
          ],
          palmEulerDeg: [12 - rinseWave * 3, 0, 50 + rinseWave * 16],
          wristEulerDeg: [-rinseWave * 4.5, 0, -rinseCos * 3.5],
          fingers: buildFingerSet(1 - rinseWave * 4, 1.2, elapsed * 5.8 + Math.PI, 3.5),
        },
        contactCenterHintOffset: [-0.02, 0, -0.06],
      };
    }

    case "finish": {
      // 13b. Finish: gentle shake off of droplets, settling into a natural relaxed final pose
      const settle = THREE.MathUtils.smoothstep(progress, 0.0, 0.65);
      const dryShake = (1 - settle) * Math.sin(elapsed * 12.0) * 5;
      return {
        right: {
          palmOffset: [
            THREE.MathUtils.lerp(0.022, 0.05, settle),
            THREE.MathUtils.lerp(-0.01, -0.04 + breathe * 0.005, settle),
            THREE.MathUtils.lerp(-0.05, 0.12, settle),
          ],
          palmEulerDeg: [10 + dryShake * 0.3, -4, 16],
          wristEulerDeg: [dryShake, 0, 0],
          fingers: buildFingerSet(2 + dryShake * 0.4, 0.3, elapsed * 2.2, 1.2),
        },
        left: {
          palmOffset: [
            THREE.MathUtils.lerp(-0.022, -0.05, settle),
            THREE.MathUtils.lerp(-0.01, -0.04 + breathe * 0.005, settle),
            THREE.MathUtils.lerp(-0.03, 0.12, settle),
          ],
          palmEulerDeg: [8 - dryShake * 0.3, 2, -8],
          wristEulerDeg: [-dryShake, 0, 0],
          fingers: buildFingerSet(2 - dryShake * 0.4, 0.3, elapsed * 2.2 + 1.0, 1.2),
        },
        contactCenterHintOffset: [0, -0.04, 0.1],
      };
    }
  }
}

export function evaluateStagePose(
  stageId: HandwashingStageId,
  progress: number,
  elapsed: number,
  anchors: HandPoseSceneAnchors,
): StagePoseEvaluation {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const pose = evaluateBaseStagePose(stageId, p, elapsed, anchors);
  if (stageId === "moveHandsToFaucet") {
    // Settle the free opening gesture before the hands converge under water.
    const opening = Math.sin(Math.PI * p) ** 2 * (1 - smooth01((p - .18) / .14));
    freeFingerFollow(pose, p * Math.PI * 2, opening, 2.4);
  } else if (stageId === "wetHands") {
    const weight = smooth01(p / .13) * smooth01((1 - p) / .15);
    freeFingerFollow(pose, p * Math.PI * 3 + .35, weight * .4, 1);
  } else if (stageId === "dispenseSoap") {
    // Keep pump contact exact. Flex only on the free reach/return arcs and
    // settle before joining the calibrated palm-rubbing pose.
    const reach = p < .28 ? p / .28 : -1;
    const returning = p > .68 && p < .94 ? (p - .68) / .26 : -1;
    const phase = reach >= 0 ? reach : returning;
    if (phase >= 0) freeFingerFollow(pose, phase * Math.PI * 2, Math.sin(Math.PI * phase) ** 2, 2.2);
  }
  return pose;
}
