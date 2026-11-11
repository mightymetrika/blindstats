import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { submitResearcherFeedback } from "./actions";

type FeedbackPageProps = {
  searchParams: Promise<{ status?: string }>;
};

const inputStyle =
  "mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

export default async function FeedbackPage({ searchParams }: FeedbackPageProps) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");

  const { status } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-black/60 dark:text-white/60">blindstats</span>
        <Link className="text-sm underline underline-offset-4" href="/studies">My Studies</Link>
      </div>
      <h1 className="mt-4 text-2xl font-semibold">Researcher feedback</h1>
      <p className="mt-2 text-sm text-black/65 dark:text-white/65">
        Tell us what worked, what was difficult, and what you would add to blindstats.
        You can skip optional questions.
      </p>
      <p className="mt-3 text-xs text-black/55 dark:text-white/55">
        Your response is stored with your signed-in account and submission date;
        other researchers cannot view it. Do not include research data, passwords,
        unblinding secrets, or other sensitive information. Contact the organizer
        through your invitation email about deletion or privacy questions.
      </p>

      {status === "thanks" ? (
        <section className="mt-6 rounded-xl border border-black/15 p-5 dark:border-white/20" role="status">
          <h2 className="font-semibold">Thank you for your feedback.</h2>
          <p className="mt-2 text-sm">Your response was received. If you also complete the other exercise, you may send another response.</p>
          <Link className="mt-4 inline-block text-sm font-medium underline underline-offset-4" href="/feedback">Submit another response</Link>
        </section>
      ) : (
        <>
          {status === "invalid" ? (
            <p className="mt-5 rounded-lg border border-black/15 p-3 text-sm dark:border-white/20" role="alert">Please check your answers and try again.</p>
          ) : null}
          {status === "unavailable" ? (
            <p className="mt-5 rounded-lg border border-black/15 p-3 text-sm dark:border-white/20" role="alert">Your feedback could not be saved. Please try again later.</p>
          ) : null}
          <form action={submitResearcherFeedback} className="mt-6 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium" htmlFor="test_role">Your exercise and role</label>
                <select className={inputStyle} id="test_role" name="test_role" defaultValue="" required>
                  <option value="" disabled>Select one</option>
                  <option value="paired_custodian">Paired — custodian</option>
                  <option value="paired_analyst">Paired — analyst</option>
                  <option value="single">Single-person exercise</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="completion">Did you finish?</label>
                <select className={inputStyle} id="completion" name="completion" defaultValue="" required>
                  <option value="" disabled>Select one</option>
                  <option value="independent">Yes, independently</option>
                  <option value="with_help">Yes, with help</option>
                  <option value="partial">Partly</option>
                  <option value="not_completed">No</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="ease_rating">How easy was it? <span className="font-normal text-black/50 dark:text-white/50">(optional)</span></label>
              <select className={inputStyle} id="ease_rating" name="ease_rating" defaultValue="">
                <option value="">Skip</option>
                <option value="1">1 — Very difficult</option>
                <option value="2">2</option><option value="3">3</option><option value="4">4</option>
                <option value="5">5 — Very easy</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="difficulties">What was confusing or difficult?</label>
              <textarea className={inputStyle} id="difficulties" name="difficulties" rows={2} maxLength={1200} placeholder="Where did you get stuck, or what should change?" />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="blinding_improvements">What blinding features would you add?</label>
              <textarea className={inputStyle} id="blinding_improvements" name="blinding_improvements" rows={2} maxLength={1200} placeholder="What would be most useful?" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium" htmlFor="transfer_usefulness">Temporary secure file transfer?</label>
                <select className={inputStyle} id="transfer_usefulness" name="transfer_usefulness" defaultValue="">
                  <option value="">Skip</option>
                  <option value="no">Not useful</option>
                  <option value="somewhat">Somewhat useful</option>
                  <option value="very">Very useful</option>
                  <option value="unsure">Unsure</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="transfer_controls">Which transfer controls matter?</label>
                <input className={inputStyle} id="transfer_controls" name="transfer_controls" maxLength={600} placeholder="E.g., expiry, one download, revocation" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="rms_priorities">Top priorities for a broader research management system?</label>
              <textarea className={inputStyle} id="rms_priorities" name="rms_priorities" rows={2} maxLength={1200} placeholder="E.g., data collection, randomization, recruitment, collaboration" />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="other_feedback">Anything else? <span className="font-normal text-black/50 dark:text-white/50">(optional)</span></label>
              <textarea className={inputStyle} id="other_feedback" name="other_feedback" rows={2} maxLength={1000} />
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input className="mt-1" type="checkbox" name="follow_up" />
              I&apos;m open to a follow-up conversation.
            </label>
            <button className="rounded-lg bg-foreground px-5 py-2 text-sm font-medium text-background" type="submit">Submit feedback</button>
          </form>
        </>
      )}
    </main>
  );
}
