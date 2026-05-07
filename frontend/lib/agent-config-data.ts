import "server-only";
import { queryPostgres } from "./postgres-server";

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
  try {
    const result = await queryPostgres<AgentConfigRow>(
      `
      select id, initial_greeting, system_prompt, vad_threshold, updated_at
      from agent_config
      order by updated_at desc nulls last
      limit 1
      `
    );

    return {
      config: normalizeConfig(result.rows[0] ?? null)
    };
  } catch (error) {
    return {
      config: defaultAgentConfig,
      error: error instanceof Error ? error.message : "Unable to load agent configuration."
    };
  }
}
