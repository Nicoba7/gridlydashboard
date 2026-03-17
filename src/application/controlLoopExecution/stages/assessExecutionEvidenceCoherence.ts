import type { ObservedStateFreshnessStatus } from "../../../domain/observedStateFreshness";
import type { CommandExecutionResult, TelemetryCoherenceStatus } from "../types";

export type ExecutionConfidenceStatus = "confirmed" | "uncertain";

/**
 * Execution outcome enriched with canonical evidence for coherence assessment.
 * Carries only observedStateFreshness for v1 classification.
 * Also includes derived executionConfidence signal computed from telemetryCoherence.
 */
export interface EvidenceAnnotatedExecutionResult extends CommandExecutionResult {
  observedStateFreshness?: ObservedStateFreshnessStatus;
  executionConfidence?: ExecutionConfidenceStatus;
}

function classifyTelemetryCoherence(
  observedStateFreshness: ObservedStateFreshnessStatus | undefined,
): TelemetryCoherenceStatus | undefined {
  if (observedStateFreshness === "fresh") {
    return "coherent";
  }

  if (observedStateFreshness === "stale") {
    return "stale";
  }

  if (observedStateFreshness === "missing" || observedStateFreshness === "unknown") {
    return "delayed";
  }

  return undefined;
}

function classifyExecutionConfidence(
  telemetryCoherence: TelemetryCoherenceStatus | undefined,
): ExecutionConfidenceStatus | undefined {
  if (telemetryCoherence === "coherent") {
    return "confirmed";
  }

  if (telemetryCoherence === "stale" || telemetryCoherence === "delayed") {
    return "uncertain";
  }

  return undefined;
}

/**
 * Canonical post-execution evidence classification.
 *
 * Pure and deterministic: classifies telemetry coherence and derives execution
 * confidence from canonical runtime evidence only (observedStateFreshness).
 * Does not alter execution statuses or perform economic logic.
 *
 * V1 classification rules:
 * - issued + fresh => telemetryCoherence: coherent, executionConfidence: confirmed
 * - issued + stale => telemetryCoherence: stale, executionConfidence: uncertain
 * - issued + missing|unknown => telemetryCoherence: delayed, executionConfidence: uncertain
 * - non-issued => telemetryCoherence and executionConfidence unset
 */
export function assessExecutionEvidenceCoherence(
  outcomes: EvidenceAnnotatedExecutionResult[],
): EvidenceAnnotatedExecutionResult[] {
  return outcomes.map((outcome) => {
    // Strip existing fields before reassessment (only canonical evidence drives classification)
    const { telemetryCoherence: _ignoredTelemetryCoherence, executionConfidence: _ignoredExecutionConfidence, ...baseOutcome } = outcome;

    // Non-issued outcomes do not receive evidence classification
    if (outcome.status !== "issued") {
      return baseOutcome;
    }

    // Classify coherence from canonical evidence only
    const telemetryCoherence = classifyTelemetryCoherence(outcome.observedStateFreshness);

    // Unset if no canonical evidence available
    if (telemetryCoherence === undefined) {
      return baseOutcome;
    }

    // Derive execution confidence from coherence classification
    const executionConfidence = classifyExecutionConfidence(telemetryCoherence);

    return {
      ...baseOutcome,
      telemetryCoherence,
      executionConfidence,
    };
  });
}

/**
 * Cycle-level canonical runtime summary of execution evidence uncertainty.
 *
 * Pure and deterministic: summarizes whether the current control cycle contains
 * any uncertain execution evidence that should be considered by future runtime logic.
 *
 * Returns true if ANY outcome has executionConfidence==="uncertain".
 * Undefined confidence is not treated as uncertain.
 * Never mutates input.
 */
export function summarizeExecutionEvidenceConfidence(
  outcomes: CommandExecutionResult[],
): { hasUncertainExecutionEvidence: boolean } {
  const hasUncertain = outcomes.some(
    (outcome) => outcome.executionConfidence === "uncertain"
  );

  return {
    hasUncertainExecutionEvidence: hasUncertain,
  };
}