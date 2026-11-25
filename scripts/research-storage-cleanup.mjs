// Operator-only CLI. Default is a read-only inventory. One explicit transfer
// per apply. No browser route or scheduler. Production requires a separate
// explicit target and configuration; do not configure it before release approval.
import { readFileSync } from 'node:fs';
import { parseEnv, parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { cleanupOne } from './lib/research-storage-cleanup.mjs';

const DEV = 'kfrfemqoalzxwzecyjjf';
const PROD = 'nafujgfnylnvmmhpbpot';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, transfer: { type: 'string' },
    environment: { type: 'string', default: 'development' },
    confirm: { type: 'string' }, operator: { type: 'string' },
    'synthetic-immediate': { type: 'boolean', default: false },
  } });
  if (!['development', 'production'].includes(values.environment)) throw new Error('Expected development or production environment.');
  const development = values.environment === 'development';
  const target = development ? DEV : PROD;
  const label = values.environment.toUpperCase();
  if (!development && values['synthetic-immediate']) throw new Error('Synthetic immediate cleanup is DEVELOPMENT-only.');
  if (values.transfer && !UUID.test(values.transfer)) throw new Error('Invalid transfer UUID.');
  if (values['synthetic-immediate'] && !values.transfer) throw new Error('Synthetic test requires one explicit transfer UUID.');
  if (values.apply && (!values.transfer || values.confirm !== target || !values.operator?.trim() || values.operator.trim().length > 100)) {
    throw new Error('Apply requires --transfer UUID --confirm target-project-ref --operator label.');
  }
  const envFile = development ? '../.env.local' : '../.env.production.local';
  const env = parseEnv(readFileSync(new URL(envFile, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  if (env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') !== `https://${target}.supabase.co`) {
    throw new Error(`Refusing: configuration must target BlindStats ${label}.`);
  }
  if (development && readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim() !== DEV) {
    throw new Error('Refusing: CLI must be linked to BlindStats DEVELOPMENT.');
  }
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.startsWith('sb_publishable_')) throw new Error('Target server credential required.');
  const client = createClient(`https://${target}.supabase.co`, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.rpc('list_research_storage_cleanup', {
    p_transfer_id: values.transfer ?? null, p_synthetic_immediate: values['synthetic-immediate'],
  });
  if (error || !Array.isArray(data)) throw new Error('Unable to inventory target cleanup candidates.');
  console.log(`${label} ${values.apply ? 'APPLY' : 'DRY RUN'} — ${data.length} candidate/review record(s), maximum 100.`);
  console.table(data.map(({ bucket_id, transfer_id, reason, eligible, object_present, completion_at }) => ({ bucket_id, transfer_id, reason, eligible, object_present, completion_at })));
  if (!values.apply) return;
  if (data.length !== 1 || data[0].eligible !== true) throw new Error('Expected exactly one eligible transfer; no deletion attempted.');
  const attempt = await cleanupOne(client, data[0], values.transfer, values.operator.trim(), values['synthetic-immediate']);
  console.log(`${label} cleanup confirmed; audit attempt ${attempt}. Transfer and workflow records retained.`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Cleanup failed.'); process.exitCode = 1; });
