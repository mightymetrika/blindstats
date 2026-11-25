import { createHash } from "node:crypto";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { MAX_TRANSFER_OBJECT_BYTES, RESEARCH_TRANSFER_BUCKET } from "@/lib/research-transfer/storage";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

type AuthorizedObject = {
  path: string;
  mode: "recipient_e2ee_v1" | "managed_at_rest_v1";
  sha256: string;
  byteLength: number;
};

function validAuthorizedObject(value: unknown): value is AuthorizedObject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.path === "string" &&
    UUID_PATTERN.test(candidate.path.split("/")[0] ?? "") &&
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/.test(candidate.path) &&
    (candidate.mode === "recipient_e2ee_v1" || candidate.mode === "managed_at_rest_v1") &&
    typeof candidate.sha256 === "string" && HASH_PATTERN.test(candidate.sha256) &&
    typeof candidate.byteLength === "number" && Number.isInteger(candidate.byteLength) &&
    candidate.byteLength >= 1 && candidate.byteLength <= MAX_TRANSFER_OBJECT_BYTES;
}

// No client Storage SELECT policy exists. Only the authenticated assigned
// analyst may request this route; PostgreSQL audits the authorization before
// the server-only Storage credential is used. The server must verify object
// integrity whether it contains managed plaintext or client ciphertext.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ transferId: string }> },
) {
  const { transferId } = await params;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Cross-origin transfer request rejected." }, { status: 403 });
  }
  if (!UUID_PATTERN.test(transferId)) {
    return NextResponse.json({ error: "Transfer not found." }, { status: 404 });
  }
  const user = await createClient();
  const { data: claims, error: authError } = await user.auth.getClaims();
  if (authError || !claims?.claims?.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    return NextResponse.json({ error: "Research transfer storage is not configured." }, { status: 503 });
  }
  const { data: authorized, error: authorizeError } = await user.rpc(
    "authorize_research_transfer_download_v2", { p_transfer_id: transferId },
  );
  if (authorizeError || !validAuthorizedObject(authorized) ||
      !authorized.path.endsWith(`/${transferId.toLowerCase()}.bin`)) {
    return NextResponse.json({ error: "Transfer not found or access denied." }, { status: 403 });
  }

  const { url } = getSupabaseConfig();
  const storage = createAdminClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await storage.storage
    .from(RESEARCH_TRANSFER_BUCKET).download(authorized.path);
  if (error || !data) {
    return NextResponse.json({ error: "Unable to retrieve file." }, { status: 502 });
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== authorized.byteLength || actualSha256 !== authorized.sha256) {
    return NextResponse.json({ error: "Stored file integrity verification failed." }, { status: 502 });
  }
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "attachment; filename=research-transfer.bin",
    },
  });
}
