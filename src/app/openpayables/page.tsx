import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SignOutButton } from "@/components/SignOutButton";
import { resolveOpenPayablesPilotAccess } from "@/lib/openpayables/access";
import { getOpenPayablesReader } from "@/lib/openpayables/reader";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ offset?: string }> };

function safeOffset(value: string | undefined): number {
  if (!value || !/^(0|[1-9][0-9]{0,6})$/.test(value)) return 0;
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset <= 1000000 ? offset : 0;
}

export default async function OpenPayablesPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");

  const access = resolveOpenPayablesPilotAccess(
    data.claims.sub, process.env.OPENPAYABLES_PILOT_ACCESS_JSON, process.env.VERCEL_ENV,
  );
  if (!access) notFound();

  const { offset: rawOffset } = await searchParams;
  const offset = safeOffset(rawOffset);
  let overview: Awaited<ReturnType<ReturnType<typeof getOpenPayablesReader>["projectOverview"]>> | null = null;
  let evidence: Awaited<ReturnType<ReturnType<typeof getOpenPayablesReader>["pendingEvidence"]>> | null = null;
  let contributor: Awaited<ReturnType<ReturnType<typeof getOpenPayablesReader>["contributorView"]>> | null = null;
  let unavailable = false;

  try {
    // Project ID and contributor ID are resolved exclusively from server-side configuration.
    // The browser supplies neither identity; the only optional input is pagination offset.
    const reader = getOpenPayablesReader();
    const [managerData, queueData, personalData] = await Promise.all([
      access.manager ? reader.projectOverview(access.projectId) : Promise.resolve(null),
      access.manager ? reader.pendingEvidence(access.projectId, offset) : Promise.resolve(null),
      access.contributorId ? reader.contributorView(access.projectId, access.contributorId) : Promise.resolve(null),
    ]);
    overview = managerData;
    evidence = queueData;
    contributor = personalData;
  } catch (caught) {
    // Never display raw connection strings, database errors or privileged SQL details.
    console.error("[blindstats] OpenPayables read-only pilot failed", caught instanceof Error ? caught.name : "unknown error");
    unavailable = true;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <Link className="text-sm underline underline-offset-4" href="/studies">Back to Studies</Link>
          <h1 className="mt-5 text-3xl font-semibold">OpenPayables</h1>
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">Read-only project pilot · TEST-mode information only</p>
        </div>
        <SignOutButton />
      </header>

      {unavailable ? (
        <section className="mt-8 rounded-2xl border border-black/15 p-6 dark:border-white/20">
          <h2 className="font-semibold">Pilot data unavailable</h2>
          <p className="mt-2 text-sm text-black/65 dark:text-white/65">Check the server-only OpenPayables connection and access configuration. No data was changed.</p>
        </section>
      ) : null}

      {overview && evidence ? (
        <section className="mt-8 space-y-6">
          <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
            <h2 className="text-xl font-semibold">{overview.projectName} · Manager view</h2>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">Project: {overview.projectId}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-black/5 p-4 dark:bg-white/10"><p className="text-xs">Contributors</p><p className="text-2xl font-semibold">{overview.contributorCount}</p></div>
              <div className="rounded-lg bg-black/5 p-4 dark:bg-white/10"><p className="text-xs">Total credits</p><p className="text-2xl font-semibold">{overview.totalPoints}</p></div>
              <div className="rounded-lg bg-black/5 p-4 dark:bg-white/10"><p className="text-xs">Unapproved evidence</p><p className="text-2xl font-semibold">{overview.pendingEvidenceCount}</p></div>
            </div>
            <h3 className="mt-6 font-semibold">Contributor balances</h3>
            {overview.balances.length === 0 ? <p className="mt-2 text-sm">No contributors enrolled.</p> : (
              <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-black/15 dark:border-white/15"><th className="py-2">Contributor</th><th className="py-2">ID</th><th className="py-2 text-right">Credits</th></tr></thead>
                <tbody>{overview.balances.map((b) => <tr className="border-b border-black/10 dark:border-white/10" key={b.contributorId}><td className="py-2">{b.displayName}</td><td className="py-2">{b.contributorId}</td><td className="py-2 text-right">{b.points}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>
          <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
            <h2 className="text-xl font-semibold">Pending GitHub evidence</h2>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">Existing evidence only. No reviews, approvals or credits can be changed here.</p>
            {evidence.pending.length === 0 ? <p className="mt-4 text-sm">No pending evidence on this page.</p> : (
              <div className="mt-3 space-y-3">{evidence.pending.map((item) => (
                <div className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/15" key={`${item.githubRepoId}:${item.candidateKey}`}>
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-black/60 dark:text-white/60">{item.repository} · PR #{item.pullNumber} · {item.kind}</p>
                  <p className="mt-1 text-black/60 dark:text-white/60">GitHub: {item.githubLogin} · Identity: {item.identityStatus}</p>
                </div>
              ))}</div>
            )}
            <div className="mt-5 flex items-center gap-4 text-sm">
              {offset > 0 ? <Link className="underline" href={`/openpayables?offset=${Math.max(0, offset - 50)}`}>Previous</Link> : null}
              {evidence.hasMore && evidence.nextOffset !== null ? <Link className="underline" href={`/openpayables?offset=${evidence.nextOffset}`}>Next</Link> : null}
              <span className="text-black/50 dark:text-white/50">Offset {offset}</span>
            </div>
          </div>
        </section>
      ) : null}

      {contributor ? (
        <section className="mt-8 space-y-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
          <h2 className="text-xl font-semibold">My contributor view</h2>
          <p className="text-sm text-black/60 dark:text-white/60">{contributor.displayName} · {contributor.contributorId} · {contributor.points} credits</p>
          <h3 className="font-semibold">Recent credit events</h3>
          {contributor.recentCredits.length === 0 ? <p className="text-sm">No credit events.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2">Category</th><th>Change</th><th>Reason</th></tr></thead><tbody>{contributor.recentCredits.map((event) => <tr className="border-t border-black/10 dark:border-white/10" key={event.id}><td className="py-2">{event.category}</td><td>{event.pointsDelta}</td><td>{event.reason}</td></tr>)}</tbody></table></div>
          )}
          <h3 className="font-semibold">Advisory governance</h3>
          {contributor.voting.length === 0 ? <p className="text-sm">No proposal voting records.</p> : (
            <div className="space-y-2">{contributor.voting.map((vote) => <p className="text-sm" key={vote.proposalId}>{vote.title} · {vote.status} · Weight {vote.weight} · Vote {vote.choice ?? "not cast"}</p>)}</div>
          )}
          <h3 className="font-semibold">Approved TEST allocations</h3>
          {contributor.testDistributions.length === 0 ? <p className="text-sm">No approved TEST allocations.</p> : (
            <div className="space-y-2">{contributor.testDistributions.map((entry) => <p className="text-sm" key={entry.periodId}>{entry.label} · {(entry.amountCents / 100).toFixed(2)} USD TEST · {entry.status}</p>)}</div>
          )}
          <p className="rounded-lg bg-black/5 p-3 text-xs dark:bg-white/10">{contributor.paymentNotice}</p>
        </section>
      ) : null}
    </main>
  );
}
