import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import type { CommandAcknowledgementStatus } from "../application/controlLoopExecution/projectExecutionOutcome";
import type { CommandExecutionStatus } from "../application/controlLoopExecution/types";
import type { OptimizationMode, PlanningConfidenceLevel } from "../domain";
import type { PlanningInputCoverage } from "../domain/optimizer";
import type { CanonicalValueLedger } from "../domain/valueLedger";

export interface ExecutionCycleDecisionSummary {
  decisionId: string;
  action: string;
  targetDeviceIds: string[];
  marginalImportAvoidance?: number;
  marginalExportValue?: number;
  grossStoredEnergyValue?: number;
  netStoredEnergyValue?: number;
  batteryDegradationCost?: number;
  effectiveStoredEnergyValue?: number;
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
  decisionReason?: string;
}

export interface ExecutionCycleFinancialContext {
  optimizationMode: OptimizationMode;
  decisionsTaken: ExecutionCycleDecisionSummary[];
  valueLedger: CanonicalValueLedger;
  planningInputCoverage?: PlanningInputCoverage;
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
  planningAssumptions?: string[];
  planningWarnings?: string[];
}

/**
 * Canonical historical record of per-request execution outcomes.
 *
 * This is a system-level journal entry, not a vendor transport log.
 */
export interface ExecutionJournalEntry {
  entryId: string;
  recordedAt: string;
  decisionId?: string;
  executionRequestId: string;
  idempotencyKey: string;
  targetDeviceId: string;
  canonicalCommand: CanonicalDeviceCommand;
  status: CommandExecutionStatus;
  acknowledgementStatus?: CommandAcknowledgementStatus;
  reasonCodes?: string[];
  stage?: "preflight_validation" | "reconciliation" | "dispatch";
  cycleFinancialContext?: ExecutionCycleFinancialContext;
  schemaVersion: string;
}
