// Read-only verification of the exact November 26 synthetic Development fixtures.
// Never call this with real research data or a Production credential.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const DEV = 'kfrfemqoalzxwzecyjjf';
const BUCKET = 'blindstats-research-v1';
const OPERATOR = 'v47-development-validation';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const groups = [
  { mode: 'managed_at_rest_v1', abandoned: 'fb14afd1-e736-41b2-a8d7-8f5b16dcb615',
    attempt: 'a958e4f3-38f9-46ee-8c91-c7265f4dff7a', ready: [
      '4a36b5a3-94ea-40db-b8e1-23aa113b0f4b', 'd17e2163-e312-4344-a202-f78cd6f020f7',
      'ecb62d04-ec44-4244-b84f-dbb0eec40c01', '18c7108b-842a-4a0f-ab5e-80b62221aff3'] },
  { mode: 'recipient_e2ee_v1', abandoned: 'd4218ba1-6069-4a34-84db-35dc1e8c7067',
    attempt: 'ead778ed-4719-4c8b-b121-ff57203015ca', ready: [
      '5ed4168f-cfac-4392-ac89-11febe0a93e9', '0f35da9d-7fdd-414d-9bff-c6e4a01bf42c',
      '29ba1e6d-6a18-484e-9b55-52e66566953f', '55bfc5c9-5f0f-4cae-87cb-57ce18e69d6f'] },
];
function requireCheck(condition, message) { if (!condition) throw new Error(message); }
// Report only a safe provider error code, never response bodies, keys or credentials.
function checkQuery(error, label) {
  if (error) {
    const raw = String(error.code ?? error.statusCode ?? error.status ?? 'unknown');
    const code = /^[A-Za-z0-9_]{1,40}$/.test(raw) ? raw : 'unknown';
    throw new Error(`${label} failed (code ${code}).`);
  }
}
async function main() {
  requireCheck(process.argv.length === 2, 'No arguments accepted. Fixed synthetic Development fixtures only.');
  const env = parseEnv(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  requireCheck(env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') === `https://${DEV}.supabase.co`, 'Incorrect local Supabase URL.');
  requireCheck(readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim() === DEV, 'Incorrect linked project.');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  requireCheck(key && !key.startsWith('sb_publishable_'), 'Development server credential required.');
  const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  requireCheck(publicKey?.startsWith('sb_publishable_'), 'Development publishable key required.');
  const email = process.env.BLINDSTATS_VERIFY_A_EMAIL;
  const password = process.env.BLINDSTATS_VERIFY_A_PASSWORD;
  delete process.env.BLINDSTATS_VERIFY_A_EMAIL;
  delete process.env.BLINDSTATS_VERIFY_A_PASSWORD;
  requireCheck(email && password, 'Original synthetic custodian login required. Use the PowerShell launcher instructions.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  // The repository explicitly grants Study and transfer SELECT to authenticated
  // members, not to the operator role. Keep metadata reads under the sender's
  // existing RLS policy; reserve the operator key for audit and stored bytes.
  const operator = createClient(`https://${DEV}.supabase.co`, key, options);
  const custodian = createClient(`https://${DEV}.supabase.co`, publicKey, options);
  const login = await custodian.auth.signInWithPassword({ email, password });
  checkQuery(login.error, 'Synthetic custodian login');
  const senderId = login.data?.user?.id;
  requireCheck(UUID.test(senderId ?? ''), 'Missing authenticated custodian identity.');
  const bucket = operator.storage.from(BUCKET);
  console.log('PASS authenticated synthetic custodian; separate operator client configured.');
  async function rowFor(id, mode, purpose) {
    const { data: r, error } = await custodian.from('research_transfers')
      .select('id,study_id,sender_id,recipient_id,storage_path,state,transfer_mode,file_purpose,workflow_id,transformation_record_id,artifact_id,plaintext_sha256,plaintext_byte_length,ciphertext_sha256,ciphertext_byte_length,abandoned_at')
      .eq('id', id).single();
    checkQuery(error, `Transfer metadata read: ${id}`);
    requireCheck(r && r.id === id && UUID.test(r.study_id) && r.sender_id === senderId && UUID.test(r.recipient_id) && r.recipient_id !== senderId && r.storage_path === `${r.study_id}/${id}.bin` && r.transfer_mode === mode && r.file_purpose === purpose, `Transfer identity check failed: ${id}`);
    requireCheck(purpose === 'supporting' ? r.workflow_id === null && r.transformation_record_id === null && r.artifact_id === null : UUID.test(r.workflow_id ?? '') && UUID.test(r.transformation_record_id ?? '') && typeof r.artifact_id === 'string' && r.artifact_id.length > 0, `Transfer purpose identity mismatch: ${id}`);
    const study = await custodian.from('studies').select('name,file_protection,lifecycle').eq('id', r.study_id).single();
    checkQuery(study.error, `Synthetic Study metadata read: ${id}`);
    requireCheck(study.data?.name?.startsWith(`[INTEGRATION TEST] v47 multi-file delivery ${mode} `) && study.data.file_protection === mode && study.data.lifecycle === 'archived', `Refusing unexpected Study: ${id}`);
    return r;
  }
  let retained = 0, removed = 0;
  for (const group of groups) {
    const abandoned = await rowFor(group.abandoned, group.mode, 'supporting');
    requireCheck(abandoned.state === 'pending' && abandoned.abandoned_at, `Abandoned state not retained: ${group.abandoned}`);
    const audit = await operator.from('research_storage_cleanup_attempts')
      .select('id,bucket_id,transfer_id,storage_path,reason,operator_label,confirmed_at,confirmed_by_label').eq('id', group.attempt).single();
    const a = audit.data;
    checkQuery(audit.error, `Cleanup audit read: ${group.abandoned}`);
    requireCheck(a && a.id === group.attempt && a.bucket_id === BUCKET && a.transfer_id === group.abandoned && a.storage_path === abandoned.storage_path && a.reason === 'incomplete_research_file' && a.operator_label === OPERATOR && a.confirmed_at && a.confirmed_by_label === OPERATOR, `Cleanup audit mismatch: ${group.abandoned}`);
    const inventory = await bucket.list(abandoned.study_id, { search: `${group.abandoned}.bin`, limit: 100 });
    checkQuery(inventory.error, `Storage inventory: ${group.abandoned}`);
    requireCheck(Array.isArray(inventory.data) && inventory.data.length < 100 && !inventory.data.some(o => o.name === `${group.abandoned}.bin`), `Unable to establish object absence: ${group.abandoned}`);
    console.log(`PASS removed object absent and audit retained: ${group.abandoned} (${group.mode})`); removed++;
    for (const [index, id] of group.ready.entries()) {
      const r = await rowFor(id, group.mode, index < 2 ? 'supporting' : 'package_dataset');
      requireCheck(r.study_id === abandoned.study_id && r.recipient_id === abandoned.recipient_id && r.state === 'ready' && !r.abandoned_at && HASH.test(r.plaintext_sha256) && HASH.test(r.ciphertext_sha256) && Number.isInteger(r.plaintext_byte_length) && r.plaintext_byte_length > 0 && Number.isInteger(r.ciphertext_byte_length) && r.ciphertext_byte_length > 0 && r.ciphertext_byte_length <= 4194304 && r.ciphertext_byte_length === r.plaintext_byte_length + (group.mode === 'recipient_e2ee_v1' ? 16 : 0), `Ready metadata mismatch: ${id}`);
      if (group.mode === 'managed_at_rest_v1') requireCheck(r.plaintext_sha256 === r.ciphertext_sha256, `Managed plaintext commitment mismatch: ${id}`);
      const { data, error } = await bucket.download(r.storage_path);
      checkQuery(error, `Retained object download: ${id}`);
      requireCheck(data, `Retained object unavailable: ${id}`);
      const bytes = Buffer.from(await data.arrayBuffer());
      requireCheck(bytes.length === r.ciphertext_byte_length && createHash('sha256').update(bytes).digest('hex') === r.ciphertext_sha256, `Retained object integrity mismatch: ${id}`);
      console.log(`PASS retained object SHA-256 and size: ${id} (${group.mode})`); retained++;
    }
  }
  requireCheck(retained === 8 && removed === 2, 'Incomplete verification.');
  console.log('V47 STORAGE ACCEPTANCE PASSED: 8/8 retained objects, 2/2 removed objects and confirmed audit records.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Verification failed.'); process.exitCode = 1; });
