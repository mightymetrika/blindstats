import { describe, expect, it } from "vitest";
import { validateHostedOpenPayablesConnection as validate } from "./hosted-connection";

const URL_STRING = "postgresql://openpayables_app_ro.aadqozgamybbksrvoivu:TEST_PASSWORD@aws-1-us-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full";
// A syntactically recognizable fixture, not a trusted or usable CA certificate.
const CA = Buffer.from(`-----BEGIN CERTIFICATE-----\n${"A".repeat(256)}\n-----END CERTIFICATE-----\n`).toString("base64");

describe("OpenPayables hosted connection safety gate", () => {
  it("accepts only the fixed read-only transaction pooler with verified TLS and one connection", () => {
    const actual = validate(URL_STRING, CA, "1");
    expect(actual.url.hostname).toBe("aws-1-us-west-1.pooler.supabase.com");
    expect(actual.url.port).toBe("6543");
    expect(actual.certificate.toString("utf8")).toContain("BEGIN CERTIFICATE");
  });

  it("rejects a writer, different project, database, port or insecure SSL", () => {
    for (const value of [
      URL_STRING.replace("openpayables_app_ro", "openpayables_operator"),
      URL_STRING.replace("aadqozgamybbksrvoivu", "unapproved-project"),
      URL_STRING.replace("/postgres?", "/openpayables?"),
      URL_STRING.replace(":6543/", ":5432/"),
      URL_STRING.replace("sslmode=verify-full", "sslmode=require"),
      URL_STRING.replace("sslmode=verify-full", "sslmode=disable"),
      `${URL_STRING}&sslrootcert=%2Ftmp%2Funverified.pem`,
    ]) {
      expect(() => validate(value, CA, "1")).toThrow();
    }
  });

  it("rejects missing or malformed CA material and unsafe pool sizes", () => {
    expect(() => validate(URL_STRING, undefined, "1")).toThrow();
    expect(() => validate(URL_STRING, "invalid", "1")).toThrow();
    expect(() => validate(URL_STRING, CA, undefined)).toThrow();
    expect(() => validate(URL_STRING, CA, "5")).toThrow();
    expect(() => validate(undefined, CA, "1")).toThrow();
  });
});
