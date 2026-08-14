import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in — Family Ledger" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-2 text-4xl">📒</div>
          <h1 className="text-2xl font-semibold tracking-tight">Family Ledger</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One password for the whole family — no accounts, no sign-ups.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
