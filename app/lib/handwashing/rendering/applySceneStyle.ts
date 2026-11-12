import * as THREE from 'three'
import { createNeoBrutalistFaucetMaterial } from './faucetMaterial'
import { createNeoBrutalistHandMaterial, createNeoBrutalistNailMaterial } from './handMaterial'
import { applyHandTwoToneColors } from './handSkinColors'
import { refineSinkToMediumPoly } from './sinkGeometry'
import { createNeoBrutalistSinkMaterial } from './sinkMaterial'

/** Node names inside `washand.glb` that receive custom materials. */
const NODE = {
  sink: 'sink',
  sinkWater: 'SinkWaterSurface',
  rightHand: 'Hand_AR_V2',
  leftHand: 'Hand_AR_V2001',
  rightNail: 'Hand_AR_V2_1',
  leftNail: 'Hand_AR_V2001_1',
  faucet: 'faucet',
} as const

/**
 * Applies the neo-brutalist look to the loaded GLB scene: smoother sink
 * geometry, cel-shaded materials and two-tone hand skin.
 */
export function applyNeoBrutalistStyle(scene: THREE.Object3D): void {
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.name.toLowerCase() === NODE.sink) {
      const mesh = child as THREE.Mesh
      mesh.geometry = refineSinkToMediumPoly(mesh.geometry)
      mesh.material = createNeoBrutalistSinkMaterial()
    }
    if (child.name === NODE.sinkWater) {
      child.visible = true
    }
    if (child.name === NODE.rightHand) {
      const mesh = child as THREE.SkinnedMesh
      applyHandTwoToneColors(mesh, true)
      mesh.material = createNeoBrutalistHandMaterial()
    }
    if (child.name === NODE.leftHand) {
      const mesh = child as THREE.SkinnedMesh
      applyHandTwoToneColors(mesh, false)
      mesh.material = createNeoBrutalistHandMaterial()
    }
    if (child.name === NODE.rightNail || child.name === NODE.leftNail) {
      const mesh = child as THREE.SkinnedMesh
      mesh.material = createNeoBrutalistNailMaterial()
    }
    if (child.name === NODE.faucet) {
      const mesh = child as THREE.Mesh
      mesh.material = createNeoBrutalistFaucetMaterial()
    }
  })
}
