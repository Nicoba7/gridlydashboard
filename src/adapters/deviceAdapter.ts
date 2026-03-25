import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";

export type DeviceAdapterExecutionStatus = "accepted" | "rejected" | "failed";

export type DeviceAdapterFailureReasonCode =
  | "UNSUPPORTED_DEVICE"
  | "COMMAND_REJECTED"
  | "COMMAND_FAILED"
  | "INVALID_COMMAND"
  | "NO_ADAPTER_FOUND"
  | "MULTIPLE_ADAPTERS_FOUND"
  | "UNKNOWN_ERROR";

export interface DeviceAdapterExecutionContext {
  executionRequestId?: string;
  idempotencyKey?: string;
  opportunityId?: string;
  decisionId?: string;
  requestedAt?: string;
}

export interface DeviceAdapterExecutionResult {
  targetDeviceId: string;
  status: DeviceAdapterExecutionStatus;
  canonicalCommand: CanonicalDeviceCommand;
  failureReasonCode?: DeviceAdapterFailureReasonCode;
  message?: string;
}

/**
 * Adapter boundary for translating canonical Aveum commands into future vendor APIs.
 */
export interface DeviceAdapter {
  canHandle(targetDeviceId: string): boolean;
  executeCanonicalCommand(
    command: CanonicalDeviceCommand,
    context?: DeviceAdapterExecutionContext,
  ): Promise<DeviceAdapterExecutionResult>;
}

/**
 * Optional extension for adapters that expose read-only telemetry/state/capabilities.
 *
 * This extends (not replaces) the canonical execution adapter contract so Aveum
 * keeps a single adapter architecture.
 */
export interface ObservableDeviceAdapter<TTelemetry, TState, TCapabilities> extends DeviceAdapter {
  getTelemetry(): Promise<TTelemetry>;
  getState(): Promise<TState>;
  getCapabilities(): TCapabilities;
}
