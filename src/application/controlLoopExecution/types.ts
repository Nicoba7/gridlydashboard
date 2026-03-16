import type { CanonicalDeviceCommand } from "./canonicalCommand";

export type CommandExecutionStatus = "issued" | "skipped" | "failed";

export interface CommandExecutionRequest {
  executionRequestId: string;
  /** Transitional alias retained while the application seam settles. */
  requestId: string;
  idempotencyKey: string;
  decisionId?: string;
  targetDeviceId: string;
  planId: string;
  requestedAt: string;
  commandId: string;
  canonicalCommand: CanonicalDeviceCommand;
}

export interface CommandExecutionResult {
  executionRequestId: string;
  /** Transitional alias retained while the application seam settles. */
  requestId: string;
  idempotencyKey: string;
  decisionId?: string;
  targetDeviceId: string;
  commandId: string;
  deviceId: string;
  status: CommandExecutionStatus;
  message?: string;
  errorCode?: string;
  reasonCodes?: string[];
}

/**
 * Application-layer execution port used to hand canonical commands to future live adapters.
 */
export interface DeviceCommandExecutor {
  execute(requests: CommandExecutionRequest[]): Promise<CommandExecutionResult[]>;
}
