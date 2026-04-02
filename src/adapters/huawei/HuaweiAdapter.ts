import type { CanonicalDeviceCommand } from "../../application/controlLoopExecution/canonicalCommand";
import type { CanonicalDeviceTelemetry } from "../../domain/telemetry";
import type { DeviceAdapterExecutionContext } from "../deviceAdapter";
import {
  BaseRealDeviceAdapter,
  type AdapterOperation,
  type CanonicalAdapterCommandResult,
  type CanonicalAdapterError,
} from "../realDeviceAdapterContract";
import {
  HuaweiTransportError,
  type HuaweiApiClient,
  type HuaweiCommandResult,
  type HuaweiDeviceRealKpi,
  type HuaweiStationRealKpi,
} from "./HuaweiApiClient";

export type HuaweiCapability = "read_soc" | "read_power" | "schedule_window" | "divert_solar";

export interface HuaweiAdapterConfig {
  deviceId: string;
  userName: string;
  systemCode: string;
  stationCode?: string;
  batteryDevTypeId?: number;
  batterySns?: string[];
  client: HuaweiApiClient;
}

export interface HuaweiTelemetryPayload {
  stationKpi: HuaweiStationRealKpi;
  deviceKpi: HuaweiDeviceRealKpi;
}

export class HuaweiAdapter extends BaseRealDeviceAdapter<
  HuaweiCommandResult,
  HuaweiTelemetryPayload,
  HuaweiTransportError
> {
  readonly adapterId = "huawei-adapter.v1";

  readonly capabilities: HuaweiCapability[] = ["read_soc", "read_power", "schedule_window", "divert_solar"];

  private readonly deviceId: string;
  private readonly userName: string;
  private readonly systemCode: string;
  private readonly stationCode?: string;
  private readonly batteryDevTypeId: number;
  private readonly batterySns: string[];
  private readonly client: HuaweiApiClient;

  constructor(config: HuaweiAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.userName = config.userName;
    this.systemCode = config.systemCode;
    this.stationCode = config.stationCode;
    this.batteryDevTypeId = config.batteryDevTypeId ?? 39;
    this.batterySns = config.batterySns ?? [];
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    this.assertCredentialsPresent();

    const token = await this.client.login(this.userName, this.systemCode);
    const stationCode = await this.resolveStationCode(token);

    const [stationKpi, deviceKpi] = await Promise.all([
      this.client.getStationRealKpi(token, stationCode),
      this.client.getDeviceRealKpi(token, this.batteryDevTypeId, this.batterySns),
    ]);

    return this.mapVendorTelemetryToCanonicalTelemetry({ stationKpi, deviceKpi });
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<HuaweiCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new HuaweiTransportError(
        "UNSUPPORTED_DEVICE",
        `Huawei adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    this.assertCredentialsPresent();

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by Huawei adapter.`,
      };
    }

    console.warn(
      "Huawei FusionSolar schedule_window requested, but API write controls are limited; no direct schedule was applied.",
      {
        targetDeviceId: command.targetDeviceId,
        startAt: command.effectiveWindow.startAt,
        endAt: command.effectiveWindow.endAt,
      },
    );

    return {
      success: true,
      message:
        "Huawei FusionSolar API has limited write capability. Recommendation: use FusionSolar TOU settings while Aveum continues read-only optimisation guidance.",
    };
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: HuaweiCommandResult,
    _context?: DeviceAdapterExecutionContext,
  ): CanonicalAdapterCommandResult {
    if (vendorResult.success) {
      return {
        targetDeviceId: command.targetDeviceId,
        status: "accepted",
        canonicalCommand: command,
        message: vendorResult.message,
      };
    }

    return {
      targetDeviceId: command.targetDeviceId,
      status: "rejected",
      canonicalCommand: command,
      failureReasonCode: "COMMAND_REJECTED",
      message: vendorResult.message ?? "Huawei command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(payload: HuaweiTelemetryPayload): CanonicalDeviceTelemetry[] {
    const batteryPowerW = payload.deviceKpi.batteryPowerW;
    const chargingState = batteryPowerW > 0
      ? ("charging" as const)
      : batteryPowerW < 0
        ? ("discharging" as const)
        : ("idle" as const);

    return [
      {
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        batterySocPercent: payload.deviceKpi.batterySocPercent,
        batteryPowerW,
        solarGenerationW: Math.max(0, payload.stationKpi.currentPowerW),
        chargingState,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: HuaweiTransportError,
    operation: AdapterOperation,
  ): CanonicalAdapterError {
    if (error.code === "UNSUPPORTED_DEVICE") {
      return { code: "UNSUPPORTED_DEVICE", operation, retryable: false, message: error.message, vendorCode: error.code };
    }
    if (error.code === "AUTH_FAILURE") {
      return { code: "UNAUTHORIZED", operation, retryable: false, message: error.message, vendorCode: error.code };
    }
    if (error.code === "RATE_LIMIT") {
      return { code: "RATE_LIMITED", operation, retryable: true, message: error.message, vendorCode: error.code };
    }
    if (error.code === "TIMEOUT") {
      return { code: "TIMEOUT", operation, retryable: true, message: error.message, vendorCode: error.code };
    }
    if (error.code === "TEMPORARY_UNAVAILABLE") {
      return { code: "UNAVAILABLE", operation, retryable: true, message: error.message, vendorCode: error.code };
    }
    if (error.code === "MALFORMED_RESPONSE") {
      return { code: "INVALID_VENDOR_RESPONSE", operation, retryable: false, message: error.message, vendorCode: error.code };
    }
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Huawei error.", vendorCode: error.code };
  }

  private assertCredentialsPresent(): void {
    if (!this.userName.trim() || !this.systemCode.trim()) {
      throw new HuaweiTransportError(
        "AUTH_FAILURE",
        "Huawei FusionSolar credentials are missing.",
        undefined,
        false,
      );
    }
  }

  private async resolveStationCode(token: string): Promise<string> {
    if (this.stationCode?.trim()) {
      return this.stationCode;
    }

    const stations = await this.client.getStationList(token);
    const first = stations[0]?.stationCode?.trim();

    if (!first) {
      throw new HuaweiTransportError(
        "UNSUPPORTED_DEVICE",
        "No FusionSolar stationCode available for this account.",
        404,
        false,
      );
    }

    return first;
  }
}
