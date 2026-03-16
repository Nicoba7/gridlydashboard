import type { TimeWindow } from "../../domain";
import type {
  CanonicalDeviceCommand,
  CanonicalDeviceCommandKind,
} from "../../application/controlLoopExecution/canonicalCommand";
import type {
  DeviceAdapter,
  DeviceAdapterExecutionContext,
  DeviceAdapterExecutionResult,
} from "../deviceAdapter";

export interface SimulatedDeviceState {
  deviceId: string;
  commandCount: number;
  lastCommand?: CanonicalDeviceCommand;
  lastCommandKind?: CanonicalDeviceCommandKind;
  lastMode?: string;
  lastPowerW?: number;
  lastTargetSocPercent?: number;
  lastReserveSocPercent?: number;
  lastWindow?: TimeWindow;
  lastExecutionRequestId?: string;
  lastIdempotencyKey?: string;
}

export interface SimulatedDeviceAdapterOptions {
  supportedDeviceIds: string[];
  supportedCommandKinds?: CanonicalDeviceCommandKind[];
}

const ALL_SUPPORTED_KINDS: CanonicalDeviceCommandKind[] = [
  "start_charging",
  "stop_charging",
  "set_mode",
  "set_power_limit",
  "set_target_soc",
  "set_reserve_soc",
  "schedule_window",
  "refresh_state",
];

/**
 * In-memory simulated adapter for development and tests without real hardware.
 */
export class SimulatedDeviceAdapter implements DeviceAdapter {
  private readonly supportedDeviceIds: Set<string>;
  private readonly supportedCommandKinds: Set<CanonicalDeviceCommandKind>;
  private readonly stateByDeviceId = new Map<string, SimulatedDeviceState>();
  private readonly idempotencyResults = new Map<string, DeviceAdapterExecutionResult>();

  constructor(options: SimulatedDeviceAdapterOptions) {
    this.supportedDeviceIds = new Set(options.supportedDeviceIds);
    this.supportedCommandKinds = new Set(options.supportedCommandKinds ?? ALL_SUPPORTED_KINDS);
  }

  canHandle(targetDeviceId: string): boolean {
    return this.supportedDeviceIds.has(targetDeviceId);
  }

  getDeviceState(deviceId: string): SimulatedDeviceState | undefined {
    const state = this.stateByDeviceId.get(deviceId);
    return state ? { ...state } : undefined;
  }

  getAllDeviceStates(): SimulatedDeviceState[] {
    return [...this.stateByDeviceId.values()].map((state) => ({ ...state }));
  }

  async executeCanonicalCommand(
    command: CanonicalDeviceCommand,
    context?: DeviceAdapterExecutionContext,
  ): Promise<DeviceAdapterExecutionResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      return {
        targetDeviceId: command.targetDeviceId,
        status: "rejected",
        canonicalCommand: command,
        failureReasonCode: "UNSUPPORTED_DEVICE",
        message: "Simulated adapter does not support this device.",
      };
    }

    if (!this.supportedCommandKinds.has(command.kind)) {
      return {
        targetDeviceId: command.targetDeviceId,
        status: "rejected",
        canonicalCommand: command,
        failureReasonCode: "INVALID_COMMAND",
        message: "Simulated adapter does not support this command kind.",
      };
    }

    const idempotencyKey = context?.idempotencyKey;
    if (idempotencyKey && this.idempotencyResults.has(idempotencyKey)) {
      return this.idempotencyResults.get(idempotencyKey)!;
    }

    const previousState = this.stateByDeviceId.get(command.targetDeviceId);
    const nextState: SimulatedDeviceState = {
      deviceId: command.targetDeviceId,
      commandCount: (previousState?.commandCount ?? 0) + 1,
      lastCommand: command,
      lastCommandKind: command.kind,
      lastMode: previousState?.lastMode,
      lastPowerW: previousState?.lastPowerW,
      lastTargetSocPercent: previousState?.lastTargetSocPercent,
      lastReserveSocPercent: previousState?.lastReserveSocPercent,
      lastWindow: command.effectiveWindow,
      lastExecutionRequestId: context?.executionRequestId,
      lastIdempotencyKey: idempotencyKey,
    };

    if (command.kind === "start_charging") {
      nextState.lastMode = "charge";
    } else if (command.kind === "stop_charging") {
      nextState.lastMode = "stop";
    } else if (command.kind === "set_mode") {
      nextState.lastMode = command.mode;
    } else if (command.kind === "set_power_limit") {
      nextState.lastPowerW = command.powerW;
    } else if (command.kind === "set_target_soc") {
      nextState.lastTargetSocPercent = command.targetSocPercent;
    } else if (command.kind === "set_reserve_soc") {
      nextState.lastReserveSocPercent = command.reserveSocPercent;
    } else if (command.kind === "schedule_window") {
      nextState.lastMode = command.targetMode;
    }

    this.stateByDeviceId.set(command.targetDeviceId, nextState);

    const result: DeviceAdapterExecutionResult = {
      targetDeviceId: command.targetDeviceId,
      status: "accepted",
      canonicalCommand: command,
      message: "SIMULATED_ACCEPTED",
    };

    if (idempotencyKey) {
      this.idempotencyResults.set(idempotencyKey, result);
    }

    return result;
  }
}
