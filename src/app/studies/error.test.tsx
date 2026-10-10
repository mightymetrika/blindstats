// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import StudiesError from "./error";

afterEach(() => {
  cleanup();
});

describe("Studies error boundary", () => {
  it("shows a safe recovery message without exposing the database error", () => {
    render(
      <StudiesError
        error={new Error("Unable to load Studies: JWT issued at future")}
        reset={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Unable to load Study information" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/JWT issued at future/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("invokes Next.js recovery when the researcher chooses to retry", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<StudiesError error={new Error("Temporary failure")} reset={reset} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
