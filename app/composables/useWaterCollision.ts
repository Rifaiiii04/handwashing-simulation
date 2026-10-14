import * as THREE from "three";

export interface StreamHit {
  hit: boolean;
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  hitTarget?: "hand" | "sink";
  runoffPoint?: THREE.Vector3;
  runoffNormal?: THREE.Vector3;
  basinPoint: THREE.Vector3;
  basinNormal: THREE.Vector3;
}

export interface WaterCollisionSystem {
  /** Refresh target matrices and world-space bounds (call once per frame) */
  refreshTargets: () => void;
  /** Fast proximity check against hand bounds */
  checkPoint: (point: THREE.Vector3) => boolean;
  /** Downward raycast to find hand surface or basin surface */
  castStreamRay: (origin: THREE.Vector3, maxDistance?: number) => StreamHit;
  /** Fast O(1) particle collision response against hands and sink basin */
  resolveParticleCollision: (
    pos: THREE.Vector3,
    vel: THREE.Vector3,
  ) => { collided: boolean; stopped: boolean };
  /** Basin floor minimum Y level at drain */
  basinY: number;
  /** Drain opening world center */
  drainCenter: THREE.Vector3;
  /** Drain opening absorption radius */
  drainRadius: number;
  /** Height of sink basin at world coordinate (x, z) */
  getBasinHeightAt: (x: number, z: number) => number;
}

interface CachedHandTarget {
  mesh: THREE.Mesh;
  worldCenter: THREE.Vector3;
  radius: number;
  radiusSq: number;
}

/**
 * High-performance physics-constrained collision system:
 * - Precise downward raycasting for stream impact & hand penetration prevention
 * - Accurate sink basin surface & drain opening detection
 * - O(1) particle deflection and drain absorption with zero per-frame heap allocations
 */
export function createWaterCollision(
  scene: THREE.Object3D,
  handTargetNames: string[] = ["R_Hand", "L_Hand"],
  sinkName = "sink",
): WaterCollisionSystem {
  const cachedHands: CachedHandTarget[] = [];
  const handMeshes: THREE.Mesh[] = [];
  let sinkMesh: THREE.Mesh | null = null;

  // Fallback values are replaced from the sink mesh's interior floor at startup.
  const drainCenter = new THREE.Vector3(0, 0.7282, -0.25);
  let drainRadius = 0.14;
  let basinFloorY = 0.7282;

  // 1. Discover Hand Meshes
  for (const name of handTargetNames) {
    const obj = scene.getObjectByName(name);
    if (!obj) {
      continue;
    }

    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (!child.geometry.boundingSphere) {
          child.geometry.computeBoundingSphere();
        }
        cachedHands.push({
          mesh: child,
          worldCenter: new THREE.Vector3(),
          radius: 0.12,
          radiusSq: 0.0144,
        });
        handMeshes.push(child);
      }
    });
  }

  // 2. Discover Sink Mesh & compute basin geometry
  scene.traverse((child) => {
    if (
      child instanceof THREE.Mesh &&
      child.name.toLowerCase().includes(sinkName.toLowerCase())
    ) {
      sinkMesh = child;
    }
  });

  if (sinkMesh) {
    const posAttr = (sinkMesh as THREE.Mesh).geometry.getAttribute("position");
    if (posAttr instanceof THREE.BufferAttribute) {
      const v = new THREE.Vector3();
      let minBasinY = Infinity;
      for (let i = 0; i < posAttr.count; i++) {
        v.fromBufferAttribute(posAttr, i);
        v.applyMatrix4((sinkMesh as THREE.Mesh).matrixWorld);
        if (v.y > 0.5 && v.y < minBasinY) {
          minBasinY = v.y;
        }
      }
      if (minBasinY !== Infinity) {
        basinFloorY = minBasinY;

        // The GLB's lowest interior ring is the drain boundary. Its centroid
        // gives the actual opening center instead of relying on a scene guess.
        let floorVertexCount = 0;
        let sumX = 0;
        let sumZ = 0;
        let maxRadiusSq = 0;
        for (let i = 0; i < posAttr.count; i++) {
          v.fromBufferAttribute(posAttr, i);
          v.applyMatrix4((sinkMesh as THREE.Mesh).matrixWorld);
          if (Math.abs(v.y - basinFloorY) > 0.002) continue;
          floorVertexCount += 1;
          sumX += v.x;
          sumZ += v.z;
        }

        if (floorVertexCount > 0) {
          drainCenter.set(sumX / floorVertexCount, basinFloorY, sumZ / floorVertexCount);
          for (let i = 0; i < posAttr.count; i++) {
            v.fromBufferAttribute(posAttr, i);
            v.applyMatrix4((sinkMesh as THREE.Mesh).matrixWorld);
            if (Math.abs(v.y - basinFloorY) > 0.002) continue;
            const dx = v.x - drainCenter.x;
            const dz = v.z - drainCenter.z;
            maxRadiusSq = Math.max(maxRadiusSq, dx * dx + dz * dz);
          }
          // Stay inside the GLB's drain rim so particles disappear at the opening.
          drainRadius = Math.max(0.06, Math.sqrt(maxRadiusSq) * 0.9);
        } else {
          drainCenter.y = basinFloorY;
        }
      }
    }
  }

  // Height query for lightweight particle collision. The rear profile matches
  // vertical samples from this GLB's basin: y=0.822 at the faucet's x/z.
  function getBasinHeightAt(x: number, z: number): number {
    let baseZ = basinFloorY;
    const rearBasinEdgeZ = drainCenter.z - drainRadius;
    const rearDistance = rearBasinEdgeZ - z;
    if (rearDistance > 0) {
      const rearRise = rearDistance <= 0.2
        ? rearDistance * (0.77 - rearDistance * 1.22)
        : Math.min(0.15, 0.1075 + (rearDistance - 0.2) * 0.43);
      baseZ += rearRise;
    } else if (z > -0.15) {
      const t = Math.min(1.0, (z - -0.15) / 0.25);
      baseZ = basinFloorY + t * t * 0.12;
    }

    const dx = Math.max(0, Math.abs(x) - 0.18);
    const riseX = dx * dx * 1.6;

    return baseZ + riseX;
  }

  // Pre-allocated temporaries for 0 runtime garbage collection
  const _tmpSphere = new THREE.Sphere();
  const _raycaster = new THREE.Raycaster();
  const _rayDown = new THREE.Vector3(0, -1, 0);
  const _hitNormalMatrix = new THREE.Matrix3();
  const _diff = new THREE.Vector3();
  const _handHits: THREE.Intersection[] = [];
  const _sinkHits: THREE.Intersection[] = [];
  const _collisionResult = { collided: false, stopped: false };

  const _streamHit: StreamHit = {
    hit: false,
    distance: 1.126,
    point: new THREE.Vector3(0, basinFloorY, -0.668),
    normal: new THREE.Vector3(0, 1, 0),
    hitTarget: undefined,
    runoffPoint: new THREE.Vector3(0, 1.357, -0.668),
    runoffNormal: new THREE.Vector3(0, -1, 0),
    basinPoint: new THREE.Vector3(0, 0.822, -0.668),
    basinNormal: new THREE.Vector3(0, 0.828, 0.561),
  };

  function refreshTargets(): void {
    for (const t of cachedHands) {
      const geo = t.mesh.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if (!geo.boundingSphere) continue;

      _tmpSphere.copy(geo.boundingSphere);
      _tmpSphere.applyMatrix4(t.mesh.matrixWorld);

      t.worldCenter.copy(_tmpSphere.center);
      const r = _tmpSphere.radius * 1.1;
      t.radius = r;
      t.radiusSq = r * r;
    }
  }

  function checkPoint(point: THREE.Vector3): boolean {
    for (const t of cachedHands) {
      if (point.distanceToSquared(t.worldCenter) <= t.radiusSq) {
        return true;
      }
    }
    return false;
  }

  function castStreamRay(origin: THREE.Vector3, maxDistance = 2.5): StreamHit {
    _raycaster.set(origin, _rayDown);
    _raycaster.near = 0.01;
    _raycaster.far = maxDistance;

    _streamHit.hit = false;
    _streamHit.hitTarget = undefined;

    // Default basin impact point directly under stream
    const defaultBasinY = getBasinHeightAt(origin.x, origin.z);
    _streamHit.basinPoint.set(origin.x, defaultBasinY, origin.z);
    _streamHit.basinNormal.set(0, 0.828, 0.561).normalize();

    // Resolve the basin independently of a hand hit. This keeps the runoff and
    // flow sheet attached to the real porcelain surface below the hands.
    let basinHit: THREE.Intersection | undefined;
    if (sinkMesh) {
      _sinkHits.length = 0;
      _raycaster.intersectObject(sinkMesh, false, _sinkHits);
      for (let i = 0; i < _sinkHits.length; i++) {
        const hit = _sinkHits[i];
        if (hit && hit.point.y > 0.5) {
          basinHit = hit;
          break;
        }
      }

      if (basinHit) {
        _streamHit.basinPoint.copy(basinHit.point);
        if (basinHit.face && basinHit.face.normal) {
          _hitNormalMatrix.getNormalMatrix((sinkMesh as THREE.Mesh).matrixWorld);
          _streamHit.basinNormal.copy(basinHit.face.normal).applyMatrix3(_hitNormalMatrix).normalize();
        } else if (basinHit.normal) {
          _streamHit.basinNormal.copy(basinHit.normal);
        }
      }
    }

    // 1. Raycast hands
    if (handMeshes.length > 0) {
      _handHits.length = 0;
      _raycaster.intersectObjects(handMeshes, false, _handHits);
      const topHit = _handHits[0];
      const bottomHit = _handHits[_handHits.length - 1];

      if (topHit) {
        _streamHit.hit = true;
        _streamHit.distance = topHit.distance;
        _streamHit.point.copy(topHit.point);
        _streamHit.hitTarget = "hand";

        if (topHit.face && topHit.face.normal) {
          _hitNormalMatrix.getNormalMatrix(topHit.object.matrixWorld);
          _streamHit.normal.copy(topHit.face.normal).applyMatrix3(_hitNormalMatrix).normalize();
        } else if (topHit.normal) {
          _streamHit.normal.copy(topHit.normal);
        } else {
          _streamHit.normal.set(0, 1, 0);
        }

        // Runoff exit point on hand underside
        if (bottomHit && bottomHit !== topHit) {
          _streamHit.runoffPoint.copy(bottomHit.point);
        } else {
          _streamHit.runoffPoint.set(topHit.point.x, topHit.point.y - 0.045, topHit.point.z);
        }
        _streamHit.runoffNormal.set(0, -1, 0);

        return _streamHit;
      }
    }

    // 2. If no hands in the way, ray hits sink basin directly
    if (basinHit) {
      _streamHit.hit = true;
      _streamHit.distance = basinHit.distance;
      _streamHit.point.copy(basinHit.point);
      _streamHit.hitTarget = "sink";
      _streamHit.normal.copy(_streamHit.basinNormal);
      _streamHit.basinNormal.copy(_streamHit.normal);
      return _streamHit;
    }

    // Fallback to computed basin surface
    const distToBasin = Math.max(0.05, origin.y - defaultBasinY);
    _streamHit.hit = true;
    _streamHit.distance = distToBasin;
    _streamHit.point.copy(_streamHit.basinPoint);
    _streamHit.normal.copy(_streamHit.basinNormal);
    _streamHit.hitTarget = "sink";
    return _streamHit;
  }

  function resolveParticleCollision(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
  ): { collided: boolean; stopped: boolean } {
    // 1. Hand proximity deflection
    for (const t of cachedHands) {
      const d2 = pos.distanceToSquared(t.worldCenter);
      if (d2 <= t.radiusSq) {
        _diff.subVectors(pos, t.worldCenter);
        const dist = Math.sqrt(d2);
        if (dist > 0.0001) {
          _diff.multiplyScalar(1 / dist);
        } else {
          _diff.set(0, 1, 0);
        }

        pos.copy(t.worldCenter).addScaledVector(_diff, t.radius + 0.003);

        const dot = vel.dot(_diff);
        if (dot < 0) {
          vel.addScaledVector(_diff, -1.35 * dot);
          vel.multiplyScalar(0.7);
        }
        _collisionResult.collided = true;
        _collisionResult.stopped = false;
        return _collisionResult;
      }
    }

    // 2. Sink basin surface collision & drain absorption
    const surfaceY = getBasinHeightAt(pos.x, pos.z);
    if (pos.y <= surfaceY + 0.002) {
      pos.y = surfaceY + 0.002;

      // Check if particle reached drain opening
      const distToDrain = Math.hypot(pos.x - drainCenter.x, pos.z - drainCenter.z);
      if (distToDrain <= drainRadius) {
        _collisionResult.collided = true;
        _collisionResult.stopped = true;
        return _collisionResult;
      }

      // Slide towards drain along basin slope
      const toDrainX = drainCenter.x - pos.x;
      const toDrainZ = drainCenter.z - pos.z;
      const drainDistInv = 1.0 / Math.max(0.01, distToDrain);

      vel.y = 0;
      // Retain enough downhill inertia for a visible basin traverse while
      // damping outward splash velocity on contact with the porcelain.
      vel.x = vel.x * 0.62 + toDrainX * drainDistInv * 0.38;
      vel.z = vel.z * 0.62 + toDrainZ * drainDistInv * 0.38;

      _collisionResult.collided = true;
      _collisionResult.stopped = false;
      return _collisionResult;
    }

    _collisionResult.collided = false;
    _collisionResult.stopped = false;
    return _collisionResult;
  }

  refreshTargets();

  return {
    refreshTargets,
    checkPoint,
    castStreamRay,
    resolveParticleCollision,
    basinY: basinFloorY,
    drainCenter,
    drainRadius,
    getBasinHeightAt,
  };
}
