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
  SolisTransportError,
  type SolisApiClient,
  type SolisCommandResult,
  type SolisInverterDetail,
} from "./SolisApiClient";

export type SolisCapability = "read_soc" | "read_power" | "schedule_window";

export interface SolisAdapterConfig {
  deviceId: string;
  keyId: string;
  keySecret: string;
  inverterId: string;
  client: SolisApiClient;
}

export class SolisAdapter extends BaseRealDeviceAdapter<
  SolisCommandResult,
  SolisInverterDetail,
  SolisTransportError
> {
  readonly adapterId = "solis-adapter.v1";

  readonly capabilities: SolisCapability[] = ["read_soc", "read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly inverterId: string;
  private readonly client: SolisApiClient;

  constructor(config: SolisAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.keyId = config.keyId;
    this.keySecret = config.keySecret;
    this.inverterId = config.inverterId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    this.assertCredentialsPresent();
    const detail = await this.client.getInverterDetail(this.keyId, this.keySecret, this.inverterId);
    return this.mapVendorTelemetryToCanonicalTelemetry(detail);
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<SolisCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new SolisTransportError(
        "UNSUPPORTED_DEVICE",
        `Solis adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    this.assertCredentialsPresent();

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by Solis adapter.`,
      };
    }

    return this.client.setChargeDischargeTimes(
      this.keyId,
      this.keySecret,
      this.inverterId,
      command.effectiveWindow.startAt,
      command.effectiveWindow.endAt,
      "charge",
    );
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: SolisCommandResult,
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
      message: vendorResult.message ?? "Solis command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(detail: SolisInverterDetail): CanonicalDeviceTelemetry[] {
    const batteryPowerW = detail.batteryPowerW;
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
        batterySocPercent: detail.batterySocPercent,
        batteryPowerW,
        solarGenerationW: Math.max(0, detail.currentPowerW),
        chargingState,
        gridImportPowerW: detail.gridPowerW > 0 ? detail.gridPowerW : undefined,
        gridExportPowerW: detail.gridPowerW < 0 ? Math.abs(detail.gridPowerW) : undefined,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: SolisTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Solis error.", vendorCode: error.code };
  }

  private assertCredentialsPresent(): void {
    if (!this.keyId.trim() || !this.keySecret.trim() || !this.inverterId.trim()) {
      throw new SolisTransportError(
        "AUTH_FAILURE",
        "Solis credentials or inverter ID are missing.",
        undefined,
        false,
      );
    }
  }
}
