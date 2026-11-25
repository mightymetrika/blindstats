"use client";

import { StudyEncryptionSetup } from "./StudyEncryptionSetup";
import { StudyFilesChevron, studyFilesPanel, studyFilesSummary } from "./StudyFilesDisclosure";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";

import {
  decryptBlindedDataset, encryptBlindedDataset,
  type AnalystKeyBackup, type PublicKeyJwk, type TransferContext,
  type TransferEnvelope,
} from "@/lib/research-transfer/crypto";
import { MAX_TRANSFER_OBJECT_BYTES, transferStoragePath, uploadTransferObject } from "@/lib/research-transfer/storage";
import { sha256Hex } from "@/lib/blinding/hashing";
import { safeTransferCsvFilename } from "@/lib/research-transfer/filename";
import { createClient } from "@/lib/supabase/client";

type Transfer = {
  id: string;
  filename: string;
  sender_id: string;
  recipient_id: string;
  state: string;
  plaintext_sha256: string;
  ciphertext_sha256: string | null;
  ciphertext_byte_length: number | null;
  envelope: TransferEnvelope | { version: "v46-managed-atrest-1" } | null;
  transfer_mode: "recipient_e2ee_v1" | "managed_at_rest_v1";
  created_at: string;
  ready_at: string | null;
};

type Props = {
  studyId: string;
  workflowId: string;
  transformationId: string;
  expectedSha256: string;
  userId: string;
  role: "custodian" | "analyst";
  fileProtection: "managed_at_rest_v1" | "recipient_e2ee_v1";
  recipients: { userId: string; publicJwk: PublicKeyJwk | null }[];
  backup: Pick<AnalystKeyBackup, "wrappedPrivateKey" | "salt" | "iv"> | null;
  transfers: Transfer[];
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected transfer error.";
}

function saveCsv(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ResearchTransferWorkspace({
  studyId, workflowId, transformationId, expectedSha256, userId,
  role, recipients, backup, transfers, fileProtection,
}: Props) {
  const router = useRouter();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recipientId, setRecipientId] = useState(recipients[0]?.userId ?? "");
  const deliveryMode = fileProtection === "recipient_e2ee_v1" ? "e2ee" : "managed";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sendDataset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;
    let uploadStarted = false;
    setBusy(true); setError(""); setMessage("");
    try {
      const recipient = recipients.find((item) => item.userId === recipientId);
      if (!recipient) throw new Error("An assigned analyst is required.");
      const transferFilename = safeTransferCsvFilename(selectedFile.name);
      const plaintext = new Uint8Array(await selectedFile.arrayBuffer());
      if (!plaintext.length || plaintext.byteLength > MAX_TRANSFER_OBJECT_BYTES - (deliveryMode === "e2ee" ? 16 : 0)) {
        throw new Error("Select a nonempty CSV smaller than the 4 MiB transfer limit.");
      }
      // The exact bytes, not just the filename, must match the registered CSV.
      const computedHash = await sha256Hex(plaintext);
      if (computedHash !== expectedSha256) {
        throw new Error("This CSV does not match the blinded dataset registered in this Study.");
      }
      const supabase = createClient();
      const useE2ee = deliveryMode === "e2ee";
      if (useE2ee && !recipient.publicJwk) {
        throw new Error("This analyst has not enabled advanced recipient-key encryption.");
      }
      const context: TransferContext = {
        studyId, workflowId, transformationId, recipientId,
        plaintextSha256: expectedSha256,
      };
      const encrypted = useE2ee && recipient.publicJwk
        ? await encryptBlindedDataset(plaintext, recipient.publicJwk, context) : null;
      const bytesToStore = encrypted?.ciphertext ?? plaintext;
      const { data: transferId, error: initiationError } = await supabase.rpc(
        useE2ee ? "initiate_research_transfer" : "initiate_managed_research_transfer", {
          p_workflow_id: workflowId, p_recipient_id: recipientId,
          p_filename: transferFilename, p_plaintext_sha256: expectedSha256,
        },
      );
      if (initiationError || typeof transferId !== "string") {
        throw initiationError ?? new Error("Unable to initiate file transfer.");
      }
      uploadStarted = true;
      await uploadTransferObject(supabase, transferStoragePath(studyId, transferId), bytesToStore);
      const completion = encrypted
        ? await supabase.rpc("complete_research_transfer", {
            p_transfer_id: transferId,
            p_ciphertext_sha256: encrypted.ciphertextSha256,
            p_ciphertext_byte_length: encrypted.ciphertext.byteLength,
            p_envelope: encrypted.envelope,
          })
        : await supabase.rpc("complete_managed_research_transfer", {
            p_transfer_id: transferId, p_object_sha256: computedHash,
            p_object_byte_length: bytesToStore.byteLength,
          });
      if (completion.error) throw completion.error;
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      uploadStarted = false;
      setMessage("File sent to your analyst.");
      router.refresh();
    } catch (caught) {
      setError(uploadStarted
        ? `${describeError(caught)} Keep your file and contact the Study administrator about the pending transfer before retrying.`
        : describeError(caught));
      router.refresh();
    } finally { setBusy(false); }
  }

  async function retrieveDataset(transfer: Transfer) {
    if (!transfer.envelope || !transfer.ciphertext_sha256 ||
        !transfer.ciphertext_byte_length) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/research-transfers/${transfer.id}/download`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
      });
      if (!response.ok) throw new Error("Download unavailable or access denied.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== transfer.ciphertext_byte_length) {
        throw new Error("Downloaded file size differs from the registered transfer.");
      }
      const downloadedHash = await sha256Hex(bytes);
      if (downloadedHash !== transfer.ciphertext_sha256) {
        throw new Error("Downloaded file failed integrity verification.");
      }
      let plaintext: Uint8Array;
      if (transfer.transfer_mode === "managed_at_rest_v1") {
        if (transfer.envelope.version !== "v46-managed-atrest-1" ||
            downloadedHash !== transfer.plaintext_sha256) {
          throw new Error("Managed file integrity verification failed.");
        }
        plaintext = bytes;
      } else {
        if (!backup || transfer.envelope.version !== "v46-ecdh-hkdf-aes256gcm-1") {
          throw new Error("Recipient decryption key is unavailable.");
        }
        const context: TransferContext = {
          studyId, workflowId, transformationId, recipientId: userId,
          plaintextSha256: transfer.plaintext_sha256,
        };
        plaintext = await decryptBlindedDataset(
          bytes, transfer.ciphertext_sha256, transfer.envelope as TransferEnvelope,
          context, backup, userId, passphrase,
        );
      }
      const { error: acknowledgementError } = await createClient().rpc(
        "acknowledge_research_transfer", {
          p_transfer_id: transfer.id, p_plaintext_sha256: transfer.plaintext_sha256,
        },
      );
      if (acknowledgementError) throw acknowledgementError;
      saveCsv(plaintext, transfer.filename);
      setMessage("File downloaded and verified.");
      router.refresh();
    } catch (caught) { setError(describeError(caught)); }
    finally { setPassphrase(""); setBusy(false); }
  }

  const ownTransfers = transfers.filter((item) =>
    role === "custodian" ? item.sender_id === userId : item.recipient_id === userId);

  const readyTransfers = ownTransfers.filter((transfer) => transfer.state === "ready");

  const selectedRecipient = recipients.find((item) => item.userId === recipientId);
  const legacyReady = readyTransfers.some((item) => item.transfer_mode === "recipient_e2ee_v1");

  return (
    <div className="space-y-6">
      {message ? <p role="status" className="rounded-xl border border-black/15 p-4 text-sm dark:border-white/20">{message}</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-red-300 p-4 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

      {role === "custodian" ? (
        <section className="rounded-2xl border border-black/15 p-6 dark:border-white/20">
          <h2 className="text-xl font-semibold">Send blinded dataset</h2>
          {recipients.length ? (
            <form onSubmit={sendDataset} className="mt-5 flex max-w-xl flex-col gap-5">
              {recipients.length > 1 ? (
                <label className="text-sm font-medium">Send to
                  <select value={recipientId} onChange={(event) => setRecipientId(event.target.value)}
                    className="mt-2 block w-full rounded-lg border border-black/25 bg-background p-3 text-foreground dark:border-white/25">
                    {recipients.map((recipient, index) => (
                      <option key={recipient.userId} value={recipient.userId}>
                        Assigned analyst {index + 1} ({recipient.userId.slice(0, 8)}…)
                      </option>
                    ))}
                  </select>
                </label>
              ) : <p className="text-sm"><span className="font-medium">Recipient:</span> Assigned blinded analyst</p>}
              <div className="text-sm">
                <span className="font-medium">Blinded CSV</span>
                <input id={fileInputId} ref={fileInputRef} type="file" accept=".csv,text/csv" required
                  className="peer sr-only"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
                <div className="mt-2 flex flex-wrap items-center gap-3 peer-focus-visible:rounded-lg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                  <label htmlFor={fileInputId}
                    className="cursor-pointer rounded-lg border border-black/30 px-4 py-3 font-medium hover:bg-black/5 dark:border-white/30 dark:hover:bg-white/10">
                    Choose CSV file
                  </label>
                  <span className="max-w-full break-all text-black/70 dark:text-white/70">
                    {selectedFile ? selectedFile.name : "No file selected"}
                  </span>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <p className="font-medium">Delivery: {deliveryMode === "e2ee" ? "Recipient-only encryption" : "Managed storage (not end-to-end encrypted)"}</p>
                {deliveryMode === "e2ee" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p role="status" className="text-black/70 dark:text-white/70">{selectedRecipient?.publicJwk ? "Ready to send" : "Waiting for analyst encryption setup"}</p>
                    {!selectedRecipient?.publicJwk ? <button type="button" disabled={busy} onClick={() => router.refresh()} className="underline underline-offset-2">Refresh status</button> : null}
                  </div>
                ) : null}
              </div>
              <button type="submit" disabled={busy || !selectedFile ||
                  (deliveryMode === "e2ee" && !selectedRecipient?.publicJwk)}
                className="rounded-lg bg-foreground px-4 py-3 font-medium text-background disabled:opacity-50">
                {busy ? "Sending file…" : "Send file securely"}
              </button>
            </form>
          ) : (
            <div className="mt-5 rounded-xl border border-black/15 p-4 text-sm dark:border-white/20">
              <p className="font-medium">An analyst needs to be assigned to this Study.</p>
              <p className="mt-2 text-black/70 dark:text-white/70">Assign an analyst in the Study role settings.</p>
            </div>
          )}
        </section>
      ) : null}

      {role === "analyst" ? (
        <section className="rounded-2xl border border-black/15 p-6 dark:border-white/20">
          <h2 className="text-xl font-semibold">Files shared with you</h2>
          {readyTransfers.length ? (
            <>
              {legacyReady && backup ? (
                <label className="mt-5 block max-w-lg text-sm font-medium">Passphrase for recipient-encrypted files
                  <input type="password" autoComplete="off" value={passphrase}
                    onChange={(event) => setPassphrase(event.target.value)}
                    className="mt-2 block w-full rounded-lg border border-black/25 bg-transparent p-3 text-foreground dark:border-white/25" />
                </label>
              ) : null}
              <div className="mt-5 space-y-3">
                {readyTransfers.map((transfer) => (
                  <div key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm dark:border-white/20">
                    <div><span className="break-all font-medium">{transfer.filename}</span>
                      {transfer.transfer_mode !== fileProtection ? <p className="mt-1 text-xs text-black/65 dark:text-white/65">Previously sent using {transfer.transfer_mode === "managed_at_rest_v1" ? "managed storage (not end-to-end encrypted)" : "recipient-only encryption"}.</p> : null}
                    </div>
                    <button type="button" disabled={busy ||
                        (transfer.transfer_mode === "recipient_e2ee_v1" && (!backup || !passphrase))}
                      onClick={() => void retrieveDataset(transfer)}
                      className="rounded-lg bg-foreground px-4 py-3 font-medium text-background disabled:opacity-50">
                      {busy ? "Downloading…" : "Download file"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : <p className="mt-2 text-sm text-black/70 dark:text-white/70">
            No files yet.
          </p>}
        </section>
      ) : null}

      {role === "analyst" && deliveryMode === "e2ee" && !backup ? (
        <section className={studyFilesPanel}>
          <h2 className="mb-3 font-semibold">Study encryption</h2>
          <StudyEncryptionSetup studyId={studyId} userId={userId} />
        </section>
      ) : null}

      {role === "custodian" && ownTransfers.length ? (
        <section className="rounded-2xl border border-black/15 p-6 dark:border-white/20">
          <h2 className="text-lg font-semibold">Files sent</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {ownTransfers.map((transfer) => (
              <li key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 dark:border-white/20">
                <span className="break-all">{transfer.filename}</span>
                <span className="text-black/65 dark:text-white/65">
                  {transfer.state === "ready" ? "Ready for analyst" : "Upload pending"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ownTransfers.length > 0 ? (
        <details className={`group ${studyFilesPanel}`}>
          <summary className={studyFilesSummary}><StudyFilesChevron />File records and verification details</summary>
          <ul className="mt-4 space-y-3">
            {ownTransfers.map((transfer) => (
              <li key={transfer.id} className="rounded-lg border p-3 dark:border-white/20">
                <span className="font-medium">{transfer.filename}</span> — {transfer.state}
                <p className="mt-1 break-all font-mono text-xs">Transfer ID: {transfer.id}</p>
                <p className="mt-1 break-all font-mono text-xs">Registered SHA-256: {transfer.plaintext_sha256}</p>
                {transfer.ready_at ? <p className="mt-1 text-xs">Ready: {new Date(transfer.ready_at).toLocaleString()}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
