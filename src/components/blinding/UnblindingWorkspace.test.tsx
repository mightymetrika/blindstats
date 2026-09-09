// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
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
  createUnblindingPackage,
  type UnblindingPackage,
} from "@/lib/blinding/unblinding";

import { UnblindingWorkspace } from "./UnblindingWorkspace";

vi.mock("@/lib/blinding/unblinding", () => ({
  createUnblindingPackage: vi.fn(),
}));

const RECEIPT_TEXT =
  '{"kind":"public-receipt"}\n';
const SECRET_TEXT =
  '{"kind":"unblinding-secret"}\n';
const LOCK_TEXT =
  '{"kind":"analysis-lock"}\n';

const mockedCreateUnblindingPackage =
  vi.mocked(createUnblindingPackage);

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function createFile(
  filename: string,
  text: string,
): File {
  const bytes = encode(text);
  const file = new File(
    [text],
    filename,
    {
      type: "application/json",
    },
  );

  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () =>
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset +
          bytes.byteLength,
      ),
  });

  return file;
}

function createMockPackage():
  UnblindingPackage {
  const receiptText =
    '{"kind":"unblinding-receipt"}\n';

  return {
    receipt: {
      schemaVersion: "0.3",
      receiptType: "unblinding",
      unblindingId:
        "2eb58498-8810-40ae-b95f-c9f97babb1d2",
      createdAt:
        "2026-09-09T00:00:00.000Z",
      transformationId:
        "123e4567-e89b-42d3-a456-426614174000",
      lockId:
        "7d5a4f1f-59d7-4c62-9821-3e2ae6a1bf33",
      selectedColumn: "group",
      artifacts: {
        sourceArtifactSha256:
          "a".repeat(64),
        blindingReceiptSha256:
          "b".repeat(64),
        blindedArtifactSha256:
          "c".repeat(64),
        unblindingSecretSha256:
          "d".repeat(64),
        analysisLockReceiptSha256:
          "e".repeat(64),
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
      text: receiptText,
      bytes: encode(receiptText),
    },
  };
}

async function uploadRequiredFiles(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.upload(
    screen.getByLabelText(
      "Public blinding receipt",
    ),
    createFile(
      "blinding-receipt.json",
      RECEIPT_TEXT,
    ),
  );
  await user.upload(
    screen.getByLabelText(
      "Unblinding secret",
    ),
    createFile(
      "unblinding-secret.json",
      SECRET_TEXT,
    ),
  );
  await user.upload(
    screen.getByLabelText(
      "Analysis-lock receipt",
    ),
    createFile(
      "analysis-lock-receipt.json",
      LOCK_TEXT,
    ),
  );
}

beforeEach(() => {
  mockedCreateUnblindingPackage.mockResolvedValue(
    createMockPackage(),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UnblindingWorkspace workflow", () => {
  it("requires only the three JSON workflow artifacts", async () => {
    const user = userEvent.setup();

    render(<UnblindingWorkspace />);

    const button = screen.getByRole(
      "button",
      {
        name: "Verify and unblind",
      },
    );

    expect(button).toBeDisabled();

    await uploadRequiredFiles(user);

    expect(button).toBeEnabled();
  });

  it("passes exact receipt, secret, and lock bytes to the core boundary", async () => {
    const user = userEvent.setup();

    render(<UnblindingWorkspace />);
    await uploadRequiredFiles(user);

    await user.click(
      screen.getByRole("button", {
        name: "Verify and unblind",
      }),
    );

    const [
      receiptBytes,
      secretBytes,
      lockBytes,
    ] =
      mockedCreateUnblindingPackage
        .mock.calls[0];

    expect(
      new TextDecoder().decode(
        receiptBytes,
      ),
    ).toBe(RECEIPT_TEXT);
    expect(
      new TextDecoder().decode(
        secretBytes,
      ),
    ).toBe(SECRET_TEXT);
    expect(
      new TextDecoder().decode(lockBytes),
    ).toBe(LOCK_TEXT);

    expect(
      await screen.findByText(
        "Artifact chain verified. Mapping released.",
      ),
    ).toBeInTheDocument();
  });

  it("invalidates a completed unblinding when any required JSON artifact is replaced", async () => {
    const user = userEvent.setup();

    render(<UnblindingWorkspace />);
    await uploadRequiredFiles(user);
    await user.click(
      screen.getByRole("button", {
        name: "Verify and unblind",
      }),
    );

    await screen.findByText(
      "Artifact chain verified. Mapping released.",
    );

    await user.upload(
      screen.getByLabelText(
        "Unblinding secret",
      ),
      createFile(
        "replacement-secret.json",
        '{"kind":"replacement"}\n',
      ),
    );

    expect(
      screen.getByRole("button", {
        name:
          "Download unblinding receipt",
      }),
    ).toBeDisabled();
  });

  it("surfaces authenticated-decryption failures without releasing a receipt", async () => {
    const user = userEvent.setup();

    mockedCreateUnblindingPackage
      .mockRejectedValueOnce(
        new Error(
          "Unblinding secret could not authenticate and decrypt the sealed mapping.",
        ),
      );

    render(<UnblindingWorkspace />);
    await uploadRequiredFiles(user);
    await user.click(
      screen.getByRole("button", {
        name: "Verify and unblind",
      }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(
      "could not authenticate and decrypt",
    );
  });
});
