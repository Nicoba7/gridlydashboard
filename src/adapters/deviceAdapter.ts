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
 * Adapter boundary for translating canonical Gridly commands into future vendor APIs.
 */
export interface DeviceAdapter {
  canHandle(targetDeviceId: string): boolean;
  executeCanonicalCommand(
    command: CanonicalDeviceCommand,
    context?: DeviceAdapterExecutionContext,
  ): Promise<DeviceAdapterExecutionResult>;
}
