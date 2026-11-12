<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import type { HandwashingSequenceController } from '~/lib/handwashing/controllers/HandwashingSequenceController'
import type { HandwashingStageId } from '~/lib/handwashing/config/handwashingConfig'

const props = defineProps<{ controller: HandwashingSequenceController }>()
const controller = props.controller
const state = controller.state
const debug = controller.debug
const isOpen = ref(true)
const activeTab = ref<'hand' | 'bone' | 'diagnostics' | 'json'>('hand')
const tabs = [{ id: 'hand', label: 'Tangan' }, { id: 'bone', label: 'Bone' }, { id: 'diagnostics', label: 'Diagnostik' }, { id: 'json', label: 'JSON' }] as const
const axes = ['X', 'Y', 'Z'] as const
const snapshot = shallowRef<ReturnType<HandwashingSequenceController['getDebugSnapshot']> | null>(null)
const jsonText = ref('')
const feedback = ref('')
const feedbackError = ref(false)
const localPositionScale = ref<[number, number, number]>([1, 1, 1])
const scratchScale = new THREE.Vector3()
const storageKey = 'bapelkes-hand-debug-v1'
let refreshTimer: ReturnType<typeof setInterval> | undefined

const selectedHand = computed(() => controller.getDebugStage(state.stageId)[debug.selectedSide])
const boneNames = computed(() => snapshot.value?.hands?.[debug.selectedSide].boneNames ?? [])
const boneOptions = computed(() => {
  const hand = controller.getRig()?.[debug.selectedSide]
  const labels: Record<string, string> = {}
  if (hand) {
    labels[hand.wristJoint.name] = 'Pergelangan'
    const fingerLabels = { thumb: 'Jempol', index: 'Telunjuk', middle: 'Tengah', ring: 'Manis', pinky: 'Kelingking' } as const
    for (const finger of Object.keys(fingerLabels) as Array<keyof typeof fingerLabels>) {
      const joints = finger === 'thumb' ? ['Pangkal', 'Tengah', 'Ujung'] : ['Metakarpal', 'MCP', 'PIP', 'DIP']
      hand.fingers[finger].joints.forEach((joint, index) => {
        labels[joint.name] = `${fingerLabels[finger]} · ${joints[index] ?? `Sendi ${index + 1}`}`
      })
    }
  }
  return boneNames.value.map(name => ({ name, label: labels[name] ? `${labels[name]} (${name})` : name }))
})
const selectedBone = computed(() => {
  const name = debug.selectedBone
  if (!name || !boneNames.value.includes(name)) return null
  const hand = selectedHand.value
  if (!hand.bones[name]) hand.bones[name] = { position: [0, 0, 0], rotation: [0, 0, 0] }
  return hand.bones[name]!
})
const editableTransform = computed(() => activeTab.value === 'bone' ? selectedBone.value : selectedHand.value)
const actualTransform = computed(() => {
  const hand = snapshot.value?.hands?.[debug.selectedSide]
  return activeTab.value === 'bone' ? hand?.bones.find(bone => bone.name === debug.selectedBone) : hand?.armature
})
const currentValues = computed(() => {
  const transform = actualTransform.value
  if (!transform) return []
  return [
    { label: 'Posisi dunia (mm)', values: transform.worldPosition.map(value => (value * 1000).toFixed(2)) },
    { label: 'Rotasi dunia XYZ (deg)', values: transform.worldRotation.map(value => value.toFixed(2)) },
    { label: 'Posisi lokal (unit GLB)', values: transform.localPosition.map(value => value.toFixed(4)) },
    { label: 'Rotasi lokal XYZ (deg)', values: transform.localRotation.map(value => value.toFixed(2)) },
  ]
})

function refreshSnapshot() {
  if (!isOpen.value) return
  snapshot.value = controller.getDebugSnapshot()
  const bone = controller.getRig()?.[debug.selectedSide].skeleton.bones.find(item => item.name === debug.selectedBone)
  if (bone?.parent) {
    bone.parent.getWorldScale(scratchScale)
    localPositionScale.value = [Math.abs(scratchScale.x), Math.abs(scratchScale.y), Math.abs(scratchScale.z)]
  }
}
function announce(message: string, error = false) { feedback.value = message; feedbackError.value = error }
function metric(value: number | null | undefined, factor = 1): string {
  return value == null || !Number.isFinite(value) ? 'Belum tersedia' : (value * factor).toFixed(2)
}
function markChanged() { controller.markPoseDirty() }
function positionFactor(axis: number): number {
  return activeTab.value === 'bone' ? Math.max(1e-8, localPositionScale.value[axis]!) * 1000 : 1000
}
function displayedDelta(kind: 'position' | 'rotation', axis: number): number {
  return Number(((editableTransform.value?.[kind][axis] ?? 0) * (kind === 'position' ? positionFactor(axis) : 1)).toFixed(4))
}
function updateDelta(kind: 'position' | 'rotation', axis: number, event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.value.trim()) return
  const value = Number(input.value)
  const target = editableTransform.value
  if (!target || !Number.isFinite(value)) return
  target[kind][axis] = value / (kind === 'position' ? positionFactor(axis) : 1)
  markChanged()
}
function selectStage(event: Event) {
  const stageId = (event.target as HTMLSelectElement).value as HandwashingStageId
  if (!controller.stages.some(stage => stage.id === stageId)) return
  controller.goToStage(stageId, false)
  controller.seek(['rubPalms', 'rubBacksOfHands', 'interlaceFingers'].includes(stageId) ? 0.35 : 0)
  refreshSnapshot()
}
function seekPercent(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.value.trim()) return
  const value = Number(input.value)
  if (!Number.isFinite(value)) return
  controller.pause()
  controller.seek(Math.min(100, Math.max(0, value)) / 100)
  refreshSnapshot()
}
function resetSelected() {
  const target = activeTab.value === 'bone' ? selectedBone.value : selectedHand.value
  if (!target) return
  target.position = [0, 0, 0]
  target.rotation = [0, 0, 0]
  markChanged()
  announce(activeTab.value === 'bone' ? 'Offset bone terpilih diatur ke nol.' : 'Offset tangan diatur ke nol; offset bone tetap tersimpan.')
}
function resetStage() { controller.resetDebugStage(); markChanged(); announce('Semua offset tangan dan bone pada tahap ini diatur ke nol.') }
function allStageOverrides() {
  for (const stage of controller.stages) controller.getDebugStage(stage.id)
  return controller.exportDebugOverrides()
}
function exportJson() {
  jsonText.value = JSON.stringify(allStageOverrides(), null, 2)
  announce('JSON seluruh tahap siap disalin. Posisi tangan: dunia; posisi bone: unit lokal GLB.')
}
function importJson(text = jsonText.value): boolean {
  try {
    const result = controller.importDebugOverrides(JSON.parse(text))
    if (!result.ok) { announce(result.error ?? 'JSON tidak valid.', true); return false }
    debug.enabled = true
    markChanged()
    refreshSnapshot()
    announce('Offset berhasil dimuat. Angka di luar rentang saran tetap dipertahankan.')
    return true
  } catch (error) { announce(error instanceof Error ? error.message : 'JSON tidak dapat dibaca.', true); return false }
}
async function copyJson() {
  exportJson()
  try { await navigator.clipboard.writeText(jsonText.value); announce('JSON seluruh tahap disalin ke clipboard.') }
  catch { announce('Clipboard tidak tersedia. Salin teks JSON secara manual.', true) }
}
function saveLocal() {
  try { localStorage.setItem(storageKey, JSON.stringify(allStageOverrides())); announce('Kalibrasi disimpan di browser ini. Muat lewat tombol Muat Lokal.') }
  catch { announce('Browser tidak mengizinkan penyimpanan lokal.', true) }
}
function loadLocal() {
  try {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return announce('Belum ada kalibrasi tersimpan di browser ini.', true)
    if (importJson(saved)) jsonText.value = saved
  } catch { announce('Penyimpanan lokal tidak dapat dibaca.', true) }
}
// Choose a fallback only when the selected hand or rig availability changes.
// Inspector polling must never change the user's bone selection.
watch([() => debug.selectedSide, () => snapshot.value?.rigAvailable], () => {
  const names = boneNames.value
  if (!names.includes(debug.selectedBone)) debug.selectedBone = names[0] ?? ''
})
watch(() => [debug.selectedSide, debug.selectedBone, state.stageId], refreshSnapshot)
watch(() => debug.enabled, markChanged)
watch(isOpen, open => {
  debug.enabled = open
  markChanged()
  if (open) refreshSnapshot()
})
onMounted(() => {
  debug.enabled = true
  controller.pause()
  markChanged()
  refreshSnapshot()
  refreshTimer = setInterval(refreshSnapshot, 100)
})
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  debug.enabled = false
  markChanged()
})
</script>

<template>
  <aside class="debug-panel fixed right-3 top-3 z-50 flex w-[360px] max-w-[calc(100vw-24px)] flex-col items-end gap-2 text-xs text-slate-200">
    <button type="button" class="debug-button bg-slate-900/95" :aria-expanded="isOpen" aria-controls="hand-debug-panel" @click="isOpen = !isOpen">{{ isOpen ? 'Tutup Debug Tangan' : 'Buka Debug Tangan' }}</button>
    <section v-if="isOpen" id="hand-debug-panel" aria-label="Kalibrasi tangan dan semua bone" class="w-full max-h-[75vh] overflow-y-auto rounded-xl border border-slate-600 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-md">
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold text-sky-300">Debug Tangan & Bone</h2>
        <label class="flex items-center gap-1.5"><input v-model="debug.enabled" type="checkbox"> Aktifkan debug</label>
      </div>
      <p class="mt-1 text-[11px] leading-relaxed text-slate-400">Offset disimpan per tahap dan ditambahkan ke animasi. Jeda untuk mengatur kontak dengan presisi.</p>
      <label for="debug-stage" class="mt-3 block font-medium">Tahap animasi</label>
      <select id="debug-stage" class="debug-input mt-1 w-full" :value="state.stageId" @change="selectStage"><option v-for="stage in controller.stages" :key="stage.id" :value="stage.id">{{ stage.shortLabel }}</option></select>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" class="debug-button bg-sky-800" @click="controller.togglePlay()">{{ state.isPlaying ? 'Jeda' : 'Putar' }}</button>
        <label class="flex items-center gap-1.5"><input v-model="debug.loopStage" type="checkbox"> Ulangi tahap ini</label>
        <label class="ml-auto flex items-center gap-1">Laju<select v-model.number="debug.playbackRate" class="debug-input" aria-label="Kecepatan animasi"><option :value="0.1">0,1x</option><option :value="0.25">0,25x</option><option :value="0.5">0,5x</option><option :value="1">1x</option><option :value="2">2x</option></select></label>
      </div>
      <div class="mt-3 flex items-center justify-between gap-2"><label for="debug-seek">Posisi waktu</label><div class="flex items-center gap-1"><input class="debug-input w-20" type="number" min="0" max="100" step="0.1" :value="Number((state.stageProgress * 100).toFixed(1))" aria-label="Posisi waktu dalam persen" @input="seekPercent">%</div></div>
      <input id="debug-seek" class="mt-2 w-full accent-sky-400" type="range" min="0" max="100" step="0.1" :value="state.stageProgress * 100" @input="seekPercent">
      <fieldset class="mt-3 flex gap-3 border-t border-slate-800 pt-3"><legend class="sr-only">Pilih tangan yang diedit</legend><label class="flex items-center gap-1.5"><input v-model="debug.selectedSide" type="radio" value="right" name="debug-hand"> Tangan kanan</label><label class="flex items-center gap-1.5"><input v-model="debug.selectedSide" type="radio" value="left" name="debug-hand"> Tangan kiri</label></fieldset>
      <div class="mt-3 grid grid-cols-4 gap-1" aria-label="Bagian kalibrasi"><button v-for="tab in tabs" :key="tab.id" type="button" class="debug-button px-1" :class="activeTab === tab.id ? 'bg-sky-800 text-white' : 'bg-slate-800 text-slate-300'" :aria-pressed="activeTab === tab.id" @click="activeTab = tab.id">{{ tab.label }}</button></div>
      <template v-if="activeTab === 'hand' || activeTab === 'bone'">
        <template v-if="activeTab === 'bone'"><label for="debug-bone" class="mt-3 block font-medium">Bone ({{ boneNames.length }} pada tangan ini)</label><select id="debug-bone" v-model="debug.selectedBone" class="debug-input mt-1 w-full"><option v-for="bone in boneOptions" :key="bone.name" :value="bone.name">{{ bone.label }}</option></select></template>
        <div v-if="editableTransform" class="mt-3">
          <h3 class="font-semibold text-sky-200">Offset tambahan — dapat diedit</h3>
          <p class="mt-1 text-[10px] leading-relaxed text-slate-400">{{ activeTab === 'bone' ? 'Posisi: mm scene sepanjang sumbu lokal bone. Rotasi: XYZ lokal, setelah pose animasi.' : 'Posisi: mm pada sumbu dunia. Rotasi: derajat pada orientasi pose tangan.' }}</p>
          <div class="mt-2 grid grid-cols-[60px_repeat(3,minmax(0,1fr))] items-center gap-1.5">
            <span></span><span v-for="axis in axes" :key="axis" class="text-center font-semibold text-slate-400">{{ axis }}</span>
            <span>Posisi mm</span><input v-for="(axis, index) in axes" :key="`position-${axis}`" class="debug-input min-w-0 w-full" type="number" step="0.5" :value="displayedDelta('position', index)" :aria-label="`Offset posisi ${activeTab === 'bone' ? 'bone' : 'tangan'} ${axis} dalam milimeter`" @input="updateDelta('position', index, $event)">
            <span>Rotasi deg</span><input v-for="(axis, index) in axes" :key="`rotation-${axis}`" class="debug-input min-w-0 w-full" type="number" step="0.5" :value="displayedDelta('rotation', index)" :aria-label="`Offset rotasi ${activeTab === 'bone' ? 'bone' : 'tangan'} ${axis} dalam derajat`" @input="updateDelta('rotation', index, $event)">
          </div>
          <p class="mt-2 text-[10px] leading-relaxed text-slate-500">Rentang saran: posisi {{ activeTab === 'bone' ? '±20' : '±150' }} mm, rotasi ±180°. Nilai di luar saran tetap diterima.</p>
          <button type="button" class="debug-button mt-2 bg-slate-800" @click="resetSelected">Nolkan offset {{ activeTab === 'bone' ? 'bone ini' : 'tangan ini' }}</button>
        </div>
        <div class="mt-3 border-t border-slate-800 pt-3"><h3 class="font-semibold text-slate-300">Transform aktual — hanya baca</h3><p class="mt-1 text-[10px] text-slate-500">{{ activeTab === 'hand' ? 'Transform armature setelah animasi + offset.' : 'Transform bone setelah animasi + offset.' }} Diperbarui 10x/detik.</p><div v-for="row in currentValues" :key="row.label" class="mt-2"><p class="text-[10px] text-slate-400">{{ row.label }}</p><div class="mt-1 grid grid-cols-3 gap-1 font-mono text-[10px]"><output v-for="(value, index) in row.values" :key="index" class="rounded bg-slate-900 px-1.5 py-1">{{ axes[index] }} {{ value }}</output></div></div><p v-if="!currentValues.length" class="mt-2 text-slate-400">Menunggu rig tangan.</p></div>
      </template>
      <div v-else-if="activeTab === 'diagnostics'" class="mt-3 space-y-3">
        <label class="flex items-center gap-2"><input v-model="debug.showSkeleton" type="checkbox"> Tampilkan skeleton kedua tangan</label><label class="flex items-center gap-2"><input v-model="debug.showAxes" type="checkbox"> Tampilkan sumbu bone terpilih</label><label class="flex items-center gap-2"><input v-model="debug.hideFoam" type="checkbox"> Sembunyikan busa untuk melihat kontak</label>
        <template v-if="snapshot">
          <div class="rounded-lg bg-slate-900 p-2">
            <p>Rig: <strong>{{ snapshot.rigAvailable ? 'Terhubung' : 'Belum tersedia' }}</strong></p>
            <p class="mt-1">Transform valid: <strong>{{ snapshot.diagnostics.finiteTransforms ? 'Ya' : 'Tidak' }}</strong></p>
            <p class="mt-1">Jarak pusat telapak: <strong>{{ metric(snapshot.diagnostics.palmCenterDistance, 1000) }} mm</strong></p>
            <p class="mt-1">Sudut normal telapak: <strong>{{ metric(snapshot.diagnostics.normalAngleDeg) }}°</strong></p>
            <p class="mt-1">Celah kulit telapak (5 sampel): <strong>{{ metric(snapshot.diagnostics.surfaceGap, 1000) }} mm</strong></p>
            <p class="mt-1">Gap antarjempol (perkiraan): <strong>{{ metric(snapshot.diagnostics.thumbClearance, 1000) }} mm</strong></p>
            <p class="mt-1">Gap jari (perkiraan): <strong>{{ metric(snapshot.diagnostics.fingerClearance, 1000) }} mm</strong></p>
            <p v-if="snapshot.diagnostics.closestFingerPair" class="mt-1 break-words text-[10px] text-slate-400">{{ snapshot.diagnostics.closestFingerPair }}</p>
            <p class="mt-2 text-[10px] leading-relaxed text-slate-400">Celah kulit memakai 5 ray pada permukaan mesh. Gap jari dan jempol memakai pendekatan kapsul tulang. Nilai negatif menandakan kemungkinan tumpang tindih; nilai positif bukan jaminan bebas benturan.</p>
            <p class="mt-1 text-[10px] leading-relaxed text-slate-400">Jarak pusat bukan celah kulit. Gunakan tampilan samping dan sembunyikan busa untuk menilai kontak.</p>
          </div>
          <ul v-if="snapshot.diagnostics.warnings.length" class="list-disc space-y-1 pl-4 text-amber-300"><li v-for="warning in snapshot.diagnostics.warnings" :key="warning">{{ warning }}</li></ul>
        </template>
        <button type="button" class="debug-button bg-slate-800" @click="refreshSnapshot">Perbarui angka</button>
      </div>
      <div v-else class="mt-3"><p class="text-[11px] leading-relaxed text-slate-400">Ekspor memuat offset semua tahap. Impor memeriksa versi, tahap, nama bone, dan angka sebelum menerapkan perubahan.</p><div class="mt-2 flex flex-wrap gap-1.5"><button type="button" class="debug-button bg-slate-800" @click="exportJson">Buat JSON</button><button type="button" class="debug-button bg-slate-800" @click="copyJson">Salin JSON</button><button type="button" class="debug-button bg-sky-800" @click="importJson()">Terapkan JSON</button></div><label for="debug-json" class="mt-2 block text-[10px] text-slate-400">JSON kalibrasi seluruh tahap</label><textarea id="debug-json" v-model="jsonText" class="debug-input mt-1 h-48 w-full resize-y font-mono text-[10px]" spellcheck="false" /><div class="mt-2 flex gap-1.5"><button type="button" class="debug-button bg-slate-800" @click="saveLocal">Simpan Lokal</button><button type="button" class="debug-button bg-slate-800" @click="loadLocal">Muat Lokal</button></div><p class="mt-2 text-[10px] text-slate-500">Tidak dimuat otomatis. Kalibrasi tidak mengubah berkas GLB atau kode animasi.</p></div>
      <div class="mt-3 border-t border-slate-800 pt-3"><button type="button" class="debug-button bg-slate-800 text-amber-200" @click="resetStage">Nolkan semua offset tahap ini</button><p v-if="feedback" role="status" class="mt-2 text-[11px] leading-relaxed" :class="feedbackError ? 'text-amber-300' : 'text-emerald-300'">{{ feedback }}</p></div>
    </section>
  </aside>
</template>

<style scoped>
.debug-input { border: 1px solid #475569; border-radius: 0.375rem; background: #0f172a; color: #e2e8f0; padding: 0.35rem 0.4rem; }
.debug-button { border: 1px solid #475569; border-radius: 0.5rem; padding: 0.45rem 0.65rem; font-weight: 500; cursor: pointer; }
.debug-button:hover { border-color: #7dd3fc; }
.debug-panel :is(button, input, select, textarea):focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }
.debug-panel input[type='checkbox'], .debug-panel input[type='radio'] { accent-color: #38bdf8; }
</style>
