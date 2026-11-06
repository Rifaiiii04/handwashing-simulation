<script setup lang="ts">
import { computed } from 'vue'
import type { HandwashingSequenceController } from '~/lib/handwashing/HandwashingSequenceController'
import type { HandwashingStepSection } from '~/lib/handwashing/handwashingStepsData'

const props = defineProps<{
  controller: HandwashingSequenceController
  sections: readonly HandwashingStepSection[]
  activeSectionId: string
  isCardVisible: boolean
  showTuning: boolean
}>()

const emit = defineEmits<{
  (e: 'selectSection', section: HandwashingStepSection): void
  (e: 'reset'): void
  (e: 'previous'): void
  (e: 'next'): void
  (e: 'togglePlay'): void
  (e: 'toggleCard'): void
  (e: 'openTuning'): void
}>()

const state = props.controller.state

// Only include the 4 active simulation steps in the topbar to keep it compact and uncluttered
const activeSteps = computed(() => {
  return props.sections.filter((s) => s.enabled)
})

const currentSectionIndex = computed(() => {
  return activeSteps.value.findIndex((s) => s.id === props.activeSectionId)
})

const canGoPrevious = computed(() => {
  return currentSectionIndex.value > 0
})

const canGoNext = computed(() => {
  return currentSectionIndex.value >= 0 && currentSectionIndex.value < activeSteps.value.length - 1
})
</script>

<template>
  <header
    class="fixed top-2.5 sm:top-4 inset-x-0 z-30 flex justify-center px-2.5 sm:px-6 pointer-events-none select-none"
  >
    <!-- Responsive Apple Light Glass Capsule: Wrapped on Mobile, Single Row on Desktop -->
    <div
      class="pointer-events-auto flex flex-col sm:flex-row items-center gap-2 sm:gap-2.5 p-2 sm:px-3.5 sm:py-2 rounded-2xl sm:rounded-full apple-light-pill transition-all duration-300 w-full sm:w-auto max-w-sm sm:max-w-none shadow-lg"
    >
      <!-- Top Row on Mobile: Logo & Identity on Left, Playback Controls on Right -->
      <div class="flex items-center justify-between sm:justify-start w-full sm:w-auto gap-2">
        <!-- 1. Authentic Kemenkes Logo Mark -->
        <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <img
            src="/logo.png"
            alt="Logo Kemenkes RI"
            class="w-6 h-6 sm:w-7 sm:h-7 object-contain shrink-0 drop-shadow-sm"
          />
          <div class="flex flex-col leading-none">
            <span class="text-[11px] sm:text-xs font-bold text-slate-800 tracking-tight">KEMENKES RI</span>
            <span class="text-[9px] font-semibold text-[#00A99D] tracking-tighter">CTPS 3D</span>
          </div>
        </div>

        <!-- Mobile-Only Controls Row -->
        <div class="flex sm:hidden items-center gap-1 shrink-0">
          <!-- Reset Button -->
          <button
            type="button"
            class="apple-light-icon-btn text-slate-600 hover:text-slate-900"
            title="Atur Ulang Simulasi (Reset)"
            @click="emit('reset')"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>

          <!-- Previous Button -->
          <button
            type="button"
            :disabled="!canGoPrevious"
            class="apple-light-icon-btn text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none"
            title="Langkah Sebelumnya"
            @click="emit('previous')"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <!-- Play / Pause Compact Pill -->
          <button
            type="button"
            class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-white shadow-sm transition-all duration-200 active:scale-95"
            :class="state.isPlaying
              ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20'
              : 'bg-[#00A99D] hover:bg-[#009388] shadow-teal-500/25'"
            :title="state.isPlaying ? 'Jeda Simulasi' : 'Mulai / Putar Simulasi'"
            @click="emit('togglePlay')"
          >
            <svg v-if="state.isPlaying" class="w-3 h-3 fill-current" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1.5" />
              <rect x="14" y="4" width="4" height="16" rx="1.5" />
            </svg>
            <svg v-else class="w-3 h-3 fill-current" viewBox="0 0 24 24">
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
            <span class="text-xs">{{ state.isPlaying ? 'Pause' : 'Play' }}</span>
          </button>

          <!-- Next Button -->
          <button
            type="button"
            :disabled="!canGoNext"
            class="apple-light-icon-btn text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none"
            title="Langkah Berikutnya"
            @click="emit('next')"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>

          <!-- Info Card Toggle -->
          <button
            type="button"
            class="apple-light-icon-btn transition-colors"
            :class="isCardVisible ? 'bg-teal-50 text-[#00A99D] border-teal-200' : 'text-slate-600 hover:text-slate-900'"
            :title="isCardVisible ? 'Sembunyikan Kotak Penjelasan' : 'Tampilkan Kotak Penjelasan'"
            @click="emit('toggleCard')"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Desktop-Only Divider -->
      <div class="hidden sm:block h-4 sm:h-5 w-[1px] bg-slate-200/90 shrink-0" />

      <!-- 2. Segmented Step Selector (Bottom Row on Mobile, Center on Desktop) -->
      <nav
        class="flex items-center justify-between sm:justify-start w-full sm:w-auto bg-slate-100/90 p-0.5 rounded-full border border-slate-200/70 shrink-0"
        aria-label="Pilih Langkah"
      >
        <button
          v-for="section in activeSteps"
          :key="section.id"
          type="button"
          class="flex-1 sm:flex-initial text-center px-2 sm:px-3.5 py-1 rounded-full text-[11px] sm:text-xs font-medium transition-all duration-200 outline-none"
          :class="[
            section.id === activeSectionId
              ? 'bg-[#00A99D] text-white font-semibold shadow-[0_2px_8px_rgba(0,169,157,0.35)]'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
          ]"
          @click="emit('selectSection', section)"
        >
          <!-- Full label on md+ screens, shortLabel on small screens -->
          <span class="hidden md:inline">{{ section.label }}</span>
          <span class="md:hidden">{{ section.shortLabel }}</span>
        </button>
      </nav>

      <!-- Desktop-Only Divider -->
      <div class="hidden sm:block h-4 sm:h-5 w-[1px] bg-slate-200/90 shrink-0" />

      <!-- 3. Desktop-Only Playback Controls -->
      <div class="hidden sm:flex items-center gap-1 sm:gap-1.5 shrink-0">
        <!-- Reset Button -->
        <button
          type="button"
          class="apple-light-icon-btn text-slate-600 hover:text-slate-900"
          title="Atur Ulang Simulasi (Reset)"
          @click="emit('reset')"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>

        <!-- Previous Button -->
        <button
          type="button"
          :disabled="!canGoPrevious"
          class="apple-light-icon-btn text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none"
          title="Langkah Sebelumnya"
          @click="emit('previous')"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        <!-- Play / Pause Compact Pill -->
        <button
          type="button"
          class="flex items-center gap-1 px-2.5 sm:px-3 py-1 rounded-full text-xs font-semibold text-white shadow-sm transition-all duration-200 active:scale-95"
          :class="state.isPlaying
            ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20'
            : 'bg-[#00A99D] hover:bg-[#009388] shadow-teal-500/25'"
          :title="state.isPlaying ? 'Jeda Simulasi' : 'Mulai / Putar Simulasi'"
          @click="emit('togglePlay')"
        >
          <svg v-if="state.isPlaying" class="w-3 h-3 fill-current" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1.5" />
            <rect x="14" y="4" width="4" height="16" rx="1.5" />
          </svg>
          <svg v-else class="w-3 h-3 fill-current" viewBox="0 0 24 24">
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
          <span class="text-xs">{{ state.isPlaying ? 'Pause' : 'Play' }}</span>
        </button>

        <!-- Next Button -->
        <button
          type="button"
          :disabled="!canGoNext"
          class="apple-light-icon-btn text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none"
          title="Langkah Berikutnya"
          @click="emit('next')"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>

        <!-- Info Card Toggle -->
        <button
          type="button"
          class="apple-light-icon-btn transition-colors"
          :class="isCardVisible ? 'bg-teal-50 text-[#00A99D] border-teal-200' : 'text-slate-600 hover:text-slate-900'"
          :title="isCardVisible ? 'Sembunyikan Kotak Penjelasan' : 'Tampilkan Kotak Penjelasan'"
          @click="emit('toggleCard')"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </button>

        <!-- Tuning Panel Toggle -->
        <button
          v-if="!showTuning"
          type="button"
          class="apple-light-icon-btn text-slate-400 hover:text-slate-700"
          title="Buka Panel Tuning Debug"
          @click="emit('openTuning')"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" x2="20" y1="21" y2="21" />
            <line x1="4" x2="20" y1="3" y2="3" />
            <line x1="4" x2="20" y1="12" y2="12" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="16" cy="3" r="2" />
            <circle cx="8" cy="21" r="2" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
/* Apple Light Glassmorphism Capsule */
.apple-light-pill {
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(24px) saturate(190%);
  -webkit-backdrop-filter: blur(24px) saturate(190%);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 
    0 10px 30px -5px rgba(0, 169, 157, 0.12),
    0 4px 12px -2px rgba(0, 0, 0, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 1);
}

.apple-light-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.875rem;
  height: 1.875rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(226, 232, 240, 0.8);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.apple-light-icon-btn:hover {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(203, 213, 225, 1);
  transform: translateY(-0.5px);
}

.apple-light-icon-btn:active {
  transform: scale(0.95);
}
</style>
