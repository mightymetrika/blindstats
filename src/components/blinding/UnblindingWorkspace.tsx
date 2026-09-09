"use client";

import {
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  createUnblindingPackage,
  type UnblindingPackage,
} from "@/lib/blinding/unblinding";

type InputStage = "receipt" | "secret" | "lock";

type WorkspaceError = {
  stage: InputStage | "generation";
  message: string;
};

type LoadedArtifact = {
  file: File;
  bytes: Uint8Array;
};

type ArtifactSetter = Dispatch<SetStateAction<LoadedArtifact | null>>;

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
  artifact,
  label,
}: {
  artifact: LoadedArtifact;
  label: string;
}) {
  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 break-all text-sm font-semibold text-slate-900">
        {artifact.file.name}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {artifact.bytes.length.toLocaleString()}{" "}
        {artifact.bytes.length === 1 ? "byte" : "bytes"}
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

export function UnblindingWorkspace() {
  const [receipt, setReceipt] = useState<LoadedArtifact | null>(null);
  const [secret, setSecret] = useState<LoadedArtifact | null>(null);
  const [lockReceipt, setLockReceipt] = useState<LoadedArtifact | null>(null);
  const [generation, setGeneration] = useState<UnblindingPackage | null>(null);
  const [workspaceError, setWorkspaceError] = useState<WorkspaceError | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);

  const canGenerate =
    Boolean(receipt && secret && lockReceipt) && !isGenerating;

  function invalidateGeneration(): void {
    setGeneration(null);
    setWorkspaceError(null);
  }

  async function handleArtifactChange(
    event: ChangeEvent<HTMLInputElement>,
    stage: InputStage,
    setter: ArtifactSetter,
  ): Promise<void> {
    const file = event.target.files?.[0] ?? null;

    setter(null);
    invalidateGeneration();

    if (!file) {
      return;
    }

    try {
      const bytes = await readFileBytes(file);
      setter({
        file,
        bytes,
      });
    } catch (error) {
      setWorkspaceError({
        stage,
        message: getErrorMessage(error),
      });
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!receipt || !secret || !lockReceipt) {
      return;
    }

    setIsGenerating(true);
    setGeneration(null);
    setWorkspaceError(null);

    try {
      const result = await createUnblindingPackage(
        receipt.bytes,
        secret.bytes,
        lockReceipt.bytes,
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
      "unblinding-receipt.json",
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
              Documented Unblinding v0
            </span>
          </div>

          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Verify the locked workflow before releasing the mapping.
          </h1>

          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Supply the public receipt, unblinding secret, and analysis-lock
            receipt. blindstats verifies the artifact chain and decrypts the
            sealed mapping.
          </p>
        </header>

        <section className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-950">
            Unblinding releases protected information
          </h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            A successful unblinding receipt contains the original-to-blinded
            mapping and should be treated as unblinded material.
          </p>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <StageHeading
              number={1}
              title="Select public blinding receipt"
              description="Choose the exact public receipt used when the blinded analysis was locked."
            />

            <div className="mt-6">
              <label
                htmlFor="unblind-blinding-receipt"
                className="block text-sm font-medium text-slate-800"
              >
                Public blinding receipt
              </label>
              <input
                id="unblind-blinding-receipt"
                type="file"
                accept=".json,application/json"
                onChange={(event) =>
                  handleArtifactChange(event, "receipt", setReceipt)
                }
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

              {receipt ? (
                <FileSummary artifact={receipt} label="Public receipt" />
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              receipt ? "border-slate-200" : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={2}
              title="Select unblinding secret"
              description="Choose the cryptographic secret released after analysis locking."
            />

            <div className="mt-6">
              <label
                htmlFor="unblind-secret"
                className="block text-sm font-medium text-slate-800"
              >
                Unblinding secret
              </label>
              <input
                id="unblind-secret"
                type="file"
                accept=".json,application/json"
                onChange={(event) =>
                  handleArtifactChange(event, "secret", setSecret)
                }
                className="mt-2 block w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 file:mr-4 file:rounded-lg file:border-0 file:bg-amber-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-amber-900"
              />

              {workspaceError?.stage === "secret" ? (
                <p
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {workspaceError.message}
                </p>
              ) : null}

              {secret ? (
                <FileSummary artifact={secret} label="Unblinding secret" />
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              receipt && secret
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={3}
              title="Select analysis-lock receipt"
              description="Choose the receipt for the analysis artifact locked before unblinding."
            />

            <div className="mt-6">
              <label
                htmlFor="unblind-lock-receipt"
                className="block text-sm font-medium text-slate-800"
              >
                Analysis-lock receipt
              </label>
              <input
                id="unblind-lock-receipt"
                type="file"
                accept=".json,application/json"
                onChange={(event) =>
                  handleArtifactChange(event, "lock", setLockReceipt)
                }
                className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
              />

              {workspaceError?.stage === "lock" ? (
                <p
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {workspaceError.message}
                </p>
              ) : null}

              {lockReceipt ? (
                <FileSummary
                  artifact={lockReceipt}
                  label="Analysis-lock receipt"
                />
              ) : null}
            </div>
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              receipt && secret && lockReceipt
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={4}
              title="Verify and unblind"
              description="Verify the linked artifacts and release the mapping."
            />

            <div className="mt-6">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-900 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isGenerating
                  ? "Verifying artifact chain..."
                  : "Verify and unblind"}
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
                    Artifact chain verified. Mapping released.
                  </p>

                  <dl className="mt-4 space-y-4">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Unblinding ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-sm text-emerald-950">
                        {generation.receipt.unblindingId}
                      </dd>
                    </div>

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
                        Lock ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-sm text-emerald-950">
                        {generation.receipt.lockId}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Selected column
                      </dt>
                      <dd className="mt-1 break-all text-sm font-semibold text-emerald-950">
                        {generation.receipt.selectedColumn}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Blinded SHA-256
                      </dt>
                      <dd>
                        <HashValue
                          value={
                            generation.receipt.artifacts
                              .blindedArtifactSha256
                          }
                        />
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Locked analysis SHA-256
                      </dt>
                      <dd>
                        <HashValue
                          value={
                            generation.receipt.artifacts.analysisArtifact
                              .sha256
                          }
                        />
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <h3 className="text-sm font-semibold text-amber-950">
                      Unblinding receipt
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-amber-900">
                      Records the released mapping and the linked workflow
                      artifacts. Treat this receipt as unblinded material.
                    </p>
                    <button
                      type="button"
                      onClick={downloadReceipt}
                      className="mt-4 rounded-lg bg-amber-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-900"
                    >
                      Download unblinding receipt
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-5 block rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-400"
                >
                  Download unblinding receipt
                </button>
              )}
            </div>
          </section>
        </div>

      </div>
    </main>
  );
}
