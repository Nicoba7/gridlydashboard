import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import type { TimeWindow } from "../domain";

/**
 * Canonical last-known device belief held by Gridly core.
 *
 * This represents system belief after execution outcomes, not guaranteed
 * physical truth and not a vendor payload.
 */
export interface CanonicalDeviceShadowState {
  deviceId: string;
  lastKnownCommand?: CanonicalDeviceCommand;
  lastKnownMode?: string;
  lastKnownPowerW?: number;
  lastKnownWindow?: TimeWindow;
  lastExecutionRequestId?: string;
  lastDecisionId?: string;
  lastUpdatedAt: string;
  stateSource: "execution_result";
  schemaVersion: string;
}
