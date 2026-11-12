# Simulasi Interaktif 3D Cuci Tangan Pakai Sabun (CTPS)
### Kementerian Kesehatan Republik Indonesia · BAPELKES

Aplikasi web interaktif 3D berbasis **Nuxt 4**, **Vue 3**, **Three.js**, dan **TresJS** untuk mendemonstrasikan panduan 6 langkah cuci tangan pakai sabun standar WHO dan Kementerian Kesehatan RI secara realistis, edukatif, dan nyaman dipelajari.

---

## 📋 Daftar Isi
1. [Fitur Utama](#-fitur-utama)
2. [Arsitektur & Struktur Folder](#-arsitektur--struktur-folder)
3. [Gaya Visual & Shading (Neo-Brutalism)](#-gaya-visual--shading-neo-brutalism)
4. [Sistem Animasi & Alur Playback](#-sistem-animasi--alur-playback)
5. [Instalasi & Menjalankan Proyek](#-instalasi--menjalankan-proyek)
6. [Pengujian & Verifikasi](#-pengujian--verifikasi)

---

## ✨ Fitur Utama

- **Visual 3D Real-time**: Simulasi sepasang tangan, wastafel keramik, kran air, dispenser sabun, dan efek aliran serta busa air.
- **Standar 6 Langkah CTPS**: Alur terstruktur dari tahap Persiapan hingga Langkah 1–6 dengan total durasi langkah inti tepat **60 detik**.
- **Shader Neo-Brutalism Halus**: Tampilan grafis modern dengan *block cel-shading*, garis kontur tinta (*ink outline*), dan pencahayaan studio yang ramah di mata.
- **Dual-Tone Kulit Anatomis**: Pembedaan alami antara punggung tangan (sunkissed tan) dan telapak tangan (warm peach) dengan transisi mulus.
- **Auto-Play Berkelanjutan**: Animasi mengalir otomatis dari langkah ke langkah tanpa berhenti di tengah jalan.
- **UI Responsif & Ramah Pengguna**: Menggunakan bahasa yang lugas, bebas istilah teknis, dilengkapi panel tips ringkas serta navigasi dock yang intuitif.

---

## 📂 Arsitektur & Struktur Folder

Kode telah direfaktor ke dalam modul-modul kecil berbasis domain agar mudah dipahami, dirawat, dan dikembangkan bersama:

```
app/
├── app.vue                                # Root component ringkas (~55 baris)
├── composables/
│   ├── useHandwashingModel.ts             # Lifecycle pemuatan GLB, binding rig, & styling scene
│   └── useHandwashingSteps.ts             # Logika navigasi langkah, sinkronisasi state, & kontrol putar/jeda
├── components/handwashing/
│   ├── scene/
│   │   └── HandwashingScene.vue           # Canvas TresJS, kamera, pencahayaan studio, & orbit controls
│   ├── ui/
│   │   ├── HandwashingTopbar.vue          # Header identitas Kemenkes, tombol Ulangi, & toggle Tips
│   │   ├── HandwashingStepDock.vue        # Dock bawah: info langkah aktif, tombol Play/Pause, & tab navigasi
│   │   ├── HandwashingTipsPanel.vue       # Panel tips & edukasi langkah (tersembunyi secara default)
│   │   └── HandwashingLoading.vue         # Layar tunggu saat aset 3D sedang dimuat
│   ├── effects/
│   │   ├── WaterSystem.vue                # Koordinator runtime efek air & busa
│   │   ├── SoapDispenser.vue              # Mesh dispenser sabun, animasi pompa, & tetesan sabun
│   │   └── water/
│   │       ├── FaucetStream.vue           # Aliran air vertikal dari keran
│   │       ├── HandWetness.vue            # Efek basah & perkembangan busa sabun di tangan
│   │       ├── SinkWaterSurface.vue       # Mesh permukaan air di dalam mangkuk wastafel
│   │       └── WaterDroplets.vue          # Partikel cipratan air
│   └── debug/
│       ├── HandRigDebug.vue               # Visualisasi tulang & sumbu sendi untuk kebutuhan kalibrasi
│       └── HandTuningPanel.vue            # Panel pengaturan transform sendi secara live
└── lib/handwashing/
    ├── config/
    │   ├── handwashingConfig.ts           # Definisi durasi, parameter fisik, & konfigurasi tiap stage
    │   └── handwashingStepsData.ts        # Data teks langkah, ringkasan, estimasi waktu, & poin tips UI
    ├── controllers/
    │   ├── HandAnimationController.ts     # Penggerak pose tulang skeletal tangan & damping gerakan
    │   └── HandwashingSequenceController.ts # State machine alur waktu, transisi tahap, & event callback
    ├── rendering/
    │   ├── toonShaderChunks.ts            # Helper modular pengganti outgoingLight Three.js
    │   ├── sinkMaterial.ts                # Material cel-shading wastafel beton arsitektural
    │   ├── sinkGeometry.ts                # Algoritma subdivisi kurvatur mangkuk & tiang wastafel
    │   ├── handMaterial.ts                # Shader cel-shading tangan & kuku dengan ink outline
    │   ├── handSkinColors.ts              # Pewarnaan vertex normal telapak vs punggung tangan
    │   ├── faucetMaterial.ts              # Shader logam slate industri untuk kran
    │   └── applySceneStyle.ts             # Fungsi traversal scene GLB untuk mengaplikasikan semua material
    ├── poses/
    │   ├── poseTypes.ts                   # Tipe data target artikulasi sendi & orientasi telapak
    │   ├── poseMotion.ts                  # Fungsi pembentuk kurva waktu (smoothstep, scrub cadence)
    │   ├── poseBlending.ts                # Interpolasi anatomis antar-pose tangan dan sendi
    │   ├── rubPalmsTuning.ts              # Konstanta tuning gerak gosok telapak tangan
    │   ├── handwashingPoses.ts            # Evaluator pose utama untuk tiap gerakan CTPS
    │   ├── handwashingContactCalibration.ts # Kalibrasi kontak permukaan kulit (punggung, sela jari, jempol)
    │   └── interlaceCalibration.ts        # Kalibrasi posisi mengaitkan jari
    ├── rig/
    │   ├── handRigMapping.ts              # Pemetaan nama tulang GLB ke struktur jari anatomis
    │   ├── handRigInspection.ts           # Inspeksi transformasi rig & verifikasi orientasi
    │   └── handPoseDebug.ts               # Snapshot & diagnosa rig tangan
    └── water/
        ├── waterConfig.ts                 # Konstanta warna air, partikel, dan busa
        ├── waterMaterials.ts              # Shader material cairan & busa
        ├── waterRuntime.ts                # Manajemen loop update efek air per frame
        └── useWaterParticles.ts           # Sistem partikel cipratan air
```

---

## 🎨 Gaya Visual & Shading (Neo-Brutalism)

Aplikasi mengadopsi estetika **Neo-Brutalism** yang disesuaikan agar tetap higienis, profesional, dan nyaman dipandang:

1. **Cel Shading Bertingkat (*Stepped Bands*)**:
   - Menghasilkan blok bayangan grafis tegas tanpa gradien kusam.
   - Menggunakan interpolasi `fwidth` pada shader untuk memastikan batas antar-blok tetap halus tanpa *aliasing* bergerigi.
2. **Kontras Bayangan yang Lembut**:
   - Bayangan wastafel menggunakan rona *teal-slate* lembut (`#9DB2B1`), bukan hitam pekat.
   - Bayangan tangan dikalibrasi pada rona hangat teratur (`baseCol * vec3(0.76, 0.68, 0.66)`) sehingga tidak tampak seperti noda lumpur/coklat pekat.
3. **Garis Siluet Grafis (*Ink Outline*)**:
   - Garis tepi tipis dihitung berbasis sudut pandang normal (`NdotV < 0.12`).
   - Warna tinta menggunakan coklat hangat untuk tangan (`#4D2E24`) dan teal pekat untuk wastafel/kran (`#2F4547`).
4. **Gradasi Kulit Dua Sisi**:
   - **Punggung Tangan**: Warna *warm golden-sand tan* (`#D9A28A`).
   - **Telapak Tangan**: Warna *warm natural peach* (`#ECD2C0`).
   - Dihitung per-vertex melalui proyeksi normal telapak dengan rentang transisi lebar (`smoothstep -0.30 .. 0.30`) agar batasnya tampak alami tanpa efek garis belang kaku.
5. **Background Studio Teduh**:
   - Latar belakang kanvas 3D menggunakan rona *studio teal-sage* (`#cbd9d8`) yang dipadukan dengan gradien lembut identitas visual Kemenkes RI, menghilangkan pantulan silau (*glare*) pada layar.

---

## ⏱️ Sistem Animasi & Alur Playback

- **Durasi Tepat 60 Detik**: Tahapan inti cuci tangan (Langkah 1 sampai 6) dikalibrasi agar selesai dalam 60 detik sesuai standar medis WHO. Tahap gosok sabun (Langkah 1) dialokasikan durasi lebih panjang (12 detik) untuk mensimulasikan proses pembentukan busa secara alami.
- **Auto-Play Penuh**: Menekan tombol **Putar (Play)** akan menjalankan animasi secara berkesinambungan dari awal hingga Langkah 6 tanpa jeda paksa di akhir tiap langkah.
- **Tombol Ulangi**: Mereset seluruh simulasi dan langsung memutar ulang dari awal (*Persiapan*).
- **Navigasi Mandiri**: Memilih langkah tertentu pada dock bawah akan langsung mengarahkan kamera dan animasi ke langkah tersebut serta melanjutkan pemutaran.

---

## 🚀 Instalasi & Menjalankan Proyek

### Prasyarat
- **Node.js**: Versi 20+ (direkomendasikan v22 atau v24)
- **NPM / PNPM**

### Langkah Menjalankan

1. **Clone repository & masuk ke direktori**:
   ```bash
   cd bapelkes
   ```

2. **Install dependensi**:
   ```bash
   npm install
   ```

3. **Jalankan development server**:
   ```bash
   npm run dev
   ```
   Aplikasi akan berjalan di `http://localhost:3000`.

4. **Build untuk produksi**:
   ```bash
   npm run build
   ```

5. **Preview build produksi**:
   ```bash
   npm run preview
   ```

---

## 🧪 Pengujian & Verifikasi

Proyek ini dilengkapi skrip verifikasi otomatis untuk memastikan stabilitas kinematika tulang, bebas benturan mesh (*collision checks*), dan akurasi durasi:

```bash
# Pengujian lengkap (kinematika, frekuensi siklus gosok, kontak kulit, & loop 30/60/144 FPS)
node scripts/verify-handwashing.mjs

# Pengujian khusus kontak permukaan kulit per langkah
node scripts/verify-handwashing-contact.mjs

# Pengujian khusus jari mengait (knuckles)
node scripts/verify-handwashing-knuckles.mjs
```

> **Catatan untuk Pengembang**: Semua tes di atas harus selalu berstatus `PASS` (exit code 0) sebelum melakukan *merge* atau *deployment*.
