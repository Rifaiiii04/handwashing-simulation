import * as THREE from "three";
import {
  discoverAndMapHandPairRig,
  FINGER_NAMES,
  type MappedHandPairRig,
  type MappedHandRig,
} from "./handRigMapping";
import type { HandPoseTarget, StagePoseEvaluation } from "./handwashingPoses";

const DEG2RAD = Math.PI / 180;
const scratchEuler = new THREE.Euler();
const scratchDeltaQuat = new THREE.Quaternion();
const scratchTargetQuat = new THREE.Quaternion();
const scratchPivotOffset = new THREE.Vector3();
const scratchTargetPalm = new THREE.Vector3();
const scratchKnuckleWorld = new THREE.Vector3();
const scratchTipWorld = new THREE.Vector3();
const scratchWristWorld = new THREE.Vector3();
const scratchIndexKnuckleWorld = new THREE.Vector3();
const scratchPinkyKnuckleWorld = new THREE.Vector3();
const scratchRadialVec = new THREE.Vector3();

export class HandAnimationController {
  private rig: MappedHandPairRig | null = null;
  private boundScene: THREE.Object3D | null = null;

  bindScene(scene: THREE.Object3D | null | undefined, enableDiagnostics = false): boolean {
    if (!scene) return false;
    if (
      this.rig &&
      this.boundScene === scene &&
      this.rig.right.armature.parent &&
      this.rig.left.armature.parent
    ) {
      return true;
    }

    const mapped = discoverAndMapHandPairRig(scene, enableDiagnostics);
    if (!mapped) return false;

    this.rig = mapped;
    this.boundScene = scene;
    return true;
  }

  getRig(): MappedHandPairRig | null {
    return this.rig;
  }

  hasValidSkeleton(): boolean {
    return Boolean(this.rig?.hasValidSkeleton);
  }

  /**
   * Restores both hands and all 40 skeletal bones to their calibrated anatomical rest transforms.
   */
  resetToRestPose(): void {
    if (!this.rig) return;

    for (const hand of [this.rig.right, this.rig.left]) {
      hand.armature.position.copy(hand.restPosition);
      hand.armature.quaternion.copy(hand.restQuaternion);
      hand.armature.scale.copy(hand.restScale);
      hand.targetPosition.copy(hand.restPosition);
      hand.targetQuaternion.copy(hand.restQuaternion);
      hand.currentPalmWorld.copy(hand.palmWorldRest);
      hand.currentKnuckleWorld.copy(hand.palmWorldRest);

      hand.wristJoint.bone.position.copy(hand.wristJoint.restPosition);
      hand.wristJoint.bone.quaternion.copy(hand.wristJoint.restQuaternion);
      hand.wristJoint.bone.scale.copy(hand.wristJoint.restScale);
      hand.wristJoint.targetQuaternion.copy(hand.wristJoint.restQuaternion);

      for (const fingerName of FINGER_NAMES) {
        const chain = hand.fingers[fingerName];
        for (const joint of chain.joints) {
          joint.bone.position.copy(joint.restPosition);
          joint.bone.quaternion.copy(joint.restQuaternion);
          joint.bone.scale.copy(joint.restScale);
          joint.targetQuaternion.copy(joint.restQuaternion);
        }
      }

      hand.armature.updateMatrixWorld(true);
      hand.skeleton.update();
    }

    this.rig.contactWorldCenter
      .addVectors(this.rig.right.palmWorldRest, this.rig.left.palmWorldRest)
      .multiplyScalar(0.5);
    this.rig.contactWorldCenter.z -= 0.1;
    this.rig.receivingPalmWorld.copy(this.rig.left.palmWorldRest);
  }

  /**
   * Applies and smoothly interpolates a stage pose evaluation onto both hands and their
   * skeletal finger chains relative to their calibrated anatomical rest pose.
   */
  applyPose(
    evaluation: StagePoseEvaluation,
    delta: number,
    poseLambda: number,
    boneLambda: number,
  ): void {
    if (!this.rig) return;

    const clampedDelta = Math.min(Math.max(delta, 0), 0.05);
    const poseAlpha = clampedDelta > 0 ? 1 - Math.exp(-poseLambda * clampedDelta) : 1;
    const boneAlpha = clampedDelta > 0 ? 1 - Math.exp(-boneLambda * clampedDelta) : 1;

    this.applySingleHandPose(this.rig.right, evaluation.right, poseAlpha, boneAlpha);
    this.applySingleHandPose(this.rig.left, evaluation.left, poseAlpha, boneAlpha);

    // Update live world-space contact center, palm normals, and receiving palm target from actual bone transforms
    for (const hand of [this.rig.right, this.rig.left]) {
      const midJoints = hand.fingers.middle.joints;
      const idxJoints = hand.fingers.index.joints;
      const pnkJoints = hand.fingers.pinky.joints;

      if (midJoints.length >= 2) {
        const knuckleBone = midJoints[1]!.bone;
        const tipBone = midJoints[midJoints.length - 1]!.bone;
        hand.wristJoint.bone.getWorldPosition(scratchWristWorld);
        knuckleBone.getWorldPosition(scratchKnuckleWorld);
        tipBone.getWorldPosition(scratchTipWorld);
        hand.currentKnuckleWorld.copy(scratchKnuckleWorld);
        hand.currentPalmWorld.copy(scratchKnuckleWorld).lerp(scratchTipWorld, 0.42);

        hand.currentFingerForward
          .subVectors(scratchKnuckleWorld, scratchWristWorld)
          .normalize();

        if (idxJoints.length >= 2 && pnkJoints.length >= 2) {
          idxJoints[1]!.bone.getWorldPosition(scratchIndexKnuckleWorld);
          pnkJoints[1]!.bone.getWorldPosition(scratchPinkyKnuckleWorld);
          scratchRadialVec
            .subVectors(scratchIndexKnuckleWorld, scratchPinkyKnuckleWorld)
            .normalize();
          hand.currentPalmNormal
            .crossVectors(hand.currentFingerForward, scratchRadialVec)
            .multiplyScalar(hand.palmNormalSign)
            .normalize();
        }
      } else {
        hand.currentPalmWorld.copy(hand.palmWorldRest);
        hand.currentKnuckleWorld.copy(hand.palmWorldRest);
      }
    }

    this.rig.contactWorldCenter
      .addVectors(this.rig.right.currentPalmWorld, this.rig.left.currentPalmWorld)
      .multiplyScalar(0.5);

    this.rig.receivingPalmWorld
      .copy(this.rig.left.currentKnuckleWorld)
      .lerp(this.rig.left.currentPalmWorld, 0.55);
    this.rig.receivingPalmWorld.y += 0.018;
  }

  private applySingleHandPose(
    hand: MappedHandRig,
    target: HandPoseTarget,
    poseAlpha: number,
    boneAlpha: number,
  ): void {
    // 1. Whole-hand orientation around the verified palm center pivot using ZXY order
    // so yaw & pitch level the forearm along -Z before roll rotates around the forearm axis.
    scratchEuler.set(
      target.palmEulerDeg[0] * DEG2RAD,
      target.palmEulerDeg[1] * DEG2RAD,
      target.palmEulerDeg[2] * DEG2RAD,
      "ZXY",
    );
    scratchDeltaQuat.setFromEuler(scratchEuler);
    scratchTargetQuat.multiplyQuaternions(scratchDeltaQuat, hand.restQuaternion);
    hand.targetQuaternion.copy(scratchTargetQuat);

    // 2. Pivot-compensated armature translation so rotating around the palm center
    // keeps the palm pinned at `palmWorldRest + palmOffset`
    scratchTargetPalm
      .copy(hand.palmWorldRest)
      .add(scratchPivotOffset.set(target.palmOffset[0], target.palmOffset[1], target.palmOffset[2]));
    scratchPivotOffset
      .copy(hand.palmLocalPivot)
      .multiply(hand.restScale)
      .applyQuaternion(hand.targetQuaternion);
    hand.targetPosition.copy(scratchTargetPalm).sub(scratchPivotOffset);

    hand.armature.position.lerp(hand.targetPosition, poseAlpha);
    hand.armature.quaternion.slerp(hand.targetQuaternion, poseAlpha);

    // 3. Wrist root bone local rotation relative to its rest pose
    scratchEuler.set(
      target.wristEulerDeg[0] * DEG2RAD * hand.curlSign,
      target.wristEulerDeg[1] * DEG2RAD * hand.curlSign,
      target.wristEulerDeg[2] * DEG2RAD,
      "XYZ",
    );
    scratchDeltaQuat.setFromEuler(scratchEuler);
    hand.wristJoint.targetQuaternion.multiplyQuaternions(
      hand.wristJoint.restQuaternion,
      scratchDeltaQuat,
    );
    hand.wristJoint.bone.quaternion.slerp(hand.wristJoint.targetQuaternion, boneAlpha);

    // 4. Anatomical finger bone chain rotations relative to each bone's calibrated rest pose
    for (const fingerName of FINGER_NAMES) {
      const chain = hand.fingers[fingerName];
      const fingerTarget = target.fingers[fingerName];
      const distalBias = fingerTarget.distalBias ?? 1.0;
      const jointCount = chain.joints.length;

      for (let i = 0; i < jointCount; i++) {
        const joint = chain.joints[i]!;
        let flexWeight: number;
        let spreadWeight: number;

        if (fingerName === "thumb") {
          flexWeight = i === 0 ? 0.25 : i === 1 ? 0.65 * distalBias : 0.55 * distalBias;
          spreadWeight = i === 0 ? 0.8 : i === 1 ? 0.3 : 0.0;
        } else {
          // i=0 is the 1.24-unit-long metacarpal inside the palm: keep it stable
          // (zero spread, minimal flex) so the palm and knuckles never stretch apart.
          // i=1 (MCP knuckle) handles abduction/adduction and primary flexion;
          // i=2 (PIP) and i=3 (DIP) act as pure anatomical hinge joints.
          flexWeight =
            i === 0
              ? 0.02
              : i === 1
                ? 0.7
                : i === 2
                  ? 0.85 * distalBias
                  : 0.55 * distalBias;
          spreadWeight = i === 1 ? 1.0 : 0.0;
        }

        const curlRad = fingerTarget.curl * flexWeight * DEG2RAD * hand.curlSign;
        const spreadRad = fingerTarget.spread * spreadWeight * DEG2RAD * hand.spreadSign;
        const twistRad = (fingerTarget.twist ?? 0) * (i === 1 ? 0.5 : 0.0) * DEG2RAD * hand.curlSign;

        scratchEuler.set(curlRad, twistRad, spreadRad, "XYZ");
        scratchDeltaQuat.setFromEuler(scratchEuler);
        joint.targetQuaternion.multiplyQuaternions(joint.restQuaternion, scratchDeltaQuat);
        joint.bone.quaternion.slerp(joint.targetQuaternion, boneAlpha);
      }
    }

    hand.armature.updateMatrixWorld(true);
    hand.skeleton.update();
  }

  dispose(): void {
    this.resetToRestPose();
    this.rig = null;
    this.boundScene = null;
  }
}
