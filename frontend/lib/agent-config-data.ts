import "server-only";
import { createQueryAbortSignal, getSupabaseClient } from "./supabase-server";

export type AgentConfig = {
  id: string | null;
  initialGreeting: string;
  systemPrompt: string;
  vadThreshold: number;
  updatedAt: string | null;
};

export type AgentConfigResult = {
  config: AgentConfig;
  error?: string;
};

type AgentConfigRow = {
  id: string;
  initial_greeting: string | null;
  system_prompt: string | null;
  vad_threshold: number | string | null;
  updated_at: string | null;
};

export const defaultAgentConfig: AgentConfig = {
  id: null,
  initialGreeting: "Hello, thanks for calling. How can I help you today?",
  systemPrompt: "You are a helpful inbound voice agent. Keep responses brief and focused.",
  vadThreshold: 0.5,
  updatedAt: null
};

function normalizeConfig(row: AgentConfigRow | null): AgentConfig {
  if (!row) {
    return defaultAgentConfig;
  }

  const parsedThreshold = Number(row.vad_threshold);

  return {
    id: row.id,
    initialGreeting: row.initial_greeting || defaultAgentConfig.initialGreeting,
    systemPrompt: row.system_prompt || defaultAgentConfig.systemPrompt,
    vadThreshold: Number.isFinite(parsedThreshold) ? parsedThreshold : defaultAgentConfig.vadThreshold,
    updatedAt: row.updated_at
  };
}

export async function getActiveAgentConfig(): Promise<AgentConfigResult> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      config: defaultAgentConfig,
      error: "Supabase service role environment variables are not configured."
    };
  }

  const timeout = createQueryAbortSignal();

  try {
    const result = await supabase
      .from("agent_config")
      .select("id,initial_greeting,system_prompt,vad_threshold,updated_at")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .abortSignal(timeout.signal)
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    return {
      config: normalizeConfig((result.data as AgentConfigRow | null) ?? null)
    };
  } catch (error) {
    return {
      config: defaultAgentConfig,
      error: error instanceof Error ? error.message : "Unable to load agent configuration."
    };
  } finally {
    timeout.cancel();
  }
}
