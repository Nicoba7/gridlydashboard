import type { ExecutionConfidenceStatus } from "./stages/assessExecutionEvidenceCoherence";
import type { TelemetryCoherenceStatus } from "./types";

export interface CanonicalRuntimeOutcomeSignal {
  executionRequestId: string;
  telemetryCoherence?: TelemetryCoherenceStatus;
  executionConfidence?: ExecutionConfidenceStatus;
}

/**
 * Canonical runtime authority for all runtime-derived execution signals.
 *
 * Signals are derived only in the canonical runtime.
 * Projection layers only persist canonical runtime truth.
 */
export interface CanonicalRuntimeSignals {
  outcomeSignals: CanonicalRuntimeOutcomeSignal[];
  executionEvidenceSummary: {
    hasUncertainExecutionEvidence: boolean;
  };
  nextCycleExecutionCaution: "normal" | "caution";
  householdObjectiveSummary: {
    objectiveMode: "savings" | "earnings" | "balanced";
    hasExportIntent: boolean;
    hasImportAvoidanceIntent: boolean;
  };
  householdObjectiveConfidence: "clear" | "mixed" | "empty";
}
