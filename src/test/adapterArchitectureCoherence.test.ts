import { describe, expect, it } from "vitest";
import { DeviceAdapterRegistry } from "../adapters/adapterRegistry";
import { LiveAdapterDeviceCommandExecutor } from "../application/controlLoopExecution/liveAdapterExecutor";
import { createRuntimeValidationAdapterWiring } from "../integrations/runtimeValidation/runtimeValidationAdapterRegistry";
import { FakeDeviceAdapter } from "./fakes/FakeDeviceAdapter";

describe("adapter architecture coherence", () => {
  it("uses the same registry + executor architecture for runtime validation wiring", async () => {
    const adapter = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const wiring = createRuntimeValidationAdapterWiring([adapter]);

    expect(wiring.registry).toBeInstanceOf(DeviceAdapterRegistry);
    expect(wiring.executor).toBeInstanceOf(LiveAdapterDeviceCommandExecutor);

    const [result] = await wiring.executor.execute([
      {
        opportunityId: "opp-1",
        opportunityProvenance: {
          kind: "native_canonical",
          canonicalizedFromLegacy: false,
        },
        executionRequestId: "exec-1",
        requestId: "exec-1",
        idempotencyKey: "opp-1:battery:set_mode:charge",
        decisionId: "decision-1",
        targetDeviceId: "battery",
        planId: "plan-1",
        requestedAt: "2026-03-16T10:00:00.000Z",
        commandId: "cmd-1",
        canonicalCommand: {
          kind: "set_mode",
          targetDeviceId: "battery",
          mode: "charge",
        },
      },
    ]);

    expect(result.status).toBe("issued");
    expect(result.opportunityId).toBe("opp-1");
    expect(result.executionRequestId).toBe("exec-1");
  });
});