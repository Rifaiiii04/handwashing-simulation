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

/**
 * Finger articulation tuning (degrees, relative to the calibrated rest pose).
 * Verified against `washand.glb`: 1 deg of `curl` moves a fingertip ~3.9 scene-mm along
 * the palm normal, so the knead amplitudes below produce clearly visible joint motion.
 */
const IDLE_FINGER_CURL = 4;
const WASH_FINGER_CURL = -7.6;
const WASH_THUMB_CURL = -14;
const WASH_THUMB_SPREAD = -4;
const WET_FINGER_KNEAD = 5;
const WET_WRIST_ROCK = 1.2;
const RUB_OMEGA = 5.2;
const RUB_FINGER_KNEAD = 6.5;
const RUB_WRIST_ROCK = 1.2;

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
      // Prepare for soap: R hand reaches cleanly onto pump cap; L hand cups beneath nozzle outlet
      return {
        right: {
          palmOffset: [0.33, 0.215, -0.495],
          palmEulerDeg: [16, -6, 68],
          wristEulerDeg: [-2, 0, 0],
          fingers: {
            thumb: { curl: -6, spread: -2, twist: 0 },
            index: { curl: 3, spread: 0.3, twist: 0 },
            middle: { curl: 4, spread: 0, twist: 0 },
            ring: { curl: 7, spread: -0.3, twist: 0 },
            pinky: { curl: 9, spread: -0.6, twist: 0 },
          },
        },
        left: {
          palmOffset: [0.435, -0.095, -0.515],
          palmEulerDeg: [10, -2, 28],
          wristEulerDeg: [2, 0, 0],
          fingers: {
            thumb: { curl: -6, spread: -2, twist: 0 },
            index: { curl: 2, spread: 0.3, twist: 0 },
            middle: { curl: 3, spread: 0, twist: 0 },
            ring: { curl: 3, spread: -0.2, twist: 0 },
            pinky: { curl: 2, spread: -0.4, twist: 0 },
          },
        },
        contactCenterHintOffset: [0.38, 0.02, -0.48],
      };
    }

    case "dispenseSoap": {
      // Stage 3 — Apply Soap (Pakai Sabun dari Dispenser):
      // 1. Phase 1 (0.00 -> 0.26): Reach in from washing position with organic arc trajectories
      //    - Right hand lifts and reaches onto the pump plunger cap
      //    - Left hand cups (menengadah) and positions directly under the nozzle outlet
      // 2. Phase 2 (0.26 -> 0.58): Pump press & soap delivery
      //    - Right hand firmly presses pump head down (pressDepth); wrist complies
      //    - Soap drops into left palm; left palm exhibits a subtle, springy cushioning recoil
      //    - Pump head springs back up smoothly
      // 3. Phase 3 (0.58 -> 1.00): Return to washing position under faucet
      //    - Left hand glides back to center holding the dispensed soap dollop safely in palm
      //    - Right hand glides back hovering above ready for the next wash cycle
      //    - Arrives seamlessly at [rWashOff, lWashOff] with 0% snap or pop on stage transition!

      const reachT = THREE.MathUtils.smoothstep(progress, 0.0, 0.26);
      const returnT = THREE.MathUtils.smoothstep(progress, 0.62, 0.98);

      // Arc curves for natural, lifelike arm elevation during reach & return
      const rReachArc = Math.sin(reachT * Math.PI) * 0.035;
      const lReachArc = Math.sin(reachT * Math.PI) * 0.020;
      const rReturnArc = Math.sin(returnT * Math.PI) * 0.028;
      const lReturnArc = Math.sin(returnT * Math.PI) * 0.016;

      // Combined weight and arc height
      const dispWeight = reachT * (1.0 - returnT);
      const rArcY = rReachArc * (1.0 - returnT) + rReturnArc * reachT;
      const lArcY = lReachArc * (1.0 - returnT) + lReturnArc * reachT;

      // Pump press displacement and finger flexion on the cap
      const pressDepth = anchors.pumpStroke * anchors.pumpPressProgress;
      const pressFlex = anchors.pumpPressProgress * 15.0;

      // Left palm cushioning bounce when soap lands (around progress 0.50..0.62)
      const landNorm = THREE.MathUtils.clamp((progress - 0.50) / 0.12, 0, 1);
      const landRecoil = Math.sin(landNorm * Math.PI) * 0.007;

      // Rest / washing offsets (from Stage 2 wetHands)
      const rWashOff: [number, number, number] = [-0.016, 0.038, -0.060];
      const lWashOff: [number, number, number] = [-0.036, -0.012, -0.058];
      const rWashEuler: [number, number, number] = [8, -5, -66];
      const lWashEuler: [number, number, number] = [10, -2, 46];

      // Exact aligned target offsets on dispenser pump cap and nozzle outlet
      const rDispOff: [number, number, number] = [0.273, 0.130, -0.732];
      const lDispOff: [number, number, number] = [0.364, 0.056, -0.524];
      const rDispEuler: [number, number, number] = [18, -8, 64];
      const lDispEuler: [number, number, number] = [12, -4, 38];

      return {
        right: {
          palmOffset: [
            THREE.MathUtils.lerp(rWashOff[0], rDispOff[0], dispWeight),
            THREE.MathUtils.lerp(rWashOff[1], rDispOff[1] - pressDepth, dispWeight) + rArcY,
            THREE.MathUtils.lerp(rWashOff[2], rDispOff[2], dispWeight),
          ],
          palmEulerDeg: [
            THREE.MathUtils.lerp(rWashEuler[0], rDispEuler[0] - anchors.pumpPressProgress * 4, dispWeight),
            THREE.MathUtils.lerp(rWashEuler[1], rDispEuler[1], dispWeight),
            THREE.MathUtils.lerp(rWashEuler[2], rDispEuler[2], dispWeight),
          ],
          wristEulerDeg: [
            THREE.MathUtils.lerp(0, -2 + anchors.pumpPressProgress * 6, dispWeight),
            0,
            0,
          ],
          fingers: {
            thumb: {
              curl: THREE.MathUtils.lerp(-4, -6 + pressFlex * 0.25, dispWeight),
              spread: THREE.MathUtils.lerp(-3, -2, dispWeight),
              twist: 0,
              distalBias: 1.15,
            },
            index: {
              curl: THREE.MathUtils.lerp(12, 6 + pressFlex, dispWeight),
              spread: THREE.MathUtils.lerp(0.1, 0.25, dispWeight),
              twist: 0,
              distalBias: 1.25,
            },
            middle: {
              curl: THREE.MathUtils.lerp(13, 7 + pressFlex, dispWeight),
              spread: 0,
              twist: 0,
              distalBias: 1.25,
            },
            ring: {
              curl: THREE.MathUtils.lerp(13, 8 + pressFlex * 0.7, dispWeight),
              spread: THREE.MathUtils.lerp(-0.1, -0.25, dispWeight),
              twist: 0,
              distalBias: 1.15,
            },
            pinky: {
              curl: THREE.MathUtils.lerp(11, 9 + pressFlex * 0.6, dispWeight),
              spread: THREE.MathUtils.lerp(-0.2, -0.5, dispWeight),
              twist: 0,
              distalBias: 1.15,
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
            THREE.MathUtils.lerp(0, 3 + landRecoil * 180, dispWeight),
            0,
            0,
          ],
          fingers: {
            thumb: {
              curl: THREE.MathUtils.lerp(-4, -6, dispWeight),
              spread: THREE.MathUtils.lerp(-3, -2, dispWeight),
              twist: 0,
              distalBias: 1.15,
            },
            index: {
              curl: THREE.MathUtils.lerp(12, 14, dispWeight),
              spread: THREE.MathUtils.lerp(0.1, 0.25, dispWeight),
              twist: 0,
              distalBias: 1.15,
            },
            middle: {
              curl: THREE.MathUtils.lerp(13, 15, dispWeight),
              spread: 0,
              twist: 0,
              distalBias: 1.15,
            },
            ring: {
              curl: THREE.MathUtils.lerp(13, 15, dispWeight),
              spread: -0.15,
              twist: 0,
              distalBias: 1.15,
            },
            pinky: {
              curl: THREE.MathUtils.lerp(11, 13, dispWeight),
              spread: -0.35,
              twist: 0,
              distalBias: 1.15,
            },
          },
        },
        contactCenterHintOffset: [
          THREE.MathUtils.lerp(-0.008, 0.32, dispWeight),
          THREE.MathUtils.lerp(0.013, 0.08, dispWeight),
          THREE.MathUtils.lerp(-0.059, -0.62, dispWeight),
        ],
      };
    }

    case "rubPalms": {
      // Stage 4 (WHO Step 1 — Rub palms in circular motion, based on Gambar 3 reference):
      // The hands form a crossed diagonal V-shape / chevron (NOT parallel vertical slabs):
      // - Left hand (underneath): cupped supinated palm, wrist originating from lower-left,
      //   pointing forward-right, palm facing up (+Y) and slightly back.
      // - Right hand (on top): pronated palm, wrist originating from lower-right,
      //   pointing forward-left, palm facing down (-Y) flat onto the left palm.
      // - Wrists are separated by >115mm (no wrist clumping / 'dempet').
      // - The right hand glides in a smooth rhythmic circular orbit over the left palm.
      // - Stable gap maintained at 3.8mm - 10.4mm throughout the full 360-degree cycle (no mesh clipping).
      const rubOmega = 4.8;
      const theta = elapsed * rubOmega;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      // Smooth circular orbit in the contact plane
      const rDx = cosTheta * 0.015;
      const rDy = sinTheta * 0.014;
      const rDz = cosTheta * 0.018;

      // Subtle organic wrist compliance
      const wristPitch = sinTheta * 1.5;
      const wristYaw = cosTheta * 1.5;

      // Base offsets for crossed chevron contact
      const rBaseOff = [-0.170, 0.005, -0.070];
      const lBaseOff = [0.120, 0.020, -0.050];

      return {
        right: {
          palmOffset: [rBaseOff[0] + rDx, rBaseOff[1] + rDy, rBaseOff[2] + rDz],
          palmEulerDeg: [15, -25, 95],
          wristEulerDeg: [wristPitch, 0, wristYaw],
          fingers: {
            thumb: { curl: -8, spread: -4, twist: 0, distalBias: 1.0 },
            index: { curl: 4 + sinTheta * 3.0, spread: 0.15, twist: 0, distalBias: 1.0 },
            middle: { curl: 4 + sinTheta * 3.0, spread: 0.0, twist: 0, distalBias: 1.0 },
            ring: { curl: 4 + sinTheta * 3.0, spread: -0.15, twist: 0, distalBias: 1.0 },
            pinky: { curl: 4 + sinTheta * 3.0, spread: -0.3, twist: 0, distalBias: 1.0 },
          },
        },
        left: {
          palmOffset: [
            lBaseOff[0] - rDx * 0.35,
            lBaseOff[1] - rDy * 0.35,
            lBaseOff[2] - rDz * 0.35,
          ],
          palmEulerDeg: [12, -30, 55],
          wristEulerDeg: [-wristPitch * 0.5, 0, -wristYaw * 0.5],
          fingers: {
            thumb: { curl: -8, spread: -5, twist: 0, distalBias: 1.0 },
            index: { curl: 4 - sinTheta * 2.0, spread: 0.2, twist: 0, distalBias: 1.0 },
            middle: { curl: 4 - sinTheta * 2.0, spread: 0.0, twist: 0, distalBias: 1.0 },
            ring: { curl: 4 - sinTheta * 2.0, spread: -0.15, twist: 0, distalBias: 1.0 },
            pinky: { curl: 4 - sinTheta * 2.0, spread: -0.3, twist: 0, distalBias: 1.0 },
          },
        },
        contactCenterHintOffset: [0.0, 0.01, -0.06],
      };
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
