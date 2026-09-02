"use client";

import {
  useMemo,
  useState,
  type ChangeEvent,
} from "react";

import {
  createBlindedPackage,
  type BlindedPackage,
} from "@/lib/blinding/blinding-package";
import {
  parseCsvBytes,
  type ParsedCsvDataset,
} from "@/lib/blinding/csv";
import { getDistinctNonmissingCategories } from "@/lib/blinding/mapping";

type WorkspaceError = {
  stage: "file" | "generation";
  message: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

function sourceBaseName(filename: string): string {
  return filename.replace(/\.csv$/i, "");
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

function HashValue({ value }: { value: string }) {
  return (
    <code className="mt-1 block break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs leading-5 text-slate-700">
      {value}
    </code>
  );
}

export function BlindingWorkspace() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [parsed, setParsed] = useState<ParsedCsvDataset | null>(null);
  const [selectedColumn, setSelectedColumn] = useState("");
  const [generation, setGeneration] = useState<BlindedPackage | null>(null);
  const [workspaceError, setWorkspaceError] = useState<WorkspaceError | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);

  const selectedCategories = useMemo(() => {
    if (!parsed || !selectedColumn) {
      return [];
    }

    return getDistinctNonmissingCategories(
      parsed.rows.map((row) => row[selectedColumn]),
    );
  }, [parsed, selectedColumn]);

  const categoryCount = selectedCategories.length;
  const selectedColumnIsEligible =
    Boolean(parsed && selectedColumn) && categoryCount >= 2;
  const canGenerate =
    Boolean(sourceFile && sourceBytes && parsed) &&
    selectedColumnIsEligible &&
    !isGenerating;

  function resetGeneratedPackage(): void {
    setGeneration(null);
  }

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0] ?? null;

    setSourceFile(null);
    setSourceBytes(null);
    setParsed(null);
    setSelectedColumn("");
    resetGeneratedPackage();
    setWorkspaceError(null);

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setWorkspaceError({
        stage: "file",
        message: "Blinding Workspace v0 accepts .csv files only.",
      });
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsedDataset = parseCsvBytes(bytes);

      setSourceFile(file);
      setSourceBytes(bytes);
      setParsed(parsedDataset);
    } catch (error) {
      setWorkspaceError({
        stage: "file",
        message: getErrorMessage(error),
      });
    }
  }

  function handleColumnChange(
    event: ChangeEvent<HTMLSelectElement>,
  ): void {
    setSelectedColumn(event.target.value);
    resetGeneratedPackage();
    setWorkspaceError(null);
  }

  async function handleGenerate(): Promise<void> {
    if (!sourceBytes || !selectedColumnIsEligible) {
      return;
    }

    setIsGenerating(true);
    resetGeneratedPackage();
    setWorkspaceError(null);

    try {
      const result = await createBlindedPackage(
        sourceBytes,
        selectedColumn,
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

  function downloadBlindedCsv(): void {
    if (!generation || !sourceFile) {
      return;
    }

    downloadBytes(
      generation.blinded.bytes,
      `${sourceBaseName(sourceFile.name)}_blinded.csv`,
      "text/csv;charset=utf-8",
    );
  }

  function downloadReceipt(): void {
    if (!generation) {
      return;
    }

    downloadBytes(
      generation.receiptArtifact.bytes,
      "blinding-receipt.json",
      "application/json;charset=utf-8",
    );
  }

  function downloadPrivateKey(): void {
    if (!generation) {
      return;
    }

    downloadBytes(
      generation.keyArtifact.bytes,
      "blinding-key.json",
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
              Blinding Workspace v0
            </span>
          </div>

          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Create an auditable blinded dataset locally in your browser.
          </h1>

          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Select a CSV, choose one categorical variable, and generate a
            blinded CSV with a public receipt and separate private blinding key.
          </p>
        </header>

        <section className="mb-8 rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <h2 className="text-sm font-semibold text-sky-950">
            Local-processing prototype
          </h2>
          <p className="mt-2 text-sm leading-6 text-sky-900">
            Dataset contents and the generated private key are processed in
            this browser session. This v0 workspace does not yet provide
            accounts, role-based separation, cloud storage, or controls
            appropriate for sensitive or regulated research data.
          </p>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <StageHeading
              number={1}
              title="Select data"
              description="Choose one UTF-8, comma-delimited CSV file. The file is parsed locally before you continue."
            />

            <div className="mt-6">
              <label
                htmlFor="source-file"
                className="block text-sm font-medium text-slate-800"
              >
                Source CSV
              </label>
              <input
                id="source-file"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
              />

              {workspaceError?.stage === "file" ? (
                <p
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {workspaceError.message}
                </p>
              ) : null}

              {sourceFile && parsed ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      File
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                      {sourceFile.name}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Rows
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {parsed.rows.length.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Columns
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {parsed.columns.length.toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              parsed
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={2}
              title="Select variable"
              description="Choose exactly one column to replace with randomized neutral Group_* labels."
            />

            <div className="mt-6">
              <label
                htmlFor="blinding-column"
                className="block text-sm font-medium text-slate-800"
              >
                Column to blind
              </label>
              <select
                id="blinding-column"
                value={selectedColumn}
                onChange={handleColumnChange}
                disabled={!parsed}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                <option value="">Select a column</option>
                {parsed?.columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>

              {selectedColumn ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700">
                    {categoryCount.toLocaleString()} distinct nonmissing{" "}
                    {categoryCount === 1 ? "category" : "categories"}
                  </span>

                  {selectedColumnIsEligible ? (
                    <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
                      Eligible for blinding
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800">
                      At least 2 categories required
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              selectedColumnIsEligible
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={3}
              title="Generate blinded package"
              description="Create a new randomized mapping, blinded dataset, and linked audit artifacts from the original uploaded bytes."
            />

            <div className="mt-6">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isGenerating
                  ? "Generating..."
                  : "Generate blinded package"}
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
                    Blinded package created successfully.
                  </p>

                  <dl className="mt-4 space-y-4">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Transformation ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-sm text-emerald-950">
                        {generation.receipt.transformationId}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Source SHA-256
                      </dt>
                      <dd>
                        <HashValue value={generation.source.sha256} />
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Blinded SHA-256
                      </dt>
                      <dd>
                        <HashValue value={generation.blinded.sha256} />
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              generation
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={4}
              title="Download artifacts"
              description="Keep the private blinding key separate from materials supplied to a blinded analyst."
            />

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">
                  Blinded CSV
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  The transformed dataset containing neutral labels in the
                  selected column.
                </p>
                <button
                  type="button"
                  onClick={downloadBlindedCsv}
                  disabled={!generation}
                  className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  Download blinded CSV
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">
                  Public receipt
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Shareable transformation metadata and hashes without the
                  private mapping.
                </p>
                <button
                  type="button"
                  onClick={downloadReceipt}
                  disabled={!generation}
                  className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  Download receipt
                </button>
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-950">
                  Private blinding key
                </h3>
                <p className="mt-2 text-sm leading-6 text-amber-900">
                  Contains the true category mapping. Do not provide this file
                  to the blinded analyst.
                </p>
                <button
                  type="button"
                  onClick={downloadPrivateKey}
                  disabled={!generation}
                  className="mt-4 w-full rounded-lg bg-amber-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-900 disabled:cursor-not-allowed disabled:bg-amber-200"
                >
                  Download private key
                </button>
              </div>
            </div>
          </section>
        </div>

        <footer className="mt-8 text-center text-xs leading-5 text-slate-500">
          Blinding Workspace v0 is an early single-user prototype. The private
          mapping is intentionally not displayed in the ordinary workspace.
        </footer>
      </div>
    </main>
  );
}
