import { describe, expect, it } from "vitest";
import {
  assessExecutionEvidenceCoherence,
  type EvidenceAnnotatedExecutionResult,
} from "../application/controlLoopExecution/stages/assessExecutionEvidenceCoherence";

function buildOutcome(overrides?: Partial<EvidenceAnnotatedExecutionResult>): EvidenceAnnotatedExecutionResult {
  return {
    opportunityId: "opp-1",
    executionRequestId: "exec-1",
    requestId: "exec-1",
    idempotencyKey: "plan-1:decision-1:cmd-1",
    decisionId: "decision-1",
    targetDeviceId: "battery",
    commandId: "cmd-1",
    deviceId: "battery",
    status: "issued",
    ...overrides,
  };
}

describe("assessExecutionEvidenceCoherence", () => {
  describe("V1 canonical classification rules", () => {
    it("sets coherent when issued outcome has fresh observed-state evidence", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: "fresh" })];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("coherent");
    });

    it("sets stale when issued outcome has stale observed-state evidence", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: "stale" })];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("stale");
    });

    it("sets delayed when issued outcome has missing evidence", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: "missing" })];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("delayed");
    });

    it("sets delayed when issued outcome has unknown evidence", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: "unknown" })];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("delayed");
    });

    it("does not set telemetryCoherence for non-issued outcomes", () => {
      const outcomes = [
        buildOutcome({ status: "skipped", observedStateFreshness: "fresh" }),
        buildOutcome({ status: "failed", observedStateFreshness: "stale" }),
      ];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBeUndefined();
      expect(assessed[1].telemetryCoherence).toBeUndefined();
    });

    it("unsets telemetryCoherence when issued but no evidence available", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: undefined })];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBeUndefined();
    });
  });

  describe("Derived execution confidence signal", () => {
    it("derives confirmed when telemetryCoherence is coherent", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: "fresh" })];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("coherent");
      expect(assessed[0].executionConfidence).toBe("confirmed");
    });

    it("derives uncertain when telemetryCoherence is stale", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: "stale" })];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("stale");
      expect(assessed[0].executionConfidence).toBe("uncertain");
    });

    it("derives uncertain when telemetryCoherence is delayed", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: "missing" })];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("delayed");
      expect(assessed[0].executionConfidence).toBe("uncertain");
    });

    it("does not set executionConfidence for non-issued outcomes", () => {
      const outcomes = [
        buildOutcome({ status: "skipped", observedStateFreshness: "fresh", executionConfidence: "confirmed" }),
        buildOutcome({ status: "failed", observedStateFreshness: "stale", executionConfidence: "uncertain" }),
      ];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].executionConfidence).toBeUndefined();
      expect(assessed[1].executionConfidence).toBeUndefined();
    });

    it("unsets executionConfidence when issued but no evidence available", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: undefined, executionConfidence: "confirmed" })];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].executionConfidence).toBeUndefined();
    });
  });

  describe("Reassessment behavior - canonical evidence drives outcome", () => {
    it("replaces existing stale telemetryCoherence with fresh evidence", () => {
      const outcomes = [
        buildOutcome({
          status: "issued",
          observedStateFreshness: "fresh",
          telemetryCoherence: "stale",
        }),
      ];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("coherent");
    });

    it("replaces executionConfidence from uncertain to confirmed when evidence improves", () => {
      const outcomes = [
        buildOutcome({
          status: "issued",
          observedStateFreshness: "fresh",
          executionConfidence: "uncertain",
        }),
      ];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].executionConfidence).toBe("confirmed");
    });

    it("strips telemetryCoherence from failed outcome regardless of prior value", () => {
      const outcomes = [
        buildOutcome({
          status: "failed",
          observedStateFreshness: "fresh",
          telemetryCoherence: "coherent",
        }),
      ];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBeUndefined();
    });

    it("strips executionConfidence from skipped outcome regardless of prior value", () => {
      const outcomes = [
        buildOutcome({
          status: "skipped",
          observedStateFreshness: "stale",
          executionConfidence: "uncertain",
        }),
      ];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].executionConfidence).toBeUndefined();
    });

    it("replaces delayed/uncertain with stale/uncertain when evidence updates", () => {
      const outcomes = [
        buildOutcome({
          status: "issued",
          observedStateFreshness: "stale",
          telemetryCoherence: "delayed",
          executionConfidence: "confirmed",
        }),
      ];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("stale");
      expect(assessed[0].executionConfidence).toBe("uncertain");
    });
  });

  describe("Immutability guarantees", () => {
    it("returns new objects and does not mutate input outcomes", () => {
      const outcomes = [buildOutcome({ observedStateFreshness: "fresh" })];
      const original = { ...outcomes[0] };

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0]).not.toBe(outcomes[0]);
      expect(outcomes[0]).toEqual(original);
      expect(assessed[0].telemetryCoherence).toBe("coherent");
      expect(assessed[0].executionConfidence).toBe("confirmed");
    });

    it("processes multiple outcomes independently without cross-outcome effects", () => {
      const outcomes = [
        buildOutcome({ executionRequestId: "exec-1", observedStateFreshness: "fresh" }),
        buildOutcome({ executionRequestId: "exec-2", observedStateFreshness: "stale" }),
        buildOutcome({
          executionRequestId: "exec-3",
          status: "failed",
          observedStateFreshness: "missing",
        }),
      ];

      const assessed = assessExecutionEvidenceCoherence(outcomes);

      expect(assessed[0].telemetryCoherence).toBe("coherent");
      expect(assessed[0].executionConfidence).toBe("confirmed");
      expect(assessed[1].telemetryCoherence).toBe("stale");
      expect(assessed[1].executionConfidence).toBe("uncertain");
      expect(assessed[2].telemetryCoherence).toBeUndefined();
      expect(assessed[2].executionConfidence).toBeUndefined();
      // Original outcomes remain unchanged
      expect(outcomes[0].telemetryCoherence).toBeUndefined();
      expect(outcomes[0].executionConfidence).toBeUndefined();
      expect(outcomes[1].telemetryCoherence).toBeUndefined();
      expect(outcomes[1].executionConfidence).toBeUndefined();
      expect(outcomes[2].telemetryCoherence).toBeUndefined();
      expect(outcomes[2].executionConfidence).toBeUndefined();
    });
  });
});
