import { onUnmounted, watch } from 'vue'
import { useGLTF } from '@tresjs/cientos'
import type { HandwashingSequenceController } from '~/lib/handwashing/controllers/HandwashingSequenceController'
import { applyNeoBrutalistStyle } from '~/lib/handwashing/rendering/applySceneStyle'

const MODEL_URL = 'models/washand.glb'

/**
 * Loads the handwashing GLB, applies the visual style, binds the hand rig to the
 * controller and starts playback once the model is ready.
 */
export function useHandwashingModel(controller: HandwashingSequenceController) {
  const { state: model, isLoading } = useGLTF(MODEL_URL)

  watch(
    () => model.value,
    (loaded) => {
      if (!loaded?.scene) return
      applyNeoBrutalistStyle(loaded.scene)
      controller.bindScene(loaded.scene)
      controller.restart(true)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    const faucet = model.value?.scene?.getObjectByName('faucet')
    if (faucet) faucet.visible = true
    controller.dispose()
  })

  return { model, isLoading }
}
