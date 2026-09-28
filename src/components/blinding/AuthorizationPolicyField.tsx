type AuthorizationPolicyFieldProps = {
  initialPolicy: string;
};

export function AuthorizationPolicyField({
  initialPolicy,
}: AuthorizationPolicyFieldProps) {
  return (
    <div>
      <label className="text-sm font-medium" htmlFor="authorizationPolicy">
        Unblinding authorization
      </label>
      <select
        className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        defaultValue={
          initialPolicy === "self_authorization"
            ? "self_authorization"
            : "independent"
        }
        id="authorizationPolicy"
        name="authorizationPolicy"
      >
        <option value="independent">Independent (recommended)</option>
        <option value="self_authorization">Self-authorization permitted</option>
      </select>
    </div>
  );
}
