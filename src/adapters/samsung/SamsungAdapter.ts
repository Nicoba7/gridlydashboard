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
  SamsungTransportError,
  type SamsungApiClient,
  type SamsungCommandResult,
  type SamsungDeviceStatus,
} from "./SamsungApiClient";

const PREHEAT_TEMPERATURE_CELSIUS = 21;

export type SamsungCapability = "read_power" | "schedule_window";

export interface SamsungAdapterConfig {
  deviceId: string;
  /** SmartThings Personal Access Token (PAT) — used as a Bearer token directly. */
  smartthingsToken: string;
  /** SmartThings device ID for the EHS heat pump. */
  smartthingsDeviceId: string;
  client: SamsungApiClient;
}

export class SamsungAdapter extends BaseRealDeviceAdapter<
  SamsungCommandResult,
  SamsungDeviceStatus,
  SamsungTransportError
> {
  readonly adapterId = "samsung-smartthings-adapter.v1";

  readonly capabilities: SamsungCapability[] = ["read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly smartthingsToken: string;
  private readonly smartthingsDeviceId: string;
  private readonly client: SamsungApiClient;

  constructor(config: SamsungAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.smartthingsToken = config.smartthingsToken;
    this.smartthingsDeviceId = config.smartthingsDeviceId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const status = await this.client.getDeviceStatus(this.smartthingsToken, this.smartthingsDeviceId);
    return this.mapVendorTelemetryToCanonicalTelemetry(status);
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<SamsungCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new SamsungTransportError(
        "UNSUPPORTED_DEVICE",
        `Samsung adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by Samsung adapter.`,
      };
    }

    const startMs = new Date(command.effectiveWindow.start).getTime();
    const endMs = new Date(command.effectiveWindow.end).getTime();

    // Capture the current setpoint before overriding so it can be restored at window end.
    const currentStatus = await this.client.getDeviceStatus(this.smartthingsToken, this.smartthingsDeviceId);
    const prevSetpoint = currentStatus.heatingSetpointCelsius;

    await this.scheduleAction(startMs, async () => {
      await this.client.setHeatingSetpoint(this.smartthingsToken, this.smartthingsDeviceId, PREHEAT_TEMPERATURE_CELSIUS);
    });

    await this.scheduleAction(endMs, async () => {
      await this.client.setHeatingSetpoint(this.smartthingsToken, this.smartthingsDeviceId, prevSetpoint);
    });

    return {
      success: true,
      message: `Scheduled Samsung EHS pre-heat to ${PREHEAT_TEMPERATURE_CELSIUS}°C at ${command.effectiveWindow.start} and setpoint restore to ${prevSetpoint}°C at ${command.effectiveWindow.end}.`,
    };
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: SamsungCommandResult,
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
      message: vendorResult.message ?? "Samsung command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(status: SamsungDeviceStatus): CanonicalDeviceTelemetry[] {
    // Express heating state as a nominal wattage — heat mode ≈ 5 kW electrical input.
    const heatingPowerW = status.thermostatMode === "heat" ? 5000 : 0;

    return [
      {
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        evChargingPowerW: heatingPowerW,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: SamsungTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Samsung error.", vendorCode: error.code };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async scheduleAction(targetMs: number, action: () => Promise<void>): Promise<void> {
    const delayMs = Math.max(0, targetMs - Date.now());

    if (delayMs === 0) {
      await action().catch((error) => {
        console.error("Samsung scheduled action failed", {
          deviceId: this.deviceId,
          smartthingsDeviceId: this.smartthingsDeviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    globalThis.setTimeout(() => {
      void action().catch((error) => {
        console.error("Samsung scheduled action failed", {
          deviceId: this.deviceId,
          smartthingsDeviceId: this.smartthingsDeviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delayMs);
  }
}
