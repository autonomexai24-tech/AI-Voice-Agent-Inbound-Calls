"use server";

import { revalidatePath } from "next/cache";
import { queryPostgres } from "../../lib/postgres-server";

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

  if (!Number.isFinite(value) || value < 0.3 || value > 0.7) {
    throw new Error("VAD threshold must be a valid number between 0.3 and 0.7.");
  }

  return value;
}

const supportedLanguageCodes = new Set(["en-IN", "hi-IN", "kn-IN"]);

function readLanguageCode(formData: FormData) {
  const value = String(formData.get("languageCode") ?? "").trim();

  if (!supportedLanguageCodes.has(value)) {
    throw new Error("Select a supported language.");
  }

  return value;
}

function readMixedLanguageEnabled(formData: FormData) {
  return String(formData.get("mixedLanguageEnabled") ?? "").trim() === "on";
}

export async function saveAgentConfig(
  _previousState: AgentConfigActionState,
  formData: FormData
): Promise<AgentConfigActionState> {
  try {
    const id = String(formData.get("id") ?? "").trim();
    const initialGreeting = readRequiredText(formData, "initialGreeting", "Initial greeting");
    const systemPrompt = readRequiredText(formData, "systemPrompt", "System prompt");
    const vadThreshold = readVadThreshold(formData);
    const languageCode = readLanguageCode(formData);
    const mixedLanguageEnabled = readMixedLanguageEnabled(formData);
    const updatedAt = new Date();

    if (id) {
      await queryPostgres(
        `
        update agent_config
        set initial_greeting = $1,
            system_prompt = $2,
            vad_threshold = $3,
            language_code = $4,
            mixed_language_enabled = $5,
            updated_at = $6
        where id = $7
        `,
        [initialGreeting, systemPrompt, vadThreshold, languageCode, mixedLanguageEnabled, updatedAt, id]
      );
    } else {
      await queryPostgres(
        `
        insert into agent_config (
          initial_greeting,
          system_prompt,
          vad_threshold,
          language_code,
          mixed_language_enabled,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6)
        `,
        [initialGreeting, systemPrompt, vadThreshold, languageCode, mixedLanguageEnabled, updatedAt]
      );
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
