import type { DeviceAdapterExecutionResult } from "../../adapters/deviceAdapter";
import type { DeviceAdapterRegistry } from "../../adapters/adapterRegistry";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "./types";

function mapAdapterResultToExecutionResult(
  request: CommandExecutionRequest,
  adapterResult: DeviceAdapterExecutionResult,
): CommandExecutionResult {
  return {
    executionRequestId: request.executionRequestId,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    decisionId: request.decisionId,
    targetDeviceId: request.targetDeviceId,
    commandId: request.commandId,
    deviceId: adapterResult.targetDeviceId,
    status: adapterResult.status === "accepted" ? "issued" : "failed",
    message: adapterResult.message,
    errorCode: adapterResult.failureReasonCode,
  };
}

/**
 * Bridge from canonical execution requests to adapter-registry dispatch.
 */
export class LiveAdapterDeviceCommandExecutor implements DeviceCommandExecutor {
  constructor(private readonly registry: DeviceAdapterRegistry) {}

  async execute(requests: CommandExecutionRequest[]): Promise<CommandExecutionResult[]> {
    const results: CommandExecutionResult[] = [];

    for (const request of requests) {
      try {
        const adapterResult = await this.registry.dispatchCanonicalCommand(request.canonicalCommand, {
          executionRequestId: request.executionRequestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          requestedAt: request.requestedAt,
        });

        results.push(mapAdapterResultToExecutionResult(request, adapterResult));
      } catch (error) {
        results.push({
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.targetDeviceId,
          status: "failed",
          message: error instanceof Error ? error.message : "Adapter execution failed.",
          errorCode: "UNKNOWN_ERROR",
        });
      }
    }

    return results;
  }
}

export { mapAdapterResultToExecutionResult };
