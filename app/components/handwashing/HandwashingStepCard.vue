<script setup lang="ts">
import { computed } from 'vue'
import type { HandwashingSequenceController } from '~/lib/handwashing/HandwashingSequenceController'
import type { HandwashingStepSection } from '~/lib/handwashing/handwashingStepsData'

const props = defineProps<{
  controller: HandwashingSequenceController
  currentSection: HandwashingStepSection
  isVisible: boolean
}>()

const emit = defineEmits<{
  (e: 'toggleVisible'): void
}>()

const state = props.controller.state

// Progress percentage within the current active section
const sectionProgressPercent = computed(() => {
  if (props.currentSection.startStageIndex === props.currentSection.endStageIndex) {
    if (state.stageIndex === props.currentSection.startStageIndex) {
      return Math.round(state.stageProgress * 100)
    }
    return state.stageIndex > props.currentSection.startStageIndex ? 100 : 0
  }

  const totalStages = props.currentSection.endStageIndex - props.currentSection.startStageIndex + 1
  if (state.stageIndex < props.currentSection.startStageIndex) return 0
  if (state.stageIndex > props.currentSection.endStageIndex) return 100

  const stageOffset = state.stageIndex - props.currentSection.startStageIndex
  const overall = (stageOffset + state.stageProgress) / totalStages
  return Math.min(100, Math.max(0, Math.round(overall * 100)))
})
</script>

<template>
  <div>
    <!-- Minimized Floating Pill Button in Light Mode -->
    <Transition name="fade-slide">
      <button
        v-if="!isVisible"
        type="button"
        class="fixed left-3 top-28 sm:left-6 sm:top-20 z-20 apple-light-min-pill flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold text-slate-800 transition-all duration-300 shadow-md"
        title="Buka Penjelasan & Manfaat Langkah"
        @click="emit('toggleVisible')"
      >
        <img src="/logo.png" alt="Logo Kemenkes" class="w-4 h-4 object-contain" />
        <span>Lihat Penjelasan & Manfaat</span>
      </button>
    </Transition>

    <!-- Expanded Apple Light Glassmorphism Modal / Popup Card -->
    <Transition name="modal-pop">
      <div
        v-if="isVisible"
        class="fixed left-3 top-28 sm:left-6 sm:top-20 z-20 w-[calc(100vw-1.5rem)] sm:w-96 max-w-sm apple-light-glass-card rounded-2xl sm:rounded-3xl p-4 sm:p-5 text-slate-800 select-none transition-all duration-300 pointer-events-auto"
      >
        <!-- Card Top Bar: Badge, Title & Hide Button -->
        <div class="flex items-start justify-between gap-2 mb-3">
          <div class="min-w-0 flex-1">
            <!-- Kemenkes Official Badge -->
            <div class="flex items-center gap-1.5 mb-1">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-teal-50 text-[#00877d] border border-teal-200">
                <img src="/logo.png" alt="Logo Kemenkes" class="w-3.5 h-3.5 object-contain" />
                Standar CTPS Kemenkes
              </span>
              <span class="text-[10px] text-slate-400 font-mono">
                {{ currentSection.estimatedDuration }}
              </span>
            </div>

            <h3 class="text-sm sm:text-base font-bold text-slate-900 tracking-tight leading-snug">
              {{ currentSection.guidanceTitle }}
            </h3>
            <p class="text-[11px] text-slate-500 font-medium">
              {{ currentSection.subLabel }}
            </p>
          </div>

          <!-- Close / Hide Button -->
          <button
            type="button"
            class="shrink-0 p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
            title="Sembunyikan Kotak Penjelasan"
            @click="emit('toggleVisible')"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Live Status Indicators & Progress -->
        <div class="space-y-2 mb-3.5">
          <!-- Status Chips Row -->
          <div class="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
            <!-- Keran Status -->
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors duration-200"
              :class="state.faucetActive ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-500 border border-slate-200'"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="state.faucetActive ? 'bg-blue-500 animate-pulse' : 'bg-slate-400'" />
              Air: {{ state.faucetActive ? 'Mengalir' : 'Mati' }}
            </span>

            <!-- Busa Status -->
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors duration-200"
              :class="state.foamIntensity > 0.05 ? 'bg-teal-50 text-[#00877d] border border-teal-200' : 'bg-slate-100 text-slate-500 border border-slate-200'"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="state.foamIntensity > 0.05 ? 'bg-[#00A99D]' : 'bg-slate-400'" />
              Busa Sabun: {{ Math.round(state.foamIntensity * 100) }}%
            </span>
          </div>

          <!-- Apple Style Progress Bar -->
          <div class="space-y-1">
            <div class="flex justify-between items-center text-[10px] text-slate-500 font-medium">
              <span>Kemajuan Langkah</span>
              <span class="font-mono font-bold text-slate-700">{{ sectionProgressPercent }}%</span>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 p-[1px] border border-slate-200">
              <div
                class="h-full rounded-full bg-gradient-to-r from-[#00A99D] via-teal-400 to-[#C4D600] transition-all duration-100 ease-out"
                :style="{ width: `${sectionProgressPercent}%` }"
              />
            </div>
          </div>
        </div>

        <!-- Scrollable Content Body -->
        <div class="space-y-3 max-h-[50vh] overflow-y-auto pr-1 scrollbar-light">
          <!-- Section 1: Panduan Gerakan Detail -->
          <div class="p-3 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-1.5">
            <div class="flex items-center gap-1.5 text-xs font-bold text-[#00A99D]">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
              </svg>
              <span>Panduan Gerakan</span>
            </div>
            <p class="text-[11px] leading-relaxed text-slate-700 font-normal">
              {{ currentSection.guidanceDescription }}
            </p>
            <ul class="space-y-1 pt-1">
              <li
                v-for="(point, idx) in currentSection.movementPoints"
                :key="idx"
                class="flex items-start gap-1.5 text-[10.5px] leading-normal text-slate-600"
              >
                <span class="shrink-0 w-3.5 h-3.5 rounded-full bg-teal-100 text-[#00A99D] text-[9px] font-bold flex items-center justify-center mt-0.5">
                  {{ idx + 1 }}
                </span>
                <span>{{ point }}</span>
              </li>
            </ul>
          </div>

          <!-- Section 2: Manfaat Medis & Kebersihan (Kemenkes) -->
          <div class="p-3 rounded-xl bg-gradient-to-br from-teal-50/70 to-lime-50/50 border border-teal-200/80 space-y-1.5">
            <div class="flex items-center gap-1.5 text-xs font-bold text-[#6f8a00]">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <span>{{ currentSection.benefitsTitle }}</span>
            </div>
            <p class="text-[11px] font-medium text-slate-800 leading-relaxed">
              {{ currentSection.benefitsSummary }}
            </p>
            <ul class="space-y-1 pt-1 border-t border-teal-200/60">
              <li
                v-for="(benefit, bIdx) in currentSection.benefitsPoints"
                :key="bIdx"
                class="flex items-start gap-1.5 text-[10.5px] leading-normal text-slate-700"
              >
                <span class="shrink-0 text-[#7a9e00] text-xs font-bold mt-0.5">✓</span>
                <span>{{ benefit }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- Card Footer Note -->
        <div class="mt-3 pt-2 border-t border-slate-200/80 flex items-center justify-between text-[10px] text-slate-500 font-medium">
          <span>Area Fokus: {{ currentSection.focalAreaName }}</span>
          <span class="hover:underline cursor-pointer text-[#00A99D] font-semibold" @click="emit('toggleVisible')">Tutup [✕]</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Apple Light Glassmorphism Card */
.apple-light-glass-card {
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(28px) saturate(190%);
  -webkit-backdrop-filter: blur(28px) saturate(190%);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 
    0 20px 45px -10px rgba(0, 169, 157, 0.12),
    0 8px 24px -4px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 1);
}

.apple-light-min-pill {
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(20px) saturate(190%);
  -webkit-backdrop-filter: blur(20px) saturate(190%);
  border: 1px solid rgba(0, 169, 157, 0.4);
  box-shadow: 
    0 6px 20px rgba(0, 169, 157, 0.15),
    0 2px 6px rgba(0, 0, 0, 0.04);
}

.apple-light-min-pill:hover {
  background: rgba(255, 255, 255, 0.98);
  border-color: rgba(0, 169, 157, 0.7);
  transform: translateY(-1px);
}

.apple-light-min-pill:active {
  transform: scale(0.97);
}

/* Modal Pop Transitions */
.modal-pop-enter-active,
.modal-pop-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-pop-enter-from,
.modal-pop-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(6px);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease-out;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

/* Custom subtle scrollbar */
.scrollbar-light::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-light::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.03);
  border-radius: 4px;
}
.scrollbar-light::-webkit-scrollbar-thumb {
  background: rgba(0, 169, 157, 0.35);
  border-radius: 4px;
}
.scrollbar-light::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 169, 157, 0.6);
}
</style>
