"use client";

import { useState } from "react";

type AuthorizationPolicyFieldProps = {
  hasIndependentAuthorizationPair: boolean;
  initialPolicy: string;
};

export function AuthorizationPolicyField({
  hasIndependentAuthorizationPair,
  initialPolicy,
}: AuthorizationPolicyFieldProps) {
  const [authorizationPolicy, setAuthorizationPolicy] = useState(
    initialPolicy === "self_authorization"
      ? "self_authorization"
      : "independent",
  );

  return (
    <div>
      <label className="text-sm font-medium" htmlFor="authorizationPolicy">
        Unblinding authorization
      </label>
      <select
        className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        id="authorizationPolicy"
        name="authorizationPolicy"
        onChange={(event) => setAuthorizationPolicy(event.target.value)}
        value={authorizationPolicy}
      >
        <option value="independent">Independent (recommended)</option>
        <option value="self_authorization">Self-authorization permitted</option>
      </select>

      {authorizationPolicy === "independent" &&
      !hasIndependentAuthorizationPair ? (
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
          Independent authorization needs two different Study members: one who
          can request unblinding and another who can authorize it. Assign a
          blinded analyst in Analysis roles, or choose self-authorization and
          save the draft.
        </p>
      ) : null}
    </div>
  );
}
