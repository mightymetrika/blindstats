import { StudyFileDeliveryPage } from "@/components/research-transfer/StudyFileDeliveryPage";

export default async function SupportingFilesPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  return <StudyFileDeliveryPage studyId={studyId}/>;
}
