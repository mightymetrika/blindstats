// Uploaded CSV bytes are never modified. Only the persisted/download filename is
// normalized to the intentionally conservative Development database allowlist.
export function safeTransferCsvFilename(originalName: string): string {
  if (!/\.csv$/i.test(originalName)) {
    throw new Error("Choose a CSV file to send.");
  }
  const stem = originalName.slice(0, -4)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 156);
  return `${stem || "blinded_dataset"}.csv`;
}
