import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResearchPackageWorkspace } from "@/components/blinding/ResearchPackageWorkspace";

export default async function DevelopmentResearchPackagePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  return <main className="mx-auto w-full max-w-5xl space-y-5 px-6 py-10">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Local research package — Development only</h1><p className="text-sm">Use synthetic data only. This workspace does not register a transformation or lock, authorize unblinding, deliver files, or change Study state.</p></header>
    <ResearchPackageWorkspace/>
  </main>;
}
