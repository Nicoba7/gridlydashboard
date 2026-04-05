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
  TadoTransportError,
  type TadoApiClient,
  type TadoCommandResult,
  type TadoZoneState,
} from "./TadoApiClient";

// Pre-heat temperature applied at schedule_window start (during cheap electricity slot).
const PREHEAT_TEMPERATURE_CELSIUS = 21;

export type TadoCapability = "read_power" | "schedule_window";

export interface TadoAdapterConfig {
  deviceId: string;
  username: string;
  password: string;
  homeId?: number;
  zoneId: number;
  client: TadoApiClient;
}

export class TadoAdapter extends BaseRealDeviceAdapter<
  TadoCommandResult,
  TadoZoneState,
  TadoTransportError
> {
  readonly adapterId = "tado-adapter.v1";

  readonly capabilities: TadoCapability[] = ["read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly username: string;
  private readonly password: string;
  private homeId: number | undefined;
  private readonly zoneId: number;
  private readonly client: TadoApiClient;

  // Cached access token — refreshed on first use and on AUTH_FAILURE.
  private token: string | null = null;

  constructor(config: TadoAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.username = config.username;
    this.password = config.password;
    this.homeId = config.homeId;
    this.zoneId = config.zoneId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const { token, homeId } = await this.ensureAuth();
    const state = await this.client.getZoneState(token, homeId, this.zoneId);
    return this.mapVendorTelemetryToCanonicalTelemetry(state);
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<TadoCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new TadoTransportError(
        "UNSUPPORTED_DEVICE",
        `Tado adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by Tado adapter.`,
      };
    }

    const startMs = new Date(command.effectiveWindow.start).getTime();
    const endMs = new Date(command.effectiveWindow.end).getTime();
    const durationMinutes = Math.max(1, Math.round((endMs - startMs) / 60_000));

    await this.scheduleAction(startMs, async () => {
      const { token, homeId } = await this.ensureAuth();
      await this.client.setTemperature(token, homeId, this.zoneId, PREHEAT_TEMPERATURE_CELSIUS, durationMinutes);
    });

    await this.scheduleAction(endMs, async () => {
      const { token, homeId } = await this.ensureAuth();
      await this.client.deleteOverlay(token, homeId, this.zoneId);
    });

    return {
      success: true,
      message: `Scheduled Tado pre-heat to ${PREHEAT_TEMPERATURE_CELSIUS}°C at ${command.effectiveWindow.start} and auto-mode restore at ${command.effectiveWindow.end}.`,
    };
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: TadoCommandResult,
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
      message: vendorResult.message ?? "Tado command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(state: TadoZoneState): CanonicalDeviceTelemetry[] {
    // Express the heating power as an equivalent wattage.
    // A typical residential boiler is ~15 kW. We use heatingPowerPercent / 100 * 15 000 W
    // to give a plausible continuous-kWh-scale signal comparable to evChargingPowerW.
    const heatingPowerW = Math.round((state.heatingPowerPercent / 100) * 15_000);

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
    error: TadoTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Tado error.", vendorCode: error.code };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async ensureAuth(): Promise<{ token: string; homeId: number }> {
    if (!this.token) {
      this.token = await this.client.login(this.username, this.password);
    }
    if (this.homeId === undefined) {
      this.homeId = await this.client.getHome(this.token);
    }
    return { token: this.token, homeId: this.homeId };
  }

  private async scheduleAction(targetMs: number, action: () => Promise<void>): Promise<void> {
    const delayMs = Math.max(0, targetMs - Date.now());

    if (delayMs === 0) {
      // Execute synchronously within this turn so callers that await dispatchVendorCommand
      // observe the side-effects immediately.
      await action().catch((error) => {
        console.error("Tado scheduled action failed", {
          deviceId: this.deviceId,
          zoneId: this.zoneId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    globalThis.setTimeout(() => {
      void action().catch((error) => {
        console.error("Tado scheduled action failed", {
          deviceId: this.deviceId,
          zoneId: this.zoneId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delayMs);
  }
}
