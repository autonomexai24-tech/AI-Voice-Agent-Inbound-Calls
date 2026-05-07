"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AgentConfig } from "../../lib/agent-config-data";
import { type AgentConfigActionState, saveAgentConfig } from "./actions";

const initialState: AgentConfigActionState = {
  status: "idle",
  message: ""
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
    >
      {pending ? "Saving..." : "Save Configuration"}
    </button>
  );
}

export function AgentConfigForm({ config }: { config: AgentConfig }) {
  const [state, formAction] = useActionState(saveAgentConfig, initialState);

  return (
    <form action={formAction} className="mt-6 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <input type="hidden" name="id" value={config.id ?? ""} />

      {state.status !== "idle" ? (
        <div
          role="status"
          className={[
            "mb-5 rounded-md border px-4 py-3 text-sm",
            state.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          ].join(" ")}
        >
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-5">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-neutral-700">Initial Greeting</span>
          <textarea
            name="initialGreeting"
            defaultValue={config.initialGreeting}
            rows={4}
            required
            className="min-h-28 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-950"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-neutral-700">System Prompt</span>
          <textarea
            name="systemPrompt"
            defaultValue={config.systemPrompt}
            rows={10}
            required
            className="min-h-56 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-6 text-neutral-950 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-950"
          />
        </label>

        <label className="grid gap-2 sm:max-w-xs">
          <span className="text-sm font-medium text-neutral-700">VAD Threshold</span>
          <input
            name="vadThreshold"
            type="number"
            min="0"
            max="1"
            step="0.01"
            defaultValue={config.vadThreshold}
            required
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 outline-none transition-colors focus:border-neutral-950"
          />
          <span className="text-xs text-neutral-500">Valid range: 0.0 to 1.0</span>
        </label>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 border-t border-neutral-200 pt-5">
        <p className="text-sm text-neutral-500">
          {config.updatedAt ? `Last updated ${new Date(config.updatedAt).toLocaleString("en-IN")}` : "No saved config yet"}
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
