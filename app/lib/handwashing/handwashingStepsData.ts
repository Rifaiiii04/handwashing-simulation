export interface HandwashingStepSection {
  readonly id: 'persiapan' | 'langkah1' | 'langkah2' | 'langkah3' | 'langkah4' | 'langkah5' | 'langkah6'
  readonly label: string
  readonly shortLabel: string
  /** Short step title shown to the user. */
  readonly subLabel: string
  /** One-sentence instruction shown under the title. */
  readonly summary: string
  readonly startStageIndex: number
  readonly endStageIndex: number
  /** Optional stage index to play through before this section pauses. */
  readonly playThroughStageIndex?: number
  readonly startStageId: string
  readonly enabled: boolean
  readonly whoStepNumber?: number
  readonly estimatedDuration: string
  /** Short how-to points shown in the Tips panel. */
  readonly movementPoints: readonly string[]
  /** One-sentence reason why the step matters. */
  readonly benefit: string
}

export const HANDWASHING_SECTIONS: readonly HandwashingStepSection[] = [
  {
    id: 'persiapan',
    label: 'Persiapan',
    shortLabel: 'Persiapan',
    subLabel: 'Basahi kedua tangan',
    summary: 'Bilas tangan di bawah air mengalir sampai basah merata.',
    startStageIndex: 0,
    endStageIndex: 1,
    startStageId: 'moveHandsToFaucet',
    enabled: true,
    whoStepNumber: 1,
    estimatedDuration: '5–7 detik',
    movementPoints: [
      'Dekatkan kedua tangan ke bawah keran.',
      'Buka telapak tangan agar air mengalir merata.',
      'Basahi sampai pergelangan tangan.',
    ],
    benefit: 'Tangan yang basah membuat sabun lebih berbusa dan kotoran lebih mudah terbilas.',
  },
  {
    id: 'langkah1',
    label: 'Langkah Pertama',
    shortLabel: 'Langkah 1',
    subLabel: 'Gosok telapak tangan',
    summary: 'Ambil sabun, lalu gosok kedua telapak tangan sampai berbusa.',
    startStageIndex: 2,
    endStageIndex: 3,
    startStageId: 'dispenseSoap',
    enabled: true,
    whoStepNumber: 1,
    estimatedDuration: '16 detik',
    movementPoints: [
      'Tekan pompa sabun dan tampung di telapak tangan.',
      'Tangkupkan kedua telapak tangan.',
      'Gosok memutar sampai busa merata.',
    ],
    benefit: 'Telapak tangan paling sering menyentuh benda, jadi paling banyak kumannya.',
  },
  {
    id: 'langkah2',
    label: 'Langkah Kedua',
    shortLabel: 'Langkah 2',
    subLabel: 'Gosok punggung tangan',
    summary: 'Gosok punggung tangan kiri dengan telapak kanan, lalu gantian.',
    startStageIndex: 4,
    endStageIndex: 4,
    startStageId: 'rubBacksOfHands',
    enabled: true,
    whoStepNumber: 2,
    estimatedDuration: '9 detik',
    movementPoints: [
      'Letakkan telapak kanan di atas punggung tangan kiri.',
      'Selipkan jari ke sela-sela jari, lalu gosok.',
      'Ganti posisi tangan.',
    ],
    benefit: 'Punggung tangan sering terlewat, padahal ikut terkena kuman dari meja dan gagang pintu.',
  },
  {
    id: 'langkah3',
    label: 'Langkah Ketiga',
    shortLabel: 'Langkah 3',
    subLabel: 'Gosok sela-sela jari',
    summary: 'Satukan kedua telapak, silangkan jari, lalu gosok maju-mundur.',
    startStageIndex: 5,
    endStageIndex: 5,
    // The interlaced release is authored as the entry of stage 4. Let it play
    // through stage 4 so the handoff is visible instead of pausing at stage 3.
    playThroughStageIndex: 6,
    startStageId: 'interlaceFingers',
    enabled: true,
    whoStepNumber: 3,
    estimatedDuration: '8 detik',
    movementPoints: [
      'Hadapkan kedua telapak tangan.',
      'Silangkan jari-jari kedua tangan.',
      'Gosok maju-mundur di sela jari.',
    ],
    benefit: 'Sela jari hangat dan lembap, tempat kuman mudah bersembunyi.',
  },
  {
    id: 'langkah4',
    label: 'Langkah Keempat',
    shortLabel: 'Langkah 4',
    subLabel: 'Kunci jari, lalu gosok',
    summary: 'Kaitkan jari kedua tangan, lalu gosokkan ruas jari ke telapak tangan.',
    startStageIndex: 6,
    endStageIndex: 6,
    // Continue into the thumb technique so the calibrated release/transfer
    // pose is visible instead of stopping on the last rubbing frame.
    playThroughStageIndex: 7,
    startStageId: 'rubBacksOfFingers',
    enabled: true,
    whoStepNumber: 4,
    estimatedDuration: '8 detik',
    movementPoints: [
      'Kaitkan jari-jari kedua tangan hingga saling mengunci.',
      'Gosokkan ruas jari ke telapak tangan lawan.',
    ],
    benefit: 'Membersihkan ruas dan lipatan jari yang sulit dijangkau.',
  },
  {
    id: 'langkah5',
    label: 'Langkah Kelima',
    shortLabel: 'Langkah 5',
    subLabel: 'Putar ibu jari',
    summary: 'Genggam ibu jari, lalu putar sambil digosok. Lakukan bergantian.',
    startStageIndex: 7,
    endStageIndex: 7,
    // Step 5 hands off directly to the fingertip technique after its final
    // thumb grip, including the authored free-space transfer.
    playThroughStageIndex: 8,
    startStageId: 'rubThumbs',
    enabled: true,
    whoStepNumber: 5,
    estimatedDuration: '9 detik',
    movementPoints: [
      'Genggam ibu jari kiri dengan tangan kanan.',
      'Putar sambil digosok.',
      'Ulangi untuk ibu jari kanan.',
    ],
    benefit: 'Ibu jari sering dipakai memegang ponsel dan makanan, jadi mudah kotor.',
  },
  {
    id: 'langkah6',
    label: 'Langkah Keenam',
    shortLabel: 'Langkah 6',
    subLabel: 'Gosok ujung jari & bilas',
    summary: 'Gosok ujung jari di telapak tangan, lalu bilas sampai bersih.',
    startStageIndex: 8,
    endStageIndex: 8,
    startStageId: 'rubFingertips',
    enabled: true,
    whoStepNumber: 6,
    estimatedDuration: '9 detik',
    movementPoints: [
      'Kuncupkan ujung jari kanan, lalu putar di telapak kiri.',
      'Ganti dengan tangan satunya.',
      'Bilas dengan air mengalir, lalu keringkan dengan handuk atau tisu bersih.',
    ],
    benefit: 'Kuku dan ujung jari menyimpan kuman yang paling sulit terbilas.',
  },
]
