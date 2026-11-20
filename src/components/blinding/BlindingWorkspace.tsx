"use client";

import { useRouter } from "next/navigation";
import {
  useMemo,
  useState,
  type ChangeEvent,
} from "react";

import {
  parseCsvBytes,
  type ParsedCsvDataset,
} from "@/lib/blinding/csv";
import { getDistinctNonmissingCategories } from "@/lib/blinding/mapping";
import {
  createMultiBlindedPackage,
  type MultiBlindedPackage,
} from "@/lib/blinding/multi-blinding";

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
  const [additionalColumns, setAdditionalColumns] = useState<string[]>([]);
  const [generation, setGeneration] = useState<MultiBlindedPackage | null>(null);
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
  const eligibleAdditionalColumns = useMemo(() => {
    if (!parsed || !selectedColumn) return [];
    return parsed.columns.filter((column) =>
      column !== selectedColumn &&
      getDistinctNonmissingCategories(parsed.rows.map((row) => row[column])).length >= 2,
    );
  }, [parsed, selectedColumn]);
  const selectedColumnIsEligible =
    Boolean(parsed && selectedColumn) && categoryCount >= 2;
  const selectedColumns = parsed
    ? parsed.columns.filter((column) =>
        column === selectedColumn || additionalColumns.includes(column),
      )
    : [];
  const selectedColumnPreviews = useMemo(() => {
    if (!parsed || !selectedColumn) return [];

    return parsed.columns
      .filter((column) => column === selectedColumn || additionalColumns.includes(column))
      .map((column) => {
        const values = parsed.rows.map((row) => row[column]);
        const categories = getDistinctNonmissingCategories(values);
        return {
          column,
          categoryCount: categories.length,
          missingCount: values.filter((value) => value === null).length,
          preview: categories.slice(0, CATEGORY_PREVIEW_LIMIT),
          hiddenCategoryCount: Math.max(categories.length - CATEGORY_PREVIEW_LIMIT, 0),
        };
      });
  }, [parsed, selectedColumn, additionalColumns]);
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
    setAdditionalColumns([]);
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
    const next = event.target.value;
    setSelectedColumn(next);
    setAdditionalColumns((previous) => previous.filter((column) => column !== next));
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
      const result = await createMultiBlindedPackage(sourceBytes, selectedColumns);

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
              Create a blinded dataset.
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
              Select a CSV and one or more categorical variables to blind.
            </p>
          </header>
        ) : null}

        <section className="mb-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <p className="text-sm text-sky-950">
            <span className="font-semibold">Browser-local files.</span>{" "}
            {registrationEnabled
              ? "Dataset contents and the unblinding secret stay in this browser; blindstats registers only the public receipt and safe metadata."
              : "Dataset contents and the unblinding secret stay in this browser session."}
          </p>
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <StageHeading
              number={1}
              title="Select data"
              description="Choose a CSV file."
            />

            <div className="mt-5">
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
                <p className="mt-3 text-sm text-slate-600">
                  <span className="font-medium text-slate-900">
                    {sourceFile.name}
                  </span>{" "}
                  · {parsed.rows.length.toLocaleString()} rows ·{" "}
                  {parsed.columns.length.toLocaleString()} columns
                </p>
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm ${
              parsed ? "border-slate-200" : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={2}
              title="Select variables"
              description="Choose a categorical column, then optionally select additional columns."
            />

            <div className="mt-5">
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

              {selectedColumnIsEligible && eligibleAdditionalColumns.length > 0 ? (
                <fieldset className="mt-5 rounded-xl border border-slate-200 p-4">
                  <legend className="px-2 text-sm font-medium text-slate-800">
                    Additional columns to blind (optional)
                  </legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {eligibleAdditionalColumns.map((column) => (
                      <label key={column} className="flex items-center gap-3 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={additionalColumns.includes(column)}
                          onChange={(event) => {
                            setAdditionalColumns((current) => event.target.checked
                              ? [...current, column]
                              : current.filter((value) => value !== column));
                            resetGeneratedPackage();
                            setWorkspaceError(null);
                          }}
                        />
                        {column}
                      </label>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {selectedColumns.length} selected. Each column receives its own randomized mapping.
                    All newly created packages use the v0.4 receipt format.
                  </p>
                </fieldset>
              ) : null}

              {selectedColumn ? (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs font-medium text-slate-600">Primary: {selectedColumn}</span>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-slate-700">
                      {categoryCount.toLocaleString()} {categoryCount === 1 ? "category" : "categories"}
                    </span>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-slate-700">
                      {missingCount.toLocaleString()} missing
                    </span>
                    {selectedColumnIsEligible ? (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-800">
                        Ready to blind
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-800">
                        At least 2 categories required
                      </span>
                    )}
                  </div>

                  <details className="mt-3 text-sm text-slate-600">
                    <summary className="cursor-pointer font-medium text-slate-700">
                      Preview categories for all {selectedColumnPreviews.length} selected {selectedColumnPreviews.length === 1 ? "column" : "columns"}
                    </summary>
                    <div className="mt-3 max-h-96 space-y-5 overflow-y-auto rounded-xl bg-slate-50 p-4">
                      {selectedColumnPreviews.map((item) => (
                        <div key={item.column}>
                          <h3 className="font-semibold text-slate-800">
                            {item.column}
                          </h3>
                          <p className="mb-2 mt-1 text-xs text-slate-500">
                            {item.categoryCount.toLocaleString()} {item.categoryCount === 1 ? "category" : "categories"} · {item.missingCount.toLocaleString()} missing
                          </p>
                          {item.preview.length > 0 ? (
                            <ul className="grid gap-2 sm:grid-cols-2">
                              {item.preview.map((category) => (
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
                            <p>No nonmissing category values were found.</p>
                          )}
                          {item.hiddenCategoryCount > 0 ? (
                            <p className="mt-2 text-xs text-slate-500">
                              {item.hiddenCategoryCount.toLocaleString()} additional {item.hiddenCategoryCount === 1 ? "category" : "categories"} not shown.
                            </p>
                          ) : null}
                        </div>
                      ))}
                      <p className="text-xs leading-5 text-slate-500">
                        Missing means an empty CSV cell. Text such as NA or N/A is treated as an observed category.
                      </p>
                    </div>
                  </details>
                </div>
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm ${
              selectedColumnIsEligible
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={3}
              title="Generate package"
              description="Create the blinded dataset and linked artifacts."
            />

            <div className="mt-5">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isGenerating ? "Generating..." : "Generate blinded package"}
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
                  className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
                  aria-live="polite"
                >
                  <p className="text-sm font-semibold text-emerald-900">
                    Blinded package created successfully.
                  </p>
                  <details className="mt-3 text-sm text-emerald-900">
                    <summary className="cursor-pointer font-medium">
                      Technical details
                    </summary>
                    <dl className="mt-3 space-y-4">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                          Transformation ID
                        </dt>
                        <dd className="mt-1 break-all font-mono text-xs text-emerald-950">
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
                  </details>
                </div>
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm ${
              generation ? "border-slate-200" : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={4}
              title="Save artifacts"
              description="Download the files created for this blinding."
            />

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">
                  Blinded CSV
                </h3>
                <button
                  type="button"
                  onClick={downloadBlindedCsv}
                  disabled={!generation}
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  Download blinded CSV
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-950">
                  Public receipt
                </h3>
                <button
                  type="button"
                  onClick={downloadReceipt}
                  disabled={!generation}
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  Download receipt
                </button>
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-950">
                  Unblinding secret
                </h3>
                <p className="mt-1 text-xs leading-5 text-amber-900">
                  Keep separate until unblinding is authorized.
                </p>
                <button
                  type="button"
                  onClick={downloadUnblindingSecret}
                  disabled={!generation}
                  className="mt-3 w-full rounded-lg bg-amber-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-900 disabled:cursor-not-allowed disabled:bg-amber-200"
                >
                  Download unblinding secret
                </button>
              </div>
            </div>
          </section>

          {registrationEnabled && registration ? (
            <section
              className={`rounded-2xl border bg-white p-6 shadow-sm ${
                generation ? "border-slate-200" : "border-slate-200 opacity-60"
              }`}
            >
              <StageHeading
                number={5}
                title="Register package"
                description={`Bind this package to BlindingPlan v${registration.planVersionNumber}.`}
              />

              <div className="mt-5">
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
                    I have saved the blinded CSV, public receipt, and unblinding secret, and I understand that blindstats does not store the unblinding secret.
                  </span>
                </label>

                <button
                  type="button"
                  onClick={handleRegister}
                  disabled={!generation || !custodyAcknowledged || isRegistering}
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isRegistering ? "Registering..." : "Register blinded package"}
                </button>

                {workspaceError?.stage === "registration" ? (
                  <p
                    className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                    role="alert"
                  >
                    {workspaceError.message}
                  </p>
                ) : null}

                <details className="mt-4 max-w-3xl text-xs leading-5 text-slate-500">
                  <summary className="cursor-pointer font-medium text-slate-600">
                    What is registered?
                  </summary>
                  <p className="mt-2">
                    blindstats stores the exact public receipt and safe artifact metadata. It does not upload the source CSV, blinded CSV, or unblinding secret.
                  </p>
                </details>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
