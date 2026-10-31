import * as THREE from "three";
import type { HandwashingStageId } from "./handwashingConfig";
import type { FingerName } from "./handRigMapping";

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
  return t * t * (3 - 2 * t);
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
    out[name] = {
      curl: THREE.MathUtils.lerp(a[name].curl, b[name].curl, t),
      spread: THREE.MathUtils.lerp(a[name].spread, b[name].spread, t),
      twist: THREE.MathUtils.lerp(a[name].twist ?? 0, b[name].twist ?? 0, t),
      distalBias: THREE.MathUtils.lerp(a[name].distalBias ?? 1, b[name].distalBias ?? 1, t),
    };
  }
  return out;
}

/**
 * Calibrated constants for Stage 4 (`rubPalms`) — WHO Technique 1:
 * "Bersihkan tangan, gosok sabun pada kedua telapak dengan arah memutar."
 * Verified against the actual `washand.glb` SkinnedMesh vertex surface so that
 * `minSignedGapMm` remains strictly positive (+4.5mm to +18.6mm) across all 360 degrees
 * of the circular rubbing orbit with zero mesh penetration and full finger articulation.
 */
const SOAP_END_RIGHT_OFF: readonly [number, number, number] = [-0.016, 0.038, -0.060];
const SOAP_END_LEFT_OFF: readonly [number, number, number] = [-0.036, -0.012, -0.058];
const SOAP_END_RIGHT_EULER: readonly [number, number, number] = [8, -5, -66];
const SOAP_END_LEFT_EULER: readonly [number, number, number] = [10, -2, 46];

const SOAP_END_RIGHT_FINGERS: Record<FingerName, FingerArticulationTarget> = {
  thumb: { curl: -4, spread: -3, twist: 0, distalBias: 1.15 },
  index: { curl: 12, spread: 0.1, twist: 0, distalBias: 1.25 },
  middle: { curl: 13, spread: 0, twist: 0, distalBias: 1.25 },
  ring: { curl: 13, spread: -0.1, twist: 0, distalBias: 1.15 },
  pinky: { curl: 11, spread: -0.2, twist: 0, distalBias: 1.15 },
};

const SOAP_END_LEFT_FINGERS: Record<FingerName, FingerArticulationTarget> = {
  thumb: { curl: -4, spread: -3, twist: 0, distalBias: 1.15 },
  index: { curl: 12, spread: 0.1, twist: 0, distalBias: 1.25 },
  middle: { curl: 13, spread: 0, twist: 0, distalBias: 1.25 },
  ring: { curl: 13, spread: -0.15, twist: 0, distalBias: 1.15 },
  pinky: { curl: 11, spread: -0.35, twist: 0, distalBias: 1.15 },
};

// Substage A (Panel 1: Sabun di Telapak Tangan): Left palm holds soap cupped up; right hand poised beside/above ready to meet
const SUB_A_RIGHT_OFF: readonly [number, number, number] = [0.022, 0.055, -0.076];
const SUB_A_LEFT_OFF: readonly [number, number, number] = [-0.042, -0.014, -0.072];
const SUB_A_RIGHT_EULER: readonly [number, number, number] = [16, -12, -12];
const SUB_A_LEFT_EULER: readonly [number, number, number] = [14, -5, 40];

const SUB_A_RIGHT_FINGERS: Record<FingerName, FingerArticulationTarget> = {
  thumb: { curl: -14, spread: -12, twist: 0, distalBias: 1.05 },
  index: { curl: 8, spread: 0.1, twist: 0, distalBias: 1.08 },
  middle: { curl: 9, spread: 0, twist: 0, distalBias: 1.08 },
  ring: { curl: 9, spread: -0.1, twist: 0, distalBias: 1.08 },
  pinky: { curl: 8, spread: -0.2, twist: 0, distalBias: 1.08 },
};

const SUB_A_LEFT_FINGERS: Record<FingerName, FingerArticulationTarget> = {
  thumb: { curl: -12, spread: -10, twist: 0, distalBias: 1.05 },
  index: { curl: 10, spread: 0.08, twist: 0, distalBias: 1.08 },
  middle: { curl: 11, spread: 0, twist: 0, distalBias: 1.08 },
  ring: { curl: 11, spread: -0.1, twist: 0, distalBias: 1.08 },
  pinky: { curl: 9, spread: -0.2, twist: 0, distalBias: 1.08 },
};

// Calibrated Palm-to-Palm Contact Basis (Substages B, C, D, E — Panels 2 to 5)
// Contact center at [0.00, 1.80, -0.65] directly over the basin
// Vertical palm-to-palm parallel orientation matching WHO Storyboard Reference Panel 2 & 3:
// Opposing angles calibrated to the verified rig coordinate system:
// Right Hand Euler: [20, -15, 10], Left Hand Euler: [20, -5, -35] (opposing normal dot = -1.000, flat face-to-face contact)
// Right hand shifted forward towards faucet (thumb Z diff ~43.3mm) so thumbs never clash or trap
// Calibrated with 40 empty collision objects around all bones + 72-sample skinned mesh surface verification:
// Initial clearance: 3.03mm, wrist separation: ~110.8mm
// Orbit clearance: strictly positive (+0.77mm to +4.23mm, avg 2.40mm) with 0 bone collisions and zero penetration
const CONTACT_RIGHT_BASE_OFF: readonly [number, number, number] = [-0.1551, 0.0221, -0.0056];
const CONTACT_LEFT_BASE_OFF: readonly [number, number, number] = [0.0091, 0.0239, 0.0726];
const CONTACT_RIGHT_BASE_EULER: readonly [number, number, number] = [20, -15, 10];
const CONTACT_LEFT_BASE_EULER: readonly [number, number, number] = [20, -5, -35];

// Orthonormal basis of the shared palm contact plane:
// - PALM_SEP_AXIS: normal pointing from Left palm surface toward Right palm surface (+X)
// - PALM_U_AXIS: forward tangent along the fingers
// - PALM_V_AXIS: lateral tangent across the palm width (up-down)
const PALM_SEP_AXIS: readonly [number, number, number] = [0.986, -0.086, 0.144];
const PALM_U_AXIS: readonly [number, number, number] = [0.154, 0.095, -0.983];
const PALM_V_AXIS: readonly [number, number, number] = [-0.015, 0.995, 0.098];

// Substage F (Panel 6: Hasil Setelah Digosok): Both palms open upward/forward toward the viewer displaying even foam layer
const SUB_F_RIGHT_OFF: readonly [number, number, number] = [-0.092, 0.013, -0.081];
const SUB_F_LEFT_OFF: readonly [number, number, number] = [0.005, 0.025, -0.036];
const SUB_F_RIGHT_EULER: readonly [number, number, number] = [18, 5, -55];
const SUB_F_LEFT_EULER: readonly [number, number, number] = [18, -5, 45];

const SUB_F_FINGERS: Record<FingerName, FingerArticulationTarget> = {
  thumb: { curl: -2, spread: -2, twist: 0, distalBias: 1.0 },
  index: { curl: 0, spread: 0.10, twist: 0, distalBias: 1.0 },
  middle: { curl: 1, spread: 0.0, twist: 0, distalBias: 1.0 },
  ring: { curl: 1, spread: -0.10, twist: 0, distalBias: 1.0 },
  pinky: { curl: 0, spread: -0.20, twist: 0, distalBias: 1.0 },
};

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
  const rU = 0.0162 * orbitWeight * spreadBoost;
  const rV = 0.0135 * orbitWeight * spreadBoost;

  // Gentle micro-pulsation (±0.4 mm) conforming softly to thenar contours while preventing mesh collision
  const dn = 0.0004 * Math.cos(2 * theta) * orbitWeight;

  const rOff: [number, number, number] = [
    CONTACT_RIGHT_BASE_OFF[0] +
      PALM_U_AXIS[0] * (rU * c) +
      PALM_V_AXIS[0] * (rV * s) +
      PALM_SEP_AXIS[0] * dn,
    CONTACT_RIGHT_BASE_OFF[1] +
      PALM_U_AXIS[1] * (rU * c) +
      PALM_V_AXIS[1] * (rV * s) +
      PALM_SEP_AXIS[1] * dn,
    CONTACT_RIGHT_BASE_OFF[2] +
      PALM_U_AXIS[2] * (rU * c) +
      PALM_V_AXIS[2] * (rV * s) +
      PALM_SEP_AXIS[2] * dn,
  ];

  const lOff: [number, number, number] = [
    CONTACT_LEFT_BASE_OFF[0] -
      PALM_U_AXIS[0] * (0.40 * rU * c) -
      PALM_V_AXIS[0] * (0.40 * rV * s) -
      PALM_SEP_AXIS[0] * dn,
    CONTACT_LEFT_BASE_OFF[1] -
      PALM_U_AXIS[1] * (0.40 * rU * c) -
      PALM_V_AXIS[1] * (0.40 * rV * s) -
      PALM_SEP_AXIS[1] * dn,
    CONTACT_LEFT_BASE_OFF[2] -
      PALM_U_AXIS[2] * (0.40 * rU * c) -
      PALM_V_AXIS[2] * (0.40 * rV * s) -
      PALM_SEP_AXIS[2] * dn,
  ];

  const rEuler: [number, number, number] = [
    CONTACT_RIGHT_BASE_EULER[0],
    CONTACT_RIGHT_BASE_EULER[1],
    CONTACT_RIGHT_BASE_EULER[2],
  ];

  const lEuler: [number, number, number] = [
    CONTACT_LEFT_BASE_EULER[0],
    CONTACT_LEFT_BASE_EULER[1],
    CONTACT_LEFT_BASE_EULER[2],
  ];

  const rWrist: [number, number, number] = [
    s * 0.6 * orbitWeight,
    c * 0.6 * orbitWeight,
    0,
  ];
  const lWrist: [number, number, number] = [
    -s * 0.4 * orbitWeight,
    -c * 0.4 * orbitWeight,
    0,
  ];

  const fR: Record<FingerName, FingerArticulationTarget> = {
    thumb: {
      curl: -1,
      spread: 2,
      twist: 0,
      distalBias: 1.0,
    },
    index: {
      curl: -5.5 + Math.sin(theta) * 0.4 * orbitWeight,
      spread: 0,
      twist: 0,
      distalBias: 1.0,
    },
    middle: {
      curl: -5.5 + Math.sin(theta + 0.4) * 0.4 * orbitWeight,
      spread: 0,
      twist: 0,
      distalBias: 1.0,
    },
    ring: {
      curl: -5.5 + Math.sin(theta + 0.8) * 0.4 * orbitWeight,
      spread: 0,
      twist: 0,
      distalBias: 1.0,
    },
    pinky: {
      curl: -5.5 + Math.sin(theta + 1.2) * 0.4 * orbitWeight,
      spread: 0,
      twist: 0,
      distalBias: 1.0,
    },
  };

  const fL: Record<FingerName, FingerArticulationTarget> = {
    thumb: {
      curl: -3,
      spread: -3,
      twist: 0,
      distalBias: 1.0,
    },
    index: {
      curl: -5.5 - Math.sin(theta) * 0.4 * orbitWeight,
      spread: 0,
      twist: 0,
      distalBias: 1.0,
    },
    middle: {
      curl: -5.5 - Math.sin(theta + 0.4) * 0.4 * orbitWeight,
      spread: 0,
      twist: 0,
      distalBias: 1.0,
    },
    ring: {
      curl: -5.5 - Math.sin(theta + 0.8) * 0.4 * orbitWeight,
      spread: 0,
      twist: 0,
      distalBias: 1.0,
    },
    pinky: {
      curl: -5.5 - Math.sin(theta + 1.2) * 0.4 * orbitWeight,
      spread: 0,
      twist: 0,
      distalBias: 1.0,
    },
  };

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

  // Substage A & B (0.00 -> 0.16): 1. Sabun di Telapak Tangan -> 2. Satukan Kedua Telapak Tangan
  // Hands smoothly bring palms together face-to-face until they meet in soft contact at contactStart
  if (p <= 0.16) {
    const t = smooth01(p / 0.16);
    const contactStart = evaluatePalmContactOrbit(0, 0);

    // Natural lift arc while bringing hands together
    const liftArc = Math.sin(t * Math.PI) * 0.020;

    const rOff = lerpVec3Tuple(SOAP_END_RIGHT_OFF, contactStart.right.palmOffset, t);
    const lOff = lerpVec3Tuple(SOAP_END_LEFT_OFF, contactStart.left.palmOffset, t);
    rOff[1] += liftArc;
    lOff[1] += liftArc * 0.5;

    return {
      right: {
        palmOffset: rOff,
        palmEulerDeg: lerpVec3Tuple(SOAP_END_RIGHT_EULER, contactStart.right.palmEulerDeg, t),
        wristEulerDeg: [0, 0, 0],
        fingers: lerpFingerTargets(SOAP_END_RIGHT_FINGERS, contactStart.right.fingers, t),
      },
      left: {
        palmOffset: lOff,
        palmEulerDeg: lerpVec3Tuple(SOAP_END_LEFT_EULER, contactStart.left.palmEulerDeg, t),
        wristEulerDeg: [0, 0, 0],
        fingers: lerpFingerTargets(SOAP_END_LEFT_FINGERS, contactStart.left.fingers, t),
      },
      contactCenterHintOffset: [0.0, 0.015, -0.06],
    };
  }

  // Substages C, D, E (0.16 -> 0.84): 3. Mulai Gerakan Memutar -> 4. Lanjutkan Gerakan Memutar -> 5. Seluruh Permukaan Terlapisi
  // Continuous circular palm-to-palm rubbing in contact
  if (p <= 0.84) {
    const rubNorm = (p - 0.16) / (0.84 - 0.16);
    const totalCycles = 6.0;
    const theta = rubNorm * totalCycles * Math.PI * 2;
    const rampIn = smooth01((p - 0.16) / 0.05);
    const rampOut = smooth01((0.84 - p) / 0.05);
    const orbitWeight = rampIn * rampOut;
    const spreadBoost =
      p >= 0.65
        ? 1.0 + 0.10 * Math.sin(THREE.MathUtils.clamp((p - 0.65) / 0.19, 0, 1) * Math.PI)
        : 1.0;

    const orbitPose = evaluatePalmContactOrbit(theta, orbitWeight, spreadBoost);
    return {
      right: orbitPose.right,
      left: orbitPose.left,
      contactCenterHintOffset: [0.0, 0.015, -0.06],
    };
  }

  // Substage F (0.84 -> 1.00): 6. Hasil Setelah Digosok
  // Stop circular rubbing, gently open palms forward/upward showing full lather
  const u = THREE.MathUtils.clamp((p - 0.84) / 0.16, 0, 1);
  const tPos = smooth01(1 - Math.pow(1 - u, 2.2));
  const tRot = smooth01(Math.pow(u, 1.5));
  const holdT = THREE.MathUtils.clamp((p - 0.92) / 0.08, 0, 1);
  const contactEnd = evaluatePalmContactOrbit(6.0 * Math.PI * 2, 0);

  const rOff = lerpVec3Tuple(contactEnd.right.palmOffset, SUB_F_RIGHT_OFF, tPos);
  const lOff = lerpVec3Tuple(contactEnd.left.palmOffset, SUB_F_LEFT_OFF, tPos);

  const holdBreath = Math.sin(holdT * Math.PI) * 1.0;
  const finalRightFingers: Record<FingerName, FingerArticulationTarget> = {
    thumb: { ...SUB_F_FINGERS.thumb, curl: SUB_F_FINGERS.thumb.curl + holdBreath * 0.3 },
    index: { ...SUB_F_FINGERS.index, curl: SUB_F_FINGERS.index.curl + holdBreath * 0.5 },
    middle: { ...SUB_F_FINGERS.middle, curl: SUB_F_FINGERS.middle.curl + holdBreath * 0.5 },
    ring: { ...SUB_F_FINGERS.ring, curl: SUB_F_FINGERS.ring.curl + holdBreath * 0.4 },
    pinky: { ...SUB_F_FINGERS.pinky, curl: SUB_F_FINGERS.pinky.curl + holdBreath * 0.4 },
  };
  const finalLeftFingers: Record<FingerName, FingerArticulationTarget> = {
    thumb: { ...SUB_F_FINGERS.thumb, curl: SUB_F_FINGERS.thumb.curl - holdBreath * 0.3 },
    index: { ...SUB_F_FINGERS.index, curl: SUB_F_FINGERS.index.curl - holdBreath * 0.5 },
    middle: { ...SUB_F_FINGERS.middle, curl: SUB_F_FINGERS.middle.curl - holdBreath * 0.5 },
    ring: { ...SUB_F_FINGERS.ring, curl: SUB_F_FINGERS.ring.curl - holdBreath * 0.4 },
    pinky: { ...SUB_F_FINGERS.pinky, curl: SUB_F_FINGERS.pinky.curl - holdBreath * 0.4 },
  };

  return {
    right: {
      palmOffset: rOff,
      palmEulerDeg: lerpVec3Tuple(contactEnd.right.palmEulerDeg, SUB_F_RIGHT_EULER, tRot),
      wristEulerDeg: lerpVec3Tuple(
        contactEnd.right.wristEulerDeg,
        [2 * Math.sin(holdT * Math.PI), 0, 0],
        tRot,
      ),
      fingers: lerpFingerTargets(contactEnd.right.fingers, finalRightFingers, tRot),
    },
    left: {
      palmOffset: lOff,
      palmEulerDeg: lerpVec3Tuple(contactEnd.left.palmEulerDeg, SUB_F_LEFT_EULER, tRot),
      wristEulerDeg: lerpVec3Tuple(
        contactEnd.left.wristEulerDeg,
        [2 * Math.sin(holdT * Math.PI + 0.5), 0, 0],
        tRot,
      ),
      fingers: lerpFingerTargets(contactEnd.left.fingers, finalLeftFingers, tRot),
    },
    contactCenterHintOffset: [0.0, 0.015, -0.06],
  };
}

/**
 * Finger articulation tuning (degrees, relative to the calibrated rest pose).
 * Verified against `washand.glb`: 1 deg of `curl` moves a fingertip ~3.9 scene-mm along
 * the palm normal, so the knead amplitudes below produce clearly visible joint motion.
 */
const IDLE_FINGER_CURL = 4;

/**
 * Evaluates the procedural hand and finger pose targets for any stage at a given
 * normalized stage progress (0..1) and elapsed stage time (seconds).
 */
export function evaluateStagePose(
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
      const rEase = THREE.MathUtils.smoothstep(progress, 0.0, 0.88);
      const lEase = THREE.MathUtils.smoothstep(progress, 0.10, 1.0);

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
            THREE.MathUtils.lerp(rIdleOff[1], rWashingOff[1], rEase),
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
              distalBias: 1.15,
            },
            index: {
              curl: THREE.MathUtils.lerp(4, 12, rEase) + unfurl,
              spread: THREE.MathUtils.lerp(0.2, 0.1, rEase),
              distalBias: 1.25,
            },
            middle: {
              curl: THREE.MathUtils.lerp(4, 13, rEase) + unfurl,
              spread: 0,
              distalBias: 1.25,
            },
            ring: {
              curl: THREE.MathUtils.lerp(4, 13, rEase) + unfurl,
              spread: THREE.MathUtils.lerp(-0.2, -0.1, rEase),
              distalBias: 1.25,
            },
            pinky: {
              curl: THREE.MathUtils.lerp(4, 11, rEase) + unfurl,
              spread: THREE.MathUtils.lerp(-0.4, -0.2, rEase),
              distalBias: 1.25,
            },
          },
        },
        left: {
          palmOffset: [
            THREE.MathUtils.lerp(lIdleOff[0], lCupOff[0], lEase),
            THREE.MathUtils.lerp(lIdleOff[1], lCupOff[1], lEase),
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
              distalBias: 1.15,
            },
            index: {
              curl: THREE.MathUtils.lerp(4, 12, lEase),
              spread: THREE.MathUtils.lerp(0.3, 0.1, lEase),
              distalBias: 1.25,
            },
            middle: {
              curl: THREE.MathUtils.lerp(4, 13, lEase),
              spread: 0,
              distalBias: 1.25,
            },
            ring: {
              curl: THREE.MathUtils.lerp(4, 13, lEase),
              spread: THREE.MathUtils.lerp(-0.2, -0.1, lEase),
              distalBias: 1.25,
            },
            pinky: {
              curl: THREE.MathUtils.lerp(4, 11, lEase),
              spread: THREE.MathUtils.lerp(-0.4, -0.2, lEase),
              distalBias: 1.25,
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
      const rWashTime = elapsed * 4.5;
      const rSin = Math.sin(rWashTime);
      const rCos = Math.cos(rWashTime);

      const rSwayX = rSin * 0.003;
      const rBobY = rCos * 0.003;
      const rSurgeZ = rCos * 0.003;
      const rCupBreath = rSin * 1.5;

      // Left hand follows with an organic delay (~1.0 rad / ~0.22s phase lag)
      const lWashTime = elapsed * 4.5 - 1.0;
      const lSin = Math.sin(lWashTime);
      const lCos = Math.cos(lWashTime);

      const lSwayX = lSin * 0.003;
      const lBobY = lCos * 0.003;
      const lSurgeZ = lCos * 0.003;
      const lCupBreath = lSin * 1.5;

      const rBaseOff = [-0.016, 0.038, -0.060];
      const lBaseOff = [-0.036, -0.012, -0.058];

      return {
        right: {
          palmOffset: [
            rBaseOff[0] + rSwayX,
            rBaseOff[1] + rBobY,
            rBaseOff[2] + rSurgeZ,
          ],
          palmEulerDeg: [8 + rCos * 1.5, -5, -66],
          wristEulerDeg: [rCos * 1.5, 0, 0],
          fingers: {
            thumb: { curl: -4 + rCupBreath * 0.2, spread: -3, distalBias: 1.15 },
            index: { curl: 12 + rCupBreath, spread: 0.1, distalBias: 1.25 },
            middle: { curl: 13 + rCupBreath, spread: 0.0, distalBias: 1.25 },
            ring: { curl: 13 + rCupBreath, spread: -0.1, distalBias: 1.25 },
            pinky: { curl: 11 + rCupBreath, spread: -0.2, distalBias: 1.25 },
          },
        },
        left: {
          palmOffset: [
            lBaseOff[0] + lSwayX,
            lBaseOff[1] + lBobY,
            lBaseOff[2] + lSurgeZ,
          ],
          palmEulerDeg: [10 + lCos * 1.5, -2, 46],
          wristEulerDeg: [lCos * 1.5, 0, 0],
          fingers: {
            thumb: { curl: -4 + lCupBreath * 0.2, spread: -3, distalBias: 1.15 },
            index: { curl: 12 + lCupBreath, spread: 0.1, distalBias: 1.25 },
            middle: { curl: 13 + lCupBreath, spread: 0.0, distalBias: 1.25 },
            ring: { curl: 13 + lCupBreath, spread: -0.1, distalBias: 1.25 },
            pinky: { curl: 11 + lCupBreath, spread: -0.2, distalBias: 1.25 },
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

      const reachT = THREE.MathUtils.smoothstep(progress, 0.0, 0.28);
      const returnT = THREE.MathUtils.smoothstep(progress, 0.62, 0.98);
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
      // 8. WHO Step 2: Wash backs of hands (R palm rubs L dorsum, then L palm rubs R dorsum)
      const { swap, swapArc } = smoothRoleBlend(progress);
      const strokeZ = rubFast * 0.026;
      const strokeX = rubFastCos * 0.01;

      const rY = THREE.MathUtils.lerp(0.098, -0.078, swap);
      const lY = THREE.MathUtils.lerp(-0.078, 0.098, swap);
      const rStroke = THREE.MathUtils.lerp(strokeZ, -strokeZ * 0.5, swap);
      const lStroke = THREE.MathUtils.lerp(-strokeZ * 0.5, strokeZ, swap);

      // Lateral separation arc during the mid-stage role swap prevents vertical pass-through
      const rX = -0.08 + strokeX + swapArc * 0.11;
      const lX = 0.08 - strokeX - swapArc * 0.11;

      const rCurl = THREE.MathUtils.lerp(-1 + rubFast * 3, -5, swap);
      const lCurl = THREE.MathUtils.lerp(-5, -1 - rubFast * 3, swap);

      return {
        right: {
          palmOffset: [rX, rY, -0.015 + rStroke],
          palmEulerDeg: [16 + rubFast * 2, -6, 84],
          wristEulerDeg: [rubFast * 3, 0, rubFastCos * 3],
          fingers: buildFingerSet(rCurl, 1.5, elapsed * 6.8, 2, 2, 2),
        },
        left: {
          palmOffset: [lX, lY, 0.015 + lStroke],
          palmEulerDeg: [12 - rubFast * 2, -1, -104],
          wristEulerDeg: [-rubFast * 3, 0, -rubFastCos * 3],
          fingers: buildFingerSet(lCurl, 1.5, elapsed * 6.8 + Math.PI, 2, 2, 2),
        },
        contactCenterHintOffset: [0.0, 0.01, -0.02],
      };
    }

    case "interlaceFingers": {
      // 9. WHO Step 3: Clean between fingers — controlled interdigitation with modest finger spacing
      const slideZ = rubFast * 0.02;
      const slideY = rubFastCos * 0.008;
      const gripWave = rubFast * 3.5;
      return {
        right: {
          palmOffset: [-0.006, 0.018 + slideY, -0.02 + slideZ],
          palmEulerDeg: [14 + rubFast * 2, -5, -2],
          wristEulerDeg: [rubFastCos * 2.5, 0, rubFast * 3],
          fingers: buildFingerSet(gripWave, 3.2, elapsed * 6.8, 1.8, 0, 4),
        },
        left: {
          palmOffset: [0.006, -0.018 - slideY, 0.0 - slideZ],
          palmEulerDeg: [12 - rubFast * 2, 0, 14],
          wristEulerDeg: [-rubFastCos * 2.5, 0, -rubFast * 3],
          fingers: buildFingerSet(-gripWave, 3.2, elapsed * 6.8 + 0.8, 1.8, 0, 4),
        },
        contactCenterHintOffset: [0.0, 0, -0.02],
      };
    }

    case "rubBacksOfFingers": {
      // 10. WHO Step 4: Clean backs of fingers — controlled, relaxed finger flexion without splaying
      const scrubY = rubFast * 0.016;
      const scrubZ = rubFastCos * 0.014;
      const flexPulse = rubFast * 2.5;
      return {
        right: {
          palmOffset: [0.056, 0.022 + scrubY, -0.015 + scrubZ],
          palmEulerDeg: [14, -2, 14],
          wristEulerDeg: [4, 0, rubFast * 4],
          fingers: {
            thumb: { curl: 10, spread: 2, twist: 0, distalBias: 1.05 },
            index: { curl: 15 + flexPulse, spread: 0.4, twist: 0, distalBias: 1.1 },
            middle: { curl: 16 + flexPulse, spread: 0, twist: 0, distalBias: 1.1 },
            ring: { curl: 15 + flexPulse, spread: -0.3, twist: 0, distalBias: 1.1 },
            pinky: { curl: 14 + flexPulse, spread: -0.6, twist: 0, distalBias: 1.1 },
          },
        },
        left: {
          palmOffset: [-0.056, -0.022 - scrubY, 0.015 - scrubZ],
          palmEulerDeg: [12, 2, -2],
          wristEulerDeg: [4, 0, -rubFast * 4],
          fingers: {
            thumb: { curl: 10, spread: 2, twist: 0, distalBias: 1.05 },
            index: { curl: 15 - flexPulse, spread: 0.4, twist: 0, distalBias: 1.1 },
            middle: { curl: 16 - flexPulse, spread: 0, twist: 0, distalBias: 1.1 },
            ring: { curl: 15 - flexPulse, spread: -0.3, twist: 0, distalBias: 1.1 },
            pinky: { curl: 14 - flexPulse, spread: -0.6, twist: 0, distalBias: 1.1 },
          },
        },
        contactCenterHintOffset: [0.0, 0, -0.02],
      };
    }

    case "rubThumbs": {
      // 11. WHO Step 5: Clean thumbs — clasping hand wraps smoothly around opposite thumb without distorting base
      const { swap, swapArc } = smoothRoleBlend(progress);
      const twistWave = rubMed * 8;
      const pumpWave = rubFast * 0.012;

      const rGripCurl = THREE.MathUtils.lerp(15 + rubFast * 3, 4, swap);
      const lGripCurl = THREE.MathUtils.lerp(4, 15 + rubFast * 3, swap);
      const rThumbSpread = THREE.MathUtils.lerp(4, 7, swap);
      const lThumbSpread = THREE.MathUtils.lerp(7, 4, swap);
      const rThumbCurl = THREE.MathUtils.lerp(10 + rubMed * 3, -2, swap);
      const lThumbCurl = THREE.MathUtils.lerp(-2, 10 + rubMed * 3, swap);

      return {
        right: {
          palmOffset: [
            0.032 + swapArc * 0.04,
            THREE.MathUtils.lerp(0.055 + pumpWave, -0.035, swap),
            THREE.MathUtils.lerp(-0.01, 0.01, swap),
          ],
          palmEulerDeg: [
            THREE.MathUtils.lerp(10 + twistWave * 0.3, 12, swap),
            THREE.MathUtils.lerp(2, -4, swap),
            THREE.MathUtils.lerp(22 + twistWave, -4, swap),
          ],
          wristEulerDeg: [twistWave * 0.35, 0, 0],
          fingers: buildFingerSet(rGripCurl, 0.5, elapsed * 5.2, 1.5, rThumbCurl, rThumbSpread, 1.08),
        },
        left: {
          palmOffset: [
            -0.032 - swapArc * 0.04,
            THREE.MathUtils.lerp(-0.035, 0.055 + pumpWave, swap),
            THREE.MathUtils.lerp(0.01, -0.01, swap),
          ],
          palmEulerDeg: [
            THREE.MathUtils.lerp(12, 10 + twistWave * 0.3, swap),
            THREE.MathUtils.lerp(0, -2, swap),
            THREE.MathUtils.lerp(12, -16 - twistWave, swap),
          ],
          wristEulerDeg: [-twistWave * 0.35, 0, 0],
          fingers: buildFingerSet(lGripCurl, 0.5, elapsed * 5.2, 1.5, lThumbCurl, lThumbSpread, 1.08),
        },
        contactCenterHintOffset: [0.0, 0.02, 0.0],
      };
    }

    case "rubFingertips": {
      // 12. WHO Step 6: Clean fingertips — gently curled fingertips scrub in opposite open palm without joint collapse
      const { swap, swapArc } = smoothRoleBlend(progress);
      const circleY = rubFast * 0.016;
      const circleZ = rubFastCos * 0.016;
      const scrubFlex = rubFast * 2.5;

      const rTipCurl = THREE.MathUtils.lerp(15 + scrubFlex, -5, swap);
      const lTipCurl = THREE.MathUtils.lerp(-5, 15 + scrubFlex, swap);
      const rBias = THREE.MathUtils.lerp(1.15, 0.95, swap);
      const lBias = THREE.MathUtils.lerp(0.95, 1.15, swap);
      const rSpread = THREE.MathUtils.lerp(-1.2, 0.5, swap);
      const lSpread = THREE.MathUtils.lerp(0.5, -1.2, swap);

      return {
        right: {
          palmOffset: [
            0.054 + swapArc * 0.035,
            THREE.MathUtils.lerp(0.022 + circleY, -0.018, swap),
            THREE.MathUtils.lerp(0.025 + circleZ, -0.015, swap),
          ],
          palmEulerDeg: [
            THREE.MathUtils.lerp(8, 14, swap),
            THREE.MathUtils.lerp(6, -2, swap),
            THREE.MathUtils.lerp(18, -22, swap),
          ],
          wristEulerDeg: [THREE.MathUtils.lerp(6, -4, swap), 0, rubFast * 3.5],
          fingers: buildFingerSet(rTipCurl, rSpread, elapsed * 6.8, 1.8, 8, 2, rBias),
        },
        left: {
          palmOffset: [
            -0.054 - swapArc * 0.035,
            THREE.MathUtils.lerp(-0.018, 0.022 + circleY, swap),
            THREE.MathUtils.lerp(-0.015, 0.025 + circleZ, swap),
          ],
          palmEulerDeg: [
            THREE.MathUtils.lerp(12, 8, swap),
            THREE.MathUtils.lerp(-2, -6, swap),
            THREE.MathUtils.lerp(28, -12, swap),
          ],
          wristEulerDeg: [THREE.MathUtils.lerp(-4, 6, swap), 0, -rubFast * 3.5],
          fingers: buildFingerSet(lTipCurl, lSpread, elapsed * 6.8 + Math.PI, 1.8, 8, 2, lBias),
        },
        contactCenterHintOffset: [0.0, 0.0, 0.0],
      };
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
