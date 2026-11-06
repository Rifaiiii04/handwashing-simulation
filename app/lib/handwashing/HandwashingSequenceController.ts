import { reactive, shallowReactive, watch, type WatchStopHandle } from "vue";
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
import {
  captureDebugRig, createDebugStageOverride, validateDebugImport,
  type DebugMetrics, type DebugOverridesExport, type DebugStageOverride,
  type HandPoseDebugSettings, type HandPoseDebugSnapshot,
} from "./handPoseDebug";

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
  readonly debug = reactive<HandPoseDebugSettings>({
    enabled: false, showSkeleton: false, showAxes: false, hideFoam: true,
    loopStage: true, playbackRate: 1, selectedSide: "right", selectedBone: "",
  });
  readonly debugStages = reactive<Partial<Record<HandwashingStageId, DebugStageOverride>>>({});

  private callbacks: HandwashingControllerCallbacks;
  private targetFoamIntensity = 0;
  private isInitialResetState = true;
  private sequenceCompletedNotified = false;
  private stagePoseDirty = true;
  private debugMetrics: Partial<DebugMetrics> = {};
  private stopDebugWatch: WatchStopHandle;

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
    if (!this.stages.length || this.stages.some((stage) => !Number.isFinite(stage.duration) || stage.duration <= 0)) {
      throw new Error("Handwashing stages require finite, positive durations.");
    }
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
    this.stopDebugWatch = watch(
      [() => this.debug.enabled, () => this.debugStages],
      () => { this.stagePoseDirty = true; },
      { deep: true, flush: "sync" },
    );
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
        this.debug.enabled ? this.debugStages[currentStage.id] : undefined,
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
        if (this.debug.enabled && this.debug.loopStage) {
          this.seek(0);
          this.play();
        } else {
          this.restart(true);
        }
      } else {
        this.play();
      }
    }
  }

  setLoop(loop: boolean): void {
    this.state.loop = loop;
  }

  markPoseDirty(): void {
    this.stagePoseDirty = true;
  }

  getDebugStage(stageId: HandwashingStageId = this.state.stageId): DebugStageOverride {
    if (!this.debugStages[stageId]) this.debugStages[stageId] = createDebugStageOverride();
    return this.debugStages[stageId]!;
  }

  resetDebugStage(): void {
    this.debugStages[this.state.stageId] = createDebugStageOverride();
    this.stagePoseDirty = true;
    this.update(0);
  }

  setPlaybackRate(rate: number): void {
    this.debug.playbackRate = Number.isFinite(rate) ? THREE.MathUtils.clamp(rate, 0.05, 2) : 1;
  }

  /** Scrubbing pauses and applies the exact pose/effects, without damping lag. */
  seek(progress: number): void {
    if (!Number.isFinite(progress)) return;
    this.isInitialResetState = false;
    this.sequenceCompletedNotified = false;
    this.state.isPlaying = false;
    this.state.stageProgress = THREE.MathUtils.clamp(progress, 0, 1);
    this.state.stageElapsed = this.state.stageProgress * this.state.stageDuration;
    this.stagePoseDirty = true;
    this.updateSequenceProgress();
    this.update(0);
  }

  setDebugMetrics(metrics: Partial<DebugMetrics>): void {
    this.debugMetrics = metrics;
  }

  getDebugSnapshot(): HandPoseDebugSnapshot {
    const captured = captureDebugRig(this.getRig(), this.debug);
    return {
      stageId: this.state.stageId,
      progress: this.state.stageProgress,
      elapsed: this.state.stageElapsed,
      rigAvailable: Boolean(this.getRig()),
      hands: captured.hands,
      selectedBone: captured.selectedBone,
      diagnostics: {
        ...captured.diagnostics, ...this.debugMetrics,
        finiteTransforms: captured.diagnostics.finiteTransforms,
        warnings: [...captured.diagnostics.warnings, ...(this.debugMetrics.warnings ?? [])],
      },
    };
  }

  exportDebugOverrides(): DebugOverridesExport {
    return {
      schemaVersion: 1,
      units: { handPosition: "world units", bonePosition: "bone local units", rotation: "degrees" },
      stages: JSON.parse(JSON.stringify(this.debugStages)),
    };
  }

  importDebugOverrides(value: unknown): { ok: boolean; error?: string } {
    try {
      const imported = validateDebugImport(value, this.stages.map((stage) => stage.id), this.getRig());
      for (const id of Object.keys(this.debugStages) as HandwashingStageId[]) delete this.debugStages[id];
      Object.assign(this.debugStages, imported.stages);
      this.stagePoseDirty = true;
      this.update(0);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Impor debug gagal." };
    }
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
      this.debug.enabled ? this.debugStages[this.state.stageId] : undefined,
    );

    this.state.isPlaying = autoPlay;
    this.callbacks.onReset?.();
  }

  restart(autoPlay = true): void {
    this.reset(autoPlay);
  }

  goToStage(stageIdOrIndex: HandwashingStageId | number, autoPlay?: boolean): void {
    if (typeof stageIdOrIndex === "number" && !Number.isFinite(stageIdOrIndex)) return;
    const nextIndex =
      typeof stageIdOrIndex === "number"
        ? THREE.MathUtils.clamp(Math.trunc(stageIdOrIndex), 0, this.stages.length - 1)
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
    if (nextStage.id !== "rubPalms") {
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
          // 0.65 -> 0.80: soap stays on the receiving palm on the way to the rubbing pose.
          this.state.soapBlobProgress = 0.65 + t * 0.15;
        }
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
      // Palms are already joined when this stage begins. Lather grows with
      // the first circles instead of waiting through another joining phase.
      stageFoamTarget = THREE.MathUtils.lerp(stage.foamStart, stage.foamEnd,
        THREE.MathUtils.smoothstep(progress, 0, .65));
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

    // The approach has its own delayed water ramp above. Do not overwrite it
    // with the stage's full emission before the hands reach the faucet.
    if (stage.id !== "moveHandsToFaucet") {
      this.state.particleMode = stage.particleMode;
      this.state.particleIntensity = stage.particleMode === "foam"
        ? stage.particleIntensity * Math.max(0.25, this.state.foamIntensity)
        : stage.particleIntensity;
    }
  }

  /**
   * Advances the timeline and updates skeletal hand & finger poses inside the single render loop.
   */
  update(delta: number): void {
    const safeDelta = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), 0.05) : 0;
    const playbackRate = this.debug.enabled && Number.isFinite(this.debug.playbackRate)
      ? THREE.MathUtils.clamp(this.debug.playbackRate, 0.05, 2) : 1;
    let completedThisFrame = false;

    if (this.state.isPlaying) {
      this.state.stageElapsed += safeDelta * playbackRate;
      let currentStage = this.getCurrentStage();
      while (this.state.stageElapsed + 1e-9 >= currentStage.duration) {
        // Carry the remainder into the next stage so timing does not depend on
        // whether a stage boundary happens to coincide with a rendered frame.
        const overflow = Math.max(0, this.state.stageElapsed - currentStage.duration);
        if (this.debug.enabled && this.debug.loopStage) {
          this.enterStage(this.state.stageIndex, currentStage, true);
        } else if (this.state.stageIndex < this.stages.length - 1) {
          this.enterStage(this.state.stageIndex + 1, currentStage, false);
        } else if (this.state.loop) {
          this.enterStage(0, currentStage, true);
        } else {
          this.state.stageElapsed = currentStage.duration;
          this.state.isPlaying = false;
          completedThisFrame = true;
          break;
        }
        this.state.stageElapsed = overflow;
        currentStage = this.getCurrentStage();
      }
      this.state.stageProgress = THREE.MathUtils.clamp(
        this.state.stageElapsed / Math.max(0.001, this.getCurrentStage().duration),
        0,
        1,
      );
      this.updateSequenceProgress();
      if (completedThisFrame && !this.sequenceCompletedNotified) {
        this.sequenceCompletedNotified = true;
        this.callbacks.onSequenceComplete?.();
      }
    } else if (!this.stagePoseDirty) {
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
      completedThisFrame || (this.stagePoseDirty && (!this.state.isPlaying || this.debug.enabled)) ? 0 : safeDelta,
      this.config.poseDampingLambda,
      this.config.boneDampingLambda,
      this.debug.enabled ? this.debugStages[activeStage.id] : undefined,
    );
    this.stagePoseDirty = false;
  }

  dispose(): void {
    this.state.isPlaying = false;
    this.stopDebugWatch();
    this.handAnimator.dispose();
  }
}
