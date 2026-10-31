import { shallowReactive } from "vue";
import * as THREE from "three";
import { HandAnimationController } from "./HandAnimationController";
import {
  DEFAULT_HANDWASHING_CONFIG,
  type HandwashingParticleMode,
  type HandwashingStageConfig,
  type HandwashingStageId,
  type HandwashingSystemConfig,
} from "./handwashingConfig";
import type { MappedHandPairRig } from "./handRigMapping";
import { evaluateStagePose } from "./handwashingPoses";

export interface HandwashingReactiveState {
  stageId: HandwashingStageId;
  stageIndex: number;
  stageLabel: string;
  stageDescription: string;
  whoStep: number | null;
  stageElapsed: number;
  stageDuration: number;
  stageProgress: number;
  sequenceProgress: number;
  isPlaying: boolean;
  loop: boolean;
  faucetActive: boolean;
  foamIntensity: number;
  particleMode: HandwashingParticleMode;
  particleIntensity: number;
  pumpPressProgress: number;
  soapBlobVisible: boolean;
  soapBlobProgress: number;
  hasValidSkeleton: boolean;
  resetToken: number;
}

export interface HandwashingControllerCallbacks {
  onStageEnter?: (stage: HandwashingStageConfig, previousStage: HandwashingStageConfig | null) => void;
  onStageExit?: (stage: HandwashingStageConfig, nextStage: HandwashingStageConfig) => void;
  onSequenceComplete?: () => void;
  onReset?: () => void;
}

export class HandwashingSequenceController {
  readonly config: HandwashingSystemConfig;
  readonly stages: readonly HandwashingStageConfig[];
  readonly totalDuration: number;
  readonly state: HandwashingReactiveState;
  readonly handAnimator: HandAnimationController;

  private callbacks: HandwashingControllerCallbacks;
  private targetFoamIntensity = 0;
  private isInitialResetState = true;
  private sequenceCompletedNotified = false;
  private stagePoseDirty = true;

  constructor(
    config: Partial<HandwashingSystemConfig> = {},
    callbacks: HandwashingControllerCallbacks = {},
  ) {
    this.config = {
      ...DEFAULT_HANDWASHING_CONFIG,
      ...config,
      dispenser: {
        ...DEFAULT_HANDWASHING_CONFIG.dispenser,
        ...config.dispenser,
      },
      stages: config.stages ?? DEFAULT_HANDWASHING_CONFIG.stages,
    };
    this.stages = this.config.stages;
    this.callbacks = callbacks;
    this.handAnimator = new HandAnimationController();
    this.totalDuration = this.stages.reduce((sum, stage) => sum + stage.duration, 0);

    const initialStage = this.stages[0]!;
    this.state = shallowReactive<HandwashingReactiveState>({
      stageId: initialStage.id,
      stageIndex: 0,
      stageLabel: initialStage.label,
      stageDescription: initialStage.description,
      whoStep: initialStage.whoStep ?? null,
      stageElapsed: 0,
      stageDuration: initialStage.duration,
      stageProgress: 0,
      sequenceProgress: 0,
      isPlaying: false,
      loop: this.config.autoLoopDemo,
      faucetActive: false,
      foamIntensity: 0,
      particleMode: "none",
      particleIntensity: 0,
      pumpPressProgress: 0,
      soapBlobVisible: false,
      soapBlobProgress: 0,
      hasValidSkeleton: false,
      resetToken: 0,
    });

    this.enterStage(0, null, true);
    this.state.faucetActive = false;
    this.state.particleMode = "none";
    this.state.particleIntensity = 0;
  }

  /**
   * Discovers, maps, and binds the loaded GLB scene's hand armatures, `SkinnedMesh`
   * primitives, and 20-bone skeletons per hand.
   */
  bindScene(scene: THREE.Object3D | null | undefined): boolean {
    if (!scene) return false;
    const wasBound = Boolean(this.handAnimator.getRig());
    const bound = this.handAnimator.bindScene(scene, this.config.enableRigDiagnostics);
    if (!bound) return false;

    this.state.hasValidSkeleton = this.handAnimator.hasValidSkeleton();

    if (!wasBound) {
      const currentStage = this.stages[this.state.stageIndex]!;
      const evaluation = evaluateStagePose(
        this.isInitialResetState ? "idle" : currentStage.id,
        this.state.stageProgress,
        this.state.stageElapsed,
        {
          pumpStroke: this.config.dispenser.pumpStroke,
          pumpPressProgress: this.state.pumpPressProgress,
        },
      );
      this.handAnimator.applyPose(
        evaluation,
        0,
        this.config.poseDampingLambda,
        this.config.boneDampingLambda,
      );
    }
    return true;
  }

  getRig(): MappedHandPairRig | null {
    return this.handAnimator.getRig();
  }

  getCurrentStage(): HandwashingStageConfig {
    return this.stages[this.state.stageIndex]!;
  }

  play(): void {
    this.isInitialResetState = false;
    this.state.isPlaying = true;
  }

  pause(): void {
    this.state.isPlaying = false;
  }

  togglePlay(): void {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      if (
        this.state.stageIndex === this.stages.length - 1 &&
        this.state.stageProgress >= 0.99
      ) {
        this.restart(true);
      } else {
        this.play();
      }
    }
  }

  setLoop(loop: boolean): void {
    this.state.loop = loop;
  }

  /**
   * Resets all timers, pump state, soap drop, foam intensity, particle emission,
   * faucet state, and restores both hands to their verified rest transforms.
   */
  reset(autoPlay = false): void {
    this.state.isPlaying = false;
    this.isInitialResetState = !autoPlay;
    this.sequenceCompletedNotified = false;
    this.state.resetToken += 1;
    this.targetFoamIntensity = 0;
    this.state.foamIntensity = 0;
    this.state.pumpPressProgress = 0;
    this.state.soapBlobVisible = false;
    this.state.soapBlobProgress = 0;
    this.enterStage(0, this.getCurrentStage(), true);

    if (this.isInitialResetState) {
      this.state.faucetActive = false;
      this.state.particleMode = "none";
      this.state.particleIntensity = 0;
    }

    this.handAnimator.resetToRestPose();
    const evaluation = evaluateStagePose("idle", 0, 0, {
      pumpStroke: this.config.dispenser.pumpStroke,
      pumpPressProgress: 0,
    });
    this.handAnimator.applyPose(
      evaluation,
      0,
      this.config.poseDampingLambda,
      this.config.boneDampingLambda,
    );

    this.state.isPlaying = autoPlay;
    this.callbacks.onReset?.();
  }

  restart(autoPlay = true): void {
    this.reset(autoPlay);
  }

  goToStage(stageIdOrIndex: HandwashingStageId | number, autoPlay?: boolean): void {
    const nextIndex =
      typeof stageIdOrIndex === "number"
        ? THREE.MathUtils.clamp(stageIdOrIndex, 0, this.stages.length - 1)
        : this.stages.findIndex((s) => s.id === stageIdOrIndex);
    if (nextIndex < 0) return;

    const wasInitialReset = this.isInitialResetState;
    this.isInitialResetState = false;
    this.sequenceCompletedNotified = false;
    const previousStage = this.getCurrentStage();
    this.enterStage(nextIndex, previousStage, true);
    if (autoPlay !== undefined) {
      this.state.isPlaying = autoPlay;
    } else if (wasInitialReset) {
      this.state.isPlaying = true;
    }
  }

  nextStage(): void {
    if (this.state.stageIndex < this.stages.length - 1) {
      this.goToStage(this.state.stageIndex + 1);
    } else if (this.state.loop) {
      this.goToStage(0);
    }
  }

  prevStage(): void {
    if (this.state.stageIndex > 0) {
      this.goToStage(this.state.stageIndex - 1);
    }
  }

  private enterStage(
    nextIndex: number,
    previousStage: HandwashingStageConfig | null,
    snapFoamToStageStart: boolean,
  ): void {
    const nextStage = this.stages[nextIndex]!;
    if (previousStage && previousStage.id !== nextStage.id) {
      this.callbacks.onStageExit?.(previousStage, nextStage);
    }

    this.state.stageIndex = nextIndex;
    this.state.stageId = nextStage.id;
    this.state.stageLabel = nextStage.label;
    this.state.stageDescription = nextStage.description;
    this.state.whoStep = nextStage.whoStep ?? null;
    this.state.stageElapsed = 0;
    this.state.stageDuration = nextStage.duration;
    this.state.stageProgress = 0;

    this.state.faucetActive =
      nextStage.id === "moveHandsToFaucet" ? false : nextStage.faucetActive;
    this.state.particleMode =
      nextStage.id === "moveHandsToFaucet" ? "none" : nextStage.particleMode;
    this.state.particleIntensity =
      nextStage.id === "moveHandsToFaucet" ? 0 : nextStage.particleIntensity;
    this.targetFoamIntensity = nextStage.foamStart;

    if (snapFoamToStageStart || nextStage.id === "idle" || nextStage.id === "finish") {
      this.state.foamIntensity = nextStage.foamStart;
    }

    if (!nextStage.triggersPump) {
      this.state.pumpPressProgress = 0;
    }
    if (
      nextStage.id !== "dispenseSoap" &&
      nextStage.id !== "rubPalms" &&
      !(nextStage.id === "moveHandsToFaucet" && previousStage?.id === "dispenseSoap")
    ) {
      this.state.soapBlobVisible = false;
      this.state.soapBlobProgress = 0;
    }
    if (nextStage.id === "idle" || nextStage.id === "finish") {
      this.state.resetToken += 1;
    }

    this.stagePoseDirty = true;
    this.updateSequenceProgress();
    this.callbacks.onStageEnter?.(nextStage, previousStage);
  }

  private updateSequenceProgress(): void {
    let elapsedBefore = 0;
    for (let i = 0; i < this.state.stageIndex; i++) {
      elapsedBefore += this.stages[i]!.duration;
    }
    const currentStage = this.getCurrentStage();
    const currentElapsed = Math.min(this.state.stageElapsed, currentStage.duration);
    const total = elapsedBefore + currentElapsed;
    this.state.sequenceProgress =
      this.totalDuration > 0 ? THREE.MathUtils.clamp(total / this.totalDuration, 0, 1) : 0;
  }

  private updateStageEffects(stage: HandwashingStageConfig, progress: number, delta: number): void {
    if (this.isInitialResetState) {
      this.state.faucetActive = false;
      this.state.particleMode = "none";
      this.state.particleIntensity = 0;
      this.state.pumpPressProgress = 0;
      this.state.soapBlobVisible = false;
      this.state.soapBlobProgress = 0;
      this.state.foamIntensity = 0;
      return;
    }

    if (stage.id === "moveHandsToFaucet") {
      this.state.faucetActive = progress >= 0.85;
      if (this.state.faucetActive) {
        this.state.particleMode = "water";
        this.state.particleIntensity =
          THREE.MathUtils.smoothstep(progress, 0.85, 1.0) * stage.particleIntensity;
      } else {
        this.state.particleMode = "none";
        this.state.particleIntensity = 0;
      }
    } else {
      this.state.faucetActive = stage.faucetActive;
    }

    if (stage.triggersPump) {
      const [pressStart, pressPeak, pressEnd] = this.config.dispenser.pumpPressWindow;
      if (progress <= pressStart || progress >= pressEnd) {
        this.state.pumpPressProgress = 0;
      } else if (progress <= pressPeak) {
        this.state.pumpPressProgress = THREE.MathUtils.smoothstep(progress, pressStart, pressPeak);
      } else {
        this.state.pumpPressProgress =
          1 - THREE.MathUtils.smoothstep(progress, pressPeak, pressEnd);
      }
    } else {
      this.state.pumpPressProgress = 0;
    }

    if (stage.emitsSoap) {
      const [dropStart, dropLand] = this.config.dispenser.soapDropWindow;
      if (progress < dropStart) {
        this.state.soapBlobVisible = false;
        this.state.soapBlobProgress = 0;
      } else {
        this.state.soapBlobVisible = true;
        if (progress <= dropLand) {
          const t = THREE.MathUtils.clamp(
            (progress - dropStart) / Math.max(0.001, dropLand - dropStart),
            0,
            1,
          );
          this.state.soapBlobProgress = t * 0.65;
        } else {
          const t = THREE.MathUtils.clamp(
            (progress - dropLand) / Math.max(0.001, 1 - dropLand),
            0,
            1,
          );
          // 0.65 -> 0.80: dollop safely resting on left palm while hands carry it back to faucet
          this.state.soapBlobProgress = 0.65 + t * 0.15;
        }
      }
    } else if (stage.id === "moveHandsToFaucet" && !this.isInitialResetState) {
      if (progress < 0.85) {
        // Soap dollop remains visible on left palm while returning under faucet
        this.state.soapBlobVisible = true;
        this.state.soapBlobProgress = 0.80;
      } else if (progress < 0.98) {
        // Water stream turns on at progress >= 0.85: soap seamlessly dissolves under the flow
        this.state.soapBlobVisible = true;
        const washT = THREE.MathUtils.clamp((progress - 0.85) / 0.13, 0, 1);
        this.state.soapBlobProgress = 0.85 + washT * 0.15;
      } else {
        this.state.soapBlobVisible = false;
        this.state.soapBlobProgress = 0;
      }
    } else if (stage.id === "rubPalms" && progress < 0.16) {
      // Substage A & B (0..0.16): dollop flattens and dissolves into lather as palms meet
      this.state.soapBlobVisible = true;
      if (progress <= 0.08) {
        this.state.soapBlobProgress = 0.80;
      } else {
        const t = THREE.MathUtils.clamp((progress - 0.08) / 0.08, 0, 1);
        this.state.soapBlobProgress = 0.80 + t * 0.20;
      }
    } else {
      this.state.soapBlobVisible = false;
      this.state.soapBlobProgress = 0;
    }

    let stageFoamTarget: number;
    if (stage.id === "rubPalms") {
      if (progress <= 0.08) {
        // Substage A: liquid soap dollop on left palm, minimal initial foam
        stageFoamTarget = THREE.MathUtils.lerp(0.0, stage.foamStart * 0.5, progress / 0.08);
      } else if (progress <= 0.16) {
        // Substage B: palms meet in contact, soap lathers to initial 0.1 coverage
        stageFoamTarget = THREE.MathUtils.lerp(
          stage.foamStart * 0.5,
          stage.foamStart,
          (progress - 0.08) / 0.08,
        );
      } else if (progress <= 0.84) {
        // Substages C, D, E: 6 circular rubbing cycles ramp foam coverage from 0.1 to 0.8
        stageFoamTarget = THREE.MathUtils.lerp(
          stage.foamStart,
          stage.foamEnd,
          THREE.MathUtils.smoothstep(progress, 0.16, 0.84),
        );
      } else {
        // Substage F: both palms fully coated with foam (0.80)
        stageFoamTarget = stage.foamEnd;
      }
    } else {
      stageFoamTarget = THREE.MathUtils.lerp(
        stage.foamStart,
        stage.foamEnd,
        THREE.MathUtils.smoothstep(progress, 0, 1),
      );
    }

    this.targetFoamIntensity = stageFoamTarget;
    if (stage.foamStart === 0 && stage.foamEnd === 0) {
      this.state.foamIntensity = 0;
    } else {
      const foamAlpha = delta > 0 ? 1 - Math.exp(-this.config.foamDampingLambda * delta) : 1;
      this.state.foamIntensity = THREE.MathUtils.lerp(
        this.state.foamIntensity,
        this.targetFoamIntensity,
        foamAlpha,
      );
      if (this.state.foamIntensity < 0.002 && this.targetFoamIntensity === 0) {
        this.state.foamIntensity = 0;
      }
    }

    this.state.particleMode = stage.particleMode;
    if (stage.id === "rinseHands") {
      this.state.particleIntensity = stage.particleIntensity;
    } else if (stage.particleMode === "foam") {
      this.state.particleIntensity = stage.particleIntensity * Math.max(0.25, this.state.foamIntensity);
    } else {
      this.state.particleIntensity = stage.particleIntensity;
    }
  }

  /**
   * Advances the timeline and updates skeletal hand & finger poses inside the single render loop.
   */
  update(delta: number): void {
    const safeDelta = Math.min(Math.max(delta, 0), 0.05);
    const currentStage = this.getCurrentStage();

    if (this.state.isPlaying) {
      this.state.stageElapsed += safeDelta;
      if (this.state.stageElapsed >= currentStage.duration) {
        if (this.state.stageIndex < this.stages.length - 1) {
          this.enterStage(this.state.stageIndex + 1, currentStage, false);
        } else if (this.state.loop) {
          this.enterStage(0, currentStage, true);
        } else {
          this.state.stageProgress = 1;
          this.state.stageElapsed = currentStage.duration;
          this.state.isPlaying = false;
          if (!this.sequenceCompletedNotified) {
            this.sequenceCompletedNotified = true;
            this.callbacks.onSequenceComplete?.();
          }
        }
      } else {
        this.state.stageProgress = THREE.MathUtils.clamp(
          this.state.stageElapsed / Math.max(0.001, currentStage.duration),
          0,
          1,
        );
      }
      this.updateSequenceProgress();
    } else if (!this.stagePoseDirty && !this.isInitialResetState) {
      return;
    }

    const activeStage = this.getCurrentStage();
    this.updateStageEffects(activeStage, this.state.stageProgress, safeDelta);

    const evaluation = evaluateStagePose(
      this.isInitialResetState ? "idle" : activeStage.id,
      this.state.stageProgress,
      this.state.stageElapsed,
      {
        pumpStroke: this.config.dispenser.pumpStroke,
        pumpPressProgress: this.state.pumpPressProgress,
      },
    );
    this.handAnimator.applyPose(
      evaluation,
      this.stagePoseDirty && !this.state.isPlaying ? 0 : safeDelta,
      this.config.poseDampingLambda,
      this.config.boneDampingLambda,
    );
    this.stagePoseDirty = false;
  }

  dispose(): void {
    this.state.isPlaying = false;
    this.handAnimator.dispose();
  }
}
