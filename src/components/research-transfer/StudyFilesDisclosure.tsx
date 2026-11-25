// Shared disclosure styling for the Study files page and its client workspace.
export const studyFilesPanel = "rounded-2xl border border-black/15 p-5 text-sm dark:border-white/20";
export const studyFilesSummary = "flex cursor-pointer list-none items-center gap-2 text-left text-sm font-medium [&::-webkit-details-marker]:hidden";

export function StudyFilesChevron({ open }: { open?: boolean }) {
  const rotation = open === undefined ? "group-open:rotate-90" : open ? "rotate-90" : "";
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16"
    className={`h-4 w-4 shrink-0 ${rotation}`} fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 3 5 5-5 5" />
  </svg>;
}
