/**
 * v45 hosted TEST pilot: fail closed unless the intended read-only Supabase
 * transaction-pooler endpoint, one-connection pool and CA are configured.
 *
 * No authentication or project authorization occurs here; the existing
 * server-side Supabase user mapping remains the mandatory access gate.
 */
const HOST = "aws-1-us-west-1.pooler.supabase.com";
const USER = "openpayables_app_ro.aadqozgamybbksrvoivu";
const PORT = "6543";

export type HostedConnectionConfig = {
  url: URL;
  certificate: Buffer;
};

export function validateHostedOpenPayablesConnection(
  rawUrl: string | undefined,
  caBase64: string | undefined,
  poolMax: string | undefined,
): HostedConnectionConfig {
  if (!rawUrl) throw new Error("Hosted OpenPayables read-only connection is not configured.");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid hosted OpenPayables connection configuration.");
  }

  // This first pilot is intentionally bound to Mightymetrika's separate
  // Supabase Development instance, never BlindStats' Supabase database.
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("OpenPayables requires a PostgreSQL connection.");
  }
  if (url.hostname !== HOST || url.port !== PORT || url.pathname !== "/postgres" ||
      decodeURIComponent(url.username) !== USER || !url.password || url.hash) {
    throw new Error("Unexpected OpenPayables hosted reader endpoint or role.");
  }
  if (url.searchParams.get("sslmode") !== "verify-full" ||
      [...url.searchParams.keys()].length !== 1) {
    throw new Error("OpenPayables requires sslmode=verify-full with a separately supplied CA.");
  }
  if (poolMax !== "1") {
    throw new Error("The hosted OpenPayables pilot requires OPENPAYABLES_POOL_MAX=1.");
  }
  if (!caBase64 || caBase64.length > 90000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(caBase64)) {
    throw new Error("A valid hosted OpenPayables CA certificate is required.");
  }
  const certificate = Buffer.from(caBase64, "base64");
  const pem = certificate.toString("utf8");
  if (certificate.length < 100 || certificate.length > 65536 ||
      certificate.toString("base64") !== caBase64 ||
      !pem.includes("-----BEGIN CERTIFICATE-----") ||
      !pem.includes("-----END CERTIFICATE-----") ||
      pem.includes("PRIVATE KEY")) {
    throw new Error("Invalid hosted OpenPayables CA certificate material.");
  }

  return { url, certificate };
}
