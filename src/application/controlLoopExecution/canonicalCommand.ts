import type { DeviceCommand, DeviceMode, TimeWindow } from "../../domain";

export type CanonicalDeviceCommandKind =
  | "start_charging"
  | "stop_charging"
  | "set_mode"
  | "set_power_limit"
  | "set_target_soc"
  | "set_reserve_soc"
  | "schedule_window"
  | "refresh_state";

interface CanonicalDeviceCommandBase {
  kind: CanonicalDeviceCommandKind;
  targetDeviceId: string;
  effectiveWindow?: TimeWindow;
}

export interface CanonicalStartChargingCommand extends CanonicalDeviceCommandBase {
  kind: "start_charging";
}

export interface CanonicalStopChargingCommand extends CanonicalDeviceCommandBase {
  kind: "stop_charging";
}

export interface CanonicalSetModeCommand extends CanonicalDeviceCommandBase {
  kind: "set_mode";
  mode: DeviceMode;
}

export interface CanonicalSetPowerLimitCommand extends CanonicalDeviceCommandBase {
  kind: "set_power_limit";
  powerW: number;
}

export interface CanonicalSetTargetSocCommand extends CanonicalDeviceCommandBase {
  kind: "set_target_soc";
  targetSocPercent: number;
}

export interface CanonicalSetReserveSocCommand extends CanonicalDeviceCommandBase {
  kind: "set_reserve_soc";
  reserveSocPercent: number;
}

export interface CanonicalScheduleWindowCommand extends CanonicalDeviceCommandBase {
  kind: "schedule_window";
  effectiveWindow: TimeWindow;
  targetMode?: DeviceMode;
}

export interface CanonicalRefreshStateCommand extends CanonicalDeviceCommandBase {
  kind: "refresh_state";
}

/**
 * Stable Aveum-native command language for future device adapters.
 * See docs/architecture/execution-architecture.md for boundary rules.
 */
export type CanonicalDeviceCommand =
  | CanonicalStartChargingCommand
  | CanonicalStopChargingCommand
  | CanonicalSetModeCommand
  | CanonicalSetPowerLimitCommand
  | CanonicalSetTargetSocCommand
  | CanonicalSetReserveSocCommand
  | CanonicalScheduleWindowCommand
  | CanonicalRefreshStateCommand;

/**
 * Normalize runtime device commands into the canonical execution command model.
 */
export function mapToCanonicalDeviceCommand(command: DeviceCommand): CanonicalDeviceCommand {
  const effectiveWindow = command.effectiveWindow ?? (command.type === "schedule_window" ? command.window : undefined);

  switch (command.type) {
    case "start_charging":
      return {
        kind: "start_charging",
        targetDeviceId: command.deviceId,
        effectiveWindow,
      };
    case "stop_charging":
      return {
        kind: "stop_charging",
        targetDeviceId: command.deviceId,
        effectiveWindow,
      };
    case "set_mode":
      return {
        kind: "set_mode",
        targetDeviceId: command.deviceId,
        effectiveWindow,
        mode: command.mode,
      };
    case "set_power_limit":
      return {
        kind: "set_power_limit",
        targetDeviceId: command.deviceId,
        effectiveWindow,
        powerW: command.powerW,
      };
    case "set_target_soc":
      return {
        kind: "set_target_soc",
        targetDeviceId: command.deviceId,
        effectiveWindow,
        targetSocPercent: command.targetSocPercent,
      };
    case "set_reserve_soc":
      return {
        kind: "set_reserve_soc",
        targetDeviceId: command.deviceId,
        effectiveWindow,
        reserveSocPercent: command.reserveSocPercent,
      };
    case "schedule_window":
      return {
        kind: "schedule_window",
        targetDeviceId: command.deviceId,
        effectiveWindow: command.window,
        targetMode: command.targetMode,
      };
    case "refresh_state":
      return {
        kind: "refresh_state",
        targetDeviceId: command.deviceId,
        effectiveWindow,
      };
  }
}
