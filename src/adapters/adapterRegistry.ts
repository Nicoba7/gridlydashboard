import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import type {
  DeviceAdapter,
  DeviceAdapterExecutionContext,
  DeviceAdapterExecutionResult,
} from "./deviceAdapter";

export type AdapterRegistryResolutionCode = "RESOLVED" | "NO_ADAPTER_FOUND" | "MULTIPLE_ADAPTERS_FOUND";

export interface AdapterRegistryResolution {
  code: AdapterRegistryResolutionCode;
  adapter?: DeviceAdapter;
  matches: number;
}

/**
 * Routing seam between canonical execution orchestration and adapter implementations.
 */
export class DeviceAdapterRegistry {
  private readonly adapters: DeviceAdapter[];

  constructor(adapters: DeviceAdapter[]) {
    this.adapters = [...adapters];
  }

  resolveForTargetDeviceId(targetDeviceId: string): AdapterRegistryResolution {
    const matches = this.adapters.filter((adapter) => adapter.canHandle(targetDeviceId));

    if (matches.length === 0) {
      return {
        code: "NO_ADAPTER_FOUND",
        matches: 0,
      };
    }

    if (matches.length > 1) {
      return {
        code: "MULTIPLE_ADAPTERS_FOUND",
        matches: matches.length,
      };
    }

    return {
      code: "RESOLVED",
      adapter: matches[0],
      matches: 1,
    };
  }

  resolveForCommand(command: CanonicalDeviceCommand): AdapterRegistryResolution {
    return this.resolveForTargetDeviceId(command.targetDeviceId);
  }

  async dispatchCanonicalCommand(
    command: CanonicalDeviceCommand,
    context?: DeviceAdapterExecutionContext,
  ): Promise<DeviceAdapterExecutionResult> {
    const resolution = this.resolveForCommand(command);

    if (resolution.code === "NO_ADAPTER_FOUND") {
      return {
        targetDeviceId: command.targetDeviceId,
        status: "rejected",
        canonicalCommand: command,
        failureReasonCode: "NO_ADAPTER_FOUND",
        message: "No adapter is registered for the target device.",
      };
    }

    if (resolution.code === "MULTIPLE_ADAPTERS_FOUND") {
      return {
        targetDeviceId: command.targetDeviceId,
        status: "failed",
        canonicalCommand: command,
        failureReasonCode: "MULTIPLE_ADAPTERS_FOUND",
        message: `Multiple adapters matched target device '${command.targetDeviceId}'.`,
      };
    }

    return resolution.adapter.executeCanonicalCommand(command, context);
  }
}
