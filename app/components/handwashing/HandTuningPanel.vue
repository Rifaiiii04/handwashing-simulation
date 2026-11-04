<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import {
  rubPalmsLiveTuning,
  updateRubPalmsTuning,
  resetRubPalmsTuning,
  DEFAULT_RUB_PALMS_TUNING,
  type RubPalmsLiveTuning,
} from '~/lib/handwashing/handwashingPoses'
import type { HandwashingSequenceController } from '~/lib/handwashing/HandwashingSequenceController'

const props = defineProps<{
  controller: HandwashingSequenceController
}>()

const isOpen = ref(true)
const isCopied = ref(false)
const loopStage4Only = ref(false)

type MainTab = 'rightHand' | 'leftHand' | 'rightFingers' | 'leftFingers' | 'code'
type FingerKey = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'
type ThumbJointKey = 'all' | 'base' | 'mid' | 'tip'

const activeTab = ref<MainTab>('rightFingers')
const activeRightFinger = ref<FingerKey | 'all'>('thumb')
const activeLeftFinger = ref<FingerKey | 'all'>('thumb')
const activeRightThumbJoint = ref<ThumbJointKey>('all')
const activeLeftThumbJoint = ref<ThumbJointKey>('all')

const fingerList: { key: FingerKey; label: string; icon: string }[] = [
  { key: 'thumb', label: 'Jempol', icon: '👍' },
  { key: 'index', label: 'Telunjuk', icon: '☝️' },
  { key: 'middle', label: 'Tengah', icon: '🖕' },
  { key: 'ring', label: 'Manis', icon: '💍' },
  { key: 'pinky', label: 'Kelingking', icon: '🤙' },
]

// Reactive local copy synced with live tuning
const tuning = reactive<RubPalmsLiveTuning>({
  rightOffsetY: rubPalmsLiveTuning.rightOffsetY,
  rightOffsetZ: rubPalmsLiveTuning.rightOffsetZ,
  rightOffsetX: rubPalmsLiveTuning.rightOffsetX,
  rightPitch: rubPalmsLiveTuning.rightPitch,
  rightYaw: rubPalmsLiveTuning.rightYaw,
  rightRoll: rubPalmsLiveTuning.rightRoll,

  leftOffsetY: rubPalmsLiveTuning.leftOffsetY,
  leftOffsetZ: rubPalmsLiveTuning.leftOffsetZ,
  leftOffsetX: rubPalmsLiveTuning.leftOffsetX,
  leftPitch: rubPalmsLiveTuning.leftPitch,
  leftYaw: rubPalmsLiveTuning.leftYaw,
  leftRoll: rubPalmsLiveTuning.leftRoll,

  rightThumbCurl: rubPalmsLiveTuning.rightThumbCurl,
  rightThumbSpread: rubPalmsLiveTuning.rightThumbSpread,
  rightThumbTwist: rubPalmsLiveTuning.rightThumbTwist,
  rightIndexCurl: rubPalmsLiveTuning.rightIndexCurl,
  rightIndexSpread: rubPalmsLiveTuning.rightIndexSpread,
  rightIndexTwist: rubPalmsLiveTuning.rightIndexTwist,
  rightMiddleCurl: rubPalmsLiveTuning.rightMiddleCurl,
  rightMiddleSpread: rubPalmsLiveTuning.rightMiddleSpread,
  rightMiddleTwist: rubPalmsLiveTuning.rightMiddleTwist,
  rightRingCurl: rubPalmsLiveTuning.rightRingCurl,
  rightRingSpread: rubPalmsLiveTuning.rightRingSpread,
  rightRingTwist: rubPalmsLiveTuning.rightRingTwist,
  rightPinkyCurl: rubPalmsLiveTuning.rightPinkyCurl,
  rightPinkySpread: rubPalmsLiveTuning.rightPinkySpread,
  rightPinkyTwist: rubPalmsLiveTuning.rightPinkyTwist,

  leftThumbCurl: rubPalmsLiveTuning.leftThumbCurl,
  leftThumbSpread: rubPalmsLiveTuning.leftThumbSpread,
  leftThumbTwist: rubPalmsLiveTuning.leftThumbTwist,
  leftIndexCurl: rubPalmsLiveTuning.leftIndexCurl,
  leftIndexSpread: rubPalmsLiveTuning.leftIndexSpread,
  leftIndexTwist: rubPalmsLiveTuning.leftIndexTwist,
  leftMiddleCurl: rubPalmsLiveTuning.leftMiddleCurl,
  leftMiddleSpread: rubPalmsLiveTuning.leftMiddleSpread,
  leftMiddleTwist: rubPalmsLiveTuning.leftMiddleTwist,
  leftRingCurl: rubPalmsLiveTuning.leftRingCurl,
  leftRingSpread: rubPalmsLiveTuning.leftRingSpread,
  leftRingTwist: rubPalmsLiveTuning.leftRingTwist,
  leftPinkyCurl: rubPalmsLiveTuning.leftPinkyCurl,
  leftPinkySpread: rubPalmsLiveTuning.leftPinkySpread,
  leftPinkyTwist: rubPalmsLiveTuning.leftPinkyTwist,

  // Right Thumb Per-Joint Bones
  rightThumbBaseCurl: rubPalmsLiveTuning.rightThumbBaseCurl,
  rightThumbBaseSpread: rubPalmsLiveTuning.rightThumbBaseSpread,
  rightThumbBaseTwist: rubPalmsLiveTuning.rightThumbBaseTwist,
  rightThumbMidCurl: rubPalmsLiveTuning.rightThumbMidCurl,
  rightThumbMidSpread: rubPalmsLiveTuning.rightThumbMidSpread,
  rightThumbMidTwist: rubPalmsLiveTuning.rightThumbMidTwist,
  rightThumbTipCurl: rubPalmsLiveTuning.rightThumbTipCurl,
  rightThumbTipSpread: rubPalmsLiveTuning.rightThumbTipSpread,
  rightThumbTipTwist: rubPalmsLiveTuning.rightThumbTipTwist,

  // Left Thumb Per-Joint Bones
  leftThumbBaseCurl: rubPalmsLiveTuning.leftThumbBaseCurl,
  leftThumbBaseSpread: rubPalmsLiveTuning.leftThumbBaseSpread,
  leftThumbBaseTwist: rubPalmsLiveTuning.leftThumbBaseTwist,
  leftThumbMidCurl: rubPalmsLiveTuning.leftThumbMidCurl,
  leftThumbMidSpread: rubPalmsLiveTuning.leftThumbMidSpread,
  leftThumbMidTwist: rubPalmsLiveTuning.leftThumbMidTwist,
  leftThumbTipCurl: rubPalmsLiveTuning.leftThumbTipCurl,
  leftThumbTipSpread: rubPalmsLiveTuning.leftThumbTipSpread,
  leftThumbTipTwist: rubPalmsLiveTuning.leftThumbTipTwist,
})

function applyChange() {
  updateRubPalmsTuning(tuning)
  props.controller.markPoseDirty()
}

function adjustMm(key: 'rightOffsetX' | 'rightOffsetY' | 'rightOffsetZ' | 'leftOffsetX' | 'leftOffsetY' | 'leftOffsetZ', deltaMm: number) {
  tuning[key] = Math.round((tuning[key] + deltaMm / 1000) * 10000) / 10000
  applyChange()
}

function adjustDeg(key: keyof RubPalmsLiveTuning, deltaDeg: number, decimals = 1) {
  tuning[key] = Math.round((tuning[key] + deltaDeg) * Math.pow(10, decimals)) / Math.pow(10, decimals)
  applyChange()
}

function applyRightThumbNatural() {
  tuning.rightThumbBaseCurl = -25.0
  tuning.rightThumbBaseSpread = 11.0
  tuning.rightThumbBaseTwist = 2.5
  tuning.rightThumbMidCurl = 0.5
  tuning.rightThumbMidSpread = -16.0
  tuning.rightThumbMidTwist = 38.5
  tuning.rightThumbTipCurl = 13.0
  tuning.rightThumbTipSpread = -5.0
  tuning.rightThumbTipTwist = -8.5
  applyChange()
}

function applyRightThumbOpenWide() {
  tuning.rightThumbBaseCurl = -25.0
  tuning.rightThumbBaseSpread = 25.0
  tuning.rightThumbBaseTwist = 2.5
  tuning.rightThumbMidCurl = 5.0
  tuning.rightThumbMidSpread = 5.0
  tuning.rightThumbMidTwist = -10.0
  tuning.rightThumbTipCurl = 10.0
  tuning.rightThumbTipSpread = -5.0
  tuning.rightThumbTipTwist = -8.5
  applyChange()
}

function applyLeftThumbNatural() {
  tuning.leftThumbBaseCurl = 10.5
  tuning.leftThumbBaseSpread = 8.0
  tuning.leftThumbBaseTwist = 40.0
  tuning.leftThumbMidCurl = 14.5
  tuning.leftThumbMidSpread = 20.0
  tuning.leftThumbMidTwist = 19.0
  tuning.leftThumbTipCurl = 4.0
  tuning.leftThumbTipSpread = 10.0
  tuning.leftThumbTipTwist = 0.0
  applyChange()
}

function doReset() {
  resetRubPalmsTuning()
  Object.assign(tuning, DEFAULT_RUB_PALMS_TUNING)
  applyChange()
}

function jumpToStage4() {
  props.controller.goToStage(3, true)
}

// Keep Stage 4 looping if enabled
watch(
  () => [props.controller.state.stageProgress, props.controller.state.stageIndex, loopStage4Only.value],
  ([prog, idx, loop]) => {
    if (loop && idx === 3 && typeof prog === 'number' && prog >= 0.98) {
      props.controller.goToStage(3, true)
    }
  }
)

const formattedCode = computed(() => {
  return [
    `// Nilai Kalibrasi Hasil Tuning Gosok Telapak (WHO Tahap 4):`,
    `// --- Posisi & Rotasi Tangan Kanan ---`,
    `CONTACT_RIGHT_BASE_OFF: [${tuning.rightOffsetX.toFixed(4)}, ${tuning.rightOffsetY.toFixed(4)}, ${tuning.rightOffsetZ.toFixed(4)}],`,
    `CONTACT_RIGHT_BASE_EULER: [${tuning.rightPitch}, ${tuning.rightYaw}, ${tuning.rightRoll}],`,
    ``,
    `// --- Posisi & Rotasi Tangan Kiri ---`,
    `CONTACT_LEFT_BASE_OFF: [${tuning.leftOffsetX.toFixed(4)}, ${tuning.leftOffsetY.toFixed(4)}, ${tuning.leftOffsetZ.toFixed(4)}],`,
    `CONTACT_LEFT_BASE_EULER: [${tuning.leftPitch}, ${tuning.leftYaw}, ${tuning.leftRoll}],`,
    ``,
    `// --- Artikulasi Jempol Kanan Per-Bone (Sendi 1, 2, 3) ---`,
    `rightThumbBase: { curl: ${tuning.rightThumbBaseCurl.toFixed(1)}, spread: ${tuning.rightThumbBaseSpread.toFixed(1)}, twist: ${tuning.rightThumbBaseTwist.toFixed(1)} }, // Bone.017 (Pangkal)`,
    `rightThumbMid:  { curl: ${tuning.rightThumbMidCurl.toFixed(1)}, spread: ${tuning.rightThumbMidSpread.toFixed(1)}, twist: ${tuning.rightThumbMidTwist.toFixed(1)} }, // Bone.018 (Tengah)`,
    `rightThumbTip:  { curl: ${tuning.rightThumbTipCurl.toFixed(1)}, spread: ${tuning.rightThumbTipSpread.toFixed(1)}, twist: ${tuning.rightThumbTipTwist.toFixed(1)} }, // Bone.019 (Ujung)`,
    ``,
    `// --- Artikulasi Jari Tangan Kanan Lainnya ---`,
    `rightIndex:  { curl: ${tuning.rightIndexCurl.toFixed(1)}, spread: ${tuning.rightIndexSpread.toFixed(1)}, twist: ${tuning.rightIndexTwist.toFixed(1)} },`,
    `rightMiddle: { curl: ${tuning.rightMiddleCurl.toFixed(1)}, spread: ${tuning.rightMiddleSpread.toFixed(1)}, twist: ${tuning.rightMiddleTwist.toFixed(1)} },`,
    `rightRing:   { curl: ${tuning.rightRingCurl.toFixed(1)}, spread: ${tuning.rightRingSpread.toFixed(1)}, twist: ${tuning.rightRingTwist.toFixed(1)} },`,
    `rightPinky:  { curl: ${tuning.rightPinkyCurl.toFixed(1)}, spread: ${tuning.rightPinkySpread.toFixed(1)}, twist: ${tuning.rightPinkyTwist.toFixed(1)} },`,
    ``,
    `// --- Artikulasi Jempol Kiri Per-Bone (Sendi 1, 2, 3) ---`,
    `leftThumbBase:  { curl: ${tuning.leftThumbBaseCurl.toFixed(1)}, spread: ${tuning.leftThumbBaseSpread.toFixed(1)}, twist: ${tuning.leftThumbBaseTwist.toFixed(1)} }, // Bone.017 (Pangkal)`,
    `leftThumbMid:   { curl: ${tuning.leftThumbMidCurl.toFixed(1)}, spread: ${tuning.leftThumbMidSpread.toFixed(1)}, twist: ${tuning.leftThumbMidTwist.toFixed(1)} }, // Bone.018 (Tengah)`,
    `leftThumbTip:   { curl: ${tuning.leftThumbTipCurl.toFixed(1)}, spread: ${tuning.leftThumbTipSpread.toFixed(1)}, twist: ${tuning.leftThumbTipTwist.toFixed(1)} }, // Bone.019 (Ujung)`,
    ``,
    `// --- Artikulasi Jari Tangan Kiri Lainnya ---`,
    `leftIndex:   { curl: ${tuning.leftIndexCurl.toFixed(1)}, spread: ${tuning.leftIndexSpread.toFixed(1)}, twist: ${tuning.leftIndexTwist.toFixed(1)} },`,
    `leftMiddle:  { curl: ${tuning.leftMiddleCurl.toFixed(1)}, spread: ${tuning.leftMiddleSpread.toFixed(1)}, twist: ${tuning.leftMiddleTwist.toFixed(1)} },`,
    `leftRing:    { curl: ${tuning.leftRingCurl.toFixed(1)}, spread: ${tuning.leftRingSpread.toFixed(1)}, twist: ${tuning.leftRingTwist.toFixed(1)} },`,
    `leftPinky:   { curl: ${tuning.leftPinkyCurl.toFixed(1)}, spread: ${tuning.leftPinkySpread.toFixed(1)}, twist: ${tuning.leftPinkyTwist.toFixed(1)} },`,
  ].join('\n')
})

async function copyValues() {
  try {
    await navigator.clipboard.writeText(formattedCode.value)
    isCopied.value = true
    setTimeout(() => {
      isCopied.value = false
    }, 2500)
  } catch (e) {
    console.error('Failed to copy to clipboard', e)
  }
}
</script>

<template>
  <div class="fixed top-4 right-4 z-50 flex flex-col items-end gap-2 font-sans select-none pointer-events-auto">
    <!-- Floating Toggle Button -->
    <button
      type="button"
      class="flex items-center gap-2 rounded-xl border border-sky-500/50 bg-slate-900/90 px-3.5 py-2 text-xs font-semibold text-sky-300 shadow-xl backdrop-blur-md transition-all hover:bg-slate-800 hover:text-sky-200 hover:border-sky-400 active:scale-95"
      @click="isOpen = !isOpen"
    >
      <span class="text-base">🛠️</span>
      <span>{{ isOpen ? 'Tutup Panel Tuning' : 'Panel Tuning Posisi & Jari (Lengkap)' }}</span>
      <span
        class="inline-block h-2 w-2 rounded-full"
        :class="isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-sky-400'"
      />
    </button>

    <!-- Main Floating Tuning Panel -->
    <div
      v-if="isOpen"
      class="w-[460px] max-w-[calc(100vw-2rem)] max-h-[88vh] flex flex-col rounded-2xl border border-slate-700/80 bg-slate-950/95 p-4 text-slate-100 shadow-2xl backdrop-blur-xl transition-all"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div>
          <h3 class="flex items-center gap-1.5 text-sm font-bold text-white">
            <span>⚙️</span> Interactive Hand & Finger Tuning
          </h3>
          <p class="text-[11px] text-slate-400">
            Kendali 3 ruas tulang jempol (Pangkal, Tengah, Ujung) & telapak tangan
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          @click="isOpen = false"
        >
          ✕
        </button>
      </div>

      <!-- Quick Loop & Stage 4 Helper -->
      <div class="mt-2.5 flex items-center justify-between rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-xs border border-slate-800">
        <label class="flex items-center gap-2 cursor-pointer text-slate-300">
          <input
            v-model="loopStage4Only"
            type="checkbox"
            class="h-3.5 w-3.5 rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-sky-500"
          >
          <span class="text-[11px]">🔁 Loop Tahap 4 terus menerus</span>
        </label>
        <button
          type="button"
          class="rounded bg-sky-600/80 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-sky-500 active:scale-95"
          @click="jumpToStage4"
        >
          {{ props.controller.state.stageIndex === 3 ? 'Replay Tahap 4' : '👉 Lompat Tahap 4' }}
        </button>
      </div>

      <!-- Navigation Tabs -->
      <div class="mt-3 grid grid-cols-5 gap-1 rounded-xl bg-slate-900/90 p-1 border border-slate-800 text-[11px] font-semibold">
        <button
          type="button"
          class="rounded-lg py-1.5 text-center transition-all"
          :class="activeTab === 'rightHand' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
          @click="activeTab = 'rightHand'"
        >
          🖐️ Kanan
        </button>
        <button
          type="button"
          class="rounded-lg py-1.5 text-center transition-all"
          :class="activeTab === 'leftHand' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
          @click="activeTab = 'leftHand'"
        >
          🖐️ Kiri
        </button>
        <button
          type="button"
          class="rounded-lg py-1.5 text-center transition-all"
          :class="activeTab === 'rightFingers' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
          @click="activeTab = 'rightFingers'"
        >
          👆 Jari Rn
        </button>
        <button
          type="button"
          class="rounded-lg py-1.5 text-center transition-all"
          :class="activeTab === 'leftFingers' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
          @click="activeTab = 'leftFingers'"
        >
          👆 Jari Lf
        </button>
        <button
          type="button"
          class="rounded-lg py-1.5 text-center transition-all"
          :class="activeTab === 'code' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
          @click="activeTab = 'code'"
        >
          📋 Salin
        </button>
      </div>

      <!-- Tab Content Area (Scrollable) -->
      <div class="mt-3 flex-1 overflow-y-auto pr-1 space-y-3.5 text-xs">
        <!-- ========================================== -->
        <!-- TAB 1: TANGAN KANAN (ATAS / SCRUBBING)     -->
        <!-- ========================================== -->
        <div v-if="activeTab === 'rightHand'" class="space-y-3">
          <div class="rounded-lg bg-sky-950/40 border border-sky-800/40 p-2 text-[11px] text-sky-200">
            <strong>🖐️ Tangan Kanan (Posisi Atas / Menggosok):</strong> Atur posisi X/Y/Z dan rotasi sudut Pitch/Yaw/Roll.
          </div>

          <!-- Ketinggian Y -->
          <div class="rounded-xl border border-sky-500/40 bg-sky-950/20 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-bold text-sky-300">↕️ Ketinggian Tangan Kanan (Y):</span>
              <span class="rounded bg-sky-500/20 px-2 py-0.5 font-mono font-bold text-sky-200">
                {{ (tuning.rightOffsetY * 1000).toFixed(1) }} mm
              </span>
            </div>
            <input
              v-model.number="tuning.rightOffsetY"
              type="range"
              min="0.040"
              max="0.250"
              step="0.001"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-6 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetY', -10)">-10</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetY', -5)">-5</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetY', -1)">-1</button>
              <button type="button" class="btn-ctrl-active" @click="adjustMm('rightOffsetY', +1)">+1</button>
              <button type="button" class="btn-ctrl-active" @click="adjustMm('rightOffsetY', +5)">+5</button>
              <button type="button" class="btn-ctrl-active" @click="adjustMm('rightOffsetY', +10)">+10</button>
            </div>
          </div>

          <!-- Maju / Mundur Z -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">↗️ Maju / Mundur (Z):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">
                {{ (tuning.rightOffsetZ * 1000).toFixed(1) }} mm
              </span>
            </div>
            <p class="text-[10px] text-slate-400 mt-0.5">(-) Lebih maju ke jari kiri | (+) Lebih mundur ke pergelangan</p>
            <input
              v-model.number="tuning.rightOffsetZ"
              type="range"
              min="-0.180"
              max="0.080"
              step="0.001"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetZ', -5)">-5 mm (Maju)</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetZ', -1)">-1 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetZ', +1)">+1 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetZ', +5)">+5 mm (Mundur)</button>
            </div>
          </div>

          <!-- Geser Kanan / Kiri X -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">↔️ Geser Samping (X):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">
                {{ (tuning.rightOffsetX * 1000).toFixed(1) }} mm
              </span>
            </div>
            <input
              v-model.number="tuning.rightOffsetX"
              type="range"
              min="-0.260"
              max="0.020"
              step="0.001"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetX', -5)">-5 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetX', -1)">-1 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetX', +1)">+1 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('rightOffsetX', +5)">+5 mm</button>
            </div>
          </div>

          <!-- Rotasi Pitch (X) -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">📐 Kemiringan Lengan / Pitch (X):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">{{ tuning.rightPitch }}°</span>
            </div>
            <input
              v-model.number="tuning.rightPitch"
              type="range"
              min="-20"
              max="90"
              step="1"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightPitch', -2)">-2°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightPitch', -1)">-1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightPitch', +1)">+1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightPitch', +2)">+2°</button>
            </div>
          </div>

          <!-- Rotasi Yaw (Y) -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">🔄 Arah Belok / Yaw (Y):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">{{ tuning.rightYaw }}°</span>
            </div>
            <input
              v-model.number="tuning.rightYaw"
              type="range"
              min="-60"
              max="60"
              step="1"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightYaw', -2)">-2°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightYaw', -1)">-1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightYaw', +1)">+1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightYaw', +2)">+2°</button>
            </div>
          </div>

          <!-- Rotasi Roll (Z) -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">💫 Kemiringan Miring / Roll (Z):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">{{ tuning.rightRoll }}°</span>
            </div>
            <input
              v-model.number="tuning.rightRoll"
              type="range"
              min="20"
              max="120"
              step="1"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-400"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightRoll', -2)">-2°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightRoll', -1)">-1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightRoll', +1)">+1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('rightRoll', +2)">+2°</button>
            </div>
          </div>
        </div>

        <!-- ========================================== -->
        <!-- TAB 2: TANGAN KIRI (BAWAH / MENOPANG)     -->
        <!-- ========================================== -->
        <div v-if="activeTab === 'leftHand'" class="space-y-3">
          <div class="rounded-lg bg-teal-950/40 border border-teal-800/40 p-2 text-[11px] text-teal-200">
            <strong>🖐️ Tangan Kiri (Posisi Bawah / Menopang):</strong> Menghadap ke atas menerima gosokan telapak kanan.
          </div>

          <!-- Ketinggian Y -->
          <div class="rounded-xl border border-teal-500/40 bg-teal-950/20 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-bold text-teal-300">↕️ Ketinggian Tangan Kiri (Y):</span>
              <span class="rounded bg-teal-500/20 px-2 py-0.5 font-mono font-bold text-teal-200">
                {{ (tuning.leftOffsetY * 1000).toFixed(1) }} mm
              </span>
            </div>
            <input
              v-model.number="tuning.leftOffsetY"
              type="range"
              min="0.010"
              max="0.160"
              step="0.001"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-6 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetY', -10)">-10</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetY', -5)">-5</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetY', -1)">-1</button>
              <button type="button" class="btn-ctrl-active" @click="adjustMm('leftOffsetY', +1)">+1</button>
              <button type="button" class="btn-ctrl-active" @click="adjustMm('leftOffsetY', +5)">+5</button>
              <button type="button" class="btn-ctrl-active" @click="adjustMm('leftOffsetY', +10)">+10</button>
            </div>
          </div>

          <!-- Maju / Mundur Z -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">↗️ Maju / Mundur (Z):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">
                {{ (tuning.leftOffsetZ * 1000).toFixed(1) }} mm
              </span>
            </div>
            <input
              v-model.number="tuning.leftOffsetZ"
              type="range"
              min="-0.150"
              max="0.050"
              step="0.001"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetZ', -5)">-5 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetZ', -1)">-1 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetZ', +1)">+1 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetZ', +5)">+5 mm</button>
            </div>
          </div>

          <!-- Geser Samping X -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">↔️ Geser Samping (X):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">
                {{ (tuning.leftOffsetX * 1000).toFixed(1) }} mm
              </span>
            </div>
            <input
              v-model.number="tuning.leftOffsetX"
              type="range"
              min="0.000"
              max="0.180"
              step="0.001"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetX', -5)">-5 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetX', -1)">-1 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetX', +1)">+1 mm</button>
              <button type="button" class="btn-ctrl" @click="adjustMm('leftOffsetX', +5)">+5 mm</button>
            </div>
          </div>

          <!-- Rotasi Pitch (X) -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">📐 Kemiringan Lengan / Pitch (X):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">{{ tuning.leftPitch }}°</span>
            </div>
            <input
              v-model.number="tuning.leftPitch"
              type="range"
              min="-20"
              max="50"
              step="1"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftPitch', -2)">-2°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftPitch', -1)">-1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftPitch', +1)">+1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftPitch', +2)">+2°</button>
            </div>
          </div>

          <!-- Rotasi Yaw (Y) -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">🔄 Arah Belok / Yaw (Y):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">{{ tuning.leftYaw }}°</span>
            </div>
            <input
              v-model.number="tuning.leftYaw"
              type="range"
              min="-50"
              max="40"
              step="1"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftYaw', -2)">-2°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftYaw', -1)">-1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftYaw', +1)">+1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftYaw', +2)">+2°</button>
            </div>
          </div>

          <!-- Rotasi Roll (Z) -->
          <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-300">💫 Kemiringan Miring / Roll (Z):</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-200">{{ tuning.leftRoll }}°</span>
            </div>
            <input
              v-model.number="tuning.leftRoll"
              type="range"
              min="10"
              max="90"
              step="1"
              class="mt-2 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-400"
              @input="applyChange"
            >
            <div class="mt-1.5 grid grid-cols-4 gap-1">
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftRoll', -2)">-2°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftRoll', -1)">-1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftRoll', +1)">+1°</button>
              <button type="button" class="btn-ctrl" @click="adjustDeg('leftRoll', +2)">+2°</button>
            </div>
          </div>
        </div>

        <!-- ========================================== -->
        <!-- TAB 3: JARI TANGAN KANAN                   -->
        <!-- ========================================== -->
        <div v-if="activeTab === 'rightFingers'" class="space-y-3">
          <div class="rounded-lg bg-indigo-950/40 border border-indigo-800/40 p-2 text-[11px] text-indigo-200">
            <strong>👆 Jari Tangan Kanan:</strong> Atur per-sendi tulang jempol (Pangkal, Tengah, Ujung) agar tidak berbenturan.
          </div>

          <!-- Finger Selector Pills -->
          <div class="flex flex-wrap gap-1 rounded-lg bg-slate-900/80 p-1 border border-slate-800 text-[10px]">
            <button
              v-for="f in fingerList"
              :key="f.key"
              type="button"
              class="rounded-md px-2 py-1 transition-all"
              :class="activeRightFinger === f.key ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
              @click="activeRightFinger = f.key"
            >
              {{ f.icon }} {{ f.label }}
            </button>
            <button
              type="button"
              class="rounded-md px-2 py-1 transition-all"
              :class="activeRightFinger === 'all' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
              @click="activeRightFinger = 'all'"
            >
              Semua Jari
            </button>
          </div>

          <!-- SPECIAL DEDICATED VIEW: JEMPOL TANGAN KANAN (PER-BONE JOINTS) -->
          <div
            v-if="activeRightFinger === 'thumb' || activeRightFinger === 'all'"
            class="rounded-xl border border-amber-500/50 bg-amber-950/20 p-3 space-y-3"
          >
            <div class="flex items-center justify-between border-b border-amber-500/30 pb-1.5">
              <span class="font-bold text-amber-300 flex items-center gap-1.5 text-xs">
                <span>👍</span> Jempol Kanan - Rangka 3 Tulang (Bone Chain)
              </span>
              <span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-mono text-amber-200">R_Thumb</span>
            </div>

            <!-- PRESET ANTI-PENGKOR & QUICK ACTIONS -->
            <div class="rounded-lg bg-slate-900/90 p-2 border border-slate-800 space-y-1.5">
              <span class="text-[10px] text-amber-300/90 font-bold flex items-center gap-1">
                <span>⚡</span> Tombol Solusi Cepat:
              </span>
              <div class="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  class="rounded bg-emerald-600/90 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-500 active:scale-95 text-center shadow"
                  @click="applyRightThumbNatural"
                >
                  ✨ Pulihkan Alami (Anti-Pengkor)
                </button>
                <button
                  type="button"
                  class="rounded bg-sky-600/80 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-500 active:scale-95 text-center"
                  @click="applyRightThumbOpenWide"
                >
                  🖐️ Buka Lebar ke Samping
                </button>
              </div>
            </div>

            <!-- Joint Selector Sub-Tabs for Thumb -->
            <div class="flex gap-1 rounded-lg bg-slate-900/80 p-1 border border-slate-800 text-[10px]">
              <button
                type="button"
                class="flex-1 rounded py-1 transition-all"
                :class="activeRightThumbJoint === 'all' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
                @click="activeRightThumbJoint = 'all'"
              >
                Semua Sendi
              </button>
              <button
                type="button"
                class="flex-1 rounded py-1 transition-all"
                :class="activeRightThumbJoint === 'base' ? 'bg-sky-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
                @click="activeRightThumbJoint = 'base'"
              >
                🦴 Pangkal
              </button>
              <button
                type="button"
                class="flex-1 rounded py-1 transition-all"
                :class="activeRightThumbJoint === 'mid' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
                @click="activeRightThumbJoint = 'mid'"
              >
                🦴 Tengah
              </button>
              <button
                type="button"
                class="flex-1 rounded py-1 transition-all"
                :class="activeRightThumbJoint === 'tip' ? 'bg-rose-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
                @click="activeRightThumbJoint = 'tip'"
              >
                🦴 Ujung
              </button>
            </div>

            <!-- SENDI 1: PANGKAL JEMPOL (Bone.017) -->
            <div
              v-if="activeRightThumbJoint === 'all' || activeRightThumbJoint === 'base'"
              class="rounded-lg bg-slate-900/80 p-2.5 border border-slate-800 space-y-2"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold text-sky-300 text-[11px] flex items-center gap-1">
                  <span>🦴</span> Sendi 1: Pangkal Jempol (Bone.017)
                </span>
                <span class="text-[9px] text-slate-400">Akar di Telapak</span>
              </div>
              <p class="text-[10px] text-amber-200/80 leading-tight">
                💡 <em>Gunakan <strong>Renggangan (Spread)</strong> untuk membuka jempol. Biarkan <strong>Twist di 0°</strong> agar daging telapak tidak melintir/pengkor.</em>
              </p>

              <!-- Pangkal Spread (Utama) -->
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300 font-semibold">Pangkal Renggangan (Spread):</span>
                  <span class="font-mono text-cyan-300 font-bold">{{ tuning.rightThumbBaseSpread.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.rightThumbBaseSpread"
                  type="range"
                  min="-30"
                  max="50"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseSpread', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseSpread', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseSpread', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseSpread', +2)">+2°</button>
                </div>
              </div>

              <!-- Pangkal Curl -->
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Pangkal Tekukan (Curl):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.rightThumbBaseCurl.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.rightThumbBaseCurl"
                  type="range"
                  min="-25"
                  max="40"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseCurl', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseCurl', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseCurl', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseCurl', +2)">+2°</button>
                </div>
              </div>

              <!-- Pangkal Twist -->
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Pangkal Putaran Poros (Twist):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.rightThumbBaseTwist.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.rightThumbBaseTwist"
                  type="range"
                  min="-30"
                  max="30"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseTwist', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseTwist', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseTwist', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbBaseTwist', +2)">+2°</button>
                </div>
              </div>
            </div>

            <!-- SENDI 2: TENGAH JEMPOL (Bone.018) -->
            <div
              v-if="activeRightThumbJoint === 'all' || activeRightThumbJoint === 'mid'"
              class="rounded-lg bg-slate-900/80 p-2.5 border border-slate-800 space-y-2"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold text-amber-300 text-[11px] flex items-center gap-1">
                  <span>🦴</span> Sendi 2: Tengah Jempol (Bone.018)
                </span>
                <span class="text-[9px] text-slate-400">Ruas Tengah (MCP)</span>
              </div>
              <p class="text-[10px] text-slate-400 leading-tight">
                Sendi utama untuk memutar (twist) dan menekuk (curl) jempol agar menghadap ke bawah/atas secara alami.
              </p>

              <!-- Tengah Curl -->
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Tengah Tekukan (Curl):</span>
                  <span class="font-mono text-amber-300 font-bold">{{ tuning.rightThumbMidCurl.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.rightThumbMidCurl"
                  type="range"
                  min="-20"
                  max="50"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidCurl', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidCurl', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidCurl', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidCurl', +2)">+2°</button>
                </div>
              </div>

              <!-- Tengah Spread -->
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Tengah Renggangan (Spread):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.rightThumbMidSpread.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.rightThumbMidSpread"
                  type="range"
                  min="-25"
                  max="35"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidSpread', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidSpread', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidSpread', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidSpread', +2)">+2°</button>
                </div>
              </div>

              <!-- Tengah Twist -->
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Tengah Putaran (Twist):</span>
                  <span class="font-mono text-purple-300 font-bold">{{ tuning.rightThumbMidTwist.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.rightThumbMidTwist"
                  type="range"
                  min="-50"
                  max="50"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidTwist', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidTwist', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidTwist', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbMidTwist', +2)">+2°</button>
                </div>
              </div>
            </div>

            <!-- SENDI 3: UJUNG JEMPOL (Bone.019) -->
            <div
              v-if="activeRightThumbJoint === 'all' || activeRightThumbJoint === 'tip'"
              class="rounded-lg bg-slate-900/80 p-2.5 border border-slate-800 space-y-2"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold text-rose-300 text-[11px] flex items-center gap-1">
                  <span>🦴</span> Sendi 3: Ujung Jempol (Bone.019)
                </span>
                <span class="text-[9px] text-slate-400">Ruas Kuku (Distal)</span>
              </div>

              <!-- Ujung Curl -->
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Ujung Tekukan (Curl):</span>
                  <span class="font-mono text-rose-300 font-bold">{{ tuning.rightThumbTipCurl.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.rightThumbTipCurl"
                  type="range"
                  min="-20"
                  max="45"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipCurl', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipCurl', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipCurl', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipCurl', +2)">+2°</button>
                </div>
              </div>

              <!-- Ujung Spread -->
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Ujung Renggangan (Spread):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.rightThumbTipSpread.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.rightThumbTipSpread"
                  type="range"
                  min="-25"
                  max="25"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipSpread', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipSpread', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipSpread', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipSpread', +2)">+2°</button>
                </div>
              </div>

              <!-- Ujung Twist -->
              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Ujung Putaran (Twist):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.rightThumbTipTwist.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.rightThumbTipTwist"
                  type="range"
                  min="-40"
                  max="40"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipTwist', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipTwist', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipTwist', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('rightThumbTipTwist', +2)">+2°</button>
                </div>
              </div>
            </div>
          </div>

          <!-- OTHER FINGERS TANGAN KANAN -->
          <template v-for="f in fingerList.filter(item => item.key !== 'thumb')" :key="f.key">
            <div
              v-if="activeRightFinger === f.key || activeRightFinger === 'all'"
              class="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-2.5"
            >
              <div class="flex items-center justify-between border-b border-slate-800/80 pb-1">
                <span class="font-bold text-indigo-300 flex items-center gap-1">
                  <span>{{ f.icon }}</span> {{ f.label }} Tangan Kanan
                </span>
                <span class="text-[10px] text-slate-400">Right {{ f.key }}</span>
              </div>

              <!-- Curl (Tekukan) -->
              <div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-slate-300">Tekukan (Curl):</span>
                  <span class="font-mono text-slate-200 font-bold">
                    {{ (tuning[`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning] as number).toFixed(1) }}°
                  </span>
                </div>
                <input
                  v-model.number="tuning[`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning]"
                  type="range"
                  min="-25"
                  max="45"
                  step="0.5"
                  class="mt-1.5 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                  @input="applyChange"
                >
                <div class="mt-1 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning, -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning, -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning, +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning, +2)">+2°</button>
                </div>
              </div>

              <!-- Spread (Renggangan / Samping) -->
              <div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-slate-300">Renggangan Samping (Spread):</span>
                  <span class="font-mono text-slate-200 font-bold">
                    {{ (tuning[`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning] as number).toFixed(1) }}°
                  </span>
                </div>
                <input
                  v-model.number="tuning[`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning]"
                  type="range"
                  min="-30"
                  max="30"
                  step="0.5"
                  class="mt-1.5 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  @input="applyChange"
                >
                <div class="mt-1 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning, -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning, -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning, +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning, +2)">+2°</button>
                </div>
              </div>

              <!-- Twist (Putaran) -->
              <div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-slate-300">Putaran (Twist):</span>
                  <span class="font-mono text-slate-200 font-bold">
                    {{ (tuning[`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning] as number).toFixed(1) }}°
                  </span>
                </div>
                <input
                  v-model.number="tuning[`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning]"
                  type="range"
                  min="-25"
                  max="85"
                  step="0.5"
                  class="mt-1.5 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  @input="applyChange"
                >
                <div class="mt-1 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning, -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning, -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning, +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`right${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning, +2)">+2°</button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ========================================== -->
        <!-- TAB 4: JARI TANGAN KIRI                    -->
        <!-- ========================================== -->
        <div v-if="activeTab === 'leftFingers'" class="space-y-3">
          <div class="rounded-lg bg-emerald-950/40 border border-emerald-800/40 p-2 text-[11px] text-emerald-200">
            <strong>👆 Jari Tangan Kiri:</strong> Atur per-sendi tulang jempol kiri (Pangkal, Tengah, Ujung) agar membuka sempurna.
          </div>

          <!-- Finger Selector Pills -->
          <div class="flex flex-wrap gap-1 rounded-lg bg-slate-900/80 p-1 border border-slate-800 text-[10px]">
            <button
              v-for="f in fingerList"
              :key="f.key"
              type="button"
              class="rounded-md px-2 py-1 transition-all"
              :class="activeLeftFinger === f.key ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
              @click="activeLeftFinger = f.key"
            >
              {{ f.icon }} {{ f.label }}
            </button>
            <button
              type="button"
              class="rounded-md px-2 py-1 transition-all"
              :class="activeLeftFinger === 'all' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
              @click="activeLeftFinger = 'all'"
            >
              Semua Jari
            </button>
          </div>

          <!-- SPECIAL DEDICATED VIEW: JEMPOL TANGAN KIRI (PER-BONE JOINTS) -->
          <div
            v-if="activeLeftFinger === 'thumb' || activeLeftFinger === 'all'"
            class="rounded-xl border border-teal-500/50 bg-teal-950/20 p-3 space-y-3"
          >
            <div class="flex items-center justify-between border-b border-teal-500/30 pb-1.5">
              <span class="font-bold text-teal-300 flex items-center gap-1.5 text-xs">
                <span>👍</span> Jempol Kiri - Rangka 3 Tulang (Bone Chain)
              </span>
              <span class="rounded bg-teal-500/20 px-1.5 py-0.5 text-[9px] font-mono text-teal-200">L_Thumb</span>
            </div>

            <!-- Quick Action Button -->
            <div class="rounded-lg bg-slate-900/90 p-2 border border-slate-800 flex justify-between items-center">
              <span class="text-[10px] text-teal-300 font-bold">Preset Posisi Jempol Kiri:</span>
              <button
                type="button"
                class="rounded bg-teal-600/90 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-teal-500 active:scale-95 shadow"
                @click="applyLeftThumbNatural"
              >
                ✨ Bentuk Alami Jempol Kiri
              </button>
            </div>

            <!-- Joint Selector Sub-Tabs for Left Thumb -->
            <div class="flex gap-1 rounded-lg bg-slate-900/80 p-1 border border-slate-800 text-[10px]">
              <button
                type="button"
                class="flex-1 rounded py-1 transition-all"
                :class="activeLeftThumbJoint === 'all' ? 'bg-teal-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
                @click="activeLeftThumbJoint = 'all'"
              >
                Semua Sendi
              </button>
              <button
                type="button"
                class="flex-1 rounded py-1 transition-all"
                :class="activeLeftThumbJoint === 'base' ? 'bg-teal-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
                @click="activeLeftThumbJoint = 'base'"
              >
                🦴 Pangkal
              </button>
              <button
                type="button"
                class="flex-1 rounded py-1 transition-all"
                :class="activeLeftThumbJoint === 'mid' ? 'bg-teal-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
                @click="activeLeftThumbJoint = 'mid'"
              >
                🦴 Tengah
              </button>
              <button
                type="button"
                class="flex-1 rounded py-1 transition-all"
                :class="activeLeftThumbJoint === 'tip' ? 'bg-teal-600 text-white font-bold' : 'text-slate-400 hover:text-white'"
                @click="activeLeftThumbJoint = 'tip'"
              >
                🦴 Ujung
              </button>
            </div>

            <!-- SENDI 1: PANGKAL JEMPOL KIRI (Bone.017) -->
            <div
              v-if="activeLeftThumbJoint === 'all' || activeLeftThumbJoint === 'base'"
              class="rounded-lg bg-slate-900/80 p-2.5 border border-slate-800 space-y-2"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold text-teal-300 text-[11px] flex items-center gap-1">
                  <span>🦴</span> Sendi 1: Pangkal Jempol Kiri (Bone.017)
                </span>
                <span class="text-[9px] text-slate-400">Akar di Telapak</span>
              </div>

              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Pangkal Renggangan (Spread):</span>
                  <span class="font-mono text-cyan-300 font-bold">{{ tuning.leftThumbBaseSpread.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.leftThumbBaseSpread"
                  type="range"
                  min="-20"
                  max="70"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseSpread', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseSpread', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseSpread', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseSpread', +2)">+2°</button>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Pangkal Tekukan (Curl):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.leftThumbBaseCurl.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.leftThumbBaseCurl"
                  type="range"
                  min="-30"
                  max="50"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseCurl', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseCurl', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseCurl', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseCurl', +2)">+2°</button>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Pangkal Putaran (Twist):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.leftThumbBaseTwist.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.leftThumbBaseTwist"
                  type="range"
                  min="-40"
                  max="40"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseTwist', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseTwist', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseTwist', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbBaseTwist', +2)">+2°</button>
                </div>
              </div>
            </div>

            <!-- SENDI 2: TENGAH JEMPOL KIRI (Bone.018) -->
            <div
              v-if="activeLeftThumbJoint === 'all' || activeLeftThumbJoint === 'mid'"
              class="rounded-lg bg-slate-900/80 p-2.5 border border-slate-800 space-y-2"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold text-teal-300 text-[11px] flex items-center gap-1">
                  <span>🦴</span> Sendi 2: Tengah Jempol Kiri (Bone.018)
                </span>
                <span class="text-[9px] text-slate-400">Ruas Tengah (MCP)</span>
              </div>

              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Tengah Tekukan (Curl):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.leftThumbMidCurl.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.leftThumbMidCurl"
                  type="range"
                  min="-30"
                  max="50"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidCurl', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidMidCurl', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidCurl', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidCurl', +2)">+2°</button>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Tengah Renggangan (Spread):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.leftThumbMidSpread.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.leftThumbMidSpread"
                  type="range"
                  min="-30"
                  max="50"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidSpread', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidSpread', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidSpread', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidSpread', +2)">+2°</button>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Tengah Putaran (Twist):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.leftThumbMidTwist.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.leftThumbMidTwist"
                  type="range"
                  min="-40"
                  max="40"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidTwist', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidTwist', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidTwist', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbMidTwist', +2)">+2°</button>
                </div>
              </div>
            </div>

            <!-- SENDI 3: UJUNG JEMPOL KIRI (Bone.019) -->
            <div
              v-if="activeLeftThumbJoint === 'all' || activeLeftThumbJoint === 'tip'"
              class="rounded-lg bg-slate-900/80 p-2.5 border border-slate-800 space-y-2"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold text-teal-300 text-[11px] flex items-center gap-1">
                  <span>🦴</span> Sendi 3: Ujung Jempol Kiri (Bone.019)
                </span>
                <span class="text-[9px] text-slate-400">Ruas Kuku (Distal)</span>
              </div>

              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Ujung Tekukan (Curl):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.leftThumbTipCurl.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.leftThumbTipCurl"
                  type="range"
                  min="-30"
                  max="50"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipCurl', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipCurl', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipCurl', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipCurl', +2)">+2°</button>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Ujung Renggangan (Spread):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.leftThumbTipSpread.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.leftThumbTipSpread"
                  type="range"
                  min="-30"
                  max="30"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipSpread', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipSpread', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipSpread', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipSpread', +2)">+2°</button>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between text-[11px]">
                  <span class="text-slate-300">Ujung Putaran (Twist):</span>
                  <span class="font-mono text-slate-200 font-bold">{{ tuning.leftThumbTipTwist.toFixed(1) }}°</span>
                </div>
                <input
                  v-model.number="tuning.leftThumbTipTwist"
                  type="range"
                  min="-40"
                  max="40"
                  step="0.5"
                  class="mt-1 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  @input="applyChange"
                >
                <div class="mt-0.5 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipTwist', -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipTwist', -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipTwist', +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg('leftThumbTipTwist', +2)">+2°</button>
                </div>
              </div>
            </div>
          </div>

          <!-- OTHER FINGERS TANGAN KIRI -->
          <template v-for="f in fingerList.filter(item => item.key !== 'thumb')" :key="f.key">
            <div
              v-if="activeLeftFinger === f.key || activeLeftFinger === 'all'"
              class="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-2.5"
            >
              <div class="flex items-center justify-between border-b border-slate-800/80 pb-1">
                <span class="font-bold text-emerald-300 flex items-center gap-1">
                  <span>{{ f.icon }}</span> {{ f.label }} Tangan Kiri
                </span>
                <span class="text-[10px] text-slate-400">Left {{ f.key }}</span>
              </div>

              <!-- Curl (Tekukan) -->
              <div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-slate-300">Tekukan (Curl):</span>
                  <span class="font-mono text-slate-200 font-bold">
                    {{ (tuning[`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning] as number).toFixed(1) }}°
                  </span>
                </div>
                <input
                  v-model.number="tuning[`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning]"
                  type="range"
                  min="-25"
                  max="45"
                  step="0.5"
                  class="mt-1.5 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                  @input="applyChange"
                >
                <div class="mt-1 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning, -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning, -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning, +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Curl` as keyof RubPalmsLiveTuning, +2)">+2°</button>
                </div>
              </div>

              <!-- Spread (Renggangan / Samping) -->
              <div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-slate-300">Renggangan Samping (Spread):</span>
                  <span class="font-mono text-slate-200 font-bold">
                    {{ (tuning[`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning] as number).toFixed(1) }}°
                  </span>
                </div>
                <input
                  v-model.number="tuning[`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning]"
                  type="range"
                  min="-30"
                  max="30"
                  step="0.5"
                  class="mt-1.5 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  @input="applyChange"
                >
                <div class="mt-1 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning, -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning, -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning, +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Spread` as keyof RubPalmsLiveTuning, +2)">+2°</button>
                </div>
              </div>

              <!-- Twist (Putaran) -->
              <div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-slate-300">Putaran (Twist):</span>
                  <span class="font-mono text-slate-200 font-bold">
                    {{ (tuning[`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning] as number).toFixed(1) }}°
                  </span>
                </div>
                <input
                  v-model.number="tuning[`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning]"
                  type="range"
                  min="-25"
                  max="25"
                  step="0.5"
                  class="mt-1.5 w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  @input="applyChange"
                >
                <div class="mt-1 grid grid-cols-4 gap-1">
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning, -2)">-2°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning, -0.5)">-0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning, +0.5)">+0.5°</button>
                  <button type="button" class="btn-ctrl" @click="adjustDeg(`left${f.key.charAt(0).toUpperCase() + f.key.slice(1)}Twist` as keyof RubPalmsLiveTuning, +2)">+2°</button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ========================================== -->
        <!-- TAB 5: KODE & SALIN NILAI                  -->
        <!-- ========================================== -->
        <div v-if="activeTab === 'code'" class="space-y-3">
          <div class="flex items-center justify-between text-xs">
            <span class="font-semibold text-slate-300">Ringkasan Konfigurasi Live:</span>
            <button
              type="button"
              class="text-[10px] text-rose-400 underline hover:text-rose-300"
              @click="doReset"
            >
              Reset Semua ke Default
            </button>
          </div>

          <pre class="max-h-64 rounded-lg bg-slate-950 p-2.5 font-mono text-[10px] text-emerald-300 overflow-x-auto overflow-y-auto leading-relaxed border border-slate-800">{{ formattedCode }}</pre>

          <button
            type="button"
            class="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-bold text-white shadow transition-all active:scale-98"
            :class="isCopied ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-sky-600 hover:bg-sky-500'"
            @click="copyValues"
          >
            <span>{{ isCopied ? '✅ Nilai Berhasil Disalin ke Clipboard!' : '📋 Salin Nilai ke Clipboard untuk Diberitahukan ke AI' }}</span>
          </button>
          <p class="text-center text-[10.5px] text-slate-400">
            Setelah Anda mengatur posisi & jari hingga pas sempurna tanpa tabrakan, klik tombol salin di atas dan paste di chat ini!
          </p>

          <!-- Skeleton Architecture Inspection Box -->
          <div class="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 text-[10.5px] text-slate-400 space-y-1">
            <span class="font-bold text-slate-300 block">ℹ️ Informasi Struktur Tulang Rig Model 3D (GLB):</span>
            <p>Model ini memiliki total 20 tulang per tangan:</p>
            <ul class="list-disc list-inside space-y-0.5 text-slate-400">
              <li><strong>Pergelangan (`Bone`)</strong>: 1 tulang induk penggerak seluruh telapak.</li>
              <li><strong>Jempol (`Bone.017` s/d `Bone.019`)</strong>: 3 ruas tulang (Pangkal, Tengah, Ujung).</li>
              <li><strong>Telunjuk (`Bone.013` s/d `Bone.016`)</strong>: 4 ruas tulang.</li>
              <li><strong>Jari Tengah (`Bone.009` s/d `Bone.012`)</strong>: 4 ruas tulang.</li>
              <li><strong>Jari Manis (`Bone.005` s/d `Bone.008`)</strong>: 4 ruas tulang.</li>
              <li><strong>Kelingking (`Bone.001` s/d `Bone.004`)</strong>: 4 ruas tulang.</li>
            </ul>
            <p class="text-[10px] text-amber-300/80 mt-1">
              *Catatan: Semua 20 tulang sudah terhubung ke kontrol panel ini tanpa ada yang tertinggal.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn-ctrl {
  background-color: rgb(30 41 59);
  color: rgb(203 213 225);
  font-size: 10px;
  font-weight: 500;
  padding: 4px 2px;
  border-radius: 6px;
  transition: all 0.15s;
}
.btn-ctrl:hover {
  background-color: rgb(51 65 85);
  color: #fff;
}
.btn-ctrl:active {
  transform: scale(0.95);
}

.btn-ctrl-active {
  background-color: rgba(2, 132, 199, 0.7);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 4px 2px;
  border-radius: 6px;
  transition: all 0.15s;
}
.btn-ctrl-active:hover {
  background-color: rgb(2, 132, 199);
}
.btn-ctrl-active:active {
  transform: scale(0.95);
}
</style>
