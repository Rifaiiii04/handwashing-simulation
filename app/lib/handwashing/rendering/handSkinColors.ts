import * as THREE from 'three'

/**
 * Paints per-vertex colors so the back of the hand is slightly darker than the
 * palm. `isRight` selects which rest-pose palm normal is used.
 */
export function applyHandTwoToneColors(mesh: THREE.SkinnedMesh, isRight: boolean) {
  const norm = mesh.geometry.attributes.normal
  if (!norm) return
  // Palm normal in rest pose:
  // Right hand points inward-left: (-0.956, 0.293, 0)
  // Left hand points inward-right: (0.943, 0.333, 0)
  const palmNormal = isRight
    ? new THREE.Vector3(-0.956, 0.293, 0).normalize()
    : new THREE.Vector3(0.943, 0.333, 0).normalize()

  // Neo-Brutalist palette: natural, healthy skin tones with gentle contrast
  // Dorsal (punggung tangan & pergelangan): warm honey-sand tan tone (not dark brown)
  const dorsalColor = new THREE.Color('#D9A28A')
  // Palmar (telapak tangan): warm natural peach-sand tone (distinctly lighter, soft & natural)
  const palmarColor = new THREE.Color('#ECD2C0')

  const colors = new Float32Array(norm.count * 3)
  const tempColor = new THREE.Color()

  for (let i = 0; i < norm.count; i++) {
    const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i)
    const dot = nx * palmNormal.x + ny * palmNormal.y + nz * palmNormal.z
    const t = THREE.MathUtils.smoothstep(dot, -0.30, 0.30)
    tempColor.copy(dorsalColor).lerp(palmarColor, t)

    colors[i * 3] = tempColor.r
    colors[i * 3 + 1] = tempColor.g
    colors[i * 3 + 2] = tempColor.b
  }

  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  if (mesh.geometry.attributes.color) {
    mesh.geometry.attributes.color.needsUpdate = true
  }
}
