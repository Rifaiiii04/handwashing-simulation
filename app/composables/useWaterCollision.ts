import * as THREE from "three";

export interface WaterCollisionSystem {
  /** Call once per frame to refresh target world positions / bounding spheres */
  refreshTargets: () => void;
  /** Fast proximity check — does this point land inside any target's bounding sphere? */
  checkPoint: (point: THREE.Vector3) => boolean;
}

interface CachedTarget {
  mesh: THREE.Mesh;
  worldCenter: THREE.Vector3;
  radiusSq: number;
}

/**
 * Bounding-sphere collision system — O(targets) per particle instead of a full raycast.
 * `refreshTargets()` is called once per frame; `checkPoint()` is called per alive particle.
 */
export function createWaterCollision(
  scene: THREE.Object3D,
  targetNames: string[] = ["R_Hand", "L_Hand"],
): WaterCollisionSystem {
  const cached: CachedTarget[] = [];

  for (const name of targetNames) {
    const obj = scene.getObjectByName(name);
    if (!obj) {
      console.warn(`[WaterCollision] Target not found: ${name}`);
      continue;
    }
    console.log(`[WaterCollision] Target found: ${name}`);

    // Collect all descendant meshes so we cover skinned meshes and sub-parts
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const geo = mesh.geometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();

        cached.push({
          mesh,
          worldCenter: new THREE.Vector3(),
          // Slightly enlarge bounding sphere for a forgiving feel
          radiusSq: 0,
        });
      }
    });
  }

  const _tmpSphere = new THREE.Sphere();

  function refreshTargets(): void {
    for (const t of cached) {
      const geo = t.mesh.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();

      // Transform local bounding sphere into world space
      _tmpSphere.copy(geo.boundingSphere!);
      _tmpSphere.applyMatrix4(t.mesh.matrixWorld);

      t.worldCenter.copy(_tmpSphere.center);
      // 1.35× radius gives forgiving collisions without looking wrong
      const r = _tmpSphere.radius * 1.35;
      t.radiusSq = r * r;
    }
  }

  function checkPoint(point: THREE.Vector3): boolean {
    for (const t of cached) {
      if (point.distanceToSquared(t.worldCenter) <= t.radiusSq) {
        return true;
      }
    }
    return false;
  }

  return { refreshTargets, checkPoint };
}
