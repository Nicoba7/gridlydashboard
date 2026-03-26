/**
 * OhmeAdapter — Real device adapter for the Ohme EV charger.
 *
 * ⚠️  Uses an unofficial API. See OhmeApiClient.ts for caveats.
 *
 * Capabilities: read_soc, read_power, schedule_window
 *
 * Command mapping:
 * - schedule_window → POST /v1/users/me/chargeDevices/{deviceId}/schedule
 *     { chargeSlots: [{ startTime, endTime }] }
 * - All other command kinds → accepted no-op (logged, not dispatched to hardware)
 *
 * Authentication:
 * - Credentials are held in config (OHME_EMAIL / OHME_PASSWORD from env).
 * - login() is called lazily before each API call; the resulting token is cached
 *   for the lifetime of the adapter instance to avoid unnecessary round-trips.
 *
 * Telemetry mapping:
 * - GET /v1/users/me/chargeDevices → batterySocPercent (EV SoC), evChargingPowerW,
 *   chargingState ("charging" | "idle" | "unknown"), evConnected
 */

import type { CanonicalDeviceCommand } from "../../application/controlLoopExecution/canonicalCommand";
import type { DeviceAdapterExecutionContext } from "../deviceAdapter";
import {
  BaseRealDeviceAdapter,
  type CanonicalAdapterCommandResult,
  type CanonicalAdapterError,
  type AdapterOperation,
} from "../realDeviceAdapterContract";
import type { CanonicalDeviceTelemetry } from "../../domain/telemetry";
import {
  OhmeTransportError,
  type OhmeApiClient,
  type OhmeChargeDevicePayload,
  type OhmeCommandResult,
} from "./OhmeApiClient";

export type OhmeCapability = "read_soc" | "read_power" | "schedule_window";

export interface OhmeAdapterConfig {
  /** Canonical device ID — matches the `id` field in Ohme's chargeDevices response. */
  deviceId: string;
  client: OhmeApiClient;
}

export class OhmeAdapter extends BaseRealDeviceAdapter<
  OhmeCommandResult,
  OhmeChargeDevicePayload,
  OhmeTransportError
> {
  readonly adapterId = "ohme-adapter.v1";

  readonly capabilities: OhmeCapability[] = ["read_soc", "read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly client: OhmeApiClient;
  /** Cached Bearer token — refreshed on AUTH_FAILURE. */
  private token: string | null = null;

  constructor(config: OhmeAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  // ── Telemetry ────────────────────────────────────────────────────────────────

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const token = await this.ensureToken();
    const devices = await this.client.getChargeDevices(token);
    const device = devices.find((d) => d.id === this.deviceId);

    if (!device) {
      throw new OhmeTransportError(
        "UNSUPPORTED_DEVICE",
        `Ohme device "${this.deviceId}" not found in chargeDevices response.`,
        undefined,
        false,
      );
    }

    return this.mapVendorTelemetryToCanonicalTelemetry(device);
  }

  // ── Command dispatch ─────────────────────────────────────────────────────────

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<OhmeCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new OhmeTransportError(
        "UNSUPPORTED_DEVICE",
        `Ohme adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    if (command.kind !== "schedule_window") {
      // Non-schedule commands are acknowledged but not dispatched to hardware.
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by Ohme adapter.`,
      };
    }

    const { effectiveWindow } = command;
    const startEpochSeconds = Math.floor(new Date(effectiveWindow.start).getTime() / 1000);
    const endEpochSeconds = Math.floor(new Date(effectiveWindow.end).getTime() / 1000);

    const token = await this.ensureToken();
    return this.client.postSchedule(token, this.deviceId, startEpochSeconds, endEpochSeconds);
  }

  // ── Mapping ──────────────────────────────────────────────────────────────────

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: OhmeCommandResult,
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
      message: vendorResult.message ?? "Ohme command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(
    device: OhmeChargeDevicePayload,
  ): CanonicalDeviceTelemetry[] {
    const modeUpper = device.mode?.toUpperCase() ?? "";
    const isCharging =
      modeUpper === "CHARGE" || modeUpper === "MAX_CHARGE" || modeUpper === "SMART_CHARGE";
    const chargingState = !device.carConnected
      ? ("idle" as const)
      : isCharging
        ? ("charging" as const)
        : ("idle" as const);

    return [
      {
        deviceId: device.id,
        timestamp: new Date().toISOString(),
        batterySocPercent: device.car?.carBatteryLevel ?? undefined,
        evChargingPowerW: device.power ?? undefined,
        chargingState,
        evConnected: device.carConnected,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: OhmeTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Ohme error.", vendorCode: error.code };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    const { token } = await this.client.login();
    this.token = token;
    return token;
  }
}
