import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupOne } from './research-storage-cleanup.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const study = '22222222-2222-4222-8222-222222222222';
const attempt = '33333333-3333-4333-8333-333333333333';
const candidate = { bucket_id: 'blindstats-secret-v1', transfer_id: id,
  storage_path: `${study}/${id}.bin`, reason: 'completed_secret', eligible: true, object_present: true };
function mock(fail = '') {
  const calls = [];
  const client = { async rpc(name, args) {
    calls.push([name, args]);
    return { data: name.startsWith('begin') ? attempt : null, error: fail === name ? {} : null };
  }, storage: { from(bucket) { return { async remove(paths) {
    calls.push(['remove', bucket, paths]); return { error: fail === 'remove' ? {} : null };
  } }; } } };
  return { calls, client };
}
test('records intent then removes one exact path then confirms', async () => {
  const { client, calls } = mock();
  assert.equal(await cleanupOne(client, candidate, id, 'operator'), attempt);
  assert.deepEqual(calls.map(c => c[0]), ['begin_research_storage_cleanup','remove','confirm_research_storage_cleanup']);
  assert.deepEqual(calls[1], ['remove',candidate.bucket_id,[candidate.storage_path]]);
  assert.equal(calls[2][1].p_attempt_id, attempt);
});
test('refuses ineligible, ready dataset, wrong ID or substituted path', async () => {
  const { client, calls } = mock();
  for (const row of [{...candidate,eligible:false}, {...candidate,bucket_id:'blindstats-research-v1'},
    {...candidate,transfer_id:study}, {...candidate,storage_path:`${study}/${study}.bin`},
    {...candidate,bucket_id:'other'}, {...candidate,storage_path:`../${id}.bin`}]) {
    await assert.rejects(cleanupOne(client,row,id,'operator'));
  }
  assert.equal(calls.length,0);
});
test('failed intent does not remove', async () => {
  const { client, calls } = mock('begin_research_storage_cleanup');
  await assert.rejects(cleanupOne(client,candidate,id,'operator'));
  assert.equal(calls.length,1);
});
test('failed Storage operation does not falsely confirm', async () => {
  const { client, calls } = mock('remove');
  await assert.rejects(cleanupOne(client,candidate,id,'operator'));
  assert.equal(calls.length,2);
});
test('failed confirmation reports open attempt', async () => {
  const { client, calls } = mock('confirm_research_storage_cleanup');
  await assert.rejects(cleanupOne(client,candidate,id,'operator'), /open audit attempt/);
  assert.equal(calls.length,3);
});
test('retry after interrupted removal confirms even when inventory says absent', async () => {
  const { client, calls } = mock();
  assert.equal(await cleanupOne(client,{...candidate,object_present:false},id,'operator',true),attempt);
  assert.equal(calls[0][1].p_synthetic_immediate,true);
  assert.deepEqual(calls.map(c => c[0]), ['begin_research_storage_cleanup','confirm_research_storage_cleanup']);
});
test('accepts only an eligible incomplete v47 research file with exact path', async () => {
  const { client, calls } = mock();
  const file = {...candidate,bucket_id:'blindstats-research-v1',reason:'incomplete_research_file'};
  await assert.rejects(cleanupOne(client,{...file,eligible:false},id,'operator'));
  assert.equal(calls.length,0);
  assert.equal(await cleanupOne(client,file,id,'operator'),attempt);
  assert.deepEqual(calls[1],['remove',file.bucket_id,[file.storage_path]]);
});
