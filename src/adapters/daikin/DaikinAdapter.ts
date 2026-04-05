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
  DaikinTransportError,
  type DaikinApiClient,
  type DaikinCommandResult,
  type DaikinGatewayDevice,
} from "./DaikinApiClient";

const PREHEAT_TEMPERATURE_CELSIUS = 21;

export type DaikinCapability = "read_power" | "schedule_window";

export interface DaikinAdapterConfig {
  deviceId: string;
  clientId: string;
  clientSecret: string;
  gatewayDeviceId: string;
  /** embeddedId of the management point to control, e.g. "climateControl". */
  managementPointId: string;
  client: DaikinApiClient;
}

export class DaikinAdapter extends BaseRealDeviceAdapter<
  DaikinCommandResult,
  DaikinGatewayDevice,
  DaikinTransportError
> {
  readonly adapterId = "daikin-adapter.v1";

  readonly capabilities: DaikinCapability[] = ["read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly gatewayDeviceId: string;
  private readonly managementPointId: string;
  private readonly client: DaikinApiClient;
  private token: string | null = null;

  constructor(config: DaikinAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.gatewayDeviceId = config.gatewayDeviceId;
    this.managementPointId = config.managementPointId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const token = await this.ensureAuth();
    const devices = await this.client.getGatewayDevices(token);
    const device = devices.find((d) => d.id === this.gatewayDeviceId);

    if (!device) {
      throw new DaikinTransportError(
        "UNSUPPORTED_DEVICE",
        `Daikin gateway device "${this.gatewayDeviceId}" not found in account.`,
        404,
        false,
      );
    }

    return this.mapVendorTelemetryToCanonicalTelemetry(device);
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<DaikinCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new DaikinTransportError(
        "UNSUPPORTED_DEVICE",
        `Daikin adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by Daikin adapter.`,
      };
    }

    const startMs = new Date(command.effectiveWindow.startAt).getTime();
    const endMs = new Date(command.effectiveWindow.endAt).getTime();

    await this.scheduleAction(startMs, async () => {
      const token = await this.ensureAuth();
      await this.client.setOperationMode(token, this.gatewayDeviceId, this.managementPointId, "heating");
      await this.client.setTemperature(token, this.gatewayDeviceId, this.managementPointId, PREHEAT_TEMPERATURE_CELSIUS);
    });

    await this.scheduleAction(endMs, async () => {
      const token = await this.ensureAuth();
      await this.client.setOperationMode(token, this.gatewayDeviceId, this.managementPointId, "off");
    });

    return {
      success: true,
      message: `Scheduled Daikin pre-heat to ${PREHEAT_TEMPERATURE_CELSIUS}°C at ${command.effectiveWindow.startAt} and mode restore to "off" at ${command.effectiveWindow.endAt}.`,
    };
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: DaikinCommandResult,
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
      message: vendorResult.message ?? "Daikin command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(device: DaikinGatewayDevice): CanonicalDeviceTelemetry[] {
    // Express heating state as a nominal wattage — heating mode ≈ 5 kW electrical input.
    const heatingPowerW = device.operationMode === "heating" ? 5000 : 0;

    // Derive a thermal "state of charge" from the indoor temperature.
    // 16°C → 0%, 22°C → 100% — signals how warm the thermal mass is to the optimizer.
    const batterySocPercent = Math.min(100, Math.max(0, Math.round(((device.indoorTemperatureCelsius - 16) / (22 - 16)) * 100)));

    return [
      {
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        batterySocPercent,
        evChargingPowerW: heatingPowerW,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: DaikinTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Daikin error.", vendorCode: error.code };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async ensureAuth(): Promise<string> {
    if (!this.token) {
      this.token = await this.client.login(this.clientId, this.clientSecret);
    }
    return this.token;
  }

  private async scheduleAction(targetMs: number, action: () => Promise<void>): Promise<void> {
    const delayMs = Math.max(0, targetMs - Date.now());

    if (delayMs === 0) {
      await action().catch((error) => {
        console.error("Daikin scheduled action failed", {
          deviceId: this.deviceId,
          gatewayDeviceId: this.gatewayDeviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    globalThis.setTimeout(() => {
      void action().catch((error) => {
        console.error("Daikin scheduled action failed", {
          deviceId: this.deviceId,
          gatewayDeviceId: this.gatewayDeviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delayMs);
  }
}
