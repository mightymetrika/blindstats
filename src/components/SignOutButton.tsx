export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
        type="submit"
      >
        Sign out
      </button>
    </form>
  );
}
