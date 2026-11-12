<script setup lang="ts">
defineProps<{
  isTipsOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'reset'): void
  (e: 'toggleTips'): void
}>()
</script>

<template>
  <header
    class="fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-3 pt-3 sm:px-6 sm:pt-4 pointer-events-none select-none"
  >
    <!-- Identity -->
    <div class="pointer-events-auto flex min-w-0 items-center gap-2.5 rounded-full glass py-1.5 pl-2 pr-4">
      <img src="/logo.png" alt="Logo Kemenkes RI" class="h-8 w-8 shrink-0 object-contain sm:h-9 sm:w-9" />
      <div class="min-w-0 leading-tight">
        <p class="truncate text-sm font-bold text-slate-900 sm:text-base">Cuci Tangan Pakai Sabun</p>
        <p class="truncate text-[11px] font-medium text-[#00877d] sm:text-xs">Kementerian Kesehatan RI</p>
      </div>
    </div>

    <!-- Actions -->
    <div class="pointer-events-auto flex shrink-0 items-center gap-2">
      <button
        type="button"
        class="glass-btn h-10 w-10 sm:w-auto sm:gap-2 sm:px-4 text-slate-700"
        aria-label="Ulangi dari awal"
        title="Ulangi dari awal"
        @click="emit('reset')"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
        <span class="hidden text-sm font-semibold sm:inline">Ulangi</span>
      </button>

      <button
        type="button"
        class="glass-btn h-10 gap-2 px-3.5 sm:px-4"
        :class="isTipsOpen ? '!border-[#00A99D] !bg-[#00A99D] !text-white' : 'text-slate-700'"
        :aria-pressed="isTipsOpen"
        @click="emit('toggleTips')"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
          <path d="M9 18h6" />
          <path d="M10 22h4" />
        </svg>
        <span class="text-sm font-semibold">Tips</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.glass {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 8px 24px -6px rgba(0, 169, 157, 0.14), 0 2px 8px rgba(0, 0, 0, 0.05);
}

.glass-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 8px 24px -6px rgba(0, 169, 157, 0.14), 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: background-color 0.2s, color 0.2s, border-color 0.2s, transform 0.15s;
}
.glass-btn:hover { background: #fff; }
.glass-btn:active { transform: scale(0.96); }
.glass-btn:focus-visible { outline: 2px solid #00A99D; outline-offset: 2px; }
</style>
