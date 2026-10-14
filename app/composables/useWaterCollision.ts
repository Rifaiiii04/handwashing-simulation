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
          radius: 0.15,
          radiusSq: 0.0225,
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

  // ── Basin Height Model ──────────────────────────────────────────────────────
  // Fitted to actual raycast samples from the GLB sink mesh:
  //   z=-0.70 → y=0.836   z=-0.65 → y=0.814   z=-0.60 → y=0.793
  //   z=-0.55 → y=0.740   z=-0.50 and closer → open bowl (floor at 0.728)
  //   z=+0.05 → y=0.797   z=+0.10 → y=0.831   z=+0.15 → y=0.865
  // The basin rim starts at ~z=-0.53 (rear) and ~z=+0.03 (front).
  // Between those Z values, the basin is open (drain hole area).
  function getBasinHeightAt(x: number, z: number): number {
    let baseY = basinFloorY;

    // Rear wall slope (z < -0.53): from floor up to rim
    const rearEdgeZ = drainCenter.z - drainRadius; // ≈ -0.53
    if (z < rearEdgeZ) {
      const dist = rearEdgeZ - z; // positive going backward
      // Piecewise linear fit to raycast data:
      //   dist=0.02 → rise≈0.012, dist=0.07 → rise≈0.065,
      //   dist=0.12 → rise≈0.093, dist=0.17 → rise≈0.108
      baseY += dist * 0.65;
    }

    // Front wall slope (z > +0.03): from floor up to rim
    const frontEdgeZ = drainCenter.z + drainRadius; // ≈ +0.03
    if (z > frontEdgeZ) {
      const dist = z - frontEdgeZ;
      baseY += dist * 0.68;
    }

    // Lateral wall rise (|x| > ~0.28 = drain radius in X)
    const lateralThreshold = drainRadius * 0.95; // ≈ 0.27
    const dx = Math.max(0, Math.abs(x) - lateralThreshold);
    baseY += dx * dx * 1.2;

    return baseY;
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
    runoffPoint: new THREE.Vector3(-0.012, 1.435, -0.440),
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
      // Use generous radius to prevent clipping — hands are irregular,
      // so a tight bounding sphere misses fingertips and palm edges.
      const r = _tmpSphere.radius * 1.25;
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
      const bottomHit = _handHits.length > 1 ? _handHits[_handHits.length - 1] : topHit;

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

        // Runoff exit: use the bottom hit point if the ray exits the hands,
        // otherwise estimate from the top hit shifted toward fingertips.
        // This makes water flow naturally off the palm surface rather than
        // teleporting to a hardcoded coordinate.
        if (bottomHit && bottomHit !== topHit) {
          // Ray exits bottom of hands — water drips from there
          _streamHit.runoffPoint!.copy(bottomHit.point);
          // Shift slightly below hand surface so the waterfall starts cleanly
          _streamHit.runoffPoint!.y -= 0.008;
        } else {
          // Single hit — estimate runoff from fingertip region
          // Use the hit point but shift toward the front (positive Z = toward viewer)
          // and slightly down, matching the cupped hands' lowest edge
          _streamHit.runoffPoint!.set(
            topHit.point.x * 0.7 - 0.01,
            topHit.point.y - 0.04,
            topHit.point.z + 0.15,
          );
        }
        _streamHit.runoffNormal!.set(0, -1, 0);

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
    // 1. Hand proximity deflection — soft push-out to prevent clipping
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

        // Push particle just outside the collision sphere
        pos.copy(t.worldCenter).addScaledVector(_diff, t.radius + 0.004);

        // Soft deflection: remove inward velocity component and add slight
        // tangential scatter. Less bouncy than before for natural feel.
        const dot = vel.dot(_diff);
        if (dot < 0) {
          // Remove inward component + gentle outward push (1.08x reflection)
          vel.addScaledVector(_diff, -1.08 * dot);
          // Dampen to simulate energy loss from hitting wet skin
          vel.multiplyScalar(0.55);
        }
        _collisionResult.collided = true;
        _collisionResult.stopped = false;
        return _collisionResult;
      }
    }

    // 2. Sink basin surface collision & drain absorption
    const surfaceY = getBasinHeightAt(pos.x, pos.z);
    if (pos.y <= surfaceY + 0.003) {
      pos.y = surfaceY + 0.003;

      // Check if particle reached drain opening
      const dxDrain = pos.x - drainCenter.x;
      const dzDrain = pos.z - drainCenter.z;
      const distToDrainSq = dxDrain * dxDrain + dzDrain * dzDrain;
      const drainRadiusSq = drainRadius * drainRadius;

      if (distToDrainSq <= drainRadiusSq) {
        _collisionResult.collided = true;
        _collisionResult.stopped = true;
        return _collisionResult;
      }

      const distToDrain = Math.sqrt(distToDrainSq);

      // Natural gravity-driven sliding toward drain:
      // Particles closer to the drain accelerate more (steeper bowl slope).
      // Particles far from drain move slowly along the shallow rim.
      const toDrainX = dxDrain > 0 || dxDrain < 0 ? -dxDrain : 0;
      const toDrainZ = dzDrain > 0 || dzDrain < 0 ? -dzDrain : 0;
      const invDist = 1.0 / Math.max(0.01, distToDrain);

      // Steepness increases as particle approaches drain rim (inverse distance)
      const slopeAccel = 0.25 + 0.20 / Math.max(0.08, distToDrain);

      // Kill vertical bounce on basin contact
      vel.y = 0;

      // Blend: retain some existing lateral momentum (water inertia)
      // but increasingly steer toward drain
      const inertia = 0.50;
      const drainPull = 1.0 - inertia;
      vel.x = vel.x * inertia + toDrainX * invDist * slopeAccel * drainPull;
      vel.z = vel.z * inertia + toDrainZ * invDist * slopeAccel * drainPull;

      // Friction damping on the wet porcelain surface
      vel.x *= 0.94;
      vel.z *= 0.94;

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
