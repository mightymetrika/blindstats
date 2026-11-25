// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResearchTransferWorkspace } from "./ResearchTransferWorkspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

const commonProps = {
  studyId: "study-1", workflowId: "workflow-1", transformationId: "transformation-1",
  fileProtection: "managed_at_rest_v1" as const,
  expectedSha256: "a".repeat(64), userId: "user-1", transfers: [],
};
const recipientWithoutKey = { userId: "user-2", publicJwk: null };

afterEach(cleanup);

describe("Study files: sender-first managed delivery", () => {
  it("shows an ordinary file chooser and send action without requiring a recipient key", () => {
    render(<ResearchTransferWorkspace {...commonProps} role="custodian"
      recipients={[recipientWithoutKey]} backup={null} />);
    expect(screen.getByText("Send blinded dataset")).toBeInTheDocument();
    expect(screen.getByLabelText("Choose CSV file")).toHaveAttribute("type", "file");
    expect(screen.getByRole("button", { name: "Send file securely" })).toBeDisabled();
    expect(screen.getByText("Delivery: Managed storage (not end-to-end encrypted)")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Use recipient-only encryption" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose CSV file"), { target: { files: [new File(["group\nA\n"], "test.csv", { type: "text/csv" })] } });
    expect(screen.getByRole("button", { name: "Send file securely" })).toBeEnabled();
  });

  it("requires a Study analyst assignment, not advance key enrollment", () => {
    render(<ResearchTransferWorkspace {...commonProps} role="custodian"
      recipients={[]} backup={null} />);
    expect(screen.getByText(/An analyst needs to be assigned/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send file securely" })).not.toBeInTheDocument();
  });

  it("does not force setup or a passphrase on an analyst with no transfer", () => {
    render(<ResearchTransferWorkspace {...commonProps} role="analyst"
      recipients={[]} backup={null} />);
    expect(screen.getByText("Files shared with you")).toBeInTheDocument();
    expect(screen.getByText("No files yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Recovery passphrase/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up Study encryption" })).not.toBeInTheDocument();
  });

  it("requires the Study-specific key in strict mode without a downgrade toggle", () => {
    const { rerender } = render(<ResearchTransferWorkspace {...commonProps} fileProtection="recipient_e2ee_v1" role="custodian"
      recipients={[recipientWithoutKey]} backup={null} />);
    fireEvent.change(screen.getByLabelText("Choose CSV file"), { target: { files: [new File(["group\nA\n"], "test.csv", { type: "text/csv" })] } });
    expect(screen.getByText("Waiting for analyst encryption setup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send file securely" })).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    rerender(<ResearchTransferWorkspace {...commonProps} fileProtection="recipient_e2ee_v1" role="custodian"
      recipients={[{ userId: "user-2", publicJwk: { kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43) } }]} backup={null} />);
    expect(screen.getByText("Ready to send")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send file securely" })).toBeEnabled();
  });

  it("prompts an analyst in a strict Study to set up encryption even before any file arrives", () => {
    render(<ResearchTransferWorkspace {...commonProps} fileProtection="recipient_e2ee_v1" role="analyst" recipients={[]} backup={null} />);
    expect(screen.getByLabelText(/Recovery passphrase/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up Study encryption" })).toBeInTheDocument();
  });

  it("offers managed download immediately even when the analyst has no private key", () => {
    render(<ResearchTransferWorkspace {...commonProps} role="analyst" recipients={[]}
      backup={null} transfers={[{
        id: "transfer-1", filename: "synthetic_blinded.csv", sender_id: "user-2",
        recipient_id: "user-1", state: "ready", transfer_mode: "managed_at_rest_v1",
        plaintext_sha256: "a".repeat(64), ciphertext_sha256: "a".repeat(64),
        ciphertext_byte_length: 55, envelope: { version: "v46-managed-atrest-1" },
        created_at: "2026-11-23T00:00:00Z", ready_at: "2026-11-23T00:00:01Z",
      }]} />);
    expect(screen.getByRole("button", { name: "Download file" })).toBeEnabled();
    expect(screen.queryByText("Passphrase for recipient-encrypted files")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Recovery passphrase/)).not.toBeInTheDocument();
  });
});
