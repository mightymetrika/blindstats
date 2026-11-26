import { StudyFileDeliveryPage } from "@/components/research-transfer/StudyFileDeliveryPage";

type Params = { params: Promise<{ studyId: string; workflowId: string }> };
export default async function ResearchTransferPage({ params }: Params) {
  const { studyId, workflowId } = await params;
  return <StudyFileDeliveryPage studyId={studyId} workflowId={workflowId}/>;
}
