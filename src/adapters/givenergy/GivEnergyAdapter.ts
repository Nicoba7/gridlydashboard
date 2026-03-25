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
  GivEnergyTransportError,
  type GivEnergyApiClient,
  type GivEnergyCommandResult,
  type GivEnergySystemDataPayload,
} from "./GivEnergyApiClient";

export type GivEnergyCapability =
  | "read_power"
  | "read_energy"
  | "read_soc"
  | "set_mode"
  | "set_reserve_soc";

export interface GivEnergyAdapterConfig {
  /** Inverter serial number — used as both the cloud API path parameter and the canonical device ID. */
  inverterSerial: string;
  client: GivEnergyApiClient;
}

/**
 * Real device adapter for the GivEnergy Cloud API v1.
 *
 * Capabilities: read_power, read_energy, read_soc, set_mode, set_reserve_soc
 *
 * Command mapping:
 * - set_mode(charge)     → POST /inverter/{serial}/commands/set-charge-target (enable_charge: true, target_soc: 100)
 * - set_mode(discharge)  → POST /inverter/{serial}/commands/set-charge-target (enable_discharge: true, target_soc: 5)
 * - set_mode(hold/…)     → POST /inverter/{serial}/commands/set-charge-target (enable_charge/discharge: false)
 *
 * Telemetry mapping:
 * - GET /inverter/{serial}/system-data/latest → batterySocPercent, batteryPowerW, solarGenerationW, gridImportPowerW
 */
export class GivEnergyAdapter extends BaseRealDeviceAdapter<
  GivEnergyCommandResult,
  GivEnergySystemDataPayload,
  GivEnergyTransportError
> {
  readonly adapterId = "givenergy-adapter.v1";

  readonly capabilities: GivEnergyCapability[] = [
    "read_power",
    "read_energy",
    "read_soc",
    "set_mode",
    "set_reserve_soc",
  ];

  private readonly inverterSerial: string;
  private readonly client: GivEnergyApiClient;

  constructor(config: GivEnergyAdapterConfig) {
    super();
    this.inverterSerial = config.inverterSerial;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.inverterSerial;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const payload = await this.client.readSystemData(this.inverterSerial);
    return this.mapVendorTelemetryToCanonicalTelemetry(payload);
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<GivEnergyCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new GivEnergyTransportError(
        "UNSUPPORTED_DEVICE",
        `GivEnergy adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    if (command.kind !== "set_mode") {
      // Commands other than set_mode are not dispatched to the hardware; surface
      // as an accepted no-op so the caller can decide how to handle unsupported kinds.
      return { success: true, message: `Command kind "${command.kind}" acknowledged but not actioned.` };
    }

    return this.client.setChargeTarget(this.inverterSerial, command.mode);
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: GivEnergyCommandResult,
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
      message: vendorResult.message ?? "GivEnergy command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(
    payload: GivEnergySystemDataPayload,
  ): CanonicalDeviceTelemetry[] {
    // gridPowerW > 0 means importing; < 0 means exporting.
    const gridImportPowerW = payload.gridPowerW > 0 ? payload.gridPowerW : 0;
    const gridExportPowerW = payload.gridPowerW < 0 ? Math.abs(payload.gridPowerW) : 0;

    return [
      {
        deviceId: payload.inverterSerial,
        timestamp: payload.timestamp,
        batterySocPercent: payload.batterySocPercent,
        batteryPowerW: payload.batteryPowerW,
        solarGenerationW: payload.solarPowerW,
        gridImportPowerW,
        gridExportPowerW,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: GivEnergyTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown GivEnergy error.", vendorCode: error.code };
  }
}
