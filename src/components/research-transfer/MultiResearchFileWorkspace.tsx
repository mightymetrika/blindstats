"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { type AnalystKeyBackup, type PublicKeyJwk } from "@/lib/research-transfer/crypto";
import { MAX_BATCH_FILES, SUPPORTING_FILE_ACCEPT, prepareResearchFile, retrieveResearchFile, sendResearchFile,
  type FileProtection, type FilePurpose, type PackageDelivery, type ResearchFileRecord } from "@/lib/research-transfer/research-files";
import { MAX_TRANSFER_OBJECT_BYTES } from "@/lib/research-transfer/storage";
import { StudyEncryptionSetup } from "./StudyEncryptionSetup";

type Props = {
  studyId: string; userId: string; role: "custodian" | "analyst"; fileProtection: FileProtection;
  packageDelivery: PackageDelivery | null; canSend: boolean;
  recipients: { userId: string; publicJwk: PublicKeyJwk | null }[];
  backup: Pick<AnalystKeyBackup, "wrappedPrivateKey" | "salt" | "iv"> | null;
  transfers: ResearchFileRecord[];
};
type FileResult = { filename: string; status: "sent" | "already sent" | "failed"; detail?: string };
const control = "mt-2 block w-full rounded-lg border border-black/25 bg-background p-3 text-foreground dark:border-white/25";
const action = "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50";
const panel = "rounded-2xl border border-black/15 p-5 dark:border-white/20";
function saveFile(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "application/octet-stream" }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function messageOf(error: unknown) { return error instanceof Error ? error.message : "Unexpected research file error."; }

export function MultiResearchFileWorkspace({ studyId, userId, role, fileProtection, packageDelivery, canSend, recipients, backup, transfers }: Props) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [recipientId, setRecipientId] = useState(recipients[0]?.userId ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FileResult[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const purpose: FilePurpose = packageDelivery ? "package_dataset" : "supporting";
  const recipient = recipients.find((item) => item.userId === recipientId);
  const strict = fileProtection === "recipient_e2ee_v1";
  const own = transfers.filter((item) => item.file_purpose === purpose && (role === "custodian" ? item.sender_id === userId : item.recipient_id === userId));
  const ready = own.filter((item) => item.state === "ready" && !item.abandoned_at);
  const selectedRecipientReady = ready.filter((item) => role === "analyst" || item.recipient_id === recipientId);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canSend || !recipient || (strict && !recipient.publicJwk) || !files.length || (!packageDelivery && !reviewed)) return;
    if (files.length > MAX_BATCH_FILES || new Set(files.map((file) => file.name)).size !== files.length) {
      setError("Select at most 20 files with distinct filenames per send."); return;
    }
    setBusy(true); setError(""); setNotice(""); setResults([]);
    const delivery = { studyId, recipientId, protection: fileProtection, packageDelivery };
    const completed: FileResult[] = [];
    try {
      const supabase = createClient();
      for (const file of files) {
        try {
          if (!file.size || file.size > MAX_TRANSFER_OBJECT_BYTES - (strict ? 16 : 0)) throw new Error("File is empty or exceeds the 4 MiB stored-object limit.");
          const prepared = await prepareResearchFile(file.name, new Uint8Array(await file.arrayBuffer()), purpose, fileProtection, packageDelivery);
          if (selectedRecipientReady.some((item) => item.filename === prepared.filename && item.plaintext_sha256 === prepared.sha256 && item.artifact_id === prepared.artifactId)) {
            completed.push({ filename: file.name, status: "already sent" });
          } else {
            await sendResearchFile(supabase, delivery, prepared, recipient.publicJwk);
            completed.push({ filename: file.name, status: "sent" });
          }
        } catch (caught) { completed.push({ filename: file.name, status: "failed", detail: messageOf(caught) }); }
        setResults([...completed]);
      }
      const failed = completed.filter((item) => item.status === "failed");
      if (failed.length) {
        setNotice("Other successful files remain available. Review failed or pending files, then select them again to retry.");
      } else setNotice("All selected files are available to the assigned analyst.");
      setFiles([]); setReviewed(false);
      if (inputRef.current) inputRef.current.value = "";
    } catch (caught) { setError(messageOf(caught)); }
    finally { setBusy(false); router.refresh(); }
  }

  async function abandon(record: ResearchFileRecord) {
    if (busy) return;
    if (!window.confirm("Abandon this pending send? Any stored object will remain for audited operator cleanup. You can select the local file again for a new send.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await createClient().rpc("abandon_research_file", { p_transfer_id: record.id });
      if (result.error) throw new Error(result.error.message);
      setNotice("Pending send abandoned. Select the file again to retry.");
    } catch (caught) { setError(messageOf(caught)); }
    finally { setBusy(false); router.refresh(); }
  }

  async function download(record: ResearchFileRecord) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const bytes = await retrieveResearchFile(createClient(), record,
        { studyId, recipientId: userId, protection: fileProtection, packageDelivery }, backup, passphrase);
      saveFile(bytes, record.filename);
      setNotice("File downloaded and verified.");
    } catch (caught) { setError(messageOf(caught)); }
    finally { setPassphrase(""); setBusy(false); router.refresh(); }
  }

  return <div className="space-y-6">
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {role === "analyst" && strict && !backup && <section className={panel}><StudyEncryptionSetup studyId={studyId} userId={userId}/></section>}
    {role === "custodian" && <section className={panel}>
      <h2 className="text-xl font-semibold">{packageDelivery ? "Send blinded datasets" : "Send supporting research files"}</h2>
      <p className="mt-2 text-sm">Delivery: {strict ? "Recipient-only encryption" : "Managed storage (not end-to-end encrypted)"}. Up to 20 files per send; 4 MiB per stored object.</p>
      {!canSend ? <p className="mt-3 text-sm">New sends are unavailable for this Study or workflow state.</p> : !recipients.length ? <p className="mt-3 text-sm">Assign a blinded analyst before sending.</p> :
        <form onSubmit={send} className="mt-4 max-w-xl space-y-4">
          {recipients.length > 1 && <label className="block text-sm font-medium">Send to
            <select disabled={busy} value={recipientId} onChange={(event) => { setRecipientId(event.target.value); setResults([]); }} className={control}>
              {recipients.map((item) => <option key={item.userId} value={item.userId}>{item.userId.slice(0, 8)}…{strict && !item.publicJwk ? " (encryption not ready)" : ""}</option>)}
            </select></label>}
          {strict && !recipient?.publicJwk && <p className="text-sm">Waiting for analyst encryption setup.</p>}
          <label htmlFor={inputId} className="block text-sm font-medium">{packageDelivery ? "Choose registered blinded files" : "Choose supporting files"}</label>
          <input ref={inputRef} id={inputId} type="file" multiple accept={packageDelivery ? ".csv,.tsv,.xlsx" : SUPPORTING_FILE_ACCEPT} disabled={busy} className="block max-w-full text-sm"
            onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setReviewed(false); setResults([]); setError(""); }}/>
          {files.length > 0 && <p className="break-words text-sm">{files.length} selected: {files.map((file) => file.name).join(", ")}</p>}
          {!packageDelivery && <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={reviewed} onChange={(event) => setReviewed(event.target.checked)}/>
            <span>I checked that these files and filenames are appropriate for the blinded analyst and contain no unblinding secrets or information revealing the assignments.</span></label>}
          {!packageDelivery && <p className="text-xs text-black/60 dark:text-white/60">Supporting files are shared as-is, not transformed or de-identified. Known secret JSON files are blocked locally; arbitrary content cannot be reliably screened.</p>}
          <button type="submit" disabled={busy || !recipient || strict && !recipient.publicJwk || !files.length || files.length > MAX_BATCH_FILES || !packageDelivery && !reviewed} className={action}>{busy ? "Working…" : "Send files securely"}</button>
        </form>}
      {results.length > 0 && <ul aria-label="Send results" className="mt-4 space-y-2 text-sm">{results.map((item) => <li key={item.filename} className="break-words"><strong>{item.filename}</strong> — {item.status}{item.detail ? `: ${item.detail}` : ""}</li>)}</ul>}
    </section>}
    {packageDelivery && <section className={panel}>
      <h2 className="font-semibold">Registered package files</h2>
      <p className="mt-2 text-sm">{packageDelivery.datasets.filter((d) => selectedRecipientReady.some((item) => item.artifact_id === d.datasetId && item.filename === d.blinded.filename && item.plaintext_sha256 === d.blinded.sha256 && item.plaintext_byte_length === d.blinded.byteLength)).length} of {packageDelivery.datasets.length} files ready{role === "custodian" ? " for selected recipient" : " for you"}.</p>
      <ul className="mt-3 space-y-2 text-sm">{packageDelivery.datasets.map((dataset) => <li key={dataset.datasetId} className="break-words">{dataset.blinded.filename} ({dataset.blinded.byteLength.toLocaleString()} bytes)</li>)}</ul>
      <p className="mt-3 text-xs text-black/60 dark:text-white/60">Verify the complete downloaded file set on the blinding workflow page. Individual ready files can be downloaded before all files are sent.</p>
    </section>}
    <section className={panel}>
      <h2 className="text-lg font-semibold">{role === "custodian" ? "Sent files and pending sends" : "Files shared with you"}</h2>
      {role === "analyst" && ready.some((item) => item.transfer_mode === "recipient_e2ee_v1") && backup && <label className="mt-3 block max-w-lg text-sm font-medium">Recovery passphrase
        <input type="password" value={passphrase} autoComplete="current-password" disabled={busy} onChange={(event) => setPassphrase(event.target.value)} className={control}/></label>}
      {!own.length ? <p className="mt-2 text-sm">No files yet.</p> : <ul className="mt-3 divide-y divide-black/10 dark:divide-white/15">{own.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 text-sm"><p className="break-words font-medium">{item.filename}</p>
          <p className="text-xs text-black/60 dark:text-white/60">{item.abandoned_at ? "Abandoned — operator cleanup" : item.state} · {item.plaintext_byte_length.toLocaleString()} bytes · {new Date(item.created_at).toLocaleString()}{role === "custodian" ? ` · recipient ${item.recipient_id.slice(0, 8)}…` : ""}</p></div>
        {role === "analyst" && item.state === "ready" && <button type="button" disabled={busy || item.transfer_mode === "recipient_e2ee_v1" && (!backup || !passphrase)} onClick={() => download(item)} className={action}>Download file</button>}
        {role === "custodian" && item.state === "pending" && !item.abandoned_at && <button type="button" disabled={busy} onClick={() => abandon(item)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Abandon pending send</button>}
      </li>)}</ul>}
    </section>
  </div>;
}
