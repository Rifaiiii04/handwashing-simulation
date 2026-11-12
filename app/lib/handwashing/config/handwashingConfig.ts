import type * as THREE from "three";

export type HandwashingStageId =
  | "idle"
  | "moveHandsToFaucet"
  | "wetHands"
  | "activateSoapDispenser"
  | "dispenseSoap"
  | "rubPalms"
  | "rubBacksOfHands"
  | "interlaceFingers"
  | "rubBacksOfFingers"
  | "rubThumbs"
  | "rubFingertips"
  | "rinseHands"
  | "finish";

export type HandwashingParticleMode = "none" | "water" | "foam";

export interface HandwashingStageConfig {
  readonly id: HandwashingStageId;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly whoStep?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly duration: number;
  readonly blendDuration: number;
  readonly faucetActive: boolean;
  readonly foamStart: number;
  readonly foamEnd: number;
  readonly particleMode: HandwashingParticleMode;
  readonly particleIntensity: number;
  readonly triggersPump: boolean;
  readonly emitsSoap: boolean;
}

export interface SoapDispenserConfig {
  /**
   * Offset in world-scaled units relative to the verified sink back-deck reference
   * (top surface of the sink back ledge at y = 1.500, x = 0, z = -1.28).
   */
  readonly deckOffset: readonly [number, number, number];
  /** Bottle dimensions in world units. */
  readonly bodyRadiusBottom: number;
  readonly bodyRadiusBelly: number;
  readonly bodyRadiusShoulder: number;
  readonly bodyHeight: number;
  readonly neckRadius: number;
  readonly neckHeight: number;
  readonly collarRadius: number;
  readonly collarHeight: number;
  readonly stemRadius: number;
  readonly stemHeight: number;
  readonly headRadius: number;
  readonly headHeight: number;
  readonly nozzleLength: number;
  readonly nozzleDrop: number;
  readonly nozzleRadius: number;
  readonly outletRadius: number;
  /** Nozzle horizontal yaw angle (radians) pointing from back-right deck toward the basin center. */
  readonly nozzleYawRadians: number;
  /** Vertical downward travel distance of the pump head during a press. */
  readonly pumpStroke: number;
  /** Normalized stage window [start, peak, end] within `dispenseSoap` for pump press & release. */
  readonly pumpPressWindow: readonly [number, number, number];
  /** Normalized stage window [start, land, fadeEnd] for the dispensed soap blob/strand. */
  readonly soapDropWindow: readonly [number, number, number];
  readonly soapBlobRadius: number;
  /** Stylized toon palette colors. */
  readonly bottleColor: THREE.ColorRepresentation;
  readonly bottleAccentColor: THREE.ColorRepresentation;
  readonly pumpMetalColor: THREE.ColorRepresentation;
  readonly outletDarkColor: THREE.ColorRepresentation;
  readonly soapLiquidColor: THREE.ColorRepresentation;
}

export interface HandwashingSystemConfig {
  readonly stages: readonly HandwashingStageConfig[];
  readonly dispenser: SoapDispenserConfig;
  readonly poseDampingLambda: number;
  readonly boneDampingLambda: number;
  /** Matched hand/bone response for faster, tightly fitted rubbing motions. */
  readonly contactDampingLambda: number;
  readonly foamDampingLambda: number;
  readonly autoLoopDemo: boolean;
  readonly enableRigDiagnostics: boolean;
}

export const HANDWASHING_STAGES: readonly HandwashingStageConfig[] = [
  {
    id: "moveHandsToFaucet",
    label: "Langkah 1 · Posisikan Tangan di Bawah Keran",
    shortLabel: "1a. Ke Keran",
    description:
      "Kedua tangan bergerak ke bawah keran. Begitu tangan berada tepat di bawah keran, air mulai mengalir.",
    whoStep: 1,
    duration: 2.8,
    blendDuration: 0.45,
    faucetActive: false,
    foamStart: 0,
    foamEnd: 0,
    particleMode: "water",
    particleIntensity: 0.55,
    triggersPump: false,
    emitsSoap: false,
  },
  {
    id: "wetHands",
    label: "Langkah 1 · Basuh Kedua Tangan",
    shortLabel: "1b. Basuh Tangan",
    description:
      "Telapak kiri menengadah menampung kucuran air dan kedua tangan membasuh permukaan kulit hingga basah merata.",
    whoStep: 1,
    duration: 5.0,
    blendDuration: 0.4,
    faucetActive: true,
    foamStart: 0,
    foamEnd: 0,
    particleMode: "water",
    particleIntensity: 0.85,
    triggersPump: false,
    emitsSoap: false,
  },
  {
    id: "dispenseSoap",
    label: "Langkah 1 · Ambil Sabun dari Dispenser",
    shortLabel: "1c. Pakai Sabun",
    description:
      "Tangan kanan menekan pompa dispenser. Telapak kiri menampung sabun, lalu kedua tangan mendekat untuk menggosok telapak.",
    whoStep: 1,
    duration: 4.0,
    blendDuration: 0.4,
    faucetActive: false,
    foamStart: 0,
    foamEnd: 0,
    particleMode: "none",
    particleIntensity: 0,
    triggersPump: true,
    emitsSoap: true,
  },
  {
    id: "rubPalms",
    label: "Langkah 1 · Gosok Kedua Telapak dengan Arah Memutar",
    shortLabel: "1d. Gosok Telapak",
    description:
      "Gosok sabun pada kedua telapak dengan gerakan memutar yang cepat dan lembut.",
    whoStep: 1,
    duration: 12.0,
    blendDuration: 0.45,
    faucetActive: false,
    foamStart: .18,
    foamEnd: .95,
    particleMode: "none",
    particleIntensity: 0,
    triggersPump: false,
    emitsSoap: false,
  },
  {
    id: "rubBacksOfHands",
    label: "Langkah 2 · Gosok Punggung Tangan Bergantian",
    shortLabel: "2. Punggung Tangan",
    description:
      "Telapak kanan menggosok punggung tangan kiri dengan jari saling menyela, kemudian berganti sisi.",
    whoStep: 2,
    duration: 9.5,
    blendDuration: 0.5,
    faucetActive: false,
    foamStart: .95,
    foamEnd: 0.95,
    particleMode: "foam",
    particleIntensity: 0.32,
    triggersPump: false,
    emitsSoap: false,
  },
  {
    id: "interlaceFingers",
    label: "Langkah 3 · Gosok Sela-Sela Jari dari Sisi Telapak",
    shortLabel: "3. Sela Jari",
    description:
      "Rapatkan sisi jari yang saling menyela, lalu gosok maju–mundur. Bagian tengah telapak boleh berjarak.",
    whoStep: 3,
    duration: 8.5,
    blendDuration: .5,
    faucetActive: false,
    foamStart: .95,
    foamEnd: .95,
    particleMode: "foam",
    particleIntensity: .32,
    triggersPump: false,
    emitsSoap: false,
  },
  {
    id: "rubBacksOfFingers",
    label: "Langkah 4 · Bersihkan Ujung Jari dengan Saling Mengunci",
    shortLabel: "4. Ujung Jari",
    description: "Kaitkan jari kedua tangan, tekuk ujungnya ke telapak yang berlawanan, lalu gosok bergantian dengan gerakan pendek.",
    whoStep: 4,
    duration: 8.0,
    blendDuration: .5,
    faucetActive: false,
    foamStart: .95,
    foamEnd: .95,
    particleMode: "foam",
    particleIntensity: .32,
    triggersPump: false,
    emitsSoap: false,
  },
  {
    id: "rubThumbs",
    label: "Langkah 5 · Gosok dan Putar Ibu Jari Bergantian",
    shortLabel: "5. Ibu Jari",
    description: "Genggam ibu jari dengan tangan yang berlawanan dan gosok dengan putaran terkontrol. Lepaskan genggaman, lalu lakukan pada ibu jari lainnya.",
    whoStep: 5,
    duration: 9.0,
    blendDuration: .5,
    faucetActive: false,
    foamStart: .95,
    foamEnd: .95,
    particleMode: "foam",
    particleIntensity: .32,
    triggersPump: false,
    emitsSoap: false,
  },
  {
    id: "rubFingertips",
    label: "Langkah 6 · Gosok Ujung Jari dan Kuku",
    shortLabel: "6. Ujung Jari",
    description: "Kuncupkan jari dan gosok ujung jari serta kuku dengan lingkaran kecil pada telapak yang berlawanan. Lepaskan, lalu berganti tangan.",
    whoStep: 6,
    duration: 9.0,
    blendDuration: .5,
    faucetActive: false,
    foamStart: .95,
    foamEnd: .95,
    particleMode: "foam",
    particleIntensity: .32,
    triggersPump: false,
    emitsSoap: false,
  },
];

export const SUBSEQUENT_WHO_STAGES: readonly HandwashingStageConfig[] = [];

export const DEFAULT_SOAP_DISPENSER_CONFIG: SoapDispenserConfig = {
  // Verified against the GLB sink back-right horizontal deck (y = 1.500, z in [-1.426, -1.181], x in [0.35, 0.85])
  deckOffset: [0.49, 0.0, -0.02],
  bodyRadiusBottom: 0.072,
  bodyRadiusBelly: 0.088,
  bodyRadiusShoulder: 0.068,
  bodyHeight: 0.245,
  neckRadius: 0.032,
  neckHeight: 0.032,
  collarRadius: 0.037,
  collarHeight: 0.044,
  stemRadius: 0.014,
  stemHeight: 0.075,
  headRadius: 0.031,
  headHeight: 0.042,
  nozzleLength: 0.175,
  nozzleDrop: 0.026,
  nozzleRadius: 0.011,
  outletRadius: 0.0085,
  nozzleYawRadians: -0.58, // Points forward (+Z) and inward (-X) toward the basin & left hand
  pumpStroke: 0.042,
  pumpPressWindow: [0.32, 0.44, 0.58],
  soapDropWindow: [0.40, 0.60, 0.98],
  soapBlobRadius: 0.018,
  bottleColor: 0x38b2ac,
  bottleAccentColor: 0xe6fffa,
  pumpMetalColor: 0xdbe4ee,
  outletDarkColor: 0x334155,
  soapLiquidColor: 0x7ce8ff,
};

export const DEFAULT_HANDWASHING_CONFIG: HandwashingSystemConfig = {
  stages: HANDWASHING_STAGES,
  dispenser: DEFAULT_SOAP_DISPENSER_CONFIG,
  poseDampingLambda: 11.5,
  boneDampingLambda: 13.0,
  contactDampingLambda: 28,
  foamDampingLambda: 6.5,
  autoLoopDemo: false,
  enableRigDiagnostics: false,
};
