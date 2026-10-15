import * as THREE from "three";

export interface StreamHit {
  hit: boolean;
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  hitTarget?: "hand" | "sink";
  hitObject?: THREE.Mesh;
  runoffPoint?: THREE.Vector3;
  runoffNormal?: THREE.Vector3;
  basinPoint: THREE.Vector3;
  basinNormal: THREE.Vector3;
}

export interface WaterCollisionSystem {
  /** Refresh target matrices and world-space bounds (call once per frame) */
  refreshTargets: () => void;
  /** Increments when a hand transform or skinned pose changes. */
  readonly handSurfaceRevision: number;
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
  /** Lower open edge of the drain passage in the GLB. */
  drainExitY: number | null;
  /** Height of sink basin at world coordinate (x, z) */
  getBasinHeightAt: (x: number, z: number) => number;
  /** Sample the actual sink mesh at an XZ point when the basin is covered. */
  sampleBasinSurface: (
    x: number,
    z: number,
    target: THREE.Vector3,
    normalTarget?: THREE.Vector3,
  ) => boolean;
  /** Sample a specific hand mesh along a world-space ray (SkinnedMesh-aware). */
  sampleHandSurface: (
    mesh: THREE.Mesh,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    target: THREE.Vector3,
    normalTarget: THREE.Vector3,
    maxDistance?: number,
  ) => boolean;
}

interface CachedHandTarget {
  mesh: THREE.Mesh;
  worldCenter: THREE.Vector3;
  radius: number;
  radiusSq: number;
  boneMatrixSnapshot: Float32Array | null;
  worldMatrixSnapshot: Float32Array;
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
  let handSurfaceRevision = 0;
  let sinkMesh: THREE.Mesh | null = null;

  // Fallback values are replaced from the sink mesh's interior floor at startup.
  const drainCenter = new THREE.Vector3(0, 0.7282, -0.25);
  let drainRadius = 0.14;
  let basinFloorY = 0.7282;
  let drainExitY: number | null = null;
  let sinkRayTop = 3;
  let sinkRayFar = 4;

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
        const skinnedMesh = child as THREE.SkinnedMesh;
        let boneMatrixSnapshot: Float32Array | null = null;
        if (skinnedMesh.isSkinnedMesh && skinnedMesh.skeleton) {
          // Seed the bound after the model's world matrices were resolved.
          skinnedMesh.skeleton.update();
          skinnedMesh.computeBoundingSphere();
          boneMatrixSnapshot = skinnedMesh.skeleton.boneMatrices.slice();
        }
        cachedHands.push({
          mesh: child,
          worldCenter: new THREE.Vector3(),
          radius: 0.15,
          radiusSq: 0.0225,
          boneMatrixSnapshot,
          worldMatrixSnapshot: new Float32Array(child.matrixWorld.elements),
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
    const sinkGeometry = sinkMesh.geometry;
    const posAttr = sinkGeometry.getAttribute("position");
    if (posAttr instanceof THREE.BufferAttribute) {
      const v = new THREE.Vector3();
      let minBasinY = Infinity;
      let minSinkY = Infinity;
      let maxSinkY = -Infinity;
      for (let i = 0; i < posAttr.count; i++) {
        v.fromBufferAttribute(posAttr, i);
        v.applyMatrix4((sinkMesh as THREE.Mesh).matrixWorld);
        minSinkY = Math.min(minSinkY, v.y);
        maxSinkY = Math.max(maxSinkY, v.y);
        if (v.y > 0.5 && v.y < minBasinY) {
          minBasinY = v.y;
        }
      }
      if (minSinkY !== Infinity && maxSinkY !== -Infinity) {
        sinkRayTop = maxSinkY + 0.1;
        sinkRayFar = sinkRayTop - minSinkY + 0.2;
      }
      if (minBasinY !== Infinity) {
        basinFloorY = minBasinY;
      }

      // Recover connected open boundary loops by position, not by height bands.
      // The GLB can split vertices at UV/normal seams, so index-only edge keys
      // can turn one opening into many false fragments.
      const edgeUse = new Map<string, { count: number; a: string; b: string }>();
      const index = sinkGeometry.index;
      const triangleIndexCount = index?.count ?? posAttr.count;
      const vertexKeys = new Array<string>(posAttr.count);
      const boundaryPoints = new Map<string, { x: number; y: number; z: number }>();
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const z = posAttr.getZ(i);
        const key = `${Math.round(x * 10000)}:${Math.round(y * 10000)}:${Math.round(z * 10000)}`;
        vertexKeys[i] = key;
        if (!boundaryPoints.has(key)) boundaryPoints.set(key, { x, y, z });
      }

      for (let i = 0; i + 2 < triangleIndexCount; i += 3) {
        const a = vertexKeys[index ? index.getX(i) : i];
        const b = vertexKeys[index ? index.getX(i + 1) : i + 1];
        const c = vertexKeys[index ? index.getX(i + 2) : i + 2];
        if (!a || !b || !c) continue;
        for (const [from, to] of [[a, b], [b, c], [c, a]]) {
          const key = from < to ? `${from}|${to}` : `${to}|${from}`;
          const edge = edgeUse.get(key);
          if (edge) edge.count += 1;
          else edgeUse.set(key, { count: 1, a: from, b: to });
        }
      }

      const boundaryAdjacency = new Map<string, Set<string>>();
      for (const edge of edgeUse.values()) {
        if (edge.count !== 1) continue;
        let aNeighbors = boundaryAdjacency.get(edge.a);
        if (!aNeighbors) boundaryAdjacency.set(edge.a, (aNeighbors = new Set<string>()));
        let bNeighbors = boundaryAdjacency.get(edge.b);
        if (!bNeighbors) boundaryAdjacency.set(edge.b, (bNeighbors = new Set<string>()));
        aNeighbors.add(edge.b);
        bNeighbors.add(edge.a);
      }

      const loops: Array<{ y: number; x: number; z: number; radius: number }> = [];
      const visitedBoundary = new Set<string>();
      for (const start of boundaryAdjacency.keys()) {
        if (visitedBoundary.has(start)) continue;
        const component: string[] = [];
        const stack = [start];
        visitedBoundary.add(start);
        while (stack.length > 0) {
          const current = stack.pop();
          if (!current) continue;
          component.push(current);
          const neighbors = boundaryAdjacency.get(current);
          if (!neighbors) continue;
          for (const neighbor of neighbors) {
            if (visitedBoundary.has(neighbor)) continue;
            visitedBoundary.add(neighbor);
            stack.push(neighbor);
          }
        }
        if (component.length < 8) continue;

        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const key of component) {
          const point = boundaryPoints.get(key);
          if (!point) continue;
          v.set(point.x, point.y, point.z).applyMatrix4((sinkMesh as THREE.Mesh).matrixWorld);
          sumX += v.x;
          sumY += v.y;
          sumZ += v.z;
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        }
        if (maxY - minY > 0.035) continue;

        const x = sumX / component.length;
        const y = sumY / component.length;
        const z = sumZ / component.length;
        let maxRadiusSq = 0;
        for (const key of component) {
          const point = boundaryPoints.get(key);
          if (!point) continue;
          v.set(point.x, point.y, point.z).applyMatrix4((sinkMesh as THREE.Mesh).matrixWorld);
          const dx = v.x - x;
          const dz = v.z - z;
          maxRadiusSq = Math.max(maxRadiusSq, dx * dx + dz * dz);
        }
        const radius = Math.sqrt(maxRadiusSq);
        if (radius >= 0.04) loops.push({ y, x, z, radius });
      }

      let upperDrainLoop: (typeof loops)[number] | null = null;
      let lowerOpening: (typeof loops)[number] | null = null;
      for (const upper of loops) {
        if (upper.radius < 0.04) continue;
        for (const lower of loops) {
          if (lower.radius < 0.04 || lower.y >= upper.y - 0.1) continue;
          const centerDistance = Math.hypot(upper.x - lower.x, upper.z - lower.z);
          const radiusRatio = lower.radius / upper.radius;
          if (centerDistance >= 0.03 || radiusRatio <= 0.5 || radiusRatio >= 1.5) continue;
          if (!upperDrainLoop || upper.y < upperDrainLoop.y) {
            upperDrainLoop = upper;
            lowerOpening = lower;
          }
        }
      }

      if (upperDrainLoop && lowerOpening) {
        basinFloorY = upperDrainLoop.y;
        drainCenter.set(upperDrainLoop.x, upperDrainLoop.y, upperDrainLoop.z);
        drainRadius = upperDrainLoop.radius;
        drainExitY = lowerOpening.y - 0.025;
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

  function sampleBasinSurface(
    x: number,
    z: number,
    target: THREE.Vector3,
    normalTarget?: THREE.Vector3,
  ): boolean {
    if (sinkMesh) {
      _raycaster.set(_basinRayOrigin.set(x, sinkRayTop, z), _rayDown);
      _raycaster.near = 0.001;
      _raycaster.far = sinkRayFar;
      _sinkHits.length = 0;
      _raycaster.intersectObject(sinkMesh, false, _sinkHits);
      for (let i = 0; i < _sinkHits.length; i++) {
        const hit = _sinkHits[i];
        if (hit && hit.point.y >= drainCenter.y - 0.01) {
          target.copy(hit.point);
          if (normalTarget && hit.face?.normal) {
            _hitNormalMatrix.getNormalMatrix(sinkMesh.matrixWorld);
            normalTarget.copy(hit.face.normal).applyMatrix3(_hitNormalMatrix).normalize();
          } else if (normalTarget) {
            normalTarget.set(0, 1, 0);
          }
          return true;
        }
      }
    }
    target.set(x, getBasinHeightAt(x, z), z);
    normalTarget?.set(0, 1, 0);
    return false;
  }

  function sampleHandSurface(
    mesh: THREE.Mesh,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    target: THREE.Vector3,
    normalTarget: THREE.Vector3,
    maxDistance = 0.08,
  ): boolean {
    _raycaster.set(origin, direction);
    _raycaster.near = 0.001;
    _raycaster.far = maxDistance;
    _handSampleHits.length = 0;
    _raycaster.intersectObject(mesh, false, _handSampleHits);
    const hit = _handSampleHits[0];
    if (!hit) return false;

    target.copy(hit.point);
    if (hit.face?.normal) {
      _hitNormalMatrix.getNormalMatrix(mesh.matrixWorld);
      normalTarget.copy(hit.face.normal).applyMatrix3(_hitNormalMatrix).normalize();
    } else if (hit.normal) {
      _hitNormalMatrix.getNormalMatrix(mesh.matrixWorld);
      normalTarget.copy(hit.normal).applyMatrix3(_hitNormalMatrix).normalize();
    } else {
      normalTarget.set(0, 1, 0);
    }
    if (normalTarget.dot(direction) > 0) normalTarget.negate();
    return true;
  }

  // Pre-allocated temporaries for 0 runtime garbage collection
  const _tmpSphere = new THREE.Sphere();
  const _raycaster = new THREE.Raycaster();
  const _rayDown = new THREE.Vector3(0, -1, 0);
  const _basinRayOrigin = new THREE.Vector3();
  const _hitNormalMatrix = new THREE.Matrix3();
  const _diff = new THREE.Vector3();
  const _handHits: THREE.Intersection[] = [];
  const _handSampleHits: THREE.Intersection[] = [];
  const _sinkHits: THREE.Intersection[] = [];
  const _collisionResult = { collided: false, stopped: false };

  const _streamHit: StreamHit = {
    hit: false,
    distance: 1.126,
    point: new THREE.Vector3(0, basinFloorY, -0.668),
    normal: new THREE.Vector3(0, 1, 0),
    hitTarget: undefined,
    runoffPoint: new THREE.Vector3(),
    runoffNormal: new THREE.Vector3(0, -1, 0),
    basinPoint: new THREE.Vector3(0, 0.822, -0.668),
    basinNormal: new THREE.Vector3(0, 0.828, 0.561),
  };

  function refreshTargets(): void {
    for (const t of cachedHands) {
      t.mesh.updateWorldMatrix(true, false);
      const worldElements = t.mesh.matrixWorld.elements;
      let surfaceChanged = false;
      for (let i = 0; i < worldElements.length; i++) {
        if (Math.abs(worldElements[i]! - t.worldMatrixSnapshot[i]!) > 0.000001) {
          surfaceChanged = true;
          break;
        }
      }

      const geo = t.mesh.geometry;
      if ((t.mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const skinnedMesh = t.mesh as THREE.SkinnedMesh;
        const skeleton = skinnedMesh.skeleton;
        if (skeleton) {
          for (const bone of skeleton.bones) bone.updateWorldMatrix(true, false);
          skeleton.update();
          const boneMatrices = skeleton.boneMatrices;
          let poseChanged = !t.boneMatrixSnapshot ||
            t.boneMatrixSnapshot.length !== boneMatrices.length;
          if (!poseChanged && t.boneMatrixSnapshot) {
            for (let i = 0; i < boneMatrices.length; i++) {
              if (Math.abs(boneMatrices[i]! - t.boneMatrixSnapshot[i]!) > 0.000001) {
                poseChanged = true;
                break;
              }
            }
          }
          if (poseChanged) {
            surfaceChanged = true;
            skinnedMesh.computeBoundingSphere();
            if (!t.boneMatrixSnapshot || t.boneMatrixSnapshot.length !== boneMatrices.length) {
              t.boneMatrixSnapshot = new Float32Array(boneMatrices.length);
            }
            t.boneMatrixSnapshot.set(boneMatrices);
          }
        }
        if (!skinnedMesh.boundingSphere) continue;
        _tmpSphere.copy(skinnedMesh.boundingSphere);
      } else {
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        if (!geo.boundingSphere) continue;
        _tmpSphere.copy(geo.boundingSphere);
      }
      if (surfaceChanged) {
        t.worldMatrixSnapshot.set(worldElements);
        handSurfaceRevision++;
      }
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
    _streamHit.hitObject = undefined;

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
      let bottomHit = topHit;
      if (topHit) {
        for (let i = _handHits.length - 1; i > 0; i--) {
          const candidate = _handHits[i];
          if (candidate?.object === topHit.object) {
            bottomHit = candidate;
            break;
          }
        }
      }

      if (topHit) {
        _streamHit.hit = true;
        _streamHit.distance = topHit.distance;
        _streamHit.point.copy(topHit.point);
        _streamHit.hitTarget = "hand";
        _streamHit.hitObject = topHit.object as THREE.Mesh;

        if (topHit.face && topHit.face.normal) {
          _hitNormalMatrix.getNormalMatrix(topHit.object.matrixWorld);
          _streamHit.normal.copy(topHit.face.normal).applyMatrix3(_hitNormalMatrix).normalize();
        } else if (topHit.normal) {
          _hitNormalMatrix.getNormalMatrix(topHit.object.matrixWorld);
          _streamHit.normal.copy(topHit.normal).applyMatrix3(_hitNormalMatrix).normalize();
        } else {
          _streamHit.normal.set(0, 1, 0);
        }
        if (_streamHit.normal.dot(_rayDown) > 0) _streamHit.normal.negate();

        // Keep a real mesh hit as the fallback. The renderer traces the visible
        // surface flow from the contact point to the edge when possible.
        if (bottomHit && bottomHit !== topHit) {
          _streamHit.runoffPoint!.copy(bottomHit.point);
          if (bottomHit.face?.normal) {
            _hitNormalMatrix.getNormalMatrix(bottomHit.object.matrixWorld);
            _streamHit.runoffNormal!.copy(bottomHit.face.normal).applyMatrix3(_hitNormalMatrix).normalize();
          } else {
            _streamHit.runoffNormal!.copy(_streamHit.normal);
          }
        } else {
          _streamHit.runoffPoint!.copy(topHit.point);
          _streamHit.runoffNormal!.copy(_streamHit.normal);
        }

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
    get handSurfaceRevision() { return handSurfaceRevision; },
    checkPoint,
    castStreamRay,
    resolveParticleCollision,
    basinY: basinFloorY,
    drainCenter,
    drainRadius,
    drainExitY,
    getBasinHeightAt,
    sampleBasinSurface,
    sampleHandSurface,
  };
}
