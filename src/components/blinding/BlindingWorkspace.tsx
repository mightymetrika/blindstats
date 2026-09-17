"use client";

import { useRouter } from "next/navigation";
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

const CATEGORY_PREVIEW_LIMIT = 8;

type WorkspaceError = {
  stage: "file" | "generation" | "registration";
  message: string;
};

export type BlindingRegistrationResult =
  | {
      ok: true;
      transformationRecordId: string;
    }
  | {
      ok: false;
      error: string;
    };

type BlindingRegistrationContext = {
  studyId: string;
  workflowId: string;
  planVersionNumber: number;
};

type BlindingWorkspaceProps = {
  registration?: BlindingRegistrationContext;
  registerAction?: (
    formData: FormData,
  ) => Promise<BlindingRegistrationResult>;
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

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
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

export function BlindingWorkspace({
  registration,
  registerAction,
}: BlindingWorkspaceProps = {}) {
  const router = useRouter();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [parsed, setParsed] = useState<ParsedCsvDataset | null>(null);
  const [selectedColumn, setSelectedColumn] = useState("");
  const [generation, setGeneration] = useState<BlindedPackage | null>(null);
  const [workspaceError, setWorkspaceError] = useState<WorkspaceError | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [custodyAcknowledged, setCustodyAcknowledged] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const registrationEnabled = Boolean(registration && registerAction);

  const selectedColumnInspection = useMemo(() => {
    if (!parsed || !selectedColumn) {
      return {
        categories: [] as string[],
        missingCount: 0,
      };
    }

    const values = parsed.rows.map((row) => row[selectedColumn]);

    return {
      categories: getDistinctNonmissingCategories(values),
      missingCount: values.filter((value) => value === null).length,
    };
  }, [parsed, selectedColumn]);

  const selectedCategories = selectedColumnInspection.categories;
  const categoryCount = selectedCategories.length;
  const missingCount = selectedColumnInspection.missingCount;
  const categoryPreview = selectedCategories.slice(0, CATEGORY_PREVIEW_LIMIT);
  const additionalCategoryCount = Math.max(
    categoryCount - categoryPreview.length,
    0,
  );
  const selectedColumnIsEligible =
    Boolean(parsed && selectedColumn) && categoryCount >= 2;
  const canGenerate =
    Boolean(sourceFile && sourceBytes && parsed) &&
    selectedColumnIsEligible &&
    !isGenerating;

  function resetGeneratedPackage(): void {
    setGeneration(null);
    setCustodyAcknowledged(false);
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

  function downloadUnblindingSecret(): void {
    if (!generation) {
      return;
    }

    downloadBytes(
      generation.secretArtifact.bytes,
      "unblinding-secret.json",
      "application/json;charset=utf-8",
    );
  }


  async function handleRegister(): Promise<void> {
    if (
      !registration ||
      !registerAction ||
      !generation ||
      !custodyAcknowledged ||
      isRegistering
    ) {
      return;
    }

    const formData = new FormData();

    formData.set("studyId", registration.studyId);
    formData.set("workflowId", registration.workflowId);
    formData.set(
      "publicReceiptBase64",
      bytesToBase64(generation.receiptArtifact.bytes),
    );
    formData.set("acknowledgeCustody", "on");

    setIsRegistering(true);
    setWorkspaceError(null);

    try {
      const result = await registerAction(formData);

      if (result.ok === false) {
        setWorkspaceError({
          stage: "registration",
          message: result.error,
        });
        return;
      }

      router.replace(
        `/studies/${registration.studyId}/blinding/${registration.workflowId}?blinded=1`,
      );
    } catch (error) {
      setWorkspaceError({
        stage: "registration",
        message: getErrorMessage(error),
      });
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <div
      className={
        registrationEnabled
          ? "mt-6 text-slate-950"
          : "min-h-screen bg-slate-50 text-slate-950"
      }
    >
      <div
        className={
          registrationEnabled
            ? "w-full"
            : "mx-auto w-full max-w-5xl px-6 py-10 sm:px-8 sm:py-14"
        }
      >
        {!registrationEnabled ? (
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
            blinded CSV with a public receipt and separate unblinding secret.
          </p>
          </header>
        ) : null}

        <section className="mb-8 rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <h2 className="text-sm font-semibold text-sky-950">
            Browser-local research files
          </h2>
          <p className="mt-2 text-sm leading-6 text-sky-900">
            {registrationEnabled
              ? "Source and blinded dataset contents and the unblinding secret stay in this browser session. Registration sends only the public receipt and safe transformation metadata to blindstats."
              : "Dataset contents and the generated unblinding secret are processed in this browser session. This standalone v0 workspace does not register workflow state or store research files on a server."}
          </p>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <StageHeading
              number={1}
              title="Select data"
              description="Choose one UTF-8, comma-delimited CSV file."
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
              description="Choose exactly one column to replace with randomized neutral group labels (Group_A, Group_B, …)."
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
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200">
                      {categoryCount.toLocaleString()} distinct nonmissing{" "}
                      {categoryCount === 1 ? "category" : "categories"}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200">
                      {missingCount.toLocaleString()} missing{" "}
                      {missingCount === 1 ? "cell" : "cells"}
                    </span>

                    {selectedColumnIsEligible ? (
                      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
                        Meets v0 requirements
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800">
                        At least 2 categories required
                      </span>
                    )}
                  </div>

                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Observed categories
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Previewed in first-observed source order.
                    </p>

                    {categoryPreview.length > 0 ? (
                      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                        {categoryPreview.map((category) => (
                          <li
                            key={category}
                            className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2"
                          >
                            <code className="block whitespace-pre-wrap break-all font-mono text-xs leading-5 text-slate-700">
                              {category}
                            </code>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-slate-600">
                        No nonmissing category values were found.
                      </p>
                    )}

                    {additionalCategoryCount > 0 ? (
                      <p className="mt-3 text-sm text-slate-600">
                        {additionalCategoryCount.toLocaleString()} additional{" "}
                        {additionalCategoryCount === 1
                          ? "category is"
                          : "categories are"}{" "}
                        not shown.
                      </p>
                    ) : null}

                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      Missing counts refer to empty CSV cells. Text values such
                      as NA or N/A remain observed categories.
                    </p>
                  </div>
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
              description="Create the blinded dataset and linked audit artifacts."
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
              description="Keep the unblinding secret separate from materials supplied to a blinded analyst."
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
                  Transformation metadata, artifact hashes, and the sealed
                  mapping.
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
                  Unblinding secret
                </h3>
                <p className="mt-2 text-sm leading-6 text-amber-900">
                  Cryptographic key used to decrypt the sealed mapping. Keep
                  it separate until unblinding is authorized.
                </p>
                <button
                  type="button"
                  onClick={downloadUnblindingSecret}
                  disabled={!generation}
                  className="mt-4 w-full rounded-lg bg-amber-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-900 disabled:cursor-not-allowed disabled:bg-amber-200"
                >
                  Download unblinding secret
                </button>
              </div>
            </div>
          </section>

          {registrationEnabled && registration ? (
            <section
              className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
                generation
                  ? "border-slate-200"
                  : "border-slate-200 opacity-60"
              }`}
            >
              <StageHeading
                number={5}
                title="Register blinding"
                description={`Bind this package to active BlindingPlan v${registration.planVersionNumber} and move the workflow from setup to blinded.`}
              />

              <div className="mt-6">
                <label className="flex max-w-3xl items-start gap-3 text-sm leading-6 text-slate-700">
                  <input
                    type="checkbox"
                    checked={custodyAcknowledged}
                    onChange={(event) =>
                      setCustodyAcknowledged(event.target.checked)
                    }
                    disabled={!generation || isRegistering}
                    className="mt-1"
                  />
                  <span>
                    I have saved the blinded CSV, public receipt, and unblinding
                    secret, and I understand that blindstats does not store the
                    unblinding secret.
                  </span>
                </label>

                <button
                  type="button"
                  onClick={handleRegister}
                  disabled={
                    !generation ||
                    !custodyAcknowledged ||
                    isRegistering
                  }
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isRegistering
                    ? "Registering..."
                    : "Register blinded package"}
                </button>

                {workspaceError?.stage === "registration" ? (
                  <p
                    className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                    role="alert"
                  >
                    {workspaceError.message}
                  </p>
                ) : null}

                <p className="mt-4 max-w-3xl text-xs leading-5 text-slate-500">
                  Registration stores the exact public receipt and safe artifact
                  metadata. It does not upload the source CSV, blinded CSV, or
                  unblinding secret.
                </p>
              </div>
            </section>
          ) : null}
        </div>

      </div>
    </div>
  );
}
