"use client";

import { useRouter } from "next/navigation";
import {
  useMemo,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";

import { sha256Hex } from "@/lib/blinding/hashing";
import {
  createUnblindingPackage,
  type UnblindingPackage,
} from "@/lib/blinding/unblinding";

type InputStage = "receipt" | "secret" | "lock";

type WorkspaceError = {
  stage: InputStage | "generation" | "registration";
  message: string;
};

type LoadedArtifact = {
  file: File;
  bytes: Uint8Array;
};

type ArtifactSetter = Dispatch<SetStateAction<LoadedArtifact | null>>;

type GeneratedUnblinding = {
  package: UnblindingPackage;
  receiptSha256: string;
};

export type RegisterUnblindingCompletionResult =
  | {
      ok: true;
      completionRecordId: string;
    }
  | {
      ok: false;
      error: string;
    };

type UnblindingRegistrationContext = {
  studyId: string;
  workflowId: string;
  requestId: string;
  transformationId: string;
  publicReceiptSha256: string;
  publicReceiptBase64: string;
  lockId: string;
  analysisLockReceiptSha256: string;
  analysisLockReceiptBase64: string;
};

type UnblindingWorkspaceProps = {
  registration?: UnblindingRegistrationContext;
  registerAction?: (
    formData: FormData,
  ) => Promise<RegisterUnblindingCompletionResult>;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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

export function UnblindingWorkspace({
  registration,
  registerAction,
}: UnblindingWorkspaceProps = {}) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<LoadedArtifact | null>(null);
  const [secret, setSecret] = useState<LoadedArtifact | null>(null);
  const [lockReceipt, setLockReceipt] = useState<LoadedArtifact | null>(null);
  const [generation, setGeneration] = useState<GeneratedUnblinding | null>(
    null,
  );
  const [workspaceError, setWorkspaceError] = useState<WorkspaceError | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [acknowledgedCustody, setAcknowledgedCustody] = useState(false);

  const registrationEnabled = Boolean(registration && registerAction);

  const registeredReceiptBytes = useMemo(() => {
    if (!registration) {
      return null;
    }

    return base64ToBytes(registration.publicReceiptBase64);
  }, [registration]);

  const registeredLockReceiptBytes = useMemo(() => {
    if (!registration) {
      return null;
    }

    return base64ToBytes(registration.analysisLockReceiptBase64);
  }, [registration]);

  const effectiveReceiptBytes = registeredReceiptBytes ?? receipt?.bytes ?? null;
  const effectiveLockReceiptBytes =
    registeredLockReceiptBytes ?? lockReceipt?.bytes ?? null;

  const receiptReady = registrationEnabled
    ? Boolean(registeredReceiptBytes)
    : Boolean(receipt);
  const lockReady = registrationEnabled
    ? Boolean(registeredLockReceiptBytes)
    : Boolean(lockReceipt);

  const canGenerate =
    Boolean(receiptReady && secret && lockReady) && !isGenerating;

  function invalidateGeneration(): void {
    setGeneration(null);
    setAcknowledgedCustody(false);
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
    if (!effectiveReceiptBytes || !secret || !effectiveLockReceiptBytes) {
      return;
    }

    setIsGenerating(true);
    setGeneration(null);
    setAcknowledgedCustody(false);
    setWorkspaceError(null);

    try {
      const result = await createUnblindingPackage(
        effectiveReceiptBytes,
        secret.bytes,
        effectiveLockReceiptBytes,
      );

      if (registration) {
        if (result.receipt.transformationId !== registration.transformationId) {
          throw new Error(
            "Generated unblinding receipt does not match the registered transformation.",
          );
        }

        if (result.receipt.lockId !== registration.lockId) {
          throw new Error(
            "Generated unblinding receipt does not match the authorized AnalysisLock.",
          );
        }
      }

      const receiptSha256 = await sha256Hex(result.receiptArtifact.bytes);

      setGeneration({
        package: result,
        receiptSha256,
      });
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
      generation.package.receiptArtifact.bytes,
      "unblinding-receipt.json",
      "application/json;charset=utf-8",
    );
  }

  async function handleRegister(): Promise<void> {
    if (
      !registration ||
      !registerAction ||
      !generation ||
      !acknowledgedCustody ||
      isRegistering
    ) {
      return;
    }

    const receipt = generation.package.receipt;
    const formData = new FormData();

    formData.set("studyId", registration.studyId);
    formData.set("workflowId", registration.workflowId);
    formData.set("requestId", registration.requestId);
    formData.set("unblindingId", receipt.unblindingId);
    formData.set("receiptCreatedAt", receipt.createdAt);
    formData.set("transformationId", receipt.transformationId);
    formData.set("lockId", receipt.lockId);
    formData.set("selectedColumn", receipt.selectedColumn);
    formData.set(
      "sourceArtifactSha256",
      receipt.artifacts.sourceArtifactSha256,
    );
    formData.set(
      "blindingReceiptSha256",
      receipt.artifacts.blindingReceiptSha256,
    );
    formData.set(
      "blindedArtifactSha256",
      receipt.artifacts.blindedArtifactSha256,
    );
    formData.set(
      "unblindingSecretSha256",
      receipt.artifacts.unblindingSecretSha256,
    );
    formData.set(
      "analysisLockReceiptSha256",
      receipt.artifacts.analysisLockReceiptSha256,
    );
    formData.set(
      "analysisArtifactFilename",
      receipt.artifacts.analysisArtifact.filename,
    );
    formData.set(
      "analysisArtifactSha256",
      receipt.artifacts.analysisArtifact.sha256,
    );
    formData.set(
      "analysisArtifactByteLength",
      String(receipt.artifacts.analysisArtifact.byteLength),
    );
    formData.set("unblindingReceiptSha256", generation.receiptSha256);
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
        `/studies/${registration.studyId}/blinding/${registration.workflowId}?unblinded=1`,
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

  const generatedReceipt = generation?.package.receipt ?? null;

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
            {registrationEnabled
              ? "Complete the authorized unblinding locally."
              : "Verify the locked workflow before releasing the mapping."}
          </h1>

          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            {registrationEnabled
              ? "The exact registered public receipt and the request-selected AnalysisLock receipt are supplied automatically. Select only the local unblinding secret to verify the artifact chain and release the mapping."
              : "Supply the public receipt, unblinding secret, and analysis-lock receipt. blindstats verifies the artifact chain and decrypts the sealed mapping."}
          </p>
        </header>

        <section className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-950">
            Unblinding releases protected information
          </h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            {registrationEnabled
              ? "The unblinding secret and plaintext mapping remain in this browser. Registration sends only safe completion metadata; blindstats does not upload the secret, released mapping, or final unblinding-receipt text."
              : "A successful unblinding receipt contains the original-to-blinded mapping and should be treated as unblinded material."}
          </p>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            {registrationEnabled && registration ? (
              <>
                <StageHeading
                  number={1}
                  title="Authorized workflow artifacts"
                  description="Use the exact public receipt and request-selected AnalysisLock receipt already registered for this authorized workflow."
                />

                <dl className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Transformation ID
                    </dt>
                    <dd className="mt-1 break-all font-mono text-sm text-slate-900">
                      {registration.transformationId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Authorized lock ID
                    </dt>
                    <dd className="mt-1 break-all font-mono text-sm text-slate-900">
                      {registration.lockId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Public receipt SHA-256
                    </dt>
                    <dd>
                      <HashValue value={registration.publicReceiptSha256} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      AnalysisLock receipt SHA-256
                    </dt>
                    <dd>
                      <HashValue
                        value={registration.analysisLockReceiptSha256}
                      />
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
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
              </>
            )}
          </section>

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              receiptReady ? "border-slate-200" : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={2}
              title="Select unblinding secret"
              description="Choose the local cryptographic secret released after authorization."
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

          {!registrationEnabled ? (
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
          ) : null}

          <section
            className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
              receiptReady && secret && lockReady
                ? "border-slate-200"
                : "border-slate-200 opacity-60"
            }`}
          >
            <StageHeading
              number={registrationEnabled ? 3 : 4}
              title="Verify and unblind"
              description="Verify the linked artifacts and release the mapping locally."
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

              {generation && generatedReceipt ? (
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
                        {generatedReceipt.unblindingId}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Transformation ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-sm text-emerald-950">
                        {generatedReceipt.transformationId}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Lock ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-sm text-emerald-950">
                        {generatedReceipt.lockId}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Selected column
                      </dt>
                      <dd className="mt-1 break-all text-sm font-semibold text-emerald-950">
                        {generatedReceipt.selectedColumn}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-emerald-800">
                        Final receipt SHA-256
                      </dt>
                      <dd>
                        <HashValue value={generation.receiptSha256} />
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <h3 className="text-sm font-semibold text-amber-950">
                      Released mapping
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-amber-900">
                      This is protected unblinded information. The mapping stays
                      local unless you save or share the final receipt yourself.
                    </p>
                    <div className="mt-4 overflow-x-auto rounded-lg border border-amber-200 bg-white">
                      <table className="w-full border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-amber-200 bg-amber-50">
                            <th className="px-3 py-2 font-semibold text-amber-950">
                              Original value
                            </th>
                            <th className="px-3 py-2 font-semibold text-amber-950">
                              Blinded label
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {generatedReceipt.releasedMapping.map((entry) => (
                            <tr
                              className="border-b border-amber-100 last:border-b-0"
                              key={`${entry.original}\u0000${entry.blinded}`}
                            >
                              <td className="px-3 py-2 text-amber-950">
                                {entry.original}
                              </td>
                              <td className="px-3 py-2 text-amber-950">
                                {entry.blinded}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <h3 className="text-sm font-semibold text-amber-950">
                      Unblinding receipt
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-amber-900">
                      Records the released mapping and linked workflow artifacts.
                      Treat this receipt as unblinded material.
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

          {registrationEnabled ? (
            <section
              className={`rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${
                generation
                  ? "border-slate-200"
                  : "border-slate-200 opacity-60"
              }`}
            >
              <StageHeading
                number={4}
                title="Register unblinding completion"
                description="Persist safe completion metadata and move the workflow to unblinded."
              />

              <div className="mt-6">
                <label className="flex items-start gap-3 text-sm text-slate-700">
                  <input
                    className="mt-1 h-4 w-4 rounded border-slate-300"
                    type="checkbox"
                    checked={acknowledgedCustody}
                    disabled={!generation || isRegistering}
                    onChange={(event) =>
                      setAcknowledgedCustody(event.target.checked)
                    }
                  />
                  <span>
                    I saved the unblinding receipt and understand that blindstats
                    stores only safe completion metadata, not the unblinding
                    secret, plaintext released mapping, or final receipt text.
                  </span>
                </label>

                <button
                  type="button"
                  onClick={handleRegister}
                  disabled={
                    !generation || !acknowledgedCustody || isRegistering
                  }
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isRegistering
                    ? "Registering completion..."
                    : "Register unblinding completion"}
                </button>

                {workspaceError?.stage === "registration" ? (
                  <p
                    className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                    role="alert"
                  >
                    {workspaceError.message}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
