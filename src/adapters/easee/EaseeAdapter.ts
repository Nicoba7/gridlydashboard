import type { CanonicalDeviceCommand } from "../../application/controlLoopExecution/canonicalCommand";
import type { CanonicalDeviceTelemetry } from "../../domain/telemetry";
import type { DeviceAdapterExecutionContext } from "../deviceAdapter";
import { BaseRealDeviceAdapter, type AdapterOperation, type CanonicalAdapterCommandResult, type CanonicalAdapterError } from "../realDeviceAdapterContract";
import { EaseeTransportError, type EaseeApiClient, type EaseeCommand, type EaseeCommandResult, type EaseeStatePayload } from "./EaseeApiClient";

export type EaseeCapability = "read_power" | "schedule_window";

export interface EaseeAdapterConfig {
  deviceId: string;
  userName: string;
  password: string;
  chargerId: string;
  client: EaseeApiClient;
}

export class EaseeAdapter extends BaseRealDeviceAdapter<EaseeCommandResult, EaseeStatePayload, EaseeTransportError> {
  readonly adapterId = "easee-adapter.v1";
  readonly capabilities: EaseeCapability[] = ["read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly userName: string;
  private readonly password: string;
  private readonly chargerId: string;
  private readonly client: EaseeApiClient;

  constructor(config: EaseeAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.userName = config.userName;
    this.password = config.password;
    this.chargerId = config.chargerId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean { return targetDeviceId === this.deviceId; }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const token = await this.ensureToken();
    const status = await this.client.getChargerState(token, this.chargerId);
    return this.mapVendorTelemetryToCanonicalTelemetry(status);
  }

  async dispatchVendorCommand(command: CanonicalDeviceCommand, _context?: DeviceAdapterExecutionContext): Promise<EaseeCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) throw new EaseeTransportError("UNSUPPORTED_DEVICE", `Easee adapter does not handle device \"${command.targetDeviceId}\".`);

    const token = await this.ensureToken();
    if (command.kind !== "schedule_window") {
      return { success: true, message: `Command kind \"${command.kind}\" acknowledged but not actioned by Easee adapter.` };
    }

    const startMs = new Date(command.effectiveWindow.startAt).getTime();
    const endMs = new Date(command.effectiveWindow.endAt).getTime();
    this.schedule(token, startMs, "start_charging");
    this.schedule(token, endMs, "stop_charging");

    return { success: true, message: `Scheduled Easee charging from ${command.effectiveWindow.startAt} to ${command.effectiveWindow.endAt}.` };
  }

  mapVendorCommandResultToCanonical(command: CanonicalDeviceCommand, vendorResult: EaseeCommandResult): CanonicalAdapterCommandResult {
    if (vendorResult.success) return { targetDeviceId: command.targetDeviceId, status: "accepted", canonicalCommand: command, message: vendorResult.message };
    return { targetDeviceId: command.targetDeviceId, status: "rejected", canonicalCommand: command, failureReasonCode: "COMMAND_REJECTED", message: vendorResult.message ?? "Easee command rejected." };
  }

  mapVendorTelemetryToCanonicalTelemetry(status: EaseeStatePayload): CanonicalDeviceTelemetry[] {
    return [{ deviceId: this.deviceId, timestamp: new Date().toISOString(), evChargingPowerW: status.powerW, evConnected: true, chargingState: status.charging ? "charging" : "idle", schemaVersion: "telemetry.v1" }];
  }

  mapVendorErrorToCanonical(error: EaseeTransportError, operation: AdapterOperation): CanonicalAdapterError {
    if (error.code === "UNSUPPORTED_DEVICE") return { code: "UNSUPPORTED_DEVICE", operation, retryable: false, message: error.message, vendorCode: error.code };
    if (error.code === "AUTH_FAILURE") return { code: "UNAUTHORIZED", operation, retryable: false, message: error.message, vendorCode: error.code };
    if (error.code === "RATE_LIMIT") return { code: "RATE_LIMITED", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "TIMEOUT") return { code: "TIMEOUT", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "TEMPORARY_UNAVAILABLE") return { code: "UNAVAILABLE", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "MALFORMED_RESPONSE") return { code: "INVALID_VENDOR_RESPONSE", operation, retryable: false, message: error.message, vendorCode: error.code };
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Easee error.", vendorCode: error.code };
  }

  private async ensureToken(): Promise<string> {
    if (!this.userName.trim() || !this.password.trim() || !this.chargerId.trim()) {
      throw new EaseeTransportError("AUTH_FAILURE", "Easee credentials or charger ID are missing.");
    }
    return this.client.login(this.userName, this.password);
  }

  private schedule(token: string, targetMs: number, command: EaseeCommand): void {
    const delayMs = Math.max(0, targetMs - Date.now());
    const run = () => { void this.client.sendCommand(token, this.chargerId, command); };
    if (delayMs === 0) return run();
    globalThis.setTimeout(run, delayMs);
  }
}
