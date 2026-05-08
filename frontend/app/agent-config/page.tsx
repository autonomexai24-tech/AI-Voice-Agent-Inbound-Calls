import { AgentConfigForm } from "./config-form";
import { getActiveAgentConfig } from "../../lib/agent-config-data";

export const dynamic = "force-dynamic";

export default async function AgentConfigPage() {
  const result = await getActiveAgentConfig();

  return (
    <section className="min-h-screen px-5 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Runtime control center</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-neutral-950">Agent Configuration</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">
              Configure business context, multilingual speech, receptionist tone, booking behavior, and voice turn
              taking. New inbound calls load these settings at runtime.
            </p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-neutral-50 p-3">
              <p className="text-xs text-neutral-500">Primary language</p>
              <p className="mt-1 text-sm font-semibold text-neutral-950">{result.config.languageCode}</p>
            </div>
            <div className="rounded-lg bg-neutral-50 p-3">
              <p className="text-xs text-neutral-500">Mixed mode</p>
              <p className="mt-1 text-sm font-semibold text-neutral-950">
                {result.config.mixedLanguageEnabled ? "Enabled" : "Disabled"}
              </p>
            </div>
            <div className="rounded-lg bg-neutral-50 p-3">
              <p className="text-xs text-neutral-500">Business</p>
              <p className="mt-1 text-sm font-semibold text-neutral-950">{result.config.businessName}</p>
            </div>
            <div className="rounded-lg bg-neutral-50 p-3">
              <p className="text-xs text-neutral-500">VAD threshold</p>
              <p className="mt-1 text-sm font-semibold text-neutral-950">{result.config.vadThreshold}</p>
            </div>
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
