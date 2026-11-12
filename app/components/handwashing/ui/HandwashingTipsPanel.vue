<script setup lang="ts">
import type { HandwashingStepSection } from '~/lib/handwashing/config/handwashingStepsData'

defineProps<{
  section: HandwashingStepSection
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <Transition name="tips-pop">
    <aside
      v-if="isOpen"
      class="tips-card fixed inset-x-3 top-[4.75rem] z-20 max-h-[calc(100dvh-17rem)] overflow-y-auto rounded-3xl p-4 sm:inset-x-auto sm:right-6 sm:top-[5.25rem] sm:w-80 sm:p-5 select-none"
      aria-label="Tips langkah ini"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs font-semibold text-[#00877d]">Tips</p>
          <h3 class="text-base font-bold leading-snug text-slate-900">{{ section.subLabel }}</h3>
        </div>
        <button
          type="button"
          class="close-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
          aria-label="Tutup tips"
          title="Tutup tips"
          @click="emit('close')"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <ol class="mt-3 space-y-2">
        <li
          v-for="(point, idx) in section.movementPoints"
          :key="idx"
          class="flex items-start gap-2.5 text-sm leading-snug text-slate-700"
        >
          <span class="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-[#00877d]">
            {{ idx + 1 }}
          </span>
          <span>{{ point }}</span>
        </li>
      </ol>

      <div class="mt-4 rounded-2xl bg-teal-50 p-3 text-sm leading-snug text-slate-700">
        <p class="mb-0.5 text-xs font-bold text-[#00877d]">Kenapa penting?</p>
        {{ section.benefit }}
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.tips-card {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 20px 45px -10px rgba(0, 169, 157, 0.18), 0 6px 18px -4px rgba(0, 0, 0, 0.08);
}

.close-btn { transition: background-color 0.2s; }
.close-btn:focus-visible { outline: 2px solid #00A99D; outline-offset: 2px; }

.tips-pop-enter-active,
.tips-pop-leave-active {
  transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.tips-pop-enter-from,
.tips-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
</style>
