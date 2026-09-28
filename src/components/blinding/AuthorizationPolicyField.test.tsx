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
  it("hides the independent-authorization warning immediately when self-authorization is selected", async () => {
    const user = userEvent.setup();

    render(
      <AuthorizationPolicyField
        hasIndependentAuthorizationPair={false}
        initialPolicy="independent"
      />,
    );

    expect(
      screen.getByText(/Independent authorization needs two different Study members/i),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Unblinding authorization"),
      "self_authorization",
    );

    expect(
      screen.queryByText(/Independent authorization needs two different Study members/i),
    ).not.toBeInTheDocument();
  });

  it("does not show the warning when an independent requester-authorizer pair exists", () => {
    render(
      <AuthorizationPolicyField
        hasIndependentAuthorizationPair
        initialPolicy="independent"
      />,
    );

    expect(
      screen.queryByText(/Independent authorization needs two different Study members/i),
    ).not.toBeInTheDocument();
  });
});
