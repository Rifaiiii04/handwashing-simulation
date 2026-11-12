import { computed, ref, watch } from 'vue'
import type { HandwashingSequenceController } from '~/lib/handwashing/controllers/HandwashingSequenceController'
import { HANDWASHING_SECTIONS, type HandwashingStepSection } from '~/lib/handwashing/config/handwashingStepsData'

type SectionId = HandwashingStepSection['id']

/** Which UI section a sequence stage belongs to. */
function sectionIdForStage(stageIndex: number): SectionId | null {
  if (stageIndex <= 1) return 'persiapan'
  if (stageIndex <= 3) return 'langkah1'
  if (stageIndex === 4) return 'langkah2'
  if (stageIndex === 5) return 'langkah3'
  if (stageIndex === 6) return 'langkah4'
  if (stageIndex === 7) return 'langkah5'
  if (stageIndex >= 8) return 'langkah6'
  return null
}

/**
 * UI-facing step navigation: keeps the active section in sync with playback
 * and exposes the handlers used by the topbar and step dock.
 */
export function useHandwashingSteps(controller: HandwashingSequenceController) {
  const sections = HANDWASHING_SECTIONS
  const seqState = controller.state

  const activeSectionId = ref<SectionId>('persiapan')
  const currentSection = computed<HandwashingStepSection>(
    () => sections.find((s) => s.id === activeSectionId.value) ?? sections[0]!,
  )

  // Follow the animation as it moves from stage to stage.
  watch(
    () => seqState.stageIndex,
    (stageIndex) => {
      const id = sectionIdForStage(stageIndex)
      if (id) activeSectionId.value = id
    },
  )

  function selectSection(section: HandwashingStepSection): void {
    if (!section.enabled) return
    activeSectionId.value = section.id
    controller.goToStage(section.startStageIndex, true)
  }

  function selectSectionAt(offset: -1 | 1): void {
    const index = sections.findIndex((s) => s.id === activeSectionId.value)
    const target = sections[index + offset]
    if (target?.enabled) selectSection(target)
  }

  function reset(): void {
    activeSectionId.value = 'persiapan'
    controller.restart(true)
  }

  function togglePlay(): void {
    if (seqState.isPlaying) {
      controller.pause()
    } else if (seqState.stageProgress >= 0.99) {
      // Finished or near the end of the step: replay it from the start.
      selectSection(currentSection.value)
    } else {
      controller.play()
    }
  }

  return {
    sections,
    activeSectionId,
    currentSection,
    selectSection,
    previous: () => selectSectionAt(-1),
    next: () => selectSectionAt(1),
    reset,
    togglePlay,
  }
}
