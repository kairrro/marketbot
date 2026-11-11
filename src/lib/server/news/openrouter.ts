// OpenRouter: one API for every model. The key lives in .env as
// OPENROUTER_API_KEY and is never sent to the browser. The model is a setting,
// so switching is a dropdown on the News page, not a code change.

import { env } from '$env/dynamic/private';

const BASE = 'https://openrouter.ai/api/v1';

export const aiReady = (): boolean => Boolean(env.OPENROUTER_API_KEY);

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 502
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface ChatArgs {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

interface ChatBody {
  choices?: { finish_reason?: string | null; message?: { content?: string | null } }[];
  error?: { message?: string; code?: number | string };
}

async function post(args: ChatArgs, json: boolean): Promise<Response> {
  return fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user }
      ],
      temperature: args.temperature ?? 0.1,
      max_tokens: args.maxTokens ?? 1500,
      ...(json ? { response_format: { type: 'json_object' } } : {})
    }),
    signal: AbortSignal.timeout(60_000)
  });
}

/** Finds the JSON object in a model's reply, even when it is wrapped in a code fence or a sentence. */
export function parseJsonReply<T>(text: string): T {
  const clean = text.replace(/```(?:json)?/gi, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiError('The model did not answer with JSON.');
  try {
    return JSON.parse(clean.slice(start, end + 1)) as T;
  } catch {
    throw new AiError('The model sent JSON that could not be read.');
  }
}

/** Asks the model for a JSON answer. */
export async function chatJson<T>(args: ChatArgs): Promise<T> {
  if (!aiReady()) throw new AiError('No OpenRouter key. Add OPENROUTER_API_KEY to .env and restart.', 400);
  let json = true;
  let maxTokens = args.maxTokens ?? 1500;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await post({ ...args, maxTokens }, json);
    } catch (err) {
      throw new AiError(`Could not reach OpenRouter: ${err instanceof Error ? err.message : err}`);
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as ChatBody | null;
      const choice = body?.choices?.[0];
      const text = choice?.message?.content;
      // Some models think before they answer and run out of room: ask again with more.
      if ((choice?.finish_reason === 'length' || !text) && attempt < 2 && maxTokens < 8000) {
        maxTokens = Math.min(8000, Math.round(maxTokens * 2.5));
        continue;
      }
      if (!text) throw new AiError(body?.error?.message ?? 'The model sent an empty answer.');
      return parseJsonReply<T>(text);
    }
    const body = (await res.json().catch(() => null)) as ChatBody | null;
    const detail = body?.error?.message ?? `OpenRouter answered ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new AiError('OpenRouter turned down the key in .env (OPENROUTER_API_KEY).', 401);
    if (res.status === 402) throw new AiError('OpenRouter says the account is out of credit.', 402);
    // Some models cannot be forced into JSON mode: ask again without it.
    if (res.status === 400 && json) {
      json = false;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new AiError(detail, res.status);
  }
  throw new AiError('OpenRouter did not answer. Try again in a minute.');
}

export interface ModelInfo {
  id: string;
  name: string;
  /** US dollars per million tokens. */
  inputPrice: number;
  outputPrice: number;
  context: number;
}

let modelCache: { at: number; list: ModelInfo[] } | null = null;

/** Every text model OpenRouter offers (a public list, no key needed), cached for six hours. */
export async function listModels(): Promise<ModelInfo[]> {
  if (modelCache && Date.now() - modelCache.at < 6 * 3_600_000) return modelCache.list;
  const res = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new AiError(`OpenRouter's model list answered ${res.status}`);
  const body = (await res.json()) as {
    data?: {
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      architecture?: { output_modalities?: string[] };
    }[];
  };
  const list = (body.data ?? [])
    .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
    .filter((m) => !m.id.endsWith(':batch'))
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      inputPrice: Number(m.pricing?.prompt ?? 0) * 1e6,
      outputPrice: Number(m.pricing?.completion ?? 0) * 1e6,
      context: m.context_length ?? 0
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  modelCache = { at: Date.now(), list };
  return list;
}
