"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AgentConfig, LanguageCode } from "../../lib/agent-config-data";
import { type AgentConfigActionState, saveAgentConfig } from "./actions";

const initialState: AgentConfigActionState = {
  status: "idle",
  message: ""
};

const languageOptions: Array<{ label: string; value: LanguageCode; voice: string; stt: string }> = [
  { label: "English", value: "en-IN", voice: "Amelia", stt: "English language hint" },
  { label: "Hindi", value: "hi-IN", voice: "Kavya", stt: "Hindi language hint" },
  { label: "Kannada", value: "kn-IN", voice: "Kavitha", stt: "Kannada language hint" }
];

type LanguageMode = LanguageCode | "mixed";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-950 px-5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
    >
      {pending ? "Saving..." : "Save runtime settings"}
    </button>
  );
}

function FieldLabel({ label, detail }: { label: string; detail?: string }) {
  return (
    <span className="grid gap-1">
      <span className="text-sm font-semibold text-neutral-900">{label}</span>
      {detail ? <span className="text-xs leading-5 text-neutral-500">{detail}</span> : null}
    </span>
  );
}

function Section({
  eyebrow,
  title,
  children
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-5 border-b border-neutral-100 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-semibold text-neutral-950">{title}</h2>
      </div>
      <div className="grid gap-5">{children}</div>
    </section>
  );
}

export function AgentConfigForm({ config }: { config: AgentConfig }) {
  const [state, formAction] = useActionState(saveAgentConfig, initialState);
  const [languageMode, setLanguageMode] = useState<LanguageMode>(
    config.mixedLanguageEnabled ? "mixed" : config.languageCode
  );
  const [primaryLanguage, setPrimaryLanguage] = useState<LanguageCode>(config.languageCode);
  const selectedLanguage = useMemo(
    () => languageOptions.find((option) => option.value === primaryLanguage) ?? languageOptions[0],
    [primaryLanguage]
  );
  const mixedLanguageEnabled = languageMode === "mixed";
  const persistedLanguageCode = mixedLanguageEnabled ? primaryLanguage : (languageMode as LanguageCode);

  return (
    <form action={formAction} className="mt-6 grid gap-5">
      <input type="hidden" name="id" value={config.id ?? ""} />
      <input type="hidden" name="languageCode" value={persistedLanguageCode} />
      <input type="hidden" name="mixedLanguageEnabled" value={mixedLanguageEnabled ? "on" : ""} />

      {state.status !== "idle" ? (
        <div
          role="status"
          className={[
            "rounded-lg border px-4 py-3 text-sm",
            state.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          ].join(" ")}
        >
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-5">
          <Section eyebrow="Business" title="Reception desk profile">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <FieldLabel label="Business name" detail="Spoken in the prompt context." />
                <input
                  name="businessName"
                  defaultValue={config.businessName}
                  required
                  className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
                />
              </label>
              <label className="grid gap-2">
                <FieldLabel label="Callback phone" detail="Used as operator context when callers ask." />
                <input
                  name="businessPhone"
                  defaultValue={config.businessPhone}
                  className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
                />
              </label>
            </div>
            <label className="grid gap-2 md:max-w-sm">
              <FieldLabel label="Business timezone" detail="Booking and dashboard display context." />
              <input
                name="businessTimezone"
                defaultValue={config.businessTimezone}
                required
                className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
              />
            </label>
          </Section>

          <Section eyebrow="Multilingual" title="Language and voice behavior">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="grid gap-2">
                <FieldLabel label="Language mode" detail="Choose one fixed language or lightweight mixed-language mode." />
                <div className="grid gap-2 sm:grid-cols-2">
                  {[...languageOptions, { label: "Mixed Language", value: "mixed" as const, voice: "Primary voice", stt: "Auto-detect" }].map(
                    (option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setLanguageMode(option.value);
                          if (option.value !== "mixed") {
                            setPrimaryLanguage(option.value);
                          }
                        }}
                        className={[
                          "rounded-lg border px-3 py-3 text-left text-sm transition",
                          languageMode === option.value
                            ? "border-neutral-950 bg-neutral-950 text-white"
                            : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"
                        ].join(" ")}
                      >
                        <span className="font-semibold">{option.label}</span>
                        <span className={languageMode === option.value ? "mt-1 block text-xs text-neutral-300" : "mt-1 block text-xs text-neutral-500"}>
                          {option.stt}
                        </span>
                      </button>
                    )
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-semibold text-neutral-950">Current voice route</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs uppercase text-neutral-500">TTS voice</p>
                    <p className="mt-1 font-medium text-neutral-900">{selectedLanguage.voice}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-neutral-500">STT mode</p>
                    <p className="mt-1 font-medium text-neutral-900">
                      {mixedLanguageEnabled ? "Auto-detect" : selectedLanguage.stt}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            {mixedLanguageEnabled ? (
              <label className="grid gap-2 sm:max-w-sm">
                <FieldLabel label="Primary voice for mixed mode" detail="STT auto-detects speech; TTS uses this voice." />
                <select
                  value={primaryLanguage}
                  onChange={(event) => setPrimaryLanguage(event.target.value as LanguageCode)}
                  className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
                >
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} voice
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </Section>

          <Section eyebrow="Conversation" title="Prompt and greeting">
            <label className="grid gap-2">
              <FieldLabel label="Initial greeting" detail="The first line callers hear." />
              <textarea
                name="initialGreeting"
                defaultValue={config.initialGreeting}
                rows={3}
                required
                className="min-h-24 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 outline-none focus:border-neutral-950"
              />
            </label>

            <label className="grid gap-2">
              <FieldLabel label="System prompt" detail="Business behavior, tone, policies, and receptionist rules." />
              <textarea
                name="systemPrompt"
                defaultValue={config.systemPrompt}
                rows={9}
                required
                className="min-h-52 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-6 text-neutral-950 outline-none focus:border-neutral-950"
              />
            </label>
          </Section>

          <Section eyebrow="Booking" title="Appointment handling">
            <label className="grid gap-2">
              <FieldLabel
                label="Booking instructions"
                detail="Used in the runtime prompt before Cal.com availability and booking calls."
              />
              <textarea
                name="bookingInstructions"
                defaultValue={config.bookingInstructions}
                rows={4}
                required
                className="min-h-28 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-6 text-neutral-950 outline-none focus:border-neutral-950"
              />
            </label>
            <div className="grid gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
              <p className="font-semibold text-neutral-950">Runtime booking flow</p>
              <p>Ask preferred time, confirm details, speak short filler, check Cal.com availability, then book.</p>
            </div>
          </Section>
        </div>

        <aside className="grid h-fit gap-5">
          <Section eyebrow="Voice" title="Turn taking">
            <label className="grid gap-2">
              <FieldLabel label="VAD threshold" detail="Lower reacts faster; higher avoids noise." />
              <input
                name="vadThreshold"
                type="number"
                min="0.3"
                max="0.7"
                step="0.01"
                defaultValue={config.vadThreshold}
                required
                className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
              />
            </label>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
              Practical phone-call range is 0.3 to 0.7. The backend clamps unsafe values unless emergency override is
              enabled.
            </div>
          </Section>

          <section className="rounded-xl border border-neutral-200 bg-neutral-950 p-5 text-white shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Runtime summary</p>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-neutral-400">Primary language</span>
                <span className="font-medium">{selectedLanguage.label}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-neutral-400">Voice</span>
                <span className="font-medium">{selectedLanguage.voice}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-neutral-400">Mixed mode</span>
                <span className="font-medium">{mixedLanguageEnabled ? "On" : "Off"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-neutral-400">VAD</span>
                <span className="font-medium">{config.vadThreshold}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-5 border-t border-neutral-200 bg-white/90 px-5 py-4 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-500">
            {config.updatedAt ? `Last updated ${new Date(config.updatedAt).toLocaleString("en-IN")}` : "No saved config yet"}
          </p>
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
