// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
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
  createBlindedPackage,
  type BlindedPackage,
} from "@/lib/blinding/blinding-package";

import { BlindingWorkspace } from "./BlindingWorkspace";

vi.mock("@/lib/blinding/blinding-package", () => ({
  createBlindedPackage: vi.fn(),
}));

const SOURCE_TEXT = [
  "id,group,alternate,single",
  "1,Treatment,A,Only",
  "2,Control,B,Only",
  "3,Treatment,A,Only",
  "4,Control,B,Only",
].join("\n");

const REPLACEMENT_SOURCE_TEXT = [
  "id,group",
  "1,Alpha",
  "2,Beta",
].join("\n");

const SOURCE_HASH = "a".repeat(64);
const BLINDED_HASH = "b".repeat(64);
const TRANSFORMATION_ID = "123e4567-e89b-42d3-a456-426614174000";

const mockedCreateBlindedPackage = vi.mocked(createBlindedPackage);

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function createCsvFile(filename: string, text: string): File {
  const bytes = encode(text);
  const file = new File([text], filename, { type: "text/csv" });

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
  selectedColumn = "group",
): BlindedPackage {
  const blindedText = [
    "id,group",
    "1,Group_A",
    "2,Group_B",
  ].join("\n");
  const receiptText = '{"kind":"receipt"}\n';
  const keyText = '{"kind":"key"}\n';

  return {
    source: {
      columns: ["id", "group", "alternate", "single"],
      rowCount: 4,
      columnCount: 4,
      sha256: SOURCE_HASH,
    },
    blinded: {
      columns: ["id", "group", "alternate", "single"],
      rows: [],
      text: blindedText,
      bytes: encode(blindedText),
      sha256: BLINDED_HASH,
    },
    receipt: {
      schemaVersion: "0.1",
      transformationId: TRANSFORMATION_ID,
      createdAt: "2026-09-03T23:00:00.000Z",
      transformationType: "categorical_label_permutation",
      selectedColumn,
      categoryCount: 2,
      rowCount: 4,
      columnCount: 4,
      sourceArtifact: {
        sha256: SOURCE_HASH,
      },
      blindedArtifact: {
        sha256: BLINDED_HASH,
      },
      algorithm: {
        neutralLabelScheme: "Group_<letters>",
        mappingAssignment: "web_crypto_random_permutation",
      },
    },
    key: {
      schemaVersion: "0.1",
      transformationId: TRANSFORMATION_ID,
      createdAt: "2026-09-03T23:00:00.000Z",
      transformationType: "categorical_label_permutation",
      selectedColumn,
      sourceArtifactSha256: SOURCE_HASH,
      blindedArtifactSha256: BLINDED_HASH,
      mapping: [
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
    keyArtifact: {
      text: keyText,
      bytes: encode(keyText),
    },
  };
}

async function uploadCsv(
  user: ReturnType<typeof userEvent.setup>,
  filename = "study.csv",
  text = SOURCE_TEXT,
): Promise<void> {
  await user.upload(
    screen.getByLabelText("Source CSV"),
    createCsvFile(filename, text),
  );
}

async function chooseColumn(
  user: ReturnType<typeof userEvent.setup>,
  column: string,
): Promise<void> {
  await user.selectOptions(
    screen.getByLabelText("Column to blind"),
    column,
  );
}

function generateButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Generate blinded package",
  });
}

function downloadButtons(): HTMLElement[] {
  return [
    screen.getByRole("button", {
      name: "Download blinded CSV",
    }),
    screen.getByRole("button", {
      name: "Download receipt",
    }),
    screen.getByRole("button", {
      name: "Download private key",
    }),
  ];
}

beforeEach(() => {
  mockedCreateBlindedPackage.mockResolvedValue(createMockPackage());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BlindingWorkspace workflow", () => {
  it("makes a valid uploaded CSV available for a valid blinding selection", async () => {
    const user = userEvent.setup();

    render(<BlindingWorkspace />);

    const columnSelect = screen.getByLabelText("Column to blind");

    expect(columnSelect).toBeDisabled();
    expect(generateButton()).toBeDisabled();

    await uploadCsv(user);

    expect(columnSelect).toBeEnabled();

    await chooseColumn(user, "group");

    expect(generateButton()).toBeEnabled();
  });

  it("keeps package generation blocked for a column with fewer than two categories", async () => {
    const user = userEvent.setup();

    render(<BlindingWorkspace />);

    await uploadCsv(user);
    await chooseColumn(user, "single");

    expect(generateButton()).toBeDisabled();
    expect(mockedCreateBlindedPackage).not.toHaveBeenCalled();
  });

  it("passes the original uploaded bytes and selected column to the core generation boundary", async () => {
    const user = userEvent.setup();

    render(<BlindingWorkspace />);

    downloadButtons().forEach((button) => {
      expect(button).toBeDisabled();
    });

    await uploadCsv(user);
    await chooseColumn(user, "group");
    await user.click(generateButton());

    expect(mockedCreateBlindedPackage).toHaveBeenCalledTimes(1);

    const [sourceBytes, selectedColumn] =
      mockedCreateBlindedPackage.mock.calls[0];

    expect(new TextDecoder().decode(sourceBytes)).toBe(SOURCE_TEXT);
    expect(selectedColumn).toBe("group");

    await screen.findByText("Blinded package created successfully.");

    downloadButtons().forEach((button) => {
      expect(button).toBeEnabled();
    });
  });

  it("invalidates generated artifacts when the selected column or source file changes", async () => {
    const user = userEvent.setup();

    render(<BlindingWorkspace />);

    await uploadCsv(user);
    await chooseColumn(user, "group");
    await user.click(generateButton());
    await screen.findByText("Blinded package created successfully.");

    downloadButtons().forEach((button) => {
      expect(button).toBeEnabled();
    });

    await chooseColumn(user, "alternate");

    downloadButtons().forEach((button) => {
      expect(button).toBeDisabled();
    });

    await user.click(generateButton());
    await screen.findByText("Blinded package created successfully.");

    downloadButtons().forEach((button) => {
      expect(button).toBeEnabled();
    });

    await uploadCsv(
      user,
      "replacement.csv",
      REPLACEMENT_SOURCE_TEXT,
    );

    expect(
      screen.getByLabelText("Column to blind"),
    ).toHaveValue("");

    downloadButtons().forEach((button) => {
      expect(button).toBeDisabled();
    });
  });
});
