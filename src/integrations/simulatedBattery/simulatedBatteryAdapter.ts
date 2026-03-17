import type { CanonicalDeviceCommand } from "../../application/controlLoopExecution/canonicalCommand";
import type {
  DeviceAdapterExecutionContext,
  DeviceAdapterExecutionResult,
  ObservableDeviceAdapter,
} from "../../adapters/deviceAdapter";
import type { TelemetryCoherenceStatus } from "../../application/controlLoopExecution/types";

export type SimulatedBatteryScenarioProfile =
  | "stable_device"
  | "slow_device"
  | "stale_telemetry_device"
  | "command_rejection_device"
  | "mixed_outcome_device"
  // Telemetry coherence drift scenarios
  | "delayed_ack_then_state_update"
  | "accepted_command_but_stale_soc"
  | "contradictory_power_vs_soc"
  | "telemetry_replay_old_snapshot"
  | "eventual_consistency_device";

export interface SimulatedBatteryAdapterOptions {
  deviceId: string;
  scenario: SimulatedBatteryScenarioProfile;
  initialSocPercent?: number;
  now?: () => Date;
  random?: () => number;
  commandRateLimitPerMinute?: number;
}

export interface SimulatedBatteryTelemetry {
  state_of_charge: number;
  charge_rate: number;
  discharge_rate: number;
  capturedAt: string;
  stale: boolean;
  /**
   * Quality assessment of this telemetry observation relative to the most recent
   * known execution outcome. Informational only — never drives runtime decisions.
   *
   * - coherent:      telemetry agrees with known execution outcome
   * - delayed:       telemetry has not yet reflected a recently accepted command
   * - contradictory: data is internally inconsistent (e.g. charge_rate > 0 but SOC static)
   * - stale:         capturedAt is too old to reflect current device state
   */
  coherenceStatus: TelemetryCoherenceStatus;
}

export interface SimulatedBatteryState {
  deviceId: string;
  scenario: SimulatedBatteryScenarioProfile;
  mode: "charge" | "discharge" | "idle";
  stateOfChargePercent: number;
  pendingCommandCount: number;
  commandCount: number;
}

export interface SimulatedBatteryCapabilities {
  telemetry: ["state_of_charge", "charge_rate", "discharge_rate"];
  commands: ["charge", "discharge", "idle"];
}

interface PendingCommand {
  applyAtMs: number;
  mode: "charge" | "discharge" | "idle";
}

const CAPABILITIES: SimulatedBatteryCapabilities = {
  telemetry: ["state_of_charge", "charge_rate", "discharge_rate"],
  commands: ["charge", "discharge", "idle"],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toSimMode(command: CanonicalDeviceCommand): "charge" | "discharge" | "idle" | undefined {
  if (command.kind === "set_mode") {
    if (command.mode === "charge") {
      return "charge";
    }

    if (command.mode === "discharge" || command.mode === "export") {
      return "discharge";
    }

    if (command.mode === "hold" || command.mode === "stop") {
      return "idle";
    }

    return undefined;
  }

  if (command.kind === "start_charging") {
    return "charge";
  }

  if (command.kind === "stop_charging") {
    return "idle";
  }

  return undefined;
}

export class SimulatedBatteryAdapter implements ObservableDeviceAdapter<
  SimulatedBatteryTelemetry,
  SimulatedBatteryState,
  SimulatedBatteryCapabilities
> {
  private mode: "charge" | "discharge" | "idle" = "idle";
  private stateOfChargePercent: number;
  private readonly pendingCommands: PendingCommand[] = [];
  private commandCount = 0;
  private readonly commandTimestampsMs: number[] = [];

  // Telemetry coherence drift tracking
  private telemetryLagPollsRemaining = 0;
  private preCommandMode: "charge" | "discharge" | "idle" = "idle";
  private frozenSocAtLastCommand?: number;
  private replaySnapshotPollsRemaining = 0;
  private replaySnapshotSoc = 0;
  private replaySnapshotCapturedAt = "";

  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly commandRateLimitPerMinute: number;

  constructor(private readonly options: SimulatedBatteryAdapterOptions) {
    this.stateOfChargePercent = clamp(options.initialSocPercent ?? 45, 0, 100);
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.commandRateLimitPerMinute = Math.max(1, options.commandRateLimitPerMinute ?? 8);
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.options.deviceId;
  }

  getCapabilities(): SimulatedBatteryCapabilities {
    return CAPABILITIES;
  }

  private applyPendingCommands(nowMs: number): void {
    while (this.pendingCommands.length > 0 && this.pendingCommands[0].applyAtMs <= nowMs) {
      const next = this.pendingCommands.shift();
      if (next) {
        this.mode = next.mode;
      }
    }
  }

  private enforceRateLimit(nowMs: number): boolean {
    const windowStart = nowMs - 60_000;
    while (this.commandTimestampsMs.length > 0 && this.commandTimestampsMs[0] < windowStart) {
      this.commandTimestampsMs.shift();
    }

    if (this.commandTimestampsMs.length >= this.commandRateLimitPerMinute) {
      return false;
    }

    this.commandTimestampsMs.push(nowMs);
    return true;
  }

  private isIntermittentFailure(): boolean {
    return this.options.scenario === "mixed_outcome_device" && this.random() < 0.12;
  }

  private updateSocForElapsed(nowMs: number): void {
    const delta = this.mode === "charge" ? 0.6 : this.mode === "discharge" ? -0.6 : 0;
    this.stateOfChargePercent = clamp(this.stateOfChargePercent + delta, 0, 100);
    this.applyPendingCommands(nowMs);
  }

  async getTelemetry(): Promise<SimulatedBatteryTelemetry> {
    const nowMs = this.now().getTime();

    if (this.isIntermittentFailure()) {
      throw new Error("Simulated intermittent telemetry API failure.");
    }

    this.updateSocForElapsed(nowMs);

    return this.buildTelemetry(nowMs);
  }

  private buildTelemetry(nowMs: number): SimulatedBatteryTelemetry {
    const { scenario } = this.options;

    // Legacy stale scenario: fixed 8-minute lag on capturedAt, mode/power accurate.
    if (scenario === "stale_telemetry_device") {
      return {
        state_of_charge: Number(this.stateOfChargePercent.toFixed(2)),
        charge_rate: this.mode === "charge" ? 3600 : 0,
        discharge_rate: this.mode === "discharge" ? 3400 : 0,
        capturedAt: new Date(nowMs - 8 * 60_000).toISOString(),
        stale: true,
        coherenceStatus: "stale",
      };
    }

    // delayed_ack_then_state_update / eventual_consistency_device:
    // Report pre-command mode/power for N polls after command acceptance.
    if (
      (scenario === "delayed_ack_then_state_update" || scenario === "eventual_consistency_device") &&
      this.telemetryLagPollsRemaining > 0
    ) {
      this.telemetryLagPollsRemaining -= 1;
      return {
        state_of_charge: Number(this.stateOfChargePercent.toFixed(2)),
        charge_rate: this.preCommandMode === "charge" ? 3600 : 0,
        discharge_rate: this.preCommandMode === "discharge" ? 3400 : 0,
        capturedAt: new Date(nowMs).toISOString(),
        stale: false,
        coherenceStatus: "delayed",
      };
    }

    // accepted_command_but_stale_soc:
    // Power metrics reflect the current mode immediately; SOC is frozen at
    // the pre-command value (simulates a stuck energy meter / SOC sensor).
    if (scenario === "accepted_command_but_stale_soc") {
      const frozenSoc = this.frozenSocAtLastCommand ?? this.stateOfChargePercent;
      const isActive = this.mode === "charge" || this.mode === "discharge";
      return {
        state_of_charge: Number(frozenSoc.toFixed(2)),
        charge_rate: this.mode === "charge" ? 3600 : 0,
        discharge_rate: this.mode === "discharge" ? 3400 : 0,
        capturedAt: new Date(nowMs).toISOString(),
        stale: false,
        // Contradictory when charging/discharging but SOC isn't moving.
        coherenceStatus: isActive ? "contradictory" : "coherent",
      };
    }

    // contradictory_power_vs_soc:
    // SOC increments normally (from updateSocForElapsed) but the power sensor
    // always reports 0. Simulates a faulty current/power meter.
    if (scenario === "contradictory_power_vs_soc") {
      const isActive = this.mode !== "idle";
      return {
        state_of_charge: Number(this.stateOfChargePercent.toFixed(2)),
        charge_rate: 0,
        discharge_rate: 0,
        capturedAt: new Date(nowMs).toISOString(),
        stale: false,
        // Contradictory when SOC changes but power sensor shows nothing.
        coherenceStatus: isActive ? "contradictory" : "coherent",
      };
    }

    // telemetry_replay_old_snapshot:
    // Return a frozen pre-command snapshot for N polls, then resume real state.
    if (scenario === "telemetry_replay_old_snapshot" && this.replaySnapshotPollsRemaining > 0) {
      this.replaySnapshotPollsRemaining -= 1;
      return {
        state_of_charge: Number(this.replaySnapshotSoc.toFixed(2)),
        charge_rate: 0,
        discharge_rate: 0,
        capturedAt: this.replaySnapshotCapturedAt,
        stale: true,
        coherenceStatus: "stale",
      };
    }

    // Default / post-convergence: coherent.
    return {
      state_of_charge: Number(this.stateOfChargePercent.toFixed(2)),
      charge_rate: this.mode === "charge" ? 3600 : 0,
      discharge_rate: this.mode === "discharge" ? 3400 : 0,
      capturedAt: new Date(nowMs).toISOString(),
      stale: false,
      coherenceStatus: "coherent",
    };
  }

  async getState(): Promise<SimulatedBatteryState> {
    const nowMs = this.now().getTime();
    this.updateSocForElapsed(nowMs);

    return {
      deviceId: this.options.deviceId,
      scenario: this.options.scenario,
      mode: this.mode,
      stateOfChargePercent: Number(this.stateOfChargePercent.toFixed(2)),
      pendingCommandCount: this.pendingCommands.length,
      commandCount: this.commandCount,
    };
  }

  async executeCanonicalCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<DeviceAdapterExecutionResult> {
    const nowMs = this.now().getTime();

    if (!this.canHandle(command.targetDeviceId)) {
      return {
        targetDeviceId: command.targetDeviceId,
        status: "rejected",
        canonicalCommand: command,
        failureReasonCode: "UNSUPPORTED_DEVICE",
        message: "Simulated battery adapter does not support this device.",
      };
    }

    const mode = toSimMode(command);
    if (!mode) {
      return {
        targetDeviceId: command.targetDeviceId,
        status: "rejected",
        canonicalCommand: command,
        failureReasonCode: "INVALID_COMMAND",
        message: "Simulated battery adapter only supports canonical battery mode commands.",
      };
    }

    if (!this.enforceRateLimit(nowMs)) {
      return {
        targetDeviceId: command.targetDeviceId,
        status: "rejected",
        canonicalCommand: command,
        failureReasonCode: "COMMAND_REJECTED",
        message: "Simulated rate limit exceeded.",
      };
    }

    this.commandCount += 1;

    if (this.options.scenario === "command_rejection_device") {
      return {
        targetDeviceId: command.targetDeviceId,
        status: "rejected",
        canonicalCommand: command,
        failureReasonCode: "COMMAND_REJECTED",
        message: "Simulated profile rejected command.",
      };
    }

    if (this.options.scenario === "mixed_outcome_device") {
      const draw = this.random();
      if (draw < 0.2) {
        return {
          targetDeviceId: command.targetDeviceId,
          status: "rejected",
          canonicalCommand: command,
          failureReasonCode: "COMMAND_REJECTED",
          message: "Simulated mixed profile rejection.",
        };
      }

      if (draw < 0.35) {
        return {
          targetDeviceId: command.targetDeviceId,
          status: "failed",
          canonicalCommand: command,
          failureReasonCode: "COMMAND_FAILED",
          message: "Simulated mixed profile command failure.",
        };
      }
    }

    if (this.options.scenario === "slow_device") {
      this.pendingCommands.push({
        applyAtMs: nowMs + 90_000,
        mode,
      });

      return {
        targetDeviceId: command.targetDeviceId,
        status: "accepted",
        canonicalCommand: command,
        message: "Simulated slow device accepted command with lag.",
      };
    }

    // Coherence drift scenarios: capture pre-command state before applying the new mode.
    const { scenario } = this.options;

    if (scenario === "delayed_ack_then_state_update") {
      this.preCommandMode = this.mode;
      this.telemetryLagPollsRemaining = 3;
    }

    if (scenario === "eventual_consistency_device") {
      this.preCommandMode = this.mode;
      this.telemetryLagPollsRemaining = 5;
    }

    if (scenario === "accepted_command_but_stale_soc") {
      // Freeze the SOC at its current value; power metrics will reflect the new mode.
      this.frozenSocAtLastCommand = this.stateOfChargePercent;
    }

    if (scenario === "telemetry_replay_old_snapshot") {
      // Freeze the complete pre-command snapshot for replay.
      this.replaySnapshotSoc = this.stateOfChargePercent;
      this.replaySnapshotCapturedAt = new Date(nowMs).toISOString();
      this.replaySnapshotPollsRemaining = 3;
    }

    this.mode = mode;
    return {
      targetDeviceId: command.targetDeviceId,
      status: "accepted",
      canonicalCommand: command,
      message: "Simulated command accepted.",
    };
  }
}
