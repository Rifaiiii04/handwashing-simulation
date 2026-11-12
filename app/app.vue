<script setup lang="ts">
import { ref } from 'vue'
import { HandwashingSequenceController } from '~/lib/handwashing/controllers/HandwashingSequenceController'
import HandwashingScene from '~/components/handwashing/scene/HandwashingScene.vue'
import HandwashingLoading from '~/components/handwashing/ui/HandwashingLoading.vue'
import HandwashingTopbar from '~/components/handwashing/ui/HandwashingTopbar.vue'
import HandwashingStepDock from '~/components/handwashing/ui/HandwashingStepDock.vue'
import HandwashingTipsPanel from '~/components/handwashing/ui/HandwashingTipsPanel.vue'

useHead({
  title: 'Kemenkes RI · Cuci Tangan Pakai Sabun',
  link: [{ rel: 'icon', type: 'image/png', href: '/logo.png' }],
})

const controller = new HandwashingSequenceController()
const { model, isLoading } = useHandwashingModel(controller)
const { sections, activeSectionId, currentSection, selectSection, previous, next, reset, togglePlay } =
  useHandwashingSteps(controller)

const isTipsOpen = ref(false)
</script>

<template>
  <div class="studio-bg relative w-full h-dvh overflow-hidden select-none">
    <HandwashingLoading v-if="isLoading" />
    <HandwashingScene v-else :model-scene="model?.scene" :controller="controller" />

    <template v-if="!isLoading">
      <!-- Header: identity, restart and tips toggle -->
      <HandwashingTopbar
        :is-tips-open="isTipsOpen"
        @reset="reset"
        @toggle-tips="isTipsOpen = !isTipsOpen"
      />

      <!-- Tips for the current step (hidden by default) -->
      <HandwashingTipsPanel
        :section="currentSection"
        :is-open="isTipsOpen"
        @close="isTipsOpen = false"
      />

      <!-- Bottom dock: current step, play and step navigation -->
      <HandwashingStepDock
        :controller="controller"
        :sections="sections"
        :current-section="currentSection"
        :active-section-id="activeSectionId"
        @select-section="selectSection"
        @previous="previous"
        @next="next"
        @toggle-play="togglePlay"
      />
    </template>
  </div>
</template>

<style scoped>
/* Studio gradient with Kemenkes color harmony (teal #00A99D + lime #C4D600). */
.studio-bg {
  background-color: #cad9d8;
  background:
    radial-gradient(ellipse 65% 55% at 15% 15%, rgba(0, 169, 157, 0.22) 0%, transparent 65%),
    radial-gradient(ellipse 60% 50% at 85% 85%, rgba(196, 214, 0, 0.14) 0%, transparent 65%),
    radial-gradient(ellipse 55% 45% at 80% 20%, rgba(0, 150, 180, 0.12) 0%, transparent 60%),
    radial-gradient(ellipse 70% 60% at 50% 45%, rgba(240, 247, 246, 0.40) 0%, transparent 80%),
    linear-gradient(135deg, #c5d7d5 0%, #d4e3e2 45%, #cadbd6 100%);
}
</style>
