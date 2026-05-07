"use server";

import { revalidatePath } from "next/cache";
import { createQueryAbortSignal, getSupabaseClient } from "../../lib/supabase-server";

export type AgentConfigActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function readRequiredText(formData: FormData, field: string, label: string) {
  const value = String(formData.get(field) ?? "").trim();

  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function readVadThreshold(formData: FormData) {
  const rawValue = String(formData.get("vadThreshold") ?? "").trim();
  const value = Number.parseFloat(rawValue);

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("VAD threshold must be a valid number between 0.0 and 1.0.");
  }

  return value;
}

export async function saveAgentConfig(
  _previousState: AgentConfigActionState,
  formData: FormData
): Promise<AgentConfigActionState> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      status: "error",
      message: "Supabase service role environment variables are not configured."
    };
  }

  try {
    const id = String(formData.get("id") ?? "").trim();
    const payload = {
      initial_greeting: readRequiredText(formData, "initialGreeting", "Initial greeting"),
      system_prompt: readRequiredText(formData, "systemPrompt", "System prompt"),
      vad_threshold: readVadThreshold(formData),
      updated_at: new Date().toISOString()
    };

    const timeout = createQueryAbortSignal();

    try {
      const result = id
        ? await supabase.from("agent_config").update(payload).eq("id", id).abortSignal(timeout.signal)
        : await supabase.from("agent_config").insert(payload).abortSignal(timeout.signal);

      if (result.error) {
        throw result.error;
      }
    } finally {
      timeout.cancel();
    }

    revalidatePath("/agent-config");

    return {
      status: "success",
      message: "Agent configuration saved."
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to save agent configuration."
    };
  }
}
