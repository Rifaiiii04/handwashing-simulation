<script setup lang="ts">
import { computed } from "vue";
import type { HandwashingSequenceController } from "~/lib/handwashing/controllers/HandwashingSequenceController";
import type { HandwashingStepSection } from "~/lib/handwashing/config/handwashingStepsData";

const props = defineProps<{
  controller: HandwashingSequenceController;
  sections: readonly HandwashingStepSection[];
  currentSection: HandwashingStepSection;
  activeSectionId: string;
}>();

const emit = defineEmits<{
  (e: "selectSection", section: HandwashingStepSection): void;
  (e: "previous"): void;
  (e: "next"): void;
  (e: "togglePlay"): void;
}>();

const state = props.controller.state;

const steps = computed(() => props.sections.filter((s) => s.enabled));
const currentIndex = computed(() =>
  steps.value.findIndex((s) => s.id === props.activeSectionId),
);
const canGoPrevious = computed(() => currentIndex.value > 0);
const canGoNext = computed(
  () => currentIndex.value >= 0 && currentIndex.value < steps.value.length - 1,
);

const stepLabel = computed(() =>
  currentIndex.value <= 0
    ? "Persiapan"
    : `Langkah ${currentIndex.value} dari ${steps.value.length - 1}`,
);

const progressPercent = computed(() => {
  const section = props.currentSection;
  const total = section.endStageIndex - section.startStageIndex + 1;
  if (state.stageIndex < section.startStageIndex) return 0;
  if (state.stageIndex > section.endStageIndex) return 100;

  const overall =
    (state.stageIndex - section.startStageIndex + state.stageProgress) / total;

  return Math.min(100, Math.max(0, Math.round(overall * 100)));
});
</script>

<template>
  <section
    class="fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5 pointer-events-none select-none"
    aria-label="Kontrol langkah cuci tangan"
  >
    <div
      class="dock pointer-events-auto w-full max-w-2xl overflow-hidden rounded-3xl"
    >
      <div
        class="h-1 w-full bg-slate-200/70"
        role="progressbar"
        aria-label="Kemajuan langkah"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="progressPercent"
      >
        <div
          class="h-full rounded-r-full bg-[#00A99D] transition-[width] duration-100 ease-out"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>

      <div class="space-y-3 p-3 sm:p-4">
        <!-- Current step + play -->
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-[#00877d]">
              {{ stepLabel }}
              <span class="font-medium text-slate-400">
                · {{ currentSection.estimatedDuration }}</span
              >
            </p>
            <h2
              class="mt-0.5 truncate text-base font-bold leading-snug text-slate-900 sm:text-lg"
            >
              {{ currentSection.subLabel }}
            </h2>
            <p
              class="mt-0.5 line-clamp-2 text-xs leading-snug text-slate-600 sm:text-sm"
            >
              {{ currentSection.summary }}
            </p>
          </div>

          <button
            type="button"
            class="play-btn flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white sm:h-16 sm:w-16"
            :class="
              state.isPlaying
                ? 'bg-amber-500 hover:bg-amber-600'
                : 'bg-[#00A99D] hover:bg-[#009388]'
            "
            :aria-label="state.isPlaying ? 'Jeda' : 'Putar'"
            :title="state.isPlaying ? 'Jeda' : 'Putar'"
            @click="emit('togglePlay')"
          >
            <svg
              v-if="state.isPlaying"
              class="h-6 w-6 fill-current"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect x="6" y="4" width="4" height="16" rx="1.5" />
              <rect x="14" y="4" width="4" height="16" rx="1.5" />
            </svg>
            <svg
              v-else
              class="ml-0.5 h-6 w-6 fill-current"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
          </button>
        </div>

        <!-- Step navigation -->
        <div class="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            class="nav-btn"
            :disabled="!canGoPrevious"
            aria-label="Langkah sebelumnya"
            title="Langkah sebelumnya"
            @click="emit('previous')"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <nav
            class="grid flex-1 grid-flow-col auto-cols-fr gap-1 rounded-full bg-slate-100/90 p-1"
            aria-label="Pilih langkah"
          >
            <button
              v-for="(section, idx) in steps"
              :key="section.id"
              type="button"
              class="step-btn"
              :class="
                section.id === activeSectionId
                  ? 'bg-[#00A99D] text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white'
              "
              :aria-label="section.label"
              :aria-current="
                section.id === activeSectionId ? 'step' : undefined
              "
              :title="section.label"
              @click="emit('selectSection', section)"
            >
              <svg
                v-if="idx === 0"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path
                  d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"
                />
              </svg>
              <span v-else class="text-sm font-bold">{{ idx }}</span>
            </button>
          </nav>

          <button
            type="button"
            class="nav-btn"
            :disabled="!canGoNext"
            aria-label="Langkah berikutnya"
            title="Langkah berikutnya"
            @click="emit('next')"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.dock {
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow:
    0 20px 45px -10px rgba(0, 169, 157, 0.18),
    0 6px 18px -4px rgba(0, 0, 0, 0.08);
}

.play-btn {
  box-shadow: 0 8px 20px -4px rgba(0, 169, 157, 0.45);
  transition:
    background-color 0.2s,
    transform 0.15s;
}
.play-btn:active {
  transform: scale(0.94);
}
.play-btn:focus-visible,
.nav-btn:focus-visible,
.step-btn:focus-visible {
  outline: 2px solid #00a99d;
  outline-offset: 2px;
}

/* On phones the numbered steps are large enough to tap directly, so arrows are desktop-only. */
.nav-btn {
  display: none;
  height: 2.5rem;
  width: 2.5rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: #334155;
  background: #fff;
  border: 1px solid #e2e8f0;
  transition:
    background-color 0.2s,
    transform 0.15s;
}
@media (min-width: 640px) {
  .nav-btn {
    display: inline-flex;
  }
}
.nav-btn:hover:not(:disabled) {
  background: #f1f5f9;
}
.nav-btn:active:not(:disabled) {
  transform: scale(0.94);
}
.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.step-btn {
  display: inline-flex;
  height: 2.25rem;
  min-width: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  transition:
    background-color 0.2s,
    color 0.2s;
}
</style>
