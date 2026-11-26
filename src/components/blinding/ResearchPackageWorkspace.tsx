"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { adapterForFilename } from "@/lib/datasets/formats";
import { type ResearchDataset } from "@/lib/datasets/types";
import { createDatasetPackage, type DatasetInput } from "@/lib/blinding/package-v05/package";
import { type MappingGroupInput } from "@/lib/blinding/package-v05/mappings";
import { createResearchAnalysisLock, supportedBlindingReference } from "@/lib/blinding/package-v05/legacy-lock";
import { verifyLockedArtifacts } from "@/lib/blinding/package-v05/analysis-lock";
import { verifyBlindedPackage } from "@/lib/blinding/package-v05/receipt";
import { sha256Hex } from "@/lib/blinding/hashing";

type Loaded = DatasetInput & { filename: string; dataset: ResearchDataset };
type Generated = Awaited<ReturnType<typeof createDatasetPackage>>;
const buttonClass = "rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-40";
const sectionClass = "space-y-4 rounded-xl border border-slate-200 p-5";
const message = (e: unknown) => e instanceof Error ? e.message : "Operation failed.";
const read = async (file: File) => new Uint8Array(await file.arrayBuffer());
const readFiles = (files: File[]) => Promise.all(files.map(async (file) => ({ filename: file.name, bytes: await read(file) })));
function download(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: "application/octet-stream" }));
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  // Keep the object URL alive until the browser has begun the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function FilePicker({ label, onChange, accept, multiple = false, disabled }: { label: string; onChange: (files: File[]) => void; accept?: string; multiple?: boolean; disabled: boolean }) {
  return <label className="block text-sm font-medium">{label}<input className="mt-2 block w-full text-sm" type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={(e) => onChange(Array.from(e.currentTarget.files ?? []))}/></label>;
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className={sectionClass}><h2 className="text-lg font-semibold">{title}</h2>{children}</section>;
}
type Registration = { studyId: string; workflowId: string; registerAction: (formData: FormData) => Promise<{ok: true; transformationRecordId: string} | {ok: false; error: string}> };
function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function ResearchPackageWorkspace({ registration }: { registration?: Registration } = {}) {
  const router = useRouter();
  const [custody, setCustody] = useState(false);
  const [stage, setStage] = useState<"blind" | "lock" | "verify">("blind");
  const [sources, setSources] = useState<Loaded[]>([]);
  // Empty means unselected; unique default group per variable. Reusing an
  // existing group is an explicit action; names never determine membership.
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Generated | null>(null);
  const [ack, setAck] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [lock, setLock] = useState<File | null>(null);
  const [lockResult, setLockResult] = useState<Awaited<ReturnType<typeof createResearchAnalysisLock>> | null>(null);
  const [verification, setVerification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = new Map<string, MappingGroupInput>();
  for (const source of sources) for (const variable of source.dataset.variables) {
    const id = `${source.datasetId}:${variable.id}`;
    const group = assignments[id];
    if (!group) continue;
    const existing = groups.get(group) ?? { members: [] };
    existing.members.push({ datasetId: source.datasetId, variableId: variable.id });
    groups.set(group, existing);
  }
  const allSelected = sources.length > 0 && sources.every((s) => [...groups.values()].some((g) => g.members.some((m) => m.datasetId === s.datasetId)));
  const groupOptions = sources.flatMap((s) => s.dataset.variables.map((v) => ({ id: `${s.datasetId}:${v.id}`, label: `${s.datasetId} · ${s.filename}: ${v.name}` })));
  function resetOutput() { setCustody(false); setResult(null); setAck(false); setLockResult(null); setVerification(null); setError(null); }
  async function run(operation: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await operation(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  function load(files: File[]) {
    setSources([]); setAssignments({}); resetOutput();
    void run(async () => {
      if (files.length > 20 || files.reduce((sum, f) => sum + f.size, 0) > 64 * 1024 * 1024) throw new Error("Select at most 20 datasets totaling 64 MiB in this local workspace.");
      const loaded: Loaded[] = [];
      for (const [i, file] of files.entries()) {
        const adapter = adapterForFilename(file.name), bytes = await read(file);
        loaded.push({ datasetId: `d${i + 1}`, filename: file.name, adapter, bytes, dataset: await adapter.parse(bytes) });
      }
      setSources(loaded);
    });
  }
  return <div className="space-y-5">
    {!registration && <div className="flex flex-wrap gap-2" aria-label="Local research package operation">
      {([['blind','Create package'],['lock','Lock analysis'],['verify','Verify files']] as const).map(([value,label]) => <button key={value} type="button" disabled={busy} aria-pressed={stage === value} className={`${buttonClass} ${stage === value ? "bg-slate-950 text-white" : ""}`} onClick={() => { setStage(value); setSources([]); setAssignments({}); setReceipt(null); setFiles([]); setLock(null); resetOutput(); }}>{label}</button>)}
    </div>}
    {stage === "blind" ? <Panel title="Select and blind datasets">
      <FilePicker label="Research datasets (CSV, TSV, XLSX)" accept=".csv,.tsv,.xlsx" multiple disabled={busy} onChange={load}/>
      {sources.map((source) => <fieldset key={source.datasetId} disabled={busy} className="space-y-2 rounded-lg border p-3">
        <legend className="font-medium">{source.datasetId} · {source.filename}</legend>
        <p className="text-xs">{source.dataset.rows.length} observations · {source.dataset.variables.length} variables</p>
        {source.dataset.variables.map((v) => {
          const id = `${source.datasetId}:${v.id}`;
          return <div className="flex flex-wrap items-center gap-3" key={id}>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(assignments[id])} onChange={(e) => { const selected = e.currentTarget.checked; resetOutput(); setAssignments((old) => ({ ...old, [id]: selected ? id : "" })); }}/>{v.name}</label>
            {assignments[id] && <select aria-label={`Mapping group for ${source.datasetId} · ${source.filename}: ${v.name}`} className="max-w-full rounded border p-1 text-sm" value={assignments[id]} onChange={(e) => { const group = e.currentTarget.value; resetOutput(); setAssignments((old) => ({ ...old, [id]: group })); }}>
              <option value={id}>Independent group ({v.name})</option>
              {groupOptions.filter((o) => o.id !== id && (groups.has(o.id) || assignments[id] === o.id)).map((o) => <option key={o.id} value={o.id}>Link to {o.label}</option>)}
            </select>}
          </div>;
        })}
      </fieldset>)}
      {sources.length > 0 && <p className="text-sm">Select at least one variable per dataset. Only link variables using the same original coding and cell type. Identically named variables remain independent by default.</p>}
      {groups.size > 0 && <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={ack} onChange={(e) => setAck(e.currentTarget.checked)}/>I have checked the selected variables, coding compatibility and disclosure risks.</label>}
      <button type="button" className={buttonClass} disabled={busy || !allSelected || !ack} onClick={() => { setResult(null); setCustody(false); void run(async () => { const generated = await createDatasetPackage(sources, [...groups.values()]); if (registration && generated.receiptArtifact.bytes.byteLength > 524288) throw new Error("Registered package receipt exceeds 512 KiB. Select fewer variables or categories."); setResult(generated); }); }}>Generate package</button>
      {result && <div className="space-y-3 rounded-lg border p-4">
        <p className="text-sm font-medium">Package generated. Save each blinded dataset and the public receipt. Keep the secret separate and under custodian control; do not share it with blinded analysts.</p>
        {result.files.map((f) => <button key={f.datasetId} type="button" className={`${buttonClass} mr-2`} onClick={() => download(f.bytes, f.filename)}>{f.filename}</button>)}
        <button type="button" className={`${buttonClass} mr-2`} onClick={() => download(result.receiptArtifact.bytes, "blinding-package-receipt.json")}>Public receipt</button>
        <button type="button" className={buttonClass} onClick={() => download(result.secretArtifact.bytes, "unblinding-secret.json")}>Custodian secret — private</button>
        <p className="break-all text-xs">Manifest SHA-256: {result.receipt.manifestSha256}</p>
        {registration && <div className="space-y-2">
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={custody} disabled={busy} onChange={(e) => setCustody(e.currentTarget.checked)}/>I saved all blinded files and the public receipt, and saved the secret separately under custodian control.</label>
          <button type="button" className={buttonClass} disabled={!custody || busy} onClick={() => void run(async () => {
            const data = new FormData(); data.set("studyId", registration.studyId); data.set("workflowId", registration.workflowId);
            data.set("publicReceiptBase64", bytesToBase64(result.receiptArtifact.bytes)); data.set("acknowledgeCustody", "on");
            const registered = await registration.registerAction(data);
            if (!registered.ok) throw new Error(registered.error);
            router.replace(`/studies/${registration.studyId}/blinding/${registration.workflowId}?blinded=1`);
          })}>Register blinded package</button>
        </div>}
      </div>}
    </Panel> : <Panel title={stage === "lock" ? "Lock analysis artifacts locally" : "Verify exact file set"}>
      <FilePicker key={`${stage}-receipt`} label="Public blinding receipt" accept=".json" disabled={busy} onChange={(f) => { resetOutput(); setReceipt(f[0] ?? null); }}/>
      {stage === "verify" && <FilePicker label="Analysis lock receipt (optional; omit to verify blinded package)" accept=".json" disabled={busy} onChange={(f) => { resetOutput(); setLock(f[0] ?? null); }}/>}
      <FilePicker key={`${stage}-files`} label={stage === "lock" || lock ? "Analysis artifacts" : "Blinded datasets"} multiple disabled={busy} onChange={(f) => { resetOutput(); setFiles(f); }}/>
      <p className="text-sm">{files.length} files selected. File bytes remain in this browser. Receipt metadata includes artifact filenames, sizes and hashes.</p>
      <button type="button" className={buttonClass} disabled={busy || !receipt || !files.length} onClick={() => {
        if (!receipt) return;
        resetOutput();
        void run(async () => {
          const bytes = await read(receipt), selected = await readFiles(files);
          if (stage === "lock") setLockResult(await createResearchAnalysisLock(bytes, selected));
          else {
            if (lock) await verifyLockedArtifacts(await read(lock), selected, await supportedBlindingReference(bytes));
            else await verifyBlindedPackage(bytes, selected);
            setVerification(`Exact file set matches the supplied receipt. Public receipt SHA-256: ${await sha256Hex(bytes)}. This does not establish registered Study provenance.`);
          }
        });
      }}>{stage === "lock" ? "Create analysis lock" : "Verify files"}</button>
      {lockResult && <div className="space-y-2"><p className="text-sm">{lockResult.receipt.analysisArtifacts.length} artifacts committed to one local lock.</p><button type="button" className={buttonClass} onClick={() => download(lockResult.receiptArtifact.bytes, "analysis-lock-receipt.json")}>Download lock receipt</button></div>}
      {verification && <p role="status" className="break-all text-sm">{verification}</p>}
    </Panel>}
    {busy && <p role="status" className="text-sm">Processing local files…</p>}
    {error && <p role="alert" className="rounded-lg border border-red-300 p-3 text-sm text-red-700">{error}</p>}
  </div>;
}


/** Verify local files against the exact registered public receipt. */
export function RegisteredPackageVerification({ receiptBase64, receiptSha256, lock }: { receiptBase64: string; receiptSha256: string; lock?: { receiptBase64: string; receiptSha256: string } }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bytes = () => Uint8Array.from(atob(receiptBase64), (c) => c.charCodeAt(0));
  const lockBytes = () => Uint8Array.from(atob(lock?.receiptBase64 ?? ""), (c) => c.charCodeAt(0));
  return <div className="mt-5 space-y-3">
    <button type="button" className={buttonClass} onClick={() => lock ? download(lockBytes(), "analysis-lock-receipt.json") : download(bytes(), "blinding-package-receipt.json")}>{lock ? "Download registered lock receipt" : "Download registered public receipt"}</button>
    <FilePicker label={lock ? "Verify locked analysis files" : "Verify blinded dataset files"} multiple disabled={busy} onChange={(selected) => { setFiles(selected); setStatus(null); setError(null); }}/>
    <button type="button" className={buttonClass} disabled={busy || !files.length} onClick={async () => {
      setBusy(true); setStatus(null); setError(null);
      try {
        const receipt = bytes();
        if (await sha256Hex(receipt) !== receiptSha256) throw new Error("Registered receipt hash mismatch.");
        if (lock) {
          const lockArtifact = lockBytes();
          if (await sha256Hex(lockArtifact) !== lock.receiptSha256) throw new Error("Registered lock receipt hash mismatch.");
          await verifyLockedArtifacts(lockArtifact, await readFiles(files), await supportedBlindingReference(receipt));
          setStatus("All analysis files match the registered lock.");
        } else {
          await verifyBlindedPackage(receipt, await readFiles(files));
          setStatus("All blinded files match the registered package.");
        }
      } catch (e) { setError(message(e)); } finally { setBusy(false); }
    }}>Verify exact file set</button>
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
