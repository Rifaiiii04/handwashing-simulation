import * as THREE from "three";

export interface WaterCollisionSystem {
  checkSegment: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
}

export function createWaterCollision(
  scene: THREE.Object3D,
  targetNames: string[] = ["R_hand", "L_hand", "sink"],
): WaterCollisionSystem {
  const targets: THREE.Object3D[] = [];

  for (const name of targetNames) {
    const target = scene.getObjectByName(name);

    if (target) {
      targets.push(target);
      console.log(`[WaterCollision] Target Found: ${name}`);
    } else {
      console.warn(`[WaterCollision] Target not Found: ${name}`);
    }
  }

  const raycaster = new THREE.Raycaster();
  const direction = new THREE.Vector3();

  function checkSegment(from: THREE.Vector3, to: THREE.Vector3): boolean {
    if (targets.length === 0) return false;

    direction.subVectors(to, from);

    const distance = direction.length();

    if (distance < 0.000001) return false;

    raycaster.set(from, direction.normalize());
    raycaster.near = 0;
    raycaster.far = distance;

    const intersections = raycaster.intersectObjects(targets, true);

    return intersections.length > 0;
  }

  return {
    checkSegment,
  };
}
