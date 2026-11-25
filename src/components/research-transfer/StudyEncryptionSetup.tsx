"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createAnalystKeyBackup } from "@/lib/research-transfer/crypto";
import { createClient } from "@/lib/supabase/client";

export function StudyEncryptionSetup({ studyId, userId }: { studyId: string; userId: string }) {
  const router = useRouter();
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);

  async function establishKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || registered) return;
    setBusy(true); setError("");
    try {
      if (passphrase !== confirmation) throw new Error("Recovery passphrases do not match.");
      const generated = await createAnalystKeyBackup(studyId, userId, passphrase);
      const { error: rpcError } = await createClient().rpc("register_research_transfer_key", {
        p_study_id: studyId, p_public_jwk: generated.publicJwk,
        p_wrapped_private_key: generated.wrappedPrivateKey, p_salt: generated.salt, p_iv: generated.iv,
      });
      if (rpcError) throw new Error(rpcError.message);
      setPassphrase(""); setConfirmation(""); setRegistered(true); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Encryption setup failed."); }
    finally { setBusy(false); }
  }
  if (registered) return <p role="status" className="text-sm">Encryption ready. Keep your recovery passphrase safe.</p>;
  return <div className="space-y-3">
    <p className="text-sm">Set up your Study encryption so the custodian can send files.</p>
    <p className="text-xs text-black/65 dark:text-white/65">Use a unique recovery passphrase. BlindStats cannot recover it or decrypt your files for you.</p>
    <form onSubmit={establishKey} className="flex max-w-lg flex-col gap-3">
      <label className="text-sm font-medium">Recovery passphrase (at least 16 characters)
        <input type="password" autoComplete="new-password" minLength={16} required value={passphrase}
          onChange={event => setPassphrase(event.target.value)}
          className="mt-1 block w-full rounded-lg border border-black/25 bg-transparent p-3 dark:border-white/25" />
      </label>
      <label className="text-sm font-medium">Confirm passphrase
        <input type="password" autoComplete="new-password" minLength={16} required value={confirmation}
          onChange={event => setConfirmation(event.target.value)}
          className="mt-1 block w-full rounded-lg border border-black/25 bg-transparent p-3 dark:border-white/25" />
      </label>
      <button type="submit" disabled={busy} className="rounded-lg bg-foreground px-4 py-3 font-medium text-background disabled:opacity-50">
        {busy ? "Setting up encryption…" : "Set up Study encryption"}
      </button>
    </form>
    {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
  </div>;
}
