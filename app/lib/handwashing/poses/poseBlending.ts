import * as THREE from "three";
import type { FingerName } from "../rig/handRigMapping";
import type { FingerArticulationTarget } from "./poseTypes";

// Interpolation between hand/finger targets, using the same anatomical joint
// weights as the animator so blends never jump.

const blendEuler = new THREE.Euler(0, 0, 0, "ZXY");
const blendQuatA = new THREE.Quaternion();
const blendQuatB = new THREE.Quaternion();
const ZERO_JOINT_POSITION = [0, 0, 0] as const;
export function blendOrientation(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  const rad = Math.PI / 180;
  blendQuatA.setFromEuler(blendEuler.set(a[0]! * rad, a[1]! * rad, a[2]! * rad, "ZXY"));
  blendQuatB.setFromEuler(blendEuler.set(b[0]! * rad, b[1]! * rad, b[2]! * rad, "ZXY"));
  blendEuler.setFromQuaternion(blendQuatA.slerp(blendQuatB, t), "ZXY");
  return [blendEuler.x / rad, blendEuler.y / rad, blendEuler.z / rad];
}

// Resolve overrides using the very same anatomical weights as the animator.
// Treating curl/spread as a full rotation on every joint caused jumps whenever
// a pose with explicit thumb joints blended into a pose without overrides.
export function jointValue(f: FingerArticulationTarget, name: FingerName, k: number, axis: "curl" | "spread" | "twist"): number {
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

export function lerpVec3Tuple(
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

export function lerpFingerTargets(
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
