// Live-tunable offsets for the "rub palms" stage (right/left hand base pose and finger joints).

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
