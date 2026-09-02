import { describe, expect, it } from "vitest";

import {
  parseCsvBytes,
  serializeCsvDataset,
} from "./csv";
import { sha256Hex } from "./hashing";
import type { DatasetRow } from "./types";

const encoder = new TextEncoder();

describe("parseCsvBytes", () => {
  it("parses ordinary comma-separated UTF-8 data", () => {
    const parsed = parseCsvBytes(
      encoder.encode(
        "participant_id,treatment,outcome\n" +
          "P001,Treatment,12.4\n" +
          "P002,Control,10.1\n",
      ),
    );

    expect(parsed.columns).toEqual([
      "participant_id",
      "treatment",
      "outcome",
    ]);
    expect(parsed.rows).toEqual([
      {
        participant_id: "P001",
        treatment: "Treatment",
        outcome: "12.4",
      },
      {
        participant_id: "P002",
        treatment: "Control",
        outcome: "10.1",
      },
    ]);
  });

  it("represents empty CSV cells as null without treating text markers as missing", () => {
    const parsed = parseCsvBytes(
      encoder.encode(
        "id,group,note\n" +
          "P001,,NA\n" +
          "P002,Control,N/A\n",
      ),
    );

    expect(parsed.rows).toEqual([
      {
        id: "P001",
        group: null,
        note: "NA",
      },
      {
        id: "P002",
        group: "Control",
        note: "N/A",
      },
    ]);
  });

  it("handles quoted commas, quotes, and embedded line breaks", () => {
    const parsed = parseCsvBytes(
      encoder.encode(
        'id,note\n' +
          'P001,"comma, inside"\n' +
          'P002,"He said ""hello"""\n' +
          'P003,"line one\nline two"\n',
      ),
    );

    expect(parsed.rows).toEqual([
      {
        id: "P001",
        note: "comma, inside",
      },
      {
        id: "P002",
        note: 'He said "hello"',
      },
      {
        id: "P003",
        note: "line one\nline two",
      },
    ]);
  });

  it("accepts a UTF-8 byte order mark without including it in the first column name", () => {
    const content = encoder.encode("id,group\nP001,Treatment\n");
    const bytes = new Uint8Array(content.length + 3);

    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(content, 3);

    const parsed = parseCsvBytes(bytes);

    expect(parsed.columns).toEqual(["id", "group"]);
  });

  it("preserves a one-column empty data cell before the terminal newline", () => {
    const parsed = parseCsvBytes(encoder.encode("group\n\n"));

    expect(parsed.columns).toEqual(["group"]);
    expect(parsed.rows).toEqual([{ group: null }]);
  });

  it("rejects an empty file or header-only dataset", () => {
    expect(() => parseCsvBytes(new Uint8Array())).toThrow(
      "source file is empty",
    );
    expect(() => parseCsvBytes(encoder.encode("id,group\n"))).toThrow(
      "at least one data row",
    );
  });

  it("rejects invalid UTF-8 bytes", () => {
    expect(() =>
      parseCsvBytes(new Uint8Array([0xc3, 0x28])),
    ).toThrow("valid UTF-8");
  });

  it("rejects blank or duplicate column names", () => {
    expect(() =>
      parseCsvBytes(encoder.encode("id,,group\nP001,x,Treatment\n")),
    ).toThrow("column names cannot be blank");

    expect(() =>
      parseCsvBytes(
        encoder.encode("id,group,group\nP001,Treatment,Treatment\n"),
      ),
    ).toThrow("duplicate column name");
  });

  it("rejects nonrectangular records instead of silently repairing them", () => {
    expect(() =>
      parseCsvBytes(
        encoder.encode(
          "id,group,outcome\n" +
            "P001,Treatment,12.4\n" +
            "P002,Control\n",
        ),
      ),
    ).toThrow("fields; expected");
  });

  it("rejects malformed quoted CSV", () => {
    expect(() =>
      parseCsvBytes(
        encoder.encode('id,note\nP001,"unterminated\n'),
      ),
    ).toThrow("CSV parse failed");
  });
});

describe("serializeCsvDataset", () => {
  it("serializes in the explicitly declared column order using LF line endings", () => {
    const rows: DatasetRow[] = [
      {
        outcome: "12.4",
        treatment: "Group_B",
        participant_id: "P001",
      },
      {
        outcome: "10.1",
        treatment: "Group_A",
        participant_id: "P002",
      },
    ];

    const serialized = serializeCsvDataset(
      ["participant_id", "treatment", "outcome"],
      rows,
    );

    expect(serialized.text).toBe(
      "participant_id,treatment,outcome\n" +
        "P001,Group_B,12.4\n" +
        "P002,Group_A,10.1",
    );
    expect(serialized.text).not.toContain("\r\n");
  });

  it("serializes null as an empty cell and correctly escapes CSV content", () => {
    const rows: DatasetRow[] = [
      {
        id: "P001",
        group: null,
        note: 'He said "hello", then left',
      },
      {
        id: "P002",
        group: "Group_A",
        note: "line one\nline two",
      },
    ];

    const serialized = serializeCsvDataset(
      ["id", "group", "note"],
      rows,
    );

    expect(serialized.text).toBe(
      'id,group,note\n' +
        'P001,,"He said ""hello"", then left"\n' +
        'P002,Group_A,"line one\nline two"',
    );
  });

  it("returns bytes for the exact serialized text that can be hashed and downloaded", async () => {
    const rows: DatasetRow[] = [
      {
        id: "P001",
        group: "Group_A",
      },
    ];

    const serialized = serializeCsvDataset(["id", "group"], rows);
    const independentlyEncoded = encoder.encode(serialized.text);

    expect(serialized.bytes).toEqual(independentlyEncoded);
    await expect(sha256Hex(serialized.bytes)).resolves.toBe(
      await sha256Hex(independentlyEncoded),
    );
  });

  it("round-trips supported values through deterministic serialization", () => {
    const rows: DatasetRow[] = [
      {
        id: "P001",
        group: null,
        note: "comma, quote \" and\nnewline",
      },
      {
        id: "P002",
        group: "Group_B",
        note: "ordinary text",
      },
    ];

    const serialized = serializeCsvDataset(
      ["id", "group", "note"],
      rows,
    );
    const reparsed = parseCsvBytes(serialized.bytes);

    expect(reparsed).toEqual({
      columns: ["id", "group", "note"],
      rows,
    });
  });

  it("does not mutate columns or source rows", () => {
    const columns = ["id", "group"];
    const rows: DatasetRow[] = [
      {
        id: "P001",
        group: "Group_A",
      },
    ];
    const columnSnapshot = [...columns];
    const rowSnapshot = structuredClone(rows);

    serializeCsvDataset(columns, rows);

    expect(columns).toEqual(columnSnapshot);
    expect(rows).toEqual(rowSnapshot);
  });

  it("rejects rows whose fields do not exactly match the declared columns", () => {
    expect(() =>
      serializeCsvDataset(
        ["id", "group"],
        [
          {
            id: "P001",
            group: "Group_A",
            unexpected: "value",
          },
        ],
      ),
    ).toThrow("does not match the declared CSV columns");

    expect(() =>
      serializeCsvDataset(
        ["id", "group"],
        [
          {
            id: "P001",
          },
        ],
      ),
    ).toThrow("does not match the declared CSV columns");
  });

  it("rejects empty datasets and invalid declared columns", () => {
    expect(() =>
      serializeCsvDataset(["id"], []),
    ).toThrow("at least one data row");

    expect(() =>
      serializeCsvDataset(
        ["id", "id"],
        [{ id: "P001" }],
      ),
    ).toThrow("duplicate column name");
  });
});
