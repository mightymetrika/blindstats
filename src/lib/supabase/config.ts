// Use literal NEXT_PUBLIC_* property access so Next.js can inline these
// values into the browser bundle. Never log the configured key.
export function getSupabaseConfig() {
  return validateSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function validateSupabaseConfig(
  rawUrl: string | undefined,
  rawPublishableKey: string | undefined,
) {
  const url = rawUrl?.trim();
  const publishableKey = rawPublishableKey?.trim();

  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL configuration.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL configuration.");
  }

  if (
    !["https:", "http:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL configuration.");
  }

  if (!publishableKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY configuration.");
  }

  return { url, publishableKey };
}
