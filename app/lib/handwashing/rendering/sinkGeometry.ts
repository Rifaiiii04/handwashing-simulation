import * as THREE from 'three'
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export /**
 * Subdivide low-poly sink mesh into smooth medium-poly (4,160 triangles),
 * rounding out the 16-sided faceted pedestal cylinder and front corners.
 */
function refineSinkToMediumPoly(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = source.getAttribute('position')
  const idx = source.index
  if (!pos || !idx) return source

  let positions: number[] = []
  for (let i = 0; i < pos.count; i++) {
    positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
  }
  let indices: number[] = []
  for (let i = 0; i < idx.count; i++) {
    indices.push(idx.getX(i))
  }

  // 2 subdivision passes: transforms 16-sided cylinder to 64-sided smooth column
  for (let pass = 0; pass < 2; pass++) {
    const edgeMap = new Map<string, number>()
    const nextPositions = [...positions]

    const getMidpoint = (i1: number, i2: number): number => {
      const min = Math.min(i1, i2)
      const max = Math.max(i1, i2)
      const key = `${min}:${max}`
      const cached = edgeMap.get(key)
      if (cached !== undefined) return cached

      const x1 = positions[i1 * 3]!
      const y1 = positions[i1 * 3 + 1]!
      const z1 = positions[i1 * 3 + 2]!
      const x2 = positions[i2 * 3]!
      const y2 = positions[i2 * 3 + 1]!
      const z2 = positions[i2 * 3 + 2]!
      let mx = (x1 + x2) * 0.5
      let my = (y1 + y2) * 0.5
      let mz = (z1 + z2) * 0.5

      // 1. Pedestal round cylinder curvature (y < -1.5, r in [0.15, 0.35])
      const r1 = Math.hypot(x1, z1)
      const r2 = Math.hypot(x2, z2)
      if (my < -1.5 && Math.abs(r1 - r2) < 0.025 && r1 > 0.15 && r1 < 0.35) {
        const avgR = (r1 + r2) * 0.5
        const angle = Math.atan2(mz, mx)
        mx = Math.cos(angle) * avgR
        mz = Math.sin(angle) * avgR
      }

      // 2. Front corners curvature (x near -1.0 or 1.0, z near -1.0, r in [0.18, 0.32])
      for (const cx of [-1.0, 1.0]) {
        const cz = -1.0
        const cr1 = Math.hypot(x1 - cx, z1 - cz)
        const cr2 = Math.hypot(x2 - cx, z2 - cz)
        if (my > -1.5 && Math.abs(cr1 - cr2) < 0.03 && cr1 > 0.18 && cr1 < 0.32) {
          const avgCR = (cr1 + cr2) * 0.5
          const cAngle = Math.atan2(mz - cz, mx - cx)
          mx = cx + Math.cos(cAngle) * avgCR
          mz = cz + Math.sin(cAngle) * avgCR
        }
      }

      const nextIdx = nextPositions.length / 3
      nextPositions.push(mx, my, mz)
      edgeMap.set(key, nextIdx)
      return nextIdx
    }

    const nextIndices: number[] = []
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]!
      const b = indices[i + 1]!
      const c = indices[i + 2]!
      const ab = getMidpoint(a, b)
      const bc = getMidpoint(b, c)
      const ca = getMidpoint(c, a)
      nextIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
    }
    positions = nextPositions
    indices = nextIndices
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setIndex(indices)

  const merged = mergeVertices(geom, 1e-4)
  const creased = toCreasedNormals(merged, THREE.MathUtils.degToRad(35))
  const result = mergeVertices(creased, 1e-4)
  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}
