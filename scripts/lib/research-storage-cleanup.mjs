const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reasons = {
  'blindstats-research-v1': ['incomplete_dataset', 'incomplete_research_file'],
  'blindstats-secret-v1': ['completed_secret', 'incomplete_secret'],
};

export function assertCandidate(row, transferId) {
  const path = typeof row?.storage_path === 'string' ? row.storage_path.split('/') : [];
  if (!row || row.eligible !== true || row.transfer_id !== transferId || !UUID.test(transferId) ||
      !Object.hasOwn(reasons, row.bucket_id) || !reasons[row.bucket_id].includes(row.reason) ||
      path.length !== 2 || !UUID.test(path[0]) || path[1] !== `${transferId}.bin` ||
      typeof row.object_present !== 'boolean') {
    throw new Error('Refusing invalid or ineligible cleanup candidate.');
  }
}

export async function cleanupOne(client, row, transferId, operatorLabel, syntheticImmediate = false) {
  assertCandidate(row, transferId);
  const { data: attempt, error: beginError } = await client.rpc('begin_research_storage_cleanup', {
    p_bucket_id: row.bucket_id, p_transfer_id: transferId,
    p_operator_label: operatorLabel, p_synthetic_immediate: syntheticImmediate,
  });
  if (beginError || typeof attempt !== 'string' || !UUID.test(attempt)) {
    throw new Error('Cleanup intent was not recorded; no deletion attempted.');
  }
  // Never SQL DELETE against storage.objects. If an interrupted run already
  // removed the object, the confirmation RPC will recheck actual absence.
  if (row.object_present) {
    const { error: removeError } = await client.storage.from(row.bucket_id).remove([row.storage_path]);
    if (removeError) throw new Error(`Storage removal failed; open audit attempt ${attempt}. Retry after review.`);
  }
  const { error: confirmError } = await client.rpc('confirm_research_storage_cleanup', {
    p_attempt_id: attempt, p_operator_label: operatorLabel,
  });
  if (confirmError) throw new Error(`Removal not confirmed; open audit attempt ${attempt}. Retry after review.`);
  return attempt;
}
