/** Shown for password-protected catalogs. Plain form post, works without JavaScript. */
export function PasswordGate({ slug, error }: { slug: string; error?: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <form method="post" action={`/c/${encodeURIComponent(slug)}/unlock`} className="grid w-full max-w-xs gap-3 rounded-xl border bg-card p-6">
        <h1 className="text-base font-semibold">This catalog is protected</h1>
        <p className="text-xs text-muted-foreground">Enter the password you were given to view it.</p>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-label="Password"
          className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
        />
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error === "locked" ? "Too many attempts. Try again in 15 minutes." : "That password is not right."}
          </p>
        )}
        <button type="submit" className="h-9 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/80">View catalog</button>
      </form>
    </main>
  );
}
