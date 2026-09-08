"use client";

import { useState, type ChangeEvent } from "react";

import {
  createAnalysisLockPackage,
  type AnalysisLockPackage,
} from "@/lib/blinding/analysis-lock";

type WorkspaceError = {
  stage: "receipt" | "blinded" | "analysis" | "generation";
  message: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): void {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);

  const blob = new Blob([stableBytes.buffer], {
    type: mimeType,
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function StageHeading({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
        {number}
      </div>
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function FileSummary({
  file,
  label,
}: {
  file: File;
  label: string;
}) {
  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 break-all text-sm font-semibold text-slate-900">
        {file.name}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {file.size.toLocaleString()} {file.size === 1 ? "byte" : "bytes"}
      </p>
    </div>
  );
}

function HashValue({ value }: { value: string }) {
  return (
    <code className="mt-1 block break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs leading-5 text-slate-700">
      {value}
    </code>
  );
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function AnalysisLockWorkspace() {
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptBytes, setReceiptBytes] = useState<Uint8Array | null>(null);
  const [blindedFile, setBlindedFile] = useState<File | null>(null);
  const [blindedBytes, setBlindedBytes] = useState<Uint8Array | null>(null);
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [analysisBytes, setAnalysisBytes] = useState<Uint8Array | null>(null);
  const [generation, setGeneration] = useState<AnalysisLockPackage | null>(null);
  const [workspaceError, setWorkspaceError] = useState<WorkspaceError | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);

  const canGenerate =
    Boolean(
      receiptFile &&
        receiptBytes &&
        blindedFile &&
        blindedBytes &&
        analysisFile &&
        analysisBytes,
    ) && !isGenerating;

  function invalidateGeneration(): void {
    setGeneration(null);
    setWorkspaceError(null);
  }

  async function handleReceiptChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0] ?? null;

    setReceiptFile(null);
    setReceiptBytes(null);
    invalidateGeneration();

    if (!file) {
      return;
    }

    try {
      const bytes = await readFileBytes(file);
      setReceiptFile(file);
      setReceiptBytes(bytes);
    } catch (error) {
      setWorkspaceError({
        stage: "receipt",
        message: getErrorMessage(error),
      });
    }
  }

  async function handleBlindedChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0] ?? null;

    setBlindedFile(null);
    setBlindedBytes(null);
    invalidateGeneration();

    if (!file) {
      return;
    }

    try {
      const bytes = await readFileBytes(file);
      setBlindedFile(file);
      setBlindedBytes(bytes);
    } catch (error) {
      setWorkspaceError({
        stage: "blinded",
        message: getErrorMessage(error),
      });
    }
  }

  async function handleAnalysisChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0] ?? null;

    setAnalysisFile(null);
    setAnalysisBytes(null);
    invalidateGeneration();

    if (!file) {
      return;
    }

    try {
      const bytes = await readFileBytes(file);
      setAnalysisFile(file);
      setAnalysisBytes(bytes);
    } catch (error) {
      setWorkspaceError({
        stage: "analysis",
        message: getErrorMessage(error),
      });
    }
  }

  async function handleGenerate(): Promise<void> {
    if (
      !receiptBytes ||
      !blindedBytes ||
      !analysisFile ||
      !analysisBytes
    ) {
      return;
    }

    setIsGenerating(true);
    setGeneration(null);
    setWorkspaceError(null);

    try {
      const result = await createAnalysisLockPackage(
        receiptBytes,
        blindedBytes,
        {
          filename: analysisFile.name,
          bytes: analysisBytes,
        },
      );

      setGeneration(result);
    } catch (error) {
      setWorkspaceError({
        stage: "generation",
        message: getErrorMessage(error),
      });
    } finally {
      setIsGenerating(false);
    }
  }

  function downloadReceipt(): void {
    if (!generation) {
      return;
    }

    downloadBytes(
      generation.receiptArtifact.bytes,
      "analysis-lock-receipt.json",
      "application/json;charset=utf-8",
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-8 sm:py-14">
        <header className="mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold tracking-wide text-slate-500">
              blindstats
            </p>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
              Analysis Lock v0
            </span>
          </div>

          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Lock an exact analysis artifact before unblinding.
          </h1>

          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Supply the public blinding receipt, the exact blinded dataset used
            for analysis, and the analysis artifact you want to identify as the
            pre-unblinding version.
          </p>
        </header>

        <section className="mb-8 rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <h2 className="text-sm font-semibold text-sky-950">
            Browser-local analysis lock
          </h2>
          <p className="mt-2 text-sm leading-6 text-sky-900">
            These files are processed in this browser session. blindstats
            verifies the blinded dataset against its public receipt and hashes
            the exact analysis-file bytes. The lock documents the artifact
            relationship; it does not make a local file immutable.
          </p>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <StageHeading
              number={1}
              title="Select public blinding receipt"
              description="Choose the exact public receipt that accompanied the blinded dataset."
            />

            <div className="mt-6">
              <label
                htmlFor="lock-blinding-receipt"
                className="block text-sm font-medium text-slate-800"
              >
                Public blinding receipt
              </label>
              <input
                id="lock-blinding-receipt"
                type="file"
                accept=".json,application/json"
                onChange={handleReceiptChange}
                className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
              />

              {workspaceError?.stage === "receipt" ? (
                <p
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {workspaceError.message}
                </p>
              ) : null}

              {receiptFile ? (
                <FileSummary file={receiptFile} label="Receipt file" />
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              receiptBytes
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={2}
              title="Select blinded dataset"
              description="Choose the exact blinded CSV supplied for the analysis. Its SHA-256 must match the public receipt."
            />

            <div className="mt-6">
              <label
                htmlFor="lock-blinded-dataset"
                className="block text-sm font-medium text-slate-800"
              >
                Blinded CSV
              </label>
              <input
                id="lock-blinded-dataset"
                type="file"
                accept=".csv,text/csv"
                onChange={handleBlindedChange}
                className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
              />

              {workspaceError?.stage === "blinded" ? (
                <p
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {workspaceError.message}
                </p>
              ) : null}

              {blindedFile ? (
                <FileSummary file={blindedFile} label="Blinded dataset" />
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              receiptBytes && blindedBytes
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={3}
              title="Select analysis artifact"
              description="Choose one nonempty file representing the analysis version you are declaring locked before unblinding."
            />

            <div className="mt-6">
              <label
                htmlFor="lock-analysis-artifact"
                className="block text-sm font-medium text-slate-800"
              >
                Analysis artifact
              </label>
              <input
                id="lock-analysis-artifact"
                type="file"
                onChange={handleAnalysisChange}
                className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
              />

              <p className="mt-2 text-xs leading-5 text-slate-500">
                The file may be a manuscript, report, script, notebook, archive,
                or another research artifact. blindstats does not execute or
                interpret its contents.
              </p>

              {workspaceError?.stage === "analysis" ? (
                <p
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {workspaceError.message}
                </p>
              ) : null}

              {analysisFile ? (
                <FileSummary file={analysisFile} label="Analysis artifact" />
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              receiptBytes && blindedBytes && analysisBytes
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={4}
              title="Verify and create analysis lock"
              description="Verify the artifact chain, identify the exact analysis bytes, and create the downloadable analysis-lock receipt."
            />

            <div className="mt-6">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isGenerating
                  ? "Creating analysis lock..."
                  : "Create analysis lock"}
              </button>

              {workspaceError?.stage === "generation" ? (
                <p
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {workspaceError.message}
                </p>
              ) : null}

              {generation ? (
                <div
                  className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5"
                  aria-live="polite"
                >
                  <p className="text-sm font-semibold text-emerald-900">
                    Analysis lock created successfully.
                  </p>

                  <dl className="mt-4 space-y-4">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Lock ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-sm text-emerald-950">
                        {generation.receipt.lockId}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Transformation ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-sm text-emerald-950">
                        {generation.receipt.blinding.transformationId}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Blinded SHA-256
                      </dt>
                      <dd>
                        <HashValue
                          value={
                            generation.receipt.blinding
                              .blindedArtifactSha256
                          }
                        />
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Analysis artifact
                      </dt>
                      <dd className="mt-1 break-all text-sm font-semibold text-emerald-950">
                        {generation.receipt.analysisArtifact.filename}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Analysis SHA-256
                      </dt>
                      <dd>
                        <HashValue
                          value={generation.receipt.analysisArtifact.sha256}
                        />
                      </dd>
                    </div>
                  </dl>

                  <button
                    type="button"
                    onClick={downloadReceipt}
                    className="mt-5 rounded-lg bg-emerald-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-900"
                  >
                    Download analysis-lock receipt
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-5 block rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-400"
                >
                  Download analysis-lock receipt
                </button>
              )}
            </div>
          </section>
        </div>

        <footer className="mt-8 text-center text-xs leading-5 text-slate-500">
          Analysis Lock v0 records exact artifact hashes and their relationship
          within the file-mediated blinded-analysis workflow.
        </footer>
      </div>
    </main>
  );
}
