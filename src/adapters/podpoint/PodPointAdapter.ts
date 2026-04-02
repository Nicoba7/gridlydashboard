import type { CanonicalDeviceCommand } from "../../application/controlLoopExecution/canonicalCommand";
import type { CanonicalDeviceTelemetry } from "../../domain/telemetry";
import type { DeviceAdapterExecutionContext } from "../deviceAdapter";
import { BaseRealDeviceAdapter, type AdapterOperation, type CanonicalAdapterCommandResult, type CanonicalAdapterError } from "../realDeviceAdapterContract";
import { PodPointTransportError, type PodPointApiClient, type PodPointAuthSession, type PodPointCommandResult, type PodPointUnitPayload } from "./PodPointApiClient";

export type PodPointCapability = "read_power" | "schedule_window";

export interface PodPointAdapterConfig {
  deviceId: string;
  email: string;
  password: string;
  unitId: string;
  client: PodPointApiClient;
}

export class PodPointAdapter extends BaseRealDeviceAdapter<PodPointCommandResult, PodPointUnitPayload, PodPointTransportError> {
  readonly adapterId = "podpoint-adapter.v1";
  readonly capabilities: PodPointCapability[] = ["read_power", "schedule_window"];

  private readonly deviceId: string;
  private readonly email: string;
  private readonly password: string;
  private readonly unitId: string;
  private readonly client: PodPointApiClient;

  constructor(config: PodPointAdapterConfig) {
    super();
    this.deviceId = config.deviceId;
    this.email = config.email;
    this.password = config.password;
    this.unitId = config.unitId;
    this.client = config.client;
  }

  canHandle(targetDeviceId: string): boolean { return targetDeviceId === this.deviceId; }

  async readTelemetry(): Promise<CanonicalDeviceTelemetry[]> {
    const auth = await this.ensureAuth();
    const unit = await this.client.getUnit(auth.token, this.unitId);
    return this.mapVendorTelemetryToCanonicalTelemetry(unit);
  }

  async dispatchVendorCommand(command: CanonicalDeviceCommand, _context?: DeviceAdapterExecutionContext): Promise<PodPointCommandResult> {
    if (!this.canHandle(command.targetDeviceId)) throw new PodPointTransportError("UNSUPPORTED_DEVICE", `Pod Point adapter does not handle device \"${command.targetDeviceId}\".`);

    const auth = await this.ensureAuth();
    if (command.kind !== "schedule_window") {
      return { success: true, message: `Command kind \"${command.kind}\" acknowledged but not actioned by Pod Point adapter.` };
    }

    return this.client.setSchedule(auth.token, this.unitId, {
      startAt: command.effectiveWindow.startAt,
      endAt: command.effectiveWindow.endAt,
    });
  }

  mapVendorCommandResultToCanonical(command: CanonicalDeviceCommand, vendorResult: PodPointCommandResult): CanonicalAdapterCommandResult {
    if (vendorResult.success) return { targetDeviceId: command.targetDeviceId, status: "accepted", canonicalCommand: command, message: vendorResult.message };
    return { targetDeviceId: command.targetDeviceId, status: "rejected", canonicalCommand: command, failureReasonCode: "COMMAND_REJECTED", message: vendorResult.message ?? "Pod Point command rejected." };
  }

  mapVendorTelemetryToCanonicalTelemetry(unit: PodPointUnitPayload): CanonicalDeviceTelemetry[] {
    return [{ deviceId: this.deviceId, timestamp: new Date().toISOString(), evChargingPowerW: unit.powerW, evConnected: unit.connected, chargingState: unit.charging ? "charging" : "idle", schemaVersion: "telemetry.v1" }];
  }

  mapVendorErrorToCanonical(error: PodPointTransportError, operation: AdapterOperation): CanonicalAdapterError {
    if (error.code === "UNSUPPORTED_DEVICE") return { code: "UNSUPPORTED_DEVICE", operation, retryable: false, message: error.message, vendorCode: error.code };
    if (error.code === "AUTH_FAILURE") return { code: "UNAUTHORIZED", operation, retryable: false, message: error.message, vendorCode: error.code };
    if (error.code === "RATE_LIMIT") return { code: "RATE_LIMITED", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "TIMEOUT") return { code: "TIMEOUT", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "TEMPORARY_UNAVAILABLE") return { code: "UNAVAILABLE", operation, retryable: true, message: error.message, vendorCode: error.code };
    if (error.code === "MALFORMED_RESPONSE") return { code: "INVALID_VENDOR_RESPONSE", operation, retryable: false, message: error.message, vendorCode: error.code };
    return { code: "UNKNOWN", operation, retryable: true, message: error.message ?? "Unknown Pod Point error.", vendorCode: error.code };
  }

  private async ensureAuth(): Promise<PodPointAuthSession> {
    if (!this.email.trim() || !this.password.trim() || !this.unitId.trim()) {
      throw new PodPointTransportError("AUTH_FAILURE", "Pod Point credentials or unit ID are missing.");
    }
    return this.client.login(this.email, this.password);
  }
}
