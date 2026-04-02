import type { CanonicalDeviceCommand } from "../../application/controlLoopExecution/canonicalCommand";
import type { CanonicalDeviceTelemetry } from "../../domain/telemetry";
import type { DeviceAdapterExecutionContext } from "../deviceAdapter";
import { BaseRealDeviceAdapter, type AdapterOperation, type CanonicalAdapterCommandResult, type CanonicalAdapterError } from "../realDeviceAdapterContract";
import { IndraTransportError, type IndraApiClient, type IndraCommandResult, type IndraStatusPayload } from "./IndraApiClient";

export type IndraCapability = "read_power" | "schedule_window";

export interface IndraAdapterConfig {
  deviceId: string;
  email: string;
  password: string;
  indraDeviceId: string;
  client: IndraApiClient;
}

export class IndraAdapter extends BaseRealDeviceAdapter<IndraCommandResult, IndraStatusPayload, IndraTransportError> {
  readonly adapterId = "indra-adapter.v1";
  readonly capabilities: IndraCapability[] = ["read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly email: string;
  private readonly password: string;
  private readonly indraDeviceId: string;
  private readonly client: IndraApiClient;

  constructor(config: IndraAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.email = config.email;
    this.password = config.password;
    this.indraDeviceId = config.indraDeviceId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean { return targetDeviceId === this.deviceId; }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const token = await this.ensureToken();
    const status = await this.client.getChargerStatus(token, this.indraDeviceId);
    return this.mapVendorTelemetryToCanonicalTelemetry(status);
  }

  async dispatchVendorCommand(command: CanonicalDeviceCommand, _context?: DeviceAdapterExecutionContext): Promise<IndraCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) throw new IndraTransportError("UNSUPPORTED_DEVICE", `Indra adapter does not handle device \"${command.targetDeviceId}\".`);

    const token = await this.ensureToken();
    if (command.kind !== "schedule_window") {
      return { success: true, message: `Command kind \"${command.kind}\" acknowledged but not actioned by Indra adapter.` };
    }

    return this.client.setChargeSchedule(token, this.indraDeviceId, {
      startAt: command.effectiveWindow.startAt,
      endAt: command.effectiveWindow.endAt,
    });
  }

  mapVendorCommandResultToCanonical(command: CanonicalDeviceCommand, vendorResult: IndraCommandResult): CanonicalAdapterCommandResult {
    if (vendorResult.success) return { targetDeviceId: command.targetDeviceId, status: "accepted", canonicalCommand: command, message: vendorResult.message };
    return { targetDeviceId: command.targetDeviceId, status: "rejected", canonicalCommand: command, failureReasonCode: "COMMAND_REJECTED", message: vendorResult.message ?? "Indra command rejected." };
  }

  mapVendorTelemetryToCanonicalTelemetry(status: IndraStatusPayload): CanonicalDeviceTelemetry[] {
    return [{ deviceId: this.deviceId, timestamp: new Date().toISOString(), evChargingPowerW: status.powerW, evConnected: true, chargingState: status.charging ? "charging" : "idle", schemaVersion: "telemetry.v1" }];
  }

  mapVendorErrorToCanonical(error: IndraTransportError, operation: AdapterOperation): CanonicalAdapterError {
    if (error.code === "UNSUPPORTED_DEVICE") return { code: "UNSUPPORTED_DEVICE", operation, retryable: false, message: error.message, vendorCode: error.code };
    if (error.code === "AUTH_FAILURE") return { code: "UNAUTHORIZED", operation, retryable: false, message: error.message, vendorCode: error.code };
    if (error.code === "RATE_LIMIT") return { code: "RATE_LIMITED", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "TIMEOUT") return { code: "TIMEOUT", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "TEMPORARY_UNAVAILABLE") return { code: "UNAVAILABLE", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "MALFORMED_RESPONSE") return { code: "INVALID_VENDOR_RESPONSE", operation, retryable: false, message: error.message, vendorCode: error.code };
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Indra error.", vendorCode: error.code };
  }

  private async ensureToken(): Promise<string> {
    if (!this.email.trim() || !this.password.trim() || !this.indraDeviceId.trim()) {
      throw new IndraTransportError("AUTH_FAILURE", "Indra credentials or device ID are missing.");
    }
    return this.client.login(this.email, this.password);
  }
}
