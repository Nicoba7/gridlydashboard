import type { RuntimeJournalProjectionPayload } from "./runtimeJournalProjectionPayload";

function collectDuplicateExecutionRequestIds(executionRequestIds: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  executionRequestIds.forEach((executionRequestId) => {
    if (seen.has(executionRequestId)) {
      duplicates.add(executionRequestId);
      return;
    }

    seen.add(executionRequestId);
  });

  return [...duplicates].sort();
}

/**
 * Integrity guard for runtime-produced projection payload shape.
 *
 * This guard does not derive new truth.
 * This guard does not make policy or economic decisions.
 */
export function validateRuntimeJournalProjectionPayloadIntegrity(
  payload: RuntimeJournalProjectionPayload,
): void {
  const recordExecutionRequestIds = payload.runtimeOutcomeProjection.outcomeRecords
    .map((record) => record.executionRequestId);
  const compatibilityEdgeContextExecutionRequestIds = payload.runtimeOutcomeProjection.compatibilityExecutionEdgeContexts
    .map((context) => context.executionRequestId);

  const duplicateRecordIds = collectDuplicateExecutionRequestIds(recordExecutionRequestIds);
  const duplicateCompatibilityEdgeContextIds = collectDuplicateExecutionRequestIds(
    compatibilityEdgeContextExecutionRequestIds,
  );

  if (duplicateRecordIds.length > 0) {
    throw new Error(
      `Projection payload integrity violation: duplicate runtime outcome projection records for executionRequestId(s): ${duplicateRecordIds.join(", ")}.`,
    );
  }

  if (duplicateCompatibilityEdgeContextIds.length > 0) {
    throw new Error(
      "Projection payload integrity violation: duplicate compatibility execution edge contexts for executionRequestId(s): "
      + `${duplicateCompatibilityEdgeContextIds.join(", ")}.`,
    );
  }

  payload.runtimeOutcomeProjection.outcomeRecords.forEach((record) => {
    if (record.outcome.executionRequestId !== record.executionRequestId) {
      throw new Error(
        "Projection payload integrity violation: outcome executionRequestId does not match runtime outcome projection record executionRequestId "
        + `(${record.executionRequestId}).`,
      );
    }

    if (record.runtimeOutcomeSignal.executionRequestId !== record.executionRequestId) {
      throw new Error(
        "Projection payload integrity violation: missing runtime outcome signal coverage for outcome executionRequestId "
        + `(${record.executionRequestId}).`,
      );
    }

    if (record.executionEdgeContext.executionRequestId !== record.executionRequestId) {
      throw new Error(
        "Projection payload integrity violation: missing execution edge context coverage for outcome executionRequestId "
        + `(${record.executionRequestId}).`,
      );
    }
  });

}
