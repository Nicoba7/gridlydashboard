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
  LibbiTransportError,
  type LibbiApiClient,
  type LibbiChargeMode,
  type LibbiCommandResult,
  type LibbiStatusPayload,
} from "./LibbiApiClient";

export type LibbiCapability = "read_soc" | "read_power" | "schedule_window";

export interface LibbiAdapterConfig {
  deviceId: string;
  hubSerial: string;
  apiKey: string;
  libbiSerial: string;
  client: LibbiApiClient;
}

export class LibbiAdapter extends BaseRealDeviceAdapter<
  LibbiCommandResult,
  LibbiStatusPayload,
  LibbiTransportError
> {
  readonly adapterId = "libbi-adapter.v1";

  readonly capabilities: LibbiCapability[] = ["read_soc", "read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly hubSerial: string;
  private readonly apiKey: string;
  private readonly libbiSerial: string;
  private readonly client: LibbiApiClient;

  constructor(config: LibbiAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.hubSerial = config.hubSerial;
    this.apiKey = config.apiKey;
    this.libbiSerial = config.libbiSerial;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  // myenergi's director URL can change over time. Always resolve it dynamically
  // via login() before issuing command/telemetry requests.
  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    await this.ensureLogin();
    const status = await this.client.getStatus(this.hubSerial, this.libbiSerial);
    return this.mapVendorTelemetryToCanonicalTelemetry(status);
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<LibbiCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new LibbiTransportError(
        "UNSUPPORTED_DEVICE",
        `Libbi adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    await this.ensureLogin();

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by Libbi adapter.`,
      };
    }

    const startAt = new Date(command.effectiveWindow.startAt).getTime();
    const endAt = new Date(command.effectiveWindow.endAt).getTime();

    this.scheduleModeSet(startAt, 1);
    this.scheduleModeSet(endAt, 4);

    return {
      success: true,
      message: `Scheduled Libbi charge mode at ${command.effectiveWindow.startAt} and stopped mode at ${command.effectiveWindow.endAt}.`,
    };
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: LibbiCommandResult,
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
      message: vendorResult.message ?? "Libbi command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(status: LibbiStatusPayload): CanonicalDeviceTelemetry[] {
    const chargingState = status.isCharging
      ? ("charging" as const)
      : status.chargeMode === 4
        ? ("idle" as const)
        : status.batterySocPercent >= 100
          ? ("idle" as const)
          : ("idle" as const);

    return [
      {
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        batterySocPercent: status.batterySocPercent,
        batteryPowerW: status.batteryPowerW,
        chargingState,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: LibbiTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Libbi error.", vendorCode: error.code };
  }

  private async ensureLogin(): Promise<void> {
    await this.client.login(this.hubSerial, this.apiKey);
  }

  private scheduleModeSet(targetMs: number, mode: LibbiChargeMode): void {
    const delayMs = Math.max(0, targetMs - Date.now());

    if (delayMs === 0) {
      void this.client.setChargeMode(this.hubSerial, this.libbiSerial, mode).catch((error) => {
        console.error("Libbi mode set failed", {
          libbiSerial: this.libbiSerial,
          mode,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    globalThis.setTimeout(() => {
      void this.client.setChargeMode(this.hubSerial, this.libbiSerial, mode).catch((error) => {
        console.error("Libbi mode set failed", {
          libbiSerial: this.libbiSerial,
          mode,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delayMs);
  }
}
