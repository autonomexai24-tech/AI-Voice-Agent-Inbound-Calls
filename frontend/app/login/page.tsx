import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string;
  }>;
};

function normalizeNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login") || value.startsWith("/api/")) {
    return "/dashboard";
  }

  return value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = normalizeNextPath(params?.next);

  return (
    <section className="grid min-h-screen place-items-center px-5 py-8">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-neutral-500">Inbound AI</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-neutral-950">Dashboard Login</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          Enter the shared operator password to access the dashboard.
        </p>
        <LoginForm nextPath={nextPath} />
      </div>
    </section>
  );
}
