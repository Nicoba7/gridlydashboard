import { DeviceAdapterRegistry } from "../../adapters/adapterRegistry";
import { LiveAdapterDeviceCommandExecutor } from "../../application/controlLoopExecution/liveAdapterExecutor";
import type { DeviceAdapter } from "../../adapters/deviceAdapter";

export type RuntimeValidationAdapter = DeviceAdapter;

export interface RuntimeValidationAdapterWiring {
  registry: DeviceAdapterRegistry;
  executor: LiveAdapterDeviceCommandExecutor;
}

export function createRuntimeValidationAdapterWiring(
  adapters: RuntimeValidationAdapter[],
): RuntimeValidationAdapterWiring {
  const registry = new DeviceAdapterRegistry(adapters);
  const executor = new LiveAdapterDeviceCommandExecutor(registry);

  return {
    registry,
    executor,
  };
}
