"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { DASHBOARD_AUTH_COOKIE, verifyDashboardSessionToken } from "../../lib/dashboard-auth";
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
const ttsSpeakerByLanguage: Record<string, string> = {
  "en-IN": "amelia",
  "hi-IN": "kavya",
  "kn-IN": "kavitha"
};

async function requireAuthenticatedConfigSave() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(DASHBOARD_AUTH_COOKIE)?.value;
  const isAuthenticated = await verifyDashboardSessionToken(sessionCookie, process.env.DASHBOARD_PASSWORD);

  if (!isAuthenticated) {
    throw new Error("Sign in before saving agent configuration.");
  }
}

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

function ttsSpeakerForLanguage(languageCode: string) {
  const speaker = ttsSpeakerByLanguage[languageCode];

  if (!speaker) {
    throw new Error("Select a supported language.");
  }

  return speaker;
}

function readOptionalText(formData: FormData, field: string) {
  return String(formData.get(field) ?? "").trim();
}

export async function saveAgentConfig(
  _previousState: AgentConfigActionState,
  formData: FormData
): Promise<AgentConfigActionState> {
  try {
    await requireAuthenticatedConfigSave();

    const id = String(formData.get("id") ?? "").trim();
    const businessName = readRequiredText(formData, "businessName", "Business name");
    const businessPhone = readOptionalText(formData, "businessPhone");
    const businessTimezone = readRequiredText(formData, "businessTimezone", "Business timezone");
    const bookingInstructions = readRequiredText(formData, "bookingInstructions", "Booking instructions");
    const initialGreeting = readRequiredText(formData, "initialGreeting", "Initial greeting");
    const systemPrompt = readRequiredText(formData, "systemPrompt", "System prompt");
    const vadThreshold = readVadThreshold(formData);
    const languageCode = readLanguageCode(formData);
    const ttsSpeaker = ttsSpeakerForLanguage(languageCode);
    const mixedLanguageEnabled = readMixedLanguageEnabled(formData);
    const updatedAt = new Date();

    if (id) {
      await queryPostgres(
        `
        update agent_config
        set business_name = $1,
            business_phone = $2,
            business_timezone = $3,
            booking_instructions = $4,
            initial_greeting = $5,
            system_prompt = $6,
            vad_threshold = $7,
            language_code = $8,
            tts_speaker = $9,
            mixed_language_enabled = $10,
            updated_at = $11
        where id = $12
        `,
        [
          businessName,
          businessPhone,
          businessTimezone,
          bookingInstructions,
          initialGreeting,
          systemPrompt,
          vadThreshold,
          languageCode,
          ttsSpeaker,
          mixedLanguageEnabled,
          updatedAt,
          id
        ]
      );
    } else {
      await queryPostgres(
        `
        insert into agent_config (
          business_name,
          business_phone,
          business_timezone,
          booking_instructions,
          initial_greeting,
          system_prompt,
          vad_threshold,
          language_code,
          tts_speaker,
          mixed_language_enabled,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          businessName,
          businessPhone,
          businessTimezone,
          bookingInstructions,
          initialGreeting,
          systemPrompt,
          vadThreshold,
          languageCode,
          ttsSpeaker,
          mixedLanguageEnabled,
          updatedAt
        ]
      );
    }

    revalidatePath("/agent-config");
    revalidatePath("/business-settings");

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
