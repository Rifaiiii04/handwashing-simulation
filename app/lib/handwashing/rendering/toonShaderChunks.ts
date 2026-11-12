import type { WebGLProgramParametersWithUniforms } from 'three'

/** The GLSL line in three's MeshToonMaterial that every neo-brutalist shader swaps out. */
const OUTGOING_LIGHT_CHUNK =
  'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;'

/**
 * Replaces the stock toon lighting result with a custom cel-shaded one.
 * Call this inside `material.onBeforeCompile`.
 */
export function replaceOutgoingLight(shader: WebGLProgramParametersWithUniforms, glsl: string): void {
  shader.fragmentShader = shader.fragmentShader.replace(OUTGOING_LIGHT_CHUNK, glsl)
}
