import type { ExecutionCycleFinancialContext } from "../../journal/executionJournal";
import type { RuntimeExecutionGuardrailContext, RuntimeExecutionPosture } from "./executionPolicyTypes";
import type {
  ExecutionEdgeContext,
  ExecutionPlan,
  ExecutionResult,
  RejectedOpportunity,
} from "./pipelineTypes";
import type { CommandExecutionResult } from "./types";
import type {
  CanonicalRuntimeOutcomeSignal,
  CanonicalRuntimeSignals,
} from "./canonicalRuntimeSignals";

/**
 * Canonical per-outcome projection record assembled in the runtime.
 *
 * Projection persists this record unchanged and must not derive signals or decisions.
 */
export interface RuntimeOutcomeProjectionRecord {
  executionRequestId: string;
  executionEdgeContext: ExecutionEdgeContext;
  outcome: CommandExecutionResult;
  runtimeOutcomeSignal: CanonicalRuntimeOutcomeSignal;
}

/**
 * Canonical runtime handoff payload for journal projection.
 *
 * This payload is produced by the canonical runtime.
 * Projection only persists runtime truth.
 * Projection must not derive or reinterpret runtime signals.
 */
export interface RuntimeJournalProjectionPayload {
  recordedAt: string;
  executionPosture: RuntimeExecutionPosture;
  runtimeGuardrailContext?: RuntimeExecutionGuardrailContext;
  failClosedTriggered: boolean;
  cycleHeartbeatMeta?: { cycleId?: string; replanReason?: string };
  cycleFinancialContext?: ExecutionCycleFinancialContext;
  executionPlan?: ExecutionPlan;
  executionResult?: ExecutionResult;
  rejectedOpportunities: RejectedOpportunity[];
  legacyCompatibilityOutcomes: CommandExecutionResult[];
  runtimeOutcomeProjection: {
    /**
     * Primary per-outcome projection truth unit.
     * Assembled in canonical runtime and persisted unchanged by projection.
     */
    outcomeRecords: RuntimeOutcomeProjectionRecord[];
    /**
     * Transitional compatibility-only contexts for legacy narrative mapping.
     * Keep narrowly scoped; do not use to reconstruct economic or signal truth.
     */
    compatibilityExecutionEdgeContexts: ExecutionEdgeContext[];
    canonicalRuntimeSignals: CanonicalRuntimeSignals;
  };
}
