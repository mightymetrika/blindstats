// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatasetPackage } from "@/lib/blinding/package-v05/package";
import { parsePackageReceipt } from "@/lib/blinding/package-v05/receipt";
import { parsePackageAnalysisLock } from "@/lib/blinding/package-v05/analysis-lock";
import { delimitedAdapter } from "@/lib/datasets/adapters/delimited";
import { sha256Hex } from "@/lib/blinding/hashing";
import { ResearchPackageWorkspace, RegisteredPackageVerification } from "./ResearchPackageWorkspace";
import { AnalysisLockWorkspace } from "./AnalysisLockWorkspace";
import { UnblindingWorkspace } from "./UnblindingWorkspace";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const encode = (s: string) => new TextEncoder().encode(s);
const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
const decode = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") throw new Error("Expected receipt text.");
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
};
function file(name: string, bytes: Uint8Array, type = "application/octet-stream") {
  const stable = Uint8Array.from(bytes);
  const f = new File([stable.buffer], name, { type });
  Object.defineProperty(f, "arrayBuffer", { value: async () => stable.buffer });
  return f;
}
const source = encode("arm,id\nControl,1\nActive,2\n");
const followup = encode("study_arm\tscore\nActive\t12\nControl\t18\n");
const generate = () => createDatasetPackage([
  {datasetId:"d1", bytes:source, adapter:delimitedAdapter("csv")},
  {datasetId:"d2", bytes:followup, adapter:delimitedAdapter("tsv")},
], [{members:[{datasetId:"d1",variableId:"v1"},{datasetId:"d2",variableId:"v1"}]}]);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("registered multi-dataset workflow UI", () => {
  it("registers only the public receipt after explicit linking and custody acknowledgement", async () => {
    const user = userEvent.setup();
    const registerAction = vi.fn().mockResolvedValue({ok:true,transformationRecordId:"record"});
    render(<ResearchPackageWorkspace registration={{studyId:"study",workflowId:"workflow",registerAction}}/>);
    await user.upload(screen.getByLabelText("Research datasets (CSV, TSV, XLSX)"), [file("baseline.csv",source,"text/csv"), file("followup.tsv",followup,"text/tab-separated-values")]);
    await user.click(await screen.findByRole("checkbox", {name:"arm"}));
    await user.click(screen.getByRole("checkbox", {name:"study_arm"}));
    await user.selectOptions(screen.getByLabelText("Mapping group for d2 · followup.tsv: study_arm"), "d1:v1");
    await user.click(screen.getByLabelText(/I have checked the selected variables/));
    await user.click(screen.getByRole("button",{name:"Generate package"}));
    const register = await screen.findByRole("button",{name:"Register blinded package"});
    expect(register).toBeDisabled();
    await user.click(screen.getByLabelText(/I saved all blinded files/));
    await user.click(register);
    await waitFor(() => expect(registerAction).toHaveBeenCalledTimes(1));
    const form = registerAction.mock.calls[0][0] as FormData;
    expect(Array.from(form.keys()).sort()).toEqual(["acknowledgeCustody","publicReceiptBase64","studyId","workflowId"]);
    const receipt = await parsePackageReceipt(decode(form.get("publicReceiptBase64")));
    expect(receipt.manifest.datasets).toHaveLength(2);
    expect(receipt.manifest.mappingGroups).toEqual([{groupId:"g1",categoryCount:2,members:[{datasetId:"d1",variableId:"v1"},{datasetId:"d2",variableId:"v1"}]}]);
    expect(router.replace).toHaveBeenCalledWith("/studies/study/blinding/workflow?blinded=1");
  });
  it("verifies the complete registered blinded file set locally", async () => {
    const user = userEvent.setup(); const p = await generate();
    render(<RegisteredPackageVerification receiptBase64={base64(p.receiptArtifact.bytes)} receiptSha256={await sha256Hex(p.receiptArtifact.bytes)}/>);
    const input = screen.getByLabelText("Verify blinded dataset files");
    const verify = screen.getByRole("button", {name:"Verify exact file set"});
    await user.upload(input,file(p.files[0].filename,p.files[0].bytes));
    await user.click(verify);
    expect(await screen.findByRole("alert")).toHaveTextContent("File set does not match");
    await user.upload(input,p.files.map(f=>file(f.filename,f.bytes)));
    await user.click(verify);
    expect(await screen.findByText("All blinded files match the registered package.")).toBeInTheDocument();
  });
  it("uses a v0.5 lock even when only one nonempty analysis artifact is selected", async () => {
    const user = userEvent.setup(); const p = await generate();
    const registerAction = vi.fn().mockResolvedValue({ok:true,lockRecordId:"lock"});
    render(<AnalysisLockWorkspace registration={{studyId:"study",workflowId:"workflow",transformationId:p.receipt.transformationId,publicReceiptBase64:base64(p.receiptArtifact.bytes),publicReceiptSha256:await sha256Hex(p.receiptArtifact.bytes)}} registerAction={registerAction}/>);
    await user.upload(screen.getByLabelText("Analysis artifact"), file("analysis.R",encode("summary(x)")));
    await user.click(screen.getByRole("button",{name:"Create analysis lock"}));
    await screen.findByText("Analysis lock created successfully.");
    await user.click(screen.getByRole("button",{name:"Register analysis lock"}));
    await waitFor(() => expect(registerAction).toHaveBeenCalledTimes(1));
    const form = registerAction.mock.calls[0][0] as FormData;
    const lock = parsePackageAnalysisLock(decode(form.get("analysisLockReceiptBase64")));
    expect(lock.blinding.schemaVersion).toBe("0.5");
    expect(lock.blinding.datasetCommitmentSha256).toBe(p.receipt.manifestSha256);
    expect(lock.analysisArtifacts).toHaveLength(1);
  });
  it("releases an authorized optional-lock package and registers only commitment metadata", async () => {
    const user = userEvent.setup(); const p = await generate();
    const registerAction = vi.fn().mockResolvedValue({ok:true,completionRecordId:"completion"});
    render(<UnblindingWorkspace registration={{studyId:"study",workflowId:"workflow",requestId:"request",transformationId:p.receipt.transformationId,publicReceiptBase64:base64(p.receiptArtifact.bytes),publicReceiptSha256:await sha256Hex(p.receiptArtifact.bytes),lockId:null,analysisLockReceiptBase64:null,analysisLockReceiptSha256:null}} registerAction={registerAction}/>);
    await user.upload(screen.getByLabelText("Unblinding secret"),file("secret.json",p.secretArtifact.bytes,"application/json"));
    await user.click(screen.getByRole("button",{name:"Verify and unblind"}));
    await screen.findByText("Artifact chain verified. Mapping released.");
    await user.click(screen.getByLabelText(/I saved the unblinding receipt/));
    await user.click(screen.getByRole("button",{name:"Register unblinding completion"}));
    await waitFor(() => expect(registerAction).toHaveBeenCalledTimes(1));
    const form = registerAction.mock.calls[0][0] as FormData;
    expect(form.get("schemaVersion")).toBe("0.5");
    expect(form.get("sourceArtifactSha256")).toBe(p.receipt.manifestSha256);
    expect(form.get("blindedArtifactSha256")).toBe(p.receipt.manifestSha256);
    for(const key of ["selectedColumn","selectedColumns","lockId","analysisArtifactSha256","releasedMappings","manifest","unblindingSecret","receiptText"]) expect(form.has(key)).toBe(false);
    expect(Array.from(form.keys()).sort()).toEqual(["acknowledgeCustody","blindedArtifactSha256","blindingReceiptSha256","receiptCreatedAt","requestId","schemaVersion","sourceArtifactSha256","studyId","transformationId","unblindingId","unblindingReceiptSha256","unblindingSecretSha256","workflowId"].sort());
  });
});
