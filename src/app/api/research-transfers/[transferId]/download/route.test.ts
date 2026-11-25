import { createHash } from "node:crypto";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient as createUserClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: vi.fn(() => ({ url: "https://example.supabase.co", publishableKey: "test" })),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const transferId = "11111111-1111-4111-8111-111111111111";
const studyId = "33333333-3333-4333-8333-333333333333";
const path = `${studyId}/${transferId}.bin`;
const endpoint = `https://blindstats.example/api/research-transfers/${transferId}/download`;
const ctx = { params: Promise.resolve({ transferId }) };
const userClient = vi.mocked(createUserClient);
const adminClient = vi.mocked(createAdminClient);

function request(origin = "https://blindstats.example") {
  return new Request(endpoint, { method: "POST", headers: { origin } });
}
function authorized(mode: "recipient_e2ee_v1" | "managed_at_rest_v1", bytes: Uint8Array) {
  return { path, mode, sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length };
}
function authorizeMock(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  userClient.mockResolvedValue({
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: transferId } }, error: null }) },
    rpc,
  } as unknown as Awaited<ReturnType<typeof createUserClient>>);
  return rpc;
}
function storageMock(bytes: Uint8Array) {
  const download = vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array(bytes)]), error: null });
  adminClient.mockReturnValue({
    storage: { from: vi.fn().mockReturnValue({ download }) },
  } as unknown as ReturnType<typeof createAdminClient>);
  return download;
}

describe("authenticated, audited researcher file downloads", () => {
  beforeEach(() => vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-server-only-secret"));
  afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

  it("rejects cross-origin requests without touching the database", async () => {
    expect((await POST(request("https://untrusted.example"), ctx)).status).toBe(403);
    expect(userClient).not.toHaveBeenCalled();
  });

  it("rejects malformed transfer identifiers before authentication or storage access", async () => {
    const malformed = { params: Promise.resolve({ transferId: "not-a-uuid" }) };
    expect((await POST(request(), malformed)).status).toBe(404);
    expect(userClient).not.toHaveBeenCalled();
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("rejects an authorized record with an unsafe object path before privileged storage access", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const rpc = authorizeMock({
      ...authorized("managed_at_rest_v1", bytes),
      path: `${studyId}/../private-object.bin`,
    });
    expect((await POST(request(), ctx)).status).toBe(403);
    expect(rpc).toHaveBeenCalledOnce();
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("rejects an object path for a different valid transfer ID", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    authorizeMock({ ...authorized("managed_at_rest_v1", bytes),
      path: `${studyId}/22222222-2222-4222-8222-222222222222.bin` });
    expect((await POST(request(), ctx)).status).toBe(403);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("rejects an object above the hosted download limit", async () => {
    authorizeMock({ ...authorized("managed_at_rest_v1", new Uint8Array([1])),
      byteLength: 4 * 1024 * 1024 + 1 });
    expect((await POST(request(), ctx)).status).toBe(403);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    userClient.mockResolvedValue({
      auth: { getClaims: vi.fn().mockResolvedValue({ data: null, error: null }) },
    } as unknown as Awaited<ReturnType<typeof createUserClient>>);
    expect((await POST(request(), ctx)).status).toBe(401);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("blocks unauthorized download before reaching privileged storage", async () => {
    userClient.mockResolvedValue({
      auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: transferId } }, error: null }) },
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } }),
    } as unknown as Awaited<ReturnType<typeof createUserClient>>);
    expect((await POST(request(), ctx)).status).toBe(403);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("requires the server-only Storage credential", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const rpc = authorizeMock(null);
    expect((await POST(request(), ctx)).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["recipient_e2ee_v1", "managed_at_rest_v1"] as const)(
    "serves verified %s objects only after the audited recipient grant", async (mode) => {
      const bytes = new Uint8Array([1, 2, 3]);
      const rpc = authorizeMock(authorized(mode, bytes));
      const download = storageMock(bytes);
      const response = await POST(request(), ctx);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(rpc).toHaveBeenCalledWith("authorize_research_transfer_download_v2", {
        p_transfer_id: transferId,
      });
      expect(download).toHaveBeenCalledWith(path);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    },
  );

  it("rejects a substituted object whose SHA-256 differs", async () => {
    const rpc = authorizeMock(authorized("managed_at_rest_v1", new Uint8Array([1, 2, 3])));
    storageMock(new Uint8Array([1, 2, 4]));
    const response = await POST(request(), ctx);
    expect(response.status).toBe(502);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("rejects an incorrect object length", async () => {
    authorizeMock({ ...authorized("managed_at_rest_v1", new Uint8Array([1, 2])), byteLength: 3 });
    storageMock(new Uint8Array([1, 2]));
    expect((await POST(request(), ctx)).status).toBe(502);
  });
});
