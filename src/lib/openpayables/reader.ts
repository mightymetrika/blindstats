import "server-only";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenPayablesReadOnly } from "openpayables/read";
import { validateHostedOpenPayablesConnection } from "./hosted-connection";

// Reuse the reader's PostgreSQL pool within each warm server process.
let sharedReader: OpenPayablesReadOnly | undefined;

export function getOpenPayablesReader(): OpenPayablesReadOnly {
  // Retain the v44 Production denial independently of the page's access check.
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("The OpenPayables pilot is disabled in Production.");
  }
  if (!sharedReader) {
    const { url, certificate } = validateHostedOpenPayablesConnection(
      process.env.OPENPAYABLES_DATABASE_URL,
      process.env.OPENPAYABLES_TLS_CA_BASE64,
      process.env.OPENPAYABLES_POOL_MAX,
    );

    // node-postgres reads the CA from sslrootcert in the PostgreSQL URL.
    // On Vercel, only /tmp is writable. Never turn off certificate or
    // hostname verification as a workaround for a missing CA.
    const certificateDir = mkdtempSync(join(tmpdir(), "blindstats-openpayables-ca-"));
    const certificateFile = join(certificateDir, "root.crt");
    writeFileSync(certificateFile, certificate, { mode: 0o600, flag: "wx" });
    url.searchParams.set("sslrootcert", certificateFile);

    sharedReader = new OpenPayablesReadOnly(url.toString());
  }
  return sharedReader;
}
