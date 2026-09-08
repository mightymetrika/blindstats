// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlindedAnalysisWorkflow } from "./BlindedAnalysisWorkflow";

vi.mock("./BlindingWorkspace", () => ({
  BlindingWorkspace: () => <div>Create blinded package workspace</div>,
}));

vi.mock("./AnalysisLockWorkspace", () => ({
  AnalysisLockWorkspace: () => <div>Analysis lock workspace</div>,
}));

afterEach(() => {
  cleanup();
});

describe("BlindedAnalysisWorkflow", () => {
  it("switches between the two file-mediated workflow stages", async () => {
    const user = userEvent.setup();

    render(<BlindedAnalysisWorkflow />);

    expect(
      screen.getByText("Create blinded package workspace"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Analysis lock workspace"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Lock blinded analysis",
      }),
    );

    expect(
      screen.getByText("Analysis lock workspace"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Create blinded package workspace"),
    ).not.toBeInTheDocument();
  });
});
