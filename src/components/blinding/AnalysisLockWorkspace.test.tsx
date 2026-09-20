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

import {
  createAnalysisLockPackage,
  type AnalysisLockPackage,
} from "@/lib/blinding/analysis-lock";

import { AnalysisLockWorkspace } from "./AnalysisLockWorkspace";

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

vi.mock("@/lib/blinding/analysis-lock", () => ({
  createAnalysisLockPackage: vi.fn(),
}));

const RECEIPT_TEXT = '{"kind":"public-receipt"}\n';
const ANALYSIS_TEXT = "Methods and results drafted under blinding.\n";

const LOCK_ID = "7d5a4f1f-59d7-4c62-9821-3e2ae6a1bf33";
const TRANSFORMATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const BLINDED_HASH = "b".repeat(64);
const ANALYSIS_HASH = "c".repeat(64);
const PUBLIC_RECEIPT_HASH = "a".repeat(64);

const mockedCreateAnalysisLockPackage = vi.mocked(
  createAnalysisLockPackage,
);

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

function createFile(
  filename: string,
  text: string,
  type = "application/octet-stream",
): File {
  const bytes = encode(text);
  const file = new File([text], filename, { type });

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

function createMockPackage(
  analysisFilename = "analysis.docx",
): AnalysisLockPackage {
  const receiptText = '{"kind":"analysis-lock"}\n';

  return {
    receipt: {
      schemaVersion: "0.3",
      receiptType: "analysis_lock",
      lockId: LOCK_ID,
      createdAt: "2026-09-08T23:30:00.000Z",
      blinding: {
        transformationId: TRANSFORMATION_ID,
        blindingReceiptSha256: PUBLIC_RECEIPT_HASH,
        blindedArtifactSha256: BLINDED_HASH,
      },
      analysisArtifact: {
        filename: analysisFilename,
        sha256: ANALYSIS_HASH,
        byteLength: encode(ANALYSIS_TEXT).length,
      },
    },
    receiptArtifact: {
      text: receiptText,
      bytes: encode(receiptText),
    },
  };
}

function persistentRegistration() {
  return {
    studyId: "study-id",
    workflowId: "workflow-id",
    transformationId: TRANSFORMATION_ID,
    publicReceiptSha256: PUBLIC_RECEIPT_HASH,
    publicReceiptBase64: bytesToBase64(encode(RECEIPT_TEXT)),
  };
}

async function uploadRequiredFiles(
  user: ReturnType<typeof userEvent.setup>,
  analysisFilename = "analysis.docx",
): Promise<void> {
  await user.upload(
    screen.getByLabelText("Public blinding receipt"),
    createFile(
      "blinding-receipt.json",
      RECEIPT_TEXT,
      "application/json",
    ),
  );
  await user.upload(
    screen.getByLabelText("Analysis artifact"),
    createFile(analysisFilename, ANALYSIS_TEXT),
  );
}

function createButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Create analysis lock",
  });
}

function downloadButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Download analysis-lock receipt",
  });
}

beforeEach(() => {
  mockedCreateAnalysisLockPackage.mockResolvedValue(
    createMockPackage(),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnalysisLockWorkspace workflow", () => {
  it("keeps lock creation unavailable until the public receipt and analysis artifact are supplied", async () => {
    const user = userEvent.setup();

    render(<AnalysisLockWorkspace />);
    expect(createButton()).toBeDisabled();

    await user.upload(
      screen.getByLabelText("Public blinding receipt"),
      createFile(
        "blinding-receipt.json",
        RECEIPT_TEXT,
        "application/json",
      ),
    );
    expect(createButton()).toBeDisabled();

    await user.upload(
      screen.getByLabelText("Analysis artifact"),
      createFile("analysis.docx", ANALYSIS_TEXT),
    );

    expect(createButton()).toBeEnabled();
  });

  it("passes exact receipt and analysis bytes plus the filename to the core lock boundary", async () => {
    const user = userEvent.setup();

    render(<AnalysisLockWorkspace />);
    expect(downloadButton()).toBeDisabled();

    await uploadRequiredFiles(user);
    await user.click(createButton());

    expect(mockedCreateAnalysisLockPackage).toHaveBeenCalledTimes(1);

    const [receiptBytes, analysisArtifact] =
      mockedCreateAnalysisLockPackage.mock.calls[0];

    expect(new TextDecoder().decode(receiptBytes)).toBe(RECEIPT_TEXT);
    expect(analysisArtifact.filename).toBe("analysis.docx");
    expect(new TextDecoder().decode(analysisArtifact.bytes)).toBe(
      ANALYSIS_TEXT,
    );

    await screen.findByText("Analysis lock created successfully.");
    expect(downloadButton()).toBeEnabled();
  });

  it("invalidates a generated lock when either required input is replaced", async () => {
    const user = userEvent.setup();

    render(<AnalysisLockWorkspace />);
    await uploadRequiredFiles(user);
    await user.click(createButton());
    await screen.findByText("Analysis lock created successfully.");
    expect(downloadButton()).toBeEnabled();

    await user.upload(
      screen.getByLabelText("Analysis artifact"),
      createFile("analysis-revised.docx", `${ANALYSIS_TEXT}Revision.\n`),
    );
    expect(downloadButton()).toBeDisabled();

    mockedCreateAnalysisLockPackage.mockResolvedValueOnce(
      createMockPackage("analysis-revised.docx"),
    );
    await user.click(createButton());
    await screen.findByText("Analysis lock created successfully.");
    expect(downloadButton()).toBeEnabled();

    await user.upload(
      screen.getByLabelText("Public blinding receipt"),
      createFile(
        "replacement-receipt.json",
        '{"kind":"replacement"}\n',
        "application/json",
      ),
    );
    expect(downloadButton()).toBeDisabled();
  });

  it("uses the already registered exact public receipt in persistent mode", async () => {
    const user = userEvent.setup();

    render(
      <AnalysisLockWorkspace
        registration={persistentRegistration()}
        registerAction={vi.fn()}
      />,
    );

    expect(
      screen.queryByLabelText("Public blinding receipt"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Registered blinding receipt")).toBeInTheDocument();
    expect(createButton()).toBeDisabled();

    await user.upload(
      screen.getByLabelText("Analysis artifact"),
      createFile("analysis.docx", ANALYSIS_TEXT),
    );

    expect(createButton()).toBeEnabled();
    await user.click(createButton());

    const [receiptBytes, analysisArtifact] =
      mockedCreateAnalysisLockPackage.mock.calls[0];

    expect(new TextDecoder().decode(receiptBytes)).toBe(RECEIPT_TEXT);
    expect(analysisArtifact.filename).toBe("analysis.docx");
  });

  it("registers the exact generated lock receipt and redirects to the current workflow", async () => {
    const user = userEvent.setup();
    const registerAction = vi.fn().mockResolvedValue({
      ok: true,
      lockRecordId: "lock-record-id",
    });

    render(
      <AnalysisLockWorkspace
        registration={persistentRegistration()}
        registerAction={registerAction}
      />,
    );

    await user.upload(
      screen.getByLabelText("Analysis artifact"),
      createFile("analysis.docx", ANALYSIS_TEXT),
    );
    await user.click(createButton());
    await screen.findByText("Analysis lock created successfully.");

    await user.click(
      screen.getByRole("button", { name: "Register analysis lock" }),
    );

    await waitFor(() => {
      expect(registerAction).toHaveBeenCalledTimes(1);
    });

    const [formData] = registerAction.mock.calls[0] as [FormData];
    expect(formData.get("studyId")).toBe("study-id");
    expect(formData.get("workflowId")).toBe("workflow-id");

    const lockReceiptBase64 = formData.get("analysisLockReceiptBase64");
    expect(typeof lockReceiptBase64).toBe("string");

    const decodedReceiptBytes = Uint8Array.from(
      atob(lockReceiptBase64 as string),
      (character) => character.charCodeAt(0),
    );

    expect(new TextDecoder().decode(decodedReceiptBytes)).toBe(
      createMockPackage().receiptArtifact.text,
    );
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/studies/study-id/blinding/workflow-id?locked=1",
    );
  });

  it("keeps the generated lock available when persistent registration fails", async () => {
    const user = userEvent.setup();
    const registerAction = vi.fn().mockResolvedValue({
      ok: false,
      error: "The workflow changed in another tab.",
    });

    render(
      <AnalysisLockWorkspace
        registration={persistentRegistration()}
        registerAction={registerAction}
      />,
    );

    await user.upload(
      screen.getByLabelText("Analysis artifact"),
      createFile("analysis.docx", ANALYSIS_TEXT),
    );
    await user.click(createButton());
    await screen.findByText("Analysis lock created successfully.");

    await user.click(
      screen.getByRole("button", { name: "Register analysis lock" }),
    );

    expect(
      await screen.findByText("The workflow changed in another tab."),
    ).toBeInTheDocument();
    expect(downloadButton()).toBeEnabled();
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });
});
