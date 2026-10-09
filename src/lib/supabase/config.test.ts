import { describe, expect, it } from "vitest";

import { validateSupabaseConfig } from "./config";

const key = "sb_publishable_test_value";

describe("Supabase public configuration", () => {
  it("returns trimmed configured values", () => {
    expect(validateSupabaseConfig(" https://example.supabase.co ", ` ${key} `)).toEqual({
      url: "https://example.supabase.co",
      publishableKey: key,
    });
  });

  it("allows local Supabase HTTP development", () => {
    expect(validateSupabaseConfig("http://127.0.0.1:54321", key).url).toBe(
      "http://127.0.0.1:54321",
    );
  });

  it.each([undefined, "", "  "])("rejects missing URL %s", (value) => {
    expect(() => validateSupabaseConfig(value, key)).toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL configuration.",
    );
  });

  it.each([undefined, "", "  "])("rejects missing key %s", (value) => {
    expect(() => validateSupabaseConfig("https://example.supabase.co", value)).toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY configuration.",
    );
  });

  it.each([
    "not-a-url",
    "ftp://example.supabase.co",
    "https://user:password@example.supabase.co",
    "https://example.supabase.co?key=value",
    "https://example.supabase.co#fragment",
  ])("rejects invalid URL %s", (value) => {
    expect(() => validateSupabaseConfig(value, key)).toThrow(
      "Invalid NEXT_PUBLIC_SUPABASE_URL configuration.",
    );
  });
});
