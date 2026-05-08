import { AgentConfigForm } from "./config-form";
import { getActiveAgentConfig } from "../../lib/agent-config-data";

export const dynamic = "force-dynamic";

export default async function AgentConfigPage() {
  const result = await getActiveAgentConfig();

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Runtime behavior</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950">Agent Configuration</h1>
          </div>
          <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
            PostgreSQL runtime config
          </div>
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
