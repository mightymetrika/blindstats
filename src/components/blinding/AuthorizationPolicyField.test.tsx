// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { AuthorizationPolicyField } from "./AuthorizationPolicyField";

afterEach(() => {
  cleanup();
});

describe("AuthorizationPolicyField", () => {
  it("renders the saved policy and allows a different policy to be selected before saving", async () => {
    const user = userEvent.setup();

    render(<AuthorizationPolicyField initialPolicy="independent" />);

    const select = screen.getByLabelText("Unblinding authorization");
    expect(select).toHaveValue("independent");

    await user.selectOptions(select, "self_authorization");
    expect(select).toHaveValue("self_authorization");
  });
});
