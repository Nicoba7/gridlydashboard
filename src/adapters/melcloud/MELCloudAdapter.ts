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
  MELCloudTransportError,
  EFFECTIVE_FLAG_ZONE1_TEMPERATURE,
  type MELCloudApiClient,
  type MELCloudCommandResult,
  type MELCloudDevice,
} from "./MELCloudApiClient";

const PREHEAT_TEMPERATURE_CELSIUS = 21;

export type MELCloudCapability = "read_soc" | "read_power" | "schedule_window";

export interface MELCloudAdapterConfig {
  deviceId: string;
  email: string;
  password: string;
  melcloudDeviceId: number;
  client: MELCloudApiClient;
}

export class MELCloudAdapter extends BaseRealDeviceAdapter<
  MELCloudCommandResult,
  MELCloudDevice,
  MELCloudTransportError
> {
  readonly adapterId = "melcloud-adapter.v1";

  readonly capabilities: MELCloudCapability[] = ["read_soc", "read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly email: string;
  private readonly password: string;
  private readonly melcloudDeviceId: number;
  private readonly client: MELCloudApiClient;
  private contextKey: string | null = null;

  constructor(config: MELCloudAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.email = config.email;
    this.password = config.password;
    this.melcloudDeviceId = config.melcloudDeviceId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === this.deviceId;
  }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const contextKey = await this.ensureAuth();
    const devices = await this.client.getDevices(contextKey);
    const device = devices.find((d) => d.deviceId === this.melcloudDeviceId);

    if (!device) {
      throw new MELCloudTransportError(
        "UNSUPPORTED_DEVICE",
        `MELCloud device ${this.melcloudDeviceId} not found in account.`,
        404,
        false,
      );
    }

    return this.mapVendorTelemetryToCanonicalTelemetry(device);
  }

  async dispatchVendorCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<MELCloudCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new MELCloudTransportError(
        "UNSUPPORTED_DEVICE",
        `MELCloud adapter does not handle device "${command.targetDeviceId}".`,
        undefined,
        false,
      );
    }

    if (command.kind !== "schedule_window") {
      return {
        success: true,
        message: `Command kind "${command.kind}" acknowledged but not actioned by MELCloud adapter.`,
      };
    }

    const startMs = new Date(command.effectiveWindow.start).getTime();
    const endMs = new Date(command.effectiveWindow.end).getTime();

    // Capture the current target temperature before overriding, to restore at window end.
    const contextKey = await this.ensureAuth();
    const devices = await this.client.getDevices(contextKey);
    const currentDevice = devices.find((d) => d.deviceId === this.melcloudDeviceId);
    const prevTemperature = currentDevice?.targetTemperatureCelsius ?? PREHEAT_TEMPERATURE_CELSIUS;

    await this.scheduleAction(startMs, async () => {
      const key = await this.ensureAuth();
      await this.client.setAtw(key, {
        DeviceID: this.melcloudDeviceId,
        EffectiveFlags: EFFECTIVE_FLAG_ZONE1_TEMPERATURE,
        SetTemperatureZone1: PREHEAT_TEMPERATURE_CELSIUS,
      });
    });

    await this.scheduleAction(endMs, async () => {
      const key = await this.ensureAuth();
      await this.client.setAtw(key, {
        DeviceID: this.melcloudDeviceId,
        EffectiveFlags: EFFECTIVE_FLAG_ZONE1_TEMPERATURE,
        SetTemperatureZone1: prevTemperature,
      });
    });

    return {
      success: true,
      message: `Scheduled MELCloud pre-heat to ${PREHEAT_TEMPERATURE_CELSIUS}°C at ${command.effectiveWindow.start} and restore to ${prevTemperature}°C at ${command.effectiveWindow.end}.`,
    };
  }

  mapVendorCommandResultToCanonical(
    command: CanonicalDeviceCommand,
    vendorResult: MELCloudCommandResult,
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
      message: vendorResult.message ?? "MELCloud command rejected.",
      adapterError: {
        code: "COMMAND_REJECTED",
        operation: "command_dispatch",
        retryable: false,
        message: vendorResult.message,
      },
    };
  }

  mapVendorTelemetryToCanonicalTelemetry(device: MELCloudDevice): CanonicalDeviceTelemetry[] {
    // Use indoor temperature as the primary thermal SoC proxy so the optimizer can
    // decide whether the house is already warm enough to skip pre-heat scheduling.
    // 16°C → 0%, 22°C → 100%.
    const batterySocPercent = Math.min(100, Math.max(0, Math.round(((device.currentTemperatureCelsius - 16) / (22 - 16)) * 100)));

    return [
      {
        deviceId: this.deviceId,
        timestamp: new Date().toISOString(),
        batterySocPercent,
        evChargingPowerW: device.heatingPowerW,
        schemaVersion: "telemetry.v1",
      },
    ];
  }

  mapVendorErrorToCanonical(
    error: MELCloudTransportError,
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
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown MELCloud error.", vendorCode: error.code };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async ensureAuth(): Promise<string> {
    if (!this.contextKey) {
      this.contextKey = await this.client.login(this.email, this.password);
    }
    return this.contextKey;
  }

  private async scheduleAction(targetMs: number, action: () => Promise<void>): Promise<void> {
    const delayMs = Math.max(0, targetMs - Date.now());

    if (delayMs === 0) {
      await action().catch((error) => {
        console.error("MELCloud scheduled action failed", {
          deviceId: this.deviceId,
          melcloudDeviceId: this.melcloudDeviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    globalThis.setTimeout(() => {
      void action().catch((error) => {
        console.error("MELCloud scheduled action failed", {
          deviceId: this.deviceId,
          melcloudDeviceId: this.melcloudDeviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delayMs);
  }
}
