"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sendAuthorizedSecret, type SecretTransferContext, type SecretTransferRecord } from "@/lib/research-transfer/secret-transfer";
import type { PublicKeyJwk } from "@/lib/research-transfer/crypto";

export function UnblindingSecretSend({ context, publicReceiptBase64, record, publicKey, requireRecipientOnly }: {
  context: SecretTransferContext; publicReceiptBase64: string; record: SecretTransferRecord | null;
  publicKey: PublicKeyJwk | null; requireRecipientOnly: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      if (file.size > 16384) throw new Error("Choose a valid unblinding secret JSON file (maximum 16 KiB).");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const receipt = Uint8Array.from(atob(publicReceiptBase64), c => c.charCodeAt(0));
      await sendAuthorizedSecret(createClient(), bytes, receipt, context, publicKey, requireRecipientOnly);
      setFile(null); setSent(true); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to send the secret."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 rounded-2xl border border-black/15 p-6 dark:border-white/20">
    <h2 className="text-lg font-semibold">Send unblinding secret</h2>
    <p className="mt-2 text-xs text-black/60 dark:text-white/60">Keep your local secret. The shared copy is eligible for removal 24 hours after registered unblinding completion.</p>
    {record?.ready_at || sent ? <p className="mt-3 text-sm">Secret available to the authorized analyst.</p> : (
      <form onSubmit={send} className="mt-4 flex max-w-lg flex-col gap-4">
        <label className="text-sm font-medium">Unblinding secret
          <input type="file" accept=".json,application/json" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-black/20 file:bg-transparent file:px-4 file:py-3 file:text-foreground" />
        </label>
        <p className="text-sm">{requireRecipientOnly ? "Delivery: Recipient-only encryption" : "Delivery: Managed storage (not end-to-end encrypted)"}</p>
        {(requireRecipientOnly) && !publicKey ? <p role="alert" className="text-sm text-red-700">The analyst must set up recipient-only encryption first.</p> : null}
        {record && !record.ready_at ? <p className="text-sm">A previous upload is pending. Retain the local secret; contact the operator if retry fails.</p> : null}
        <button type="submit" disabled={!file || busy || ((requireRecipientOnly) && !publicKey)} className="rounded-lg bg-foreground px-4 py-3 font-medium text-background disabled:opacity-50">{busy ? "Sending…" : "Send secret"}</button>
      </form>
    )}
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
  </section>;
}
