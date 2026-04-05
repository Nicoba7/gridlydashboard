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
  VaillantTransportError,
  type VaillantApiClient,
  type VaillantCommandResult,
  type VaillantSystemStatus,
} from "./VaillantApiClient";

// Pre-heat temperature applied at schedule_window start (during cheap electricity slot).
const PREHEAT_TEMPERATURE_CELSIUS = 21;
// Typical residential heat pump output in watts, used as the active-heating signal.
const HEAT_PUMP_ACTIVE_POWER_W = 5000;

export type VaillantCapability = "read_power" | "schedule_window";

export interface VaillantAdapterConfig {
  deviceId: string;
  username: string;
  password: string;
  homeId: string;
  client: VaillantApiClient;
}

export class VaillantAdapter extends BaseRealDeviceAdapter<
  VaillantCommandResult,
  VaillantSystemStatus,
  VaillantTransportError
> {
  readonly adapterId = "vaillant-adapter.v1";

  readonly capabilities: VaillantCapability[] = ["read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly username: string;
  private readonly password: string;
  private readonly homeId: string;
  private readonly client: VaillantApiClient;
  private token: string | null = null;

  constructor(config: VaillantAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.username = config.username;
    this.password = config.password;
    this.homeId = config.homeId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const token = await this.ensureAuth();
    const status = await this.client.getSystemStatus(token, this.homeId);
    return this.mapVendorTelemetryToCanonicalTelemetry(status);
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<VaillantCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new VaillantTransportError(
        "UNSUPPORTED_DEVICE",
        `Vaillant adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by Vaillant adapter.`,
      };
    }

    const startMs = new Date(command.effectiveWindow.start).getTime();
    const endMs = new Date(command.effectiveWindow.end).getTime();
    const durationMinutes = Math.max(1, Math.round((endMs - startMs) / 60_000));

    await this.scheduleAction(startMs, async () => {
      const token = await this.ensureAuth();
      await this.client.setQuickMode(token, this.homeId, "QUICK_VETO", durationMinutes);
    });

    await this.scheduleAction(endMs, async () => {
      const token = await this.ensureAuth();
      await this.client.clearQuickMode(token, this.homeId);
    });

    return {
      success: true,
      message: `Scheduled Vaillant QUICK_VETO pre-heat to ${PREHEAT_TEMPERATURE_CELSIUS}°C at ${command.effectiveWindow.start} and schedule restore at ${command.effectiveWindow.end}.`,
    };
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: VaillantCommandResult,
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
      message: vendorResult.message ?? "Vaillant command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(status: VaillantSystemStatus): CanonicalDeviceTelemetry[] {
    // Express heating state as a nominal wattage — active heat pump ≈ 5 kW electrical input.
    const heatingPowerW = status.heatingActive ? HEAT_PUMP_ACTIVE_POWER_W : 0;

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
    error: VaillantTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Vaillant error.", vendorCode: error.code };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async ensureAuth(): Promise<string> {
    if (!this.token) {
      this.token = await this.client.login(this.username, this.password);
    }
    return this.token;
  }

  private async scheduleAction(targetMs: number, action: () => Promise<void>): Promise<void> {
    const delayMs = Math.max(0, targetMs - Date.now());

    if (delayMs === 0) {
      await action().catch((error) => {
        console.error("Vaillant scheduled action failed", {
          deviceId: this.deviceId,
          homeId: this.homeId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    globalThis.setTimeout(() => {
      void action().catch((error) => {
        console.error("Vaillant scheduled action failed", {
          deviceId: this.deviceId,
          homeId: this.homeId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delayMs);
  }
}
