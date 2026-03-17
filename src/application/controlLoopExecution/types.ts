import type { CanonicalDeviceCommand } from "./canonicalCommand";
import type { RuntimeExecutionPosture } from "./executionPolicyTypes";
import type { ExecutionConfidenceStatus } from "./stages/assessExecutionEvidenceCoherence";

export type CommandExecutionStatus = "issued" | "skipped" | "failed";

export interface ExecutionEconomicArbitrationTrace {
  comparisonScope: "device" | "household";
  selectedOpportunityId: string;
  /** Transitional compatibility metadata for request-centric execution/journal joins. */
  selectedExecutionRequestId?: string;
  selectedDecisionId?: string;
  selectedTargetDeviceId: string;
  selectedAction?: string;
  selectedScorePencePerKwh: number;
  candidateScorePencePerKwh?: number;
  scoreDeltaPencePerKwh?: number;
  selectionReason: string;
  comparisonReason?: string;
  alternativesConsidered: number;
}

export interface LegacySourceCommandLineage {
  planId: string;
  decisionId?: string;
  commandId: string;
  targetDeviceId: string;
  sourceOpportunityId?: string;
}

export interface NativeCanonicalOpportunityProvenance {
  kind: "native_canonical";
  canonicalizedFromLegacy: false;
}

export interface CompatibilityCanonicalizedOpportunityProvenance {
  kind: "compatibility_canonicalized";
  canonicalizedFromLegacy: true;
  legacySourceType: "command_execution_request";
  adaptationReason: "missing_opportunity_id";
  sourceCommandLineage: LegacySourceCommandLineage;
  canonicalizationVersion: "legacy-opportunity-canonicalization.v1";
}

export type ExecutionOpportunityProvenance =
  | NativeCanonicalOpportunityProvenance
  | CompatibilityCanonicalizedOpportunityProvenance;

/**
 * Quality of telemetry evidence observed relative to a recent canonical execution.
 *
 * This is informational metadata recorded in the journal — it never drives
 * canonical identity or economic decisions. The runtime remains authoritative
 * regardless of what the device telemetry reports.
 *
 * - coherent     — telemetry agrees with known execution outcome
 * - delayed      — telemetry has not yet reflected a recently accepted command
 * - contradictory — telemetry data is internally inconsistent (e.g. SOC rising but charge_rate=0)
 * - stale         — telemetry capturedAt is too old to be trusted for current state
 */
export type TelemetryCoherenceStatus = "coherent" | "delayed" | "contradictory" | "stale";

export interface CommandExecutionRequest {
  opportunityId?: string;
  opportunityProvenance?: ExecutionOpportunityProvenance;
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
  opportunityId?: string;
  opportunityProvenance?: ExecutionOpportunityProvenance;
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
  executionPosture?: RuntimeExecutionPosture;
  economicArbitration?: ExecutionEconomicArbitrationTrace;
  /**
   * Optional observation of telemetry evidence quality at or after command dispatch.
   * Informational only — never used for canonical identity or economic reasoning.
   * Flows through to journal entries so the runtime's audit trail can distinguish
   * "command was dispatched" from "device state has converged".
   */
  telemetryCoherence?: TelemetryCoherenceStatus;
  /**
   * Optional derived signal of execution certainty from canonical runtime evidence.
   * Computed from telemetryCoherence: confirmed when coherent, uncertain when stale/delayed.
   * Informational only — runtime truth about device state reliability after dispatch.
   */
  executionConfidence?: ExecutionConfidenceStatus;
}

/**
 * Application-layer execution port used to hand canonical commands to future live adapters.
 */
export interface DeviceCommandExecutor {
  execute(requests: CommandExecutionRequest[]): Promise<CommandExecutionResult[]>;
}
