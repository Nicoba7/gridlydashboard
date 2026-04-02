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
  FoxESSTransportError,
  type FoxESSApiClient,
  type FoxESSCommandResult,
  type FoxESSRealTimeData,
} from "./FoxESSApiClient";

export type FoxESSCapability = "read_soc" | "read_power" | "schedule_window" | "divert_solar";

export interface FoxESSAdapterConfig {
  deviceId: string;
  apiKey: string;
  deviceSN?: string;
  client: FoxESSApiClient;
}

export class FoxESSAdapter extends BaseRealDeviceAdapter<
  FoxESSCommandResult,
  FoxESSRealTimeData,
  FoxESSTransportError
> {
  readonly adapterId = "foxess-adapter.v1";

  readonly capabilities: FoxESSCapability[] = ["read_soc", "read_power", "schedule_window", "divert_solar"];

  private readonly deviceId: string;
  private readonly apiKey: string;
  private readonly configuredDeviceSN?: string;
  private readonly client: FoxESSApiClient;

  constructor(config: FoxESSAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.apiKey = config.apiKey;
    this.configuredDeviceSN = config.deviceSN;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    this.assertCredentialsPresent();
    const deviceSN = await this.resolveDeviceSN();
    const data = await this.client.getRealTimeData(this.apiKey, deviceSN);
    return this.mapVendorTelemetryToCanonicalTelemetry(data);
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<FoxESSCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new FoxESSTransportError(
        "UNSUPPORTED_DEVICE",
        `FoxESS adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    this.assertCredentialsPresent();

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by FoxESS adapter.`,
      };
    }

    const deviceSN = await this.resolveDeviceSN();
    return this.client.setChargeTimes(this.apiKey, deviceSN, {
      startAt: command.effectiveWindow.startAt,
      endAt: command.effectiveWindow.endAt,
    });
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: FoxESSCommandResult,
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
      message: vendorResult.message ?? "FoxESS command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(data: FoxESSRealTimeData): CanonicalDeviceTelemetry[] {
    const batteryPowerW = data.batteryPowerW;
    const chargingState = batteryPowerW === undefined
      ? ("unknown" as const)
      : batteryPowerW > 0
        ? ("charging" as const)
        : batteryPowerW < 0
          ? ("discharging" as const)
          : ("idle" as const);

    return [
      {
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        batterySocPercent: data.batterySocPercent,
        batteryPowerW,
        solarGenerationW: Math.max(0, data.solarPowerW),
        chargingState,
        gridImportPowerW: data.gridPowerW > 0 ? data.gridPowerW : undefined,
        gridExportPowerW: data.gridPowerW < 0 ? Math.abs(data.gridPowerW) : undefined,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: FoxESSTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown FoxESS error.", vendorCode: error.code };
  }

  private assertCredentialsPresent(): void {
    if (!this.apiKey.trim()) {
      throw new FoxESSTransportError(
        "AUTH_FAILURE",
        "FoxESS API key is missing.",
        undefined,
        false,
      );
    }
  }

  private async resolveDeviceSN(): Promise<string> {
    if (this.configuredDeviceSN?.trim()) {
      return this.configuredDeviceSN;
    }

    const devices = await this.client.getDeviceList(this.apiKey);
    const first = devices[0]?.deviceSN?.trim();

    if (!first) {
      throw new FoxESSTransportError(
        "UNSUPPORTED_DEVICE",
        "No FoxESS deviceSN available for this account.",
        404,
        false,
      );
    }

    return first;
  }
}
