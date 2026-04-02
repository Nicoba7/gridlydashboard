import type { CanonicalDeviceCommand } from "../../application/controlLoopExecution/canonicalCommand";
import type { CanonicalDeviceTelemetry } from "../../domain/telemetry";
import type { DeviceAdapterExecutionContext } from "../deviceAdapter";
import { BaseRealDeviceAdapter, type AdapterOperation, type CanonicalAdapterCommandResult, type CanonicalAdapterError } from "../realDeviceAdapterContract";
import { WallboxTransportError, type WallboxApiClient, type WallboxCommandResult, type WallboxRemoteAction, type WallboxStatusPayload } from "./WallboxApiClient";

export type WallboxCapability = "read_power" | "schedule_window";

export interface WallboxAdapterConfig {
  deviceId: string;
  email: string;
  password: string;
  chargerId: string;
  client: WallboxApiClient;
}

export class WallboxAdapter extends BaseRealDeviceAdapter<WallboxCommandResult, WallboxStatusPayload, WallboxTransportError> {
  readonly adapterId = "wallbox-adapter.v1";
  readonly capabilities: WallboxCapability[] = ["read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly email: string;
  private readonly password: string;
  private readonly chargerId: string;
  private readonly client: WallboxApiClient;

  constructor(config: WallboxAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.email = config.email;
    this.password = config.password;
    this.chargerId = config.chargerId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean { return targetDeviceId === this.deviceId; }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const token = await this.ensureToken();
    const status = await this.client.getChargerStatus(token, this.chargerId);
    return this.mapVendorTelemetryToCanonicalTelemetry(status);
  }

  async dispatchVendorCommand(command: CanonicalDeviceCommand, _context?: DeviceAdapterExecutionContext): Promise<WallboxCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) {
      throw new WallboxTransportError("UNSUPPORTED_DEVICE", `Wallbox adapter does not handle device \"${command.targetDeviceId}\".`);
    }

    const token = await this.ensureToken();
    if (command.kind !== "schedule_window") {
      return { success: true, message: `Command kind \"${command.kind}\" acknowledged but not actioned by Wallbox adapter.` };
    }

    const startMs = new Date(command.effectiveWindow.startAt).getTime();
    const endMs = new Date(command.effectiveWindow.endAt).getTime();
    this.scheduleAction(token, startMs, "start");
    this.scheduleAction(token, endMs, "stop");

    return { success: true, message: `Scheduled Wallbox charging from ${command.effectiveWindow.startAt} to ${command.effectiveWindow.endAt}.` };
  }

  mapVendorCommandResultToCanonical(command: CanonicalDeviceCommand, vendorResult: WallboxCommandResult): CanonicalAdapterCommandResult {
    if (vendorResult.success) return { targetDeviceId: command.targetDeviceId, status: "accepted", canonicalCommand: command, message: vendorResult.message };
    return { targetDeviceId: command.targetDeviceId, status: "rejected", canonicalCommand: command, failureReasonCode: "COMMAND_REJECTED", message: vendorResult.message ?? "Wallbox command rejected." };
  }

  mapVendorTelemetryToCanonicalTelemetry(status: WallboxStatusPayload): CanonicalDeviceTelemetry[] {
    return [{ deviceId: this.deviceId, timestamp: new Date().toISOString(), evChargingPowerW: status.powerW, evConnected: true, chargingState: status.charging ? "charging" : "idle", schemaVersion: "telemetry.v1" }];
  }

  mapVendorErrorToCanonical(error: WallboxTransportError, operation: AdapterOperation): CanonicalAdapterError {
    if (error.code === "UNSUPPORTED_DEVICE") return { code: "UNSUPPORTED_DEVICE", operation, retryable: false, message: error.message, vendorCode: error.code };
    if (error.code === "AUTH_FAILURE") return { code: "UNAUTHORIZED", operation, retryable: false, message: error.message, vendorCode: error.code };
    if (error.code === "RATE_LIMIT") return { code: "RATE_LIMITED", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "TIMEOUT") return { code: "TIMEOUT", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "TEMPORARY_UNAVAILABLE") return { code: "UNAVAILABLE", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "MALFORMED_RESPONSE") return { code: "INVALID_VENDOR_RESPONSE", operation, retryable: false, message: error.message, vendorCode: error.code };
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Wallbox error.", vendorCode: error.code };
  }

  private async ensureToken(): Promise<string> {
    if (!this.email.trim() || !this.password.trim() || !this.chargerId.trim()) {
      throw new WallboxTransportError("AUTH_FAILURE", "Wallbox credentials or charger ID are missing.");
    }
    return this.client.login(this.email, this.password);
  }

  private scheduleAction(token: string, targetMs: number, action: WallboxRemoteAction): void {
    const delayMs = Math.max(0, targetMs - Date.now());
    const run = () => { void this.client.setChargerAction(token, this.chargerId, action); };
    if (delayMs === 0) return run();
    globalThis.setTimeout(run, delayMs);
  }
}
