import "server-only";
import { OpenPayablesReadOnly } from "openpayables/read";

// A reader owns a pool. Reuse it within this server process, not per page request.
let sharedReader: OpenPayablesReadOnly | undefined;

export function getOpenPayablesReader(): OpenPayablesReadOnly {
  const connectionString = process.env.OPENPAYABLES_DATABASE_URL;
  if (!connectionString) throw new Error("OpenPayables pilot database is not configured.");
  if (!sharedReader) sharedReader = new OpenPayablesReadOnly(connectionString);
  return sharedReader;
}
