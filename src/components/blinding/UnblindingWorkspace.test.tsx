// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { sha256Hex } from "@/lib/blinding/hashing";
import {
  createUnblindingPackage,
  type UnblindingPackage,
} from "@/lib/blinding/unblinding";

import { UnblindingWorkspace } from "./UnblindingWorkspace";

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

vi.mock("@/lib/blinding/unblinding", () => ({
  createUnblindingPackage: vi.fn(),
}));

vi.mock("@/lib/blinding/hashing", () => ({
  sha256Hex: vi.fn(),
}));

const RECEIPT_TEXT = '{"kind":"public-receipt"}\n';
const SECRET_TEXT = '{"kind":"unblinding-secret"}\n';
const LOCK_TEXT = '{"kind":"analysis-lock"}\n';
const FINAL_RECEIPT_TEXT = '{"kind":"unblinding-receipt"}\n';

const TRANSFORMATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const LOCK_ID = "7d5a4f1f-59d7-4c62-9821-3e2ae6a1bf33";
const PUBLIC_RECEIPT_HASH = "b".repeat(64);
const LOCK_RECEIPT_HASH = "e".repeat(64);
const FINAL_RECEIPT_HASH = "1".repeat(64);

const mockedCreateUnblindingPackage = vi.mocked(createUnblindingPackage);
const mockedSha256Hex = vi.mocked(sha256Hex);

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function createFile(filename: string, text: string): File {
  const bytes = encode(text);
  const file = new File([text], filename, {
    type: "application/json",
  });

  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () =>
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
  });

  return file;
}

function createMockPackage(): UnblindingPackage {
  return {
    receipt: {
      schemaVersion: "0.3",
      receiptType: "unblinding",
      unblindingId: "2eb58498-8810-40ae-b95f-c9f97babb1d2",
      createdAt: "2026-09-09T00:00:00.000Z",
      transformationId: TRANSFORMATION_ID,
      lockId: LOCK_ID,
      selectedColumn: "group",
      artifacts: {
        sourceArtifactSha256: "a".repeat(64),
        blindingReceiptSha256: PUBLIC_RECEIPT_HASH,
        blindedArtifactSha256: "c".repeat(64),
        unblindingSecretSha256: "d".repeat(64),
        analysisLockReceiptSha256: LOCK_RECEIPT_HASH,
        analysisArtifact: {
          filename: "analysis.docx",
          sha256: "f".repeat(64),
          byteLength: 1234,
        },
      },
      releasedMapping: [
        {
          original: "Treatment",
          blinded: "Group_A",
        },
        {
          original: "Control",
          blinded: "Group_B",
        },
      ],
    },
    receiptArtifact: {
      text: FINAL_RECEIPT_TEXT,
      bytes: encode(FINAL_RECEIPT_TEXT),
    },
  };
}

function persistentRegistration() {
  return {
    studyId: "study-id",
    workflowId: "workflow-id",
    requestId: "request-id",
    transformationId: TRANSFORMATION_ID,
    publicReceiptSha256: PUBLIC_RECEIPT_HASH,
    publicReceiptBase64: bytesToBase64(encode(RECEIPT_TEXT)),
    lockId: LOCK_ID,
    analysisLockReceiptSha256: LOCK_RECEIPT_HASH,
    analysisLockReceiptBase64: bytesToBase64(encode(LOCK_TEXT)),
  };
}

async function uploadRequiredFiles(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.upload(
    screen.getByLabelText("Public blinding receipt"),
    createFile("blinding-receipt.json", RECEIPT_TEXT),
  );
  await user.upload(
    screen.getByLabelText("Unblinding secret"),
    createFile("unblinding-secret.json", SECRET_TEXT),
  );
  await user.upload(
    screen.getByLabelText("Analysis-lock receipt"),
    createFile("analysis-lock-receipt.json", LOCK_TEXT),
  );
}

function verifyButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Verify and unblind",
  });
}

function downloadButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Download unblinding receipt",
  });
}

beforeEach(() => {
  mockedCreateUnblindingPackage.mockResolvedValue(createMockPackage());
  mockedSha256Hex.mockResolvedValue(FINAL_RECEIPT_HASH);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UnblindingWorkspace workflow", () => {
  it("requires only the three JSON workflow artifacts in standalone mode", async () => {
    const user = userEvent.setup();

    render(<UnblindingWorkspace />);

    expect(verifyButton()).toBeDisabled();

    await uploadRequiredFiles(user);

    expect(verifyButton()).toBeEnabled();
  });

  it("passes exact receipt, secret, and lock bytes to the core boundary", async () => {
    const user = userEvent.setup();

    render(<UnblindingWorkspace />);
    await uploadRequiredFiles(user);

    await user.click(verifyButton());

    const [receiptBytes, secretBytes, lockBytes] =
      mockedCreateUnblindingPackage.mock.calls[0];

    expect(new TextDecoder().decode(receiptBytes)).toBe(RECEIPT_TEXT);
    expect(new TextDecoder().decode(secretBytes)).toBe(SECRET_TEXT);
    expect(new TextDecoder().decode(lockBytes)).toBe(LOCK_TEXT);

    expect(
      await screen.findByText("Artifact chain verified. Mapping released."),
    ).toBeInTheDocument();
    expect(screen.getByText("Treatment")).toBeInTheDocument();
    expect(screen.getByText("Group_A")).toBeInTheDocument();
  });

  it("invalidates a completed unblinding when any required JSON artifact is replaced", async () => {
    const user = userEvent.setup();

    render(<UnblindingWorkspace />);
    await uploadRequiredFiles(user);
    await user.click(verifyButton());

    await screen.findByText("Artifact chain verified. Mapping released.");

    await user.upload(
      screen.getByLabelText("Unblinding secret"),
      createFile("replacement-secret.json", '{"kind":"replacement"}\n'),
    );

    expect(downloadButton()).toBeDisabled();
  });

  it("surfaces authenticated-decryption failures without releasing a receipt", async () => {
    const user = userEvent.setup();

    mockedCreateUnblindingPackage.mockRejectedValueOnce(
      new Error(
        "Unblinding secret could not authenticate and decrypt the sealed mapping.",
      ),
    );

    render(<UnblindingWorkspace />);
    await uploadRequiredFiles(user);
    await user.click(verifyButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not authenticate and decrypt",
    );
  });

  it("uses the registered exact public and AnalysisLock receipts in persistent mode", async () => {
    const user = userEvent.setup();

    render(
      <UnblindingWorkspace
        registration={persistentRegistration()}
        registerAction={vi.fn()}
      />,
    );

    expect(
      screen.queryByLabelText("Public blinding receipt"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Analysis-lock receipt"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Authorized workflow artifacts")).toBeInTheDocument();
    expect(verifyButton()).toBeDisabled();

    await user.upload(
      screen.getByLabelText("Unblinding secret"),
      createFile("unblinding-secret.json", SECRET_TEXT),
    );

    expect(verifyButton()).toBeEnabled();
    await user.click(verifyButton());

    const [receiptBytes, secretBytes, lockBytes] =
      mockedCreateUnblindingPackage.mock.calls[0];

    expect(new TextDecoder().decode(receiptBytes)).toBe(RECEIPT_TEXT);
    expect(new TextDecoder().decode(secretBytes)).toBe(SECRET_TEXT);
    expect(new TextDecoder().decode(lockBytes)).toBe(LOCK_TEXT);
    expect(mockedSha256Hex).toHaveBeenCalledWith(
      createMockPackage().receiptArtifact.bytes,
    );
  });

  it("registers only safe completion metadata and redirects to the current workflow", async () => {
    const user = userEvent.setup();
    const registerAction = vi.fn().mockResolvedValue({
      ok: true,
      completionRecordId: "completion-record-id",
    });

    render(
      <UnblindingWorkspace
        registration={persistentRegistration()}
        registerAction={registerAction}
      />,
    );

    await user.upload(
      screen.getByLabelText("Unblinding secret"),
      createFile("unblinding-secret.json", SECRET_TEXT),
    );
    await user.click(verifyButton());
    await screen.findByText("Artifact chain verified. Mapping released.");

    const registerButton = screen.getByRole("button", {
      name: "Register unblinding completion",
    });
    expect(registerButton).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", {
        name: /I saved the unblinding receipt/i,
      }),
    );
    expect(registerButton).toBeEnabled();

    await user.click(registerButton);

    await waitFor(() => {
      expect(registerAction).toHaveBeenCalledTimes(1);
    });

    const [formData] = registerAction.mock.calls[0] as [FormData];

    expect(formData.get("studyId")).toBe("study-id");
    expect(formData.get("workflowId")).toBe("workflow-id");
    expect(formData.get("requestId")).toBe("request-id");
    expect(formData.get("unblindingId")).toBe(
      createMockPackage().receipt.unblindingId,
    );
    expect(formData.get("unblindingSecretSha256")).toBe("d".repeat(64));
    expect(formData.get("unblindingReceiptSha256")).toBe(FINAL_RECEIPT_HASH);
    expect(formData.get("analysisArtifactFilename")).toBe("analysis.docx");
    expect(formData.get("analysisArtifactByteLength")).toBe("1234");

    expect(formData.get("unblindingSecretBase64")).toBeNull();
    expect(formData.get("unblindingReceiptBase64")).toBeNull();
    expect(formData.get("releasedMapping")).toBeNull();

    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/studies/study-id/blinding/workflow-id?unblinded=1",
    );
  });

  it("keeps the released mapping and final receipt available when completion registration fails", async () => {
    const user = userEvent.setup();
    const registerAction = vi.fn().mockResolvedValue({
      ok: false,
      error: "The workflow changed in another tab.",
    });

    render(
      <UnblindingWorkspace
        registration={persistentRegistration()}
        registerAction={registerAction}
      />,
    );

    await user.upload(
      screen.getByLabelText("Unblinding secret"),
      createFile("unblinding-secret.json", SECRET_TEXT),
    );
    await user.click(verifyButton());
    await screen.findByText("Artifact chain verified. Mapping released.");

    await user.click(
      screen.getByRole("checkbox", {
        name: /I saved the unblinding receipt/i,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Register unblinding completion",
      }),
    );

    expect(
      await screen.findByText("The workflow changed in another tab."),
    ).toBeInTheDocument();
    expect(downloadButton()).toBeEnabled();
    expect(screen.getByText("Treatment")).toBeInTheDocument();
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });
});
