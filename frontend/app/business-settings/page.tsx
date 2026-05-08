import { AgentConfigForm } from "../agent-config/config-form";
import { getActiveAgentConfig } from "../../lib/agent-config-data";

export const dynamic = "force-dynamic";

export default async function BusinessSettingsPage() {
  const result = await getActiveAgentConfig();

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Business settings</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal text-neutral-950">Reception Profile</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">
            Update the visible business identity, callback number, timezone, booking rules, and voice runtime behavior
            used by the AI receptionist.
          </p>
        </div>

        {result.error ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {result.error}
          </div>
        ) : null}

        <AgentConfigForm config={result.config} />
      </div>
    </section>
  );
}
