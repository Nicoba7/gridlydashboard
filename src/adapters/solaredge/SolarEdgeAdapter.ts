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
  SolarEdgeTransportError,
  type SolarEdgeApiClient,
  type SolarEdgeBatteryControlMode,
  type SolarEdgeBatteryControlResult,
  type SolarEdgeCurrentPowerFlow,
  type SolarEdgeSiteOverview,
} from "./SolarEdgeApiClient";

export type SolarEdgeCapability = "read_soc" | "read_power" | "schedule_window";

export interface SolarEdgeAdapterConfig {
  deviceId: string;
  siteId: string;
  apiKey: string;
  client: SolarEdgeApiClient;
}

export interface SolarEdgeTelemetryPayload {
  overview: SolarEdgeSiteOverview;
  powerFlow: SolarEdgeCurrentPowerFlow;
}

export class SolarEdgeAdapter extends BaseRealDeviceAdapter<
  SolarEdgeBatteryControlResult,
  SolarEdgeTelemetryPayload,
  SolarEdgeTransportError
> {
  readonly adapterId = "solaredge-adapter.v1";

  readonly capabilities: SolarEdgeCapability[] = ["read_soc", "read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly siteId: string;
  private readonly apiKey: string;
  private readonly client: SolarEdgeApiClient;

  constructor(config: SolarEdgeAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.siteId = config.siteId;
    this.apiKey = config.apiKey;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    this.assertCredentialsPresent();

    const [overview, powerFlow] = await Promise.all([
      this.client.getSiteOverview(this.siteId, this.apiKey),
      this.client.getCurrentPowerFlow(this.siteId, this.apiKey),
    ]);

    return this.mapVendorTelemetryToCanonicalTelemetry({ overview, powerFlow });
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<SolarEdgeBatteryControlResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new SolarEdgeTransportError(
        "UNSUPPORTED_DEVICE",
        `SolarEdge adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    this.assertCredentialsPresent();

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by SolarEdge adapter.`,
      };
    }

    const startAt = new Date(command.effectiveWindow.startAt).getTime();
    this.scheduleBatteryMode(startAt, "time_of_use");

    return {
      success: true,
      message: `Scheduled SolarEdge mode time_of_use at ${command.effectiveWindow.startAt}.`,
    };
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: SolarEdgeBatteryControlResult,
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
      message: vendorResult.message ?? "SolarEdge command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(payload: SolarEdgeTelemetryPayload): CanonicalDeviceTelemetry[] {
    const storagePowerW = payload.powerFlow.storagePowerW;
    const chargingState = storagePowerW > 0
      ? ("charging" as const)
      : storagePowerW < 0
        ? ("discharging" as const)
        : ("idle" as const);

    return [
      {
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        batteryPowerW: storagePowerW,
        solarGenerationW: Math.max(0, payload.powerFlow.pvPowerW),
        chargingState,
        gridImportPowerW: payload.powerFlow.gridPowerW > 0 ? payload.powerFlow.gridPowerW : undefined,
        gridExportPowerW: payload.powerFlow.gridPowerW < 0 ? Math.abs(payload.powerFlow.gridPowerW) : undefined,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: SolarEdgeTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown SolarEdge error.", vendorCode: error.code };
  }

  private assertCredentialsPresent(): void {
    if (!this.siteId.trim() || !this.apiKey.trim()) {
      throw new SolarEdgeTransportError(
        "AUTH_FAILURE",
        "SolarEdge site ID or API key is missing.",
        undefined,
        false,
      );
    }
  }

  private scheduleBatteryMode(targetMs: number, mode: SolarEdgeBatteryControlMode): void {
    const delayMs = Math.max(0, targetMs - Date.now());

    const runModeSet = () => {
      void this.client.setBatteryControl(this.siteId, this.apiKey, mode).catch((error) => {
        console.error("SolarEdge battery control failed", {
          siteId: this.siteId,
          mode,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    if (delayMs === 0) {
      runModeSet();
      return;
    }

    globalThis.setTimeout(runModeSet, delayMs);
  }
}
