export interface HandwashingStepSection {
  readonly id: 'persiapan' | 'langkah1' | 'langkah2' | 'langkah3' | 'langkah4' | 'langkah5' | 'langkah6'
  readonly label: string
  readonly shortLabel: string
  readonly subLabel: string
  readonly startStageIndex: number
  readonly endStageIndex: number
  readonly startStageId: string
  readonly enabled: boolean
  readonly whoStepNumber?: number
  readonly estimatedDuration: string
  readonly guidanceTitle: string
  readonly guidanceDescription: string
  readonly movementPoints: readonly string[]
  readonly benefitsTitle: string
  readonly benefitsSummary: string
  readonly benefitsPoints: readonly string[]
  readonly focalAreaName: string
}

export const HANDWASHING_SECTIONS: readonly HandwashingStepSection[] = [
  {
    id: 'persiapan',
    label: 'Persiapan',
    shortLabel: 'Persiapan',
    subLabel: 'Basahi Tangan dengan Air Mengalir',
    startStageIndex: 0,
    endStageIndex: 1,
    startStageId: 'moveHandsToFaucet',
    enabled: true,
    whoStepNumber: 1,
    estimatedDuration: '5 – 7 detik',
    guidanceTitle: 'Persiapan: Basahi Kedua Tangan',
    guidanceDescription:
      'Posisikan kedua tangan di bawah kucuran air mengalir dari keran. Ratakan air ke seluruh permukaan kulit tangan hingga basah merata sebelum mengaplikasikan sabun.',
    movementPoints: [
      'Arahkan kedua tangan mendekat ke bawah kucuran keran wastafel.',
      'Buka telapak tangan ke atas untuk menampung aliran air bersih.',
      'Basahi seluruh bagian tangan hingga ke pergelangan sebelum sabun dituangkan.',
    ],
    benefitsTitle: 'Manfaat Medis & Kebersihan (Kemenkes)',
    benefitsSummary:
      'Air mengalir melarutkan debu dan mempersiapkan kulit agar surfaktan sabun dapat beremulsi secara maksimal.',
    benefitsPoints: [
      'Membilas partikel debu dan kotoran kasar awal tanpa risiko kontaminasi ulang.',
      'Memberikan kelembapan optimal pada pori-pori kulit sehingga sabun berbusa melimpah dan tidak menyebabkan iritasi pekat.',
      'Sistem air mengalir memastikan kuman langsung terhanyut ke saluran pembuangan wastafel, berbeda dari air tampungan kobokan.',
    ],
    focalAreaName: 'Kucuran Air Keran & Telapak',
  },
  {
    id: 'langkah1',
    label: 'Langkah Pertama',
    shortLabel: 'Langkah 1',
    subLabel: 'Ambil Sabun & Gosok Telapak Tangan',
    startStageIndex: 2,
    endStageIndex: 3,
    startStageId: 'dispenseSoap',
    enabled: true,
    whoStepNumber: 1,
    estimatedDuration: '10 – 15 detik',
    guidanceTitle: 'Langkah 1: Tuang Sabun & Gosok Telapak',
    guidanceDescription:
      'Ambil sabun cair antiseptik secukupnya (3–5 ml), lalu tangkupkan kedua telapak tangan dan gosok memutar dengan lembut hingga menghasilkan busa melimpah.',
    movementPoints: [
      'Tekan pompa dispenser dengan telapak kanan, tampung cairan sabun pada telapak kiri.',
      'Rapatkan kedua telapak tangan secara berhadapan.',
      'Gosok kedua telapak tangan dengan gerakan memutar (circular motions) secara merata hingga busa menutup seluruh telapak.',
    ],
    benefitsTitle: 'Manfaat Medis & Kebersihan (Kemenkes)',
    benefitsSummary:
      'Surfaktan sabun melarutkan selubung lipid virus dan melemahkan daya rekat bakteri pada telapak tangan.',
    benefitsPoints: [
      'Molekul sabun merusak membran lipid virus (termasuk virus influenza dan coronavirus) sehingga kuman menjadi tidak aktif.',
      'Telapak tangan adalah zona sentuh utama saat beraktivitas; penggosokan memutar melepaskan koloni mikrob dari lipatan kulit epidermal.',
      'Membentuk busa busa tebal yang mengangkat kotoran berminyak agar mudah dibilas.',
    ],
    focalAreaName: 'Permukaan Telapak Tangan',
  },
  {
    id: 'langkah2',
    label: 'Langkah Kedua',
    shortLabel: 'Langkah 2',
    subLabel: 'Gosok Punggung Tangan Bergantian',
    startStageIndex: 4,
    endStageIndex: 4,
    startStageId: 'rubBacksOfHands',
    enabled: true,
    whoStepNumber: 2,
    estimatedDuration: '10 – 12 detik',
    guidanceTitle: 'Langkah 2: Gosok Punggung Tangan Bergantian',
    guidanceDescription:
      'Letakkan telapak tangan kanan di atas punggung tangan kiri dengan jari saling menyela, lalu gosok ke arah atas dan bawah. Lakukan sebaliknya untuk punggung tangan kanan.',
    movementPoints: [
      'Letakkan telapak tangan kanan di atas punggung tangan kiri.',
      'Sisipkan jari-jemari ke sela-sela jari tangan kiri dari arah luar.',
      'Gosok ke arah atas dan bawah secara merata, kemudian tukar posisi tangan kanan dan kiri.',
    ],
    benefitsTitle: 'Manfaat Medis & Kebersihan (Kemenkes)',
    benefitsSummary:
      'Membersihkan punggung tangan dan sela luar yang sering luput saat mencuci tangan terburu-buru.',
    benefitsPoints: [
      'Kulit punggung tangan lebih tipis dan sering terpapar droplet serta debu permukaan meja atau gagang pintu.',
      'Gerakan menyela dari atas membersihkan bakteri yang menempel di pangkal luar celah jari.',
      'Mencegah perpindahan patogen nosokomial ke area sensitif tubuh lainnya.',
    ],
    focalAreaName: 'Punggung Tangan & Sela Luar',
  },
  {
    id: 'langkah3',
    label: 'Langkah Ketiga',
    shortLabel: 'Langkah 3',
    subLabel: 'Gosok Sela-Sela Jari Bagian Dalam',
    startStageIndex: 5,
    endStageIndex: 5,
    startStageId: 'interlaceFingers',
    enabled: true,
    whoStepNumber: 3,
    estimatedDuration: '10 – 12 detik',
    guidanceTitle: 'Langkah 3: Gosok Sela-Sela Jari Bagian Dalam',
    guidanceDescription:
      'Hadapkan kedua telapak tangan, kaitkan jari-jari saling menyilang, lalu gosok maju dan mundur dengan gesekan kuat di celah-celah antar jari.',
    movementPoints: [
      'Hadapkan kedua telapak tangan secara paralel.',
      'Rapatkan jari-jari yang saling menyela dari sisi depan telapak.',
      'Lakukan gerakan menggosok maju-mundur secara ritmis sepanjang celah jari.',
    ],
    benefitsTitle: 'Manfaat Medis & Kebersihan (Kemenkes)',
    benefitsSummary:
      'Sela jari merupakan area mikro paling lembap dan menjadi habitat utama koloni bakteri patogen.',
    benefitsPoints: [
      'Sela-sela jari adalah zona mikro paling hangat dan lembap, tempat bersarangnya bakteri penyebab diare dan infeksi saluran cerna.',
      'Friksi antar sisi samping jari efektif mengikis biofilm kuman yang tidak terjangkau usapan biasa.',
      'Memastikan seluruh celah jari terlindungi secara higienis sebelum langkah penguncian.',
    ],
    focalAreaName: 'Sela-Sela Jari Bagian Dalam',
  },
  {
    id: 'langkah4',
    label: 'Langkah Keempat',
    shortLabel: 'Langkah 4',
    subLabel: 'Posisi Jari Saling Mengunci',
    startStageIndex: -1,
    endStageIndex: -1,
    startStageId: '',
    enabled: false,
    whoStepNumber: 4,
    estimatedDuration: '10 detik',
    guidanceTitle: 'Langkah 4: Jari-Jari Saling Mengunci (WHO)',
    guidanceDescription:
      'Kaitkan jari-jemari kedua tangan dengan posisi saling mengunci, lalu gosokkan bagian belakang ruas-ruas jari ke telapak tangan yang berlawanan.',
    movementPoints: [
      'Rapatkan jari tangan kiri dan kanan membentuk kaitan mengunci.',
      'Gosokkan buku-buku jari secara bergantian ke telapak tangan.',
    ],
    benefitsTitle: 'Manfaat Medis & Kebersihan (Kemenkes)',
    benefitsSummary:
      'Membersihkan punggung ruas jari dan lipatan sendi falang yang sulit dibersihkan dengan telapak datar.',
    benefitsPoints: [
      'Menjangkau lekukan dorsal pada buku-buku jari tangan.',
      'Mengangkat kotoran yang terperangkap pada lipatan sendi jari.',
    ],
    focalAreaName: 'Buku & Ruas Jari Tangan',
  },
  {
    id: 'langkah5',
    label: 'Langkah Kelima',
    shortLabel: 'Langkah 5',
    subLabel: 'Gosok & Putar Kedua Ibu Jari',
    startStageIndex: -1,
    endStageIndex: -1,
    startStageId: '',
    enabled: false,
    whoStepNumber: 5,
    estimatedDuration: '10 detik',
    guidanceTitle: 'Langkah 5: Gosok & Putar Ibu Jari (WHO)',
    guidanceDescription:
      'Genggam ibu jari kiri dengan telapak tangan kanan, putar dan gosok secara sirkular. Lakukan bergantian untuk ibu jari tangan kanan.',
    movementPoints: [
      'Genggam erat ibu jari tangan kiri dengan telapak tangan kanan.',
      'Putar tangan kanan memutar ibu jari kiri secara sirkular.',
      'Lakukan gerakan yang sama secara bergantian untuk ibu jari kanan.',
    ],
    benefitsTitle: 'Manfaat Medis & Kebersihan (Kemenkes)',
    benefitsSummary:
      'Ibu jari adalah jari paling aktif dan memiliki kontak tertinggi dengan objek luar seperti ponsel dan makanan.',
    benefitsPoints: [
      'Ibu jari menyumbang lebih dari 40% fungsi genggaman tangan.',
      'Area thenar dan pangkal jempol sering menjadi vektor utama transmisi kuman saat makan menggunakan tangan.',
    ],
    focalAreaName: 'Pangkal & Batang Ibu Jari',
  },
  {
    id: 'langkah6',
    label: 'Langkah Keenam',
    shortLabel: 'Langkah 6',
    subLabel: 'Bersihkan Ujung Jari & Kuku',
    startStageIndex: -1,
    endStageIndex: -1,
    startStageId: '',
    enabled: false,
    whoStepNumber: 6,
    estimatedDuration: '10 detik',
    guidanceTitle: 'Langkah 6: Ujung Jari, Kuku & Bilas (WHO)',
    guidanceDescription:
      'Kuncupkan ujung-ujung jari tangan kanan di atas telapak tangan kiri, lalu putar perlahan searah dan berlawanan jarum jam. Lakukan bergantian, kemudian bilas dengan air mengalir hingga bersih.',
    movementPoints: [
      'Kuncupkan ujung kuku dan jari tangan kanan.',
      'Gosokkan memutar di atas telapak tangan kiri.',
      'Lakukan bergantian untuk kuku jari tangan kiri.',
      'Bilas tangan dengan air mengalir sampai seluruh sisa sabun hilang, lalu keringkan dengan handuk/tisu bersih.',
    ],
    benefitsTitle: 'Manfaat Medis & Kebersihan (Kemenkes)',
    benefitsSummary:
      'Membersihkan area subungual (bawah kuku) yang menjadi tempat bersembunyinya telur cacing dan mikroba patogen.',
    benefitsPoints: [
      'Area bawah kuku adalah tempat persembunyian mikrob yang paling sulit dijangkau.',
      'Pembersihan kuku sangat vital untuk mencegah penularan penyakit diare, cacingan, dan infeksi makanan.',
    ],
    focalAreaName: 'Ujung Kuku & Ujung Jari',
  },
]
