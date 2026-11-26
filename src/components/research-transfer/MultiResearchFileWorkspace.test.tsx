// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/blinding/hashing";
import { MultiResearchFileWorkspace } from "./MultiResearchFileWorkspace";
import { sendResearchFile } from "@/lib/research-transfer/research-files";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({useRouter: () => ({refresh})}));
vi.mock("@/lib/supabase/client", () => ({createClient: () => ({})}));
vi.mock("@/lib/research-transfer/research-files", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/research-transfer/research-files")>(), sendResearchFile: vi.fn(),
}));
const common = {studyId:"study",userId:"custodian",role:"custodian" as const,fileProtection:"managed_at_rest_v1" as const,
  canSend:true,packageDelivery:null,recipients:[{userId:"analyst",publicJwk:null}],backup:null,transfers:[]};
const content = new TextEncoder().encode("Synthetic document");
function file(name: string) {
  const stable = Uint8Array.from(content);
  const f = new File([stable.buffer], name);
  Object.defineProperty(f,"arrayBuffer",{value:async()=>stable.buffer}); return f;
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("multi-file research delivery workspace", () => {
  it("requires review for supporting files and preserves successful sends after another file fails", async () => {
    const user = userEvent.setup();
    vi.mocked(sendResearchFile).mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("Synthetic upload failure"));
    render(<MultiResearchFileWorkspace {...common}/>);
    await user.upload(screen.getByLabelText("Choose supporting files"),[file("protocol.txt"),file("codebook.txt")]);
    const send = screen.getByRole("button",{name:"Send files securely"}); expect(send).toBeDisabled();
    await user.click(screen.getByLabelText(/I checked that these files/)); await user.click(send);
    await screen.findByText(/Other successful files remain available/);
    expect(sendResearchFile).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/protocol.txt/,{selector:"strong"}).parentElement).toHaveTextContent("sent");
    expect(screen.getByText(/codebook.txt/,{selector:"strong"}).parentElement).toHaveTextContent("failed: Synthetic upload failure");
    expect(refresh).toHaveBeenCalled();
  });
  it("uses the registered manifest for multiple datasets, with no implicit supporting upload", async () => {
    const user = userEvent.setup(); const sha256 = await sha256Hex(content);
    const packageDelivery = {workflowId:"workflow",transformationId:"transformation",datasets:[
      {datasetId:"d1",blinded:{filename:"blinded-dataset-1.csv",sha256,byteLength:content.length}},
      {datasetId:"d2",blinded:{filename:"blinded-dataset-2.csv",sha256,byteLength:content.length}},
    ]};
    vi.mocked(sendResearchFile).mockResolvedValue("transfer");
    render(<MultiResearchFileWorkspace {...common} packageDelivery={packageDelivery}/>);
    await user.upload(screen.getByLabelText("Choose registered blinded files"),[file("blinded-dataset-1.csv"),file("blinded-dataset-2.csv")]);
    await user.click(screen.getByRole("button",{name:"Send files securely"}));
    await waitFor(()=>expect(sendResearchFile).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sendResearchFile).mock.calls.map(call=>call[2].artifactId)).toEqual(["d1","d2"]);
    await screen.findByText("All selected files are available to the assigned analyst.");
  });
  it("requires a recipient key for strict Studies and does not offer downgrade", async () => {
    const user = userEvent.setup();
    render(<MultiResearchFileWorkspace {...common} fileProtection="recipient_e2ee_v1"/>);
    await user.upload(screen.getByLabelText("Choose supporting files"),file("protocol.txt"));
    await user.click(screen.getByLabelText(/I checked that these files/));
    expect(screen.getByText("Waiting for analyst encryption setup.")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Send files securely"})).toBeDisabled();
  });
});
