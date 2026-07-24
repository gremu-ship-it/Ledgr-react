/**
 * Arena AI Agent client for Ledgr
 * Production-ready wrapper around Arena agents
 */

const ARENA_AGENT_URL =
  import.meta.env.VITE_ARENA_AGENT_URL ||
  'https://api.arena.ai/v1/agents/ledgr-financial-advisor/invoke';

const ARENA_API_KEY = import.meta.env.VITE_ARENA_API_KEY;

interface ArenaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ArenaResponse {
  content: string;
  actions?: Array<{ label: string; path: string; variant?: string }>;
}

/**
 * Calls the configured Arena agent with full financial context.
 */
export async function callArenaAgent(
  messages: ArenaMessage[],
  systemPrompt: string,
  businessContext: string
): Promise<ArenaResponse> {
  const payload = {
    messages: [
      { role: 'system', content: `${systemPrompt}\n\n${businessContext}` },
      ...messages,
    ],
    temperature: 0.3,
    max_tokens: 1200,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (ARENA_API_KEY) {
    headers['Authorization'] = `Bearer ${ARENA_API_KEY}`;
  }

  try {
    const res = await fetch(ARENA_AGENT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Arena agent error ${res.status}: ${errorText}`);
    }

    const data = await res.json();

    return {
      content: data.content || data.output || 'Sorry, I could not generate a response.',
      actions: data.actions || [],
    };
  } catch (err) {
    console.error('[ArenaAgent] Call failed:', err);
    throw err;
  }
}

/**
 * Optional helper: check if Arena is properly configured
 */
export function isArenaConfigured(): boolean {
  return !!ARENA_AGENT_URL && !!ARENA_API_KEY;
}