import type { SupabaseClient } from "@supabase/supabase-js";

// The first v46 backend remains a private managed Supabase Storage bucket.
// Existing encrypted-client objects and managed-at-rest objects share paths,
// but an explicit, immutable database transfer_mode differentiates them.
export const RESEARCH_TRANSFER_BUCKET = "blindstats-research-v1";
export const MAX_TRANSFER_OBJECT_BYTES = 4 * 1024 * 1024;

export function transferStoragePath(studyId: string, transferId: string): string {
  return `${studyId}/${transferId}.bin`;
}

export async function uploadTransferObject(
  supabase: SupabaseClient, path: string, bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_TRANSFER_OBJECT_BYTES) {
    throw new Error("File exceeds the 4 MiB transfer limit or is empty.");
  }
  const stable = new Uint8Array(bytes);
  const { error } = await supabase.storage.from(RESEARCH_TRANSFER_BUCKET).upload(
    path, new Blob([stable], { type: "application/octet-stream" }),
    { contentType: "application/octet-stream", upsert: false },
  );
  if (error) throw new Error(`File upload failed: ${error.message}`);
}

// Compatibility with existing v46 recipient-key transfers and integration test.
export const uploadCiphertext = uploadTransferObject;
