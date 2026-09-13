import { login, signup } from "./actions";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-black/10 p-6 shadow-sm dark:border-white/15">
        <p className="text-sm font-medium text-black/60 dark:text-white/60">blindstats</p>
        <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          Sign in to work with persistent Studies.
        </p>

        <form className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="displayName">Display name</label>
            <input className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50" id="displayName" name="displayName" type="text" autoComplete="name" maxLength={100} />
            <p className="mt-1 text-xs text-black/50 dark:text-white/50">Used only when creating a new account.</p>
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="email">Email</label>
            <input className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50" id="email" name="email" type="email" autoComplete="email" required />
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="password">Password</label>
            <input className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50" id="password" name="password" type="password" autoComplete="current-password" minLength={6} required />
          </div>

          <div className="flex gap-3 pt-2">
            <button className="flex-1 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background" formAction={login}>Sign in</button>
            <button className="flex-1 rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20" formAction={signup}>Create account</button>
          </div>
        </form>
      </section>
    </main>
  );
}
