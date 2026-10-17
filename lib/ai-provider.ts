export type AITask = 'text' | 'vision';

type ModelRateState = {
  queue: Promise<void>;
  requestTimes: number[];
  remainingRequests: number | null;
  requestsResetAt: number;
  remainingTokens: number | null;
  tokensResetAt: number;
};

type GroqGuardGlobal = typeof globalThis & { __detvisionGroqRateState?: Map<string, ModelRateState> };
const globalState = globalThis as GroqGuardGlobal;
const modelRateState = globalState.__detvisionGroqRateState ??= new Map<string, ModelRateState>();

const BASE_URL = 'https://api.groq.com/openai/v1';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
type OpenRouterGuardState = { queue: Promise<void>; requestTimes: number[] };
type OpenRouterGuardGlobal = typeof globalThis & { __detvisionOpenRouterState?: Map<string, OpenRouterGuardState> };
const openRouterGlobal = globalThis as OpenRouterGuardGlobal;
const openRouterStates = openRouterGlobal.__detvisionOpenRouterState ??= new Map<string, OpenRouterGuardState>();

export function getLayoutAIConfig() {
  return {
    provider: 'OpenRouter',
    keyName: 'OPENROUTER_API_KEY',
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: OPENROUTER_URL,
    model: process.env.OPENROUTER_LAYOUT_MODEL || 'openrouter/free',
  };
}

export function getLayoutAICompletionsURL() {
  return `${OPENROUTER_URL}/chat/completions`;
}

/** Conservative process-local limits for OpenRouter's free tier (50 requests/day). */
export async function fetchOpenRouter(model: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let state = openRouterStates.get(model);
  if (!state) {
    state = { queue: Promise.resolve(), requestTimes: [] };
    openRouterStates.set(model, state);
  }
  const previous = state.queue;
  let release!: () => void;
  state.queue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const now = Date.now();
    state.requestTimes = state.requestTimes.filter(time => now - time < 86_400_000);
    const dailyLimit = Math.max(1, Math.min(45, Number(process.env.OPENROUTER_LAYOUT_MAX_REQUESTS_PER_DAY) || 40));
    const minuteLimit = Math.max(1, Math.min(10, Number(process.env.OPENROUTER_LAYOUT_MAX_REQUESTS_PER_MINUTE) || 3));
    const recent = state.requestTimes.filter(time => now - time < 60_000);
    if (state.requestTimes.length >= dailyLimit || recent.length >= minuteLimit) {
      const retry = state.requestTimes.length >= dailyLimit
        ? Math.ceil((state.requestTimes[0] + 86_400_000 - now) / 1000)
        : Math.ceil((recent[0] + 60_000 - now) / 1000);
      return syntheticRateLimit('Local OpenRouter layout guard paused this request to preserve the configured free-tier budget.', retry);
    }
    state.requestTimes.push(now);
    return await fetch(input, init);
  } finally {
    release();
  }
}

export function getAIConfig(task: AITask = 'text') {
  return {
    provider: 'Groq',
    keyName: 'GROQ_API_KEY',
    apiKey: process.env.GROQ_API_KEY,
    baseUrl: BASE_URL,
    model: task === 'vision'
      ? process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b'
      : process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  };
}

export function getAICompletionsURL(task: AITask = 'text') {
  return `${getAIConfig(task).baseUrl}/chat/completions`;
}

function getModelState(model: string): ModelRateState {
  let state = modelRateState.get(model);
  if (!state) {
    state = { queue: Promise.resolve(), requestTimes: [], remainingRequests: null, requestsResetAt: 0, remainingTokens: null, tokensResetAt: 0 };
    modelRateState.set(model, state);
  }
  return state;
}

function durationMs(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  const match = value.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/);
  return match && (match[1] || match[2] || match[3])
    ? (Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)) * 1000
    : 0;
}

function updateFromHeaders(state: ModelRateState, headers: Headers) {
  const now = Date.now();
  const requestsHeader = headers.get('x-ratelimit-remaining-requests');
  const remainingRequests = requestsHeader === null || requestsHeader.trim() === '' ? Number.NaN : Number(requestsHeader);
  if (Number.isFinite(remainingRequests) && remainingRequests >= 0) state.remainingRequests = remainingRequests;
  const requestReset = durationMs(headers.get('x-ratelimit-reset-requests'));
  if (requestReset > 0) state.requestsResetAt = now + requestReset;
  const tokensHeader = headers.get('x-ratelimit-remaining-tokens');
  const remainingTokens = tokensHeader === null || tokensHeader.trim() === '' ? Number.NaN : Number(tokensHeader);
  if (Number.isFinite(remainingTokens) && remainingTokens >= 0) state.remainingTokens = remainingTokens;
  const tokenReset = durationMs(headers.get('x-ratelimit-reset-tokens'));
  if (tokenReset > 0) state.tokensResetAt = now + tokenReset;
}

function estimateReservedTokens(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;
  const request = body as Record<string, unknown>;
  const messages = JSON.stringify(request.messages ?? request.input ?? '');
  const imageCount = (messages.match(/"image_url"\s*:/g) || []).length;
  const text = messages.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image]');
  const estimatedInput = Math.ceil(text.length / 3) + imageCount * 2048 + (Array.isArray(request.messages) ? request.messages.length * 16 : 16);
  const maxOutput = Number(request.max_completion_tokens ?? request.max_tokens ?? 0);
  return estimatedInput + Math.max(0, Number.isFinite(maxOutput) ? maxOutput : 0) + Math.ceil(estimatedInput * 0.15);
}

function syntheticRateLimit(message: string, retryAfterSeconds: number): Response {
  const retry = Math.max(1, Math.ceil(retryAfterSeconds));
  return new Response(JSON.stringify({ error: { message } }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': String(retry) },
  });
}

/**
 * Pace this server process and reserve against the latest Groq response headers
 * before making another billable request. Groq's account-wide usage from other
 * apps remains outside this local guard's visibility.
 */
export async function fetchGroq(model: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const state = getModelState(model);
  const previous = state.queue;
  let release!: () => void;
  state.queue = new Promise<void>(resolve => { release = resolve; });
  await previous;

  try {
    const now = Date.now();
    state.requestTimes = state.requestTimes.filter(time => now - time < 60_000);
    const configuredLimit = Number(process.env.GROQ_MAX_REQUESTS_PER_MINUTE || 8);
    const requestsPerMinute = Number.isFinite(configuredLimit) ? Math.max(1, Math.min(30, Math.floor(configuredLimit))) : 8;
    if (state.requestTimes.length >= requestsPerMinute) {
      const retry = Math.max(1, Math.ceil((state.requestTimes[0] + 60_000 - now) / 1000));
      return syntheticRateLimit(`Local Groq guard paused this model to stay under ${requestsPerMinute} requests per minute.`, retry);
    }

    if (state.remainingRequests === 0 && state.requestsResetAt > now) {
      return syntheticRateLimit('Local Groq guard paused this model until the provider request limit resets.', (state.requestsResetAt - now) / 1000);
    }
    if (state.requestsResetAt <= now) state.remainingRequests = null;

    const bodyText = typeof init?.body === 'string' ? init.body : '';
    let body: unknown;
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = null; }
    const reservation = estimateReservedTokens(body);
    if (state.remainingTokens !== null && state.tokensResetAt > now && reservation > state.remainingTokens) {
      return syntheticRateLimit('Local Groq guard paused this request because its estimated input and maximum output exceed the remaining token window.', (state.tokensResetAt - now) / 1000);
    }
    if (state.tokensResetAt <= now) state.remainingTokens = null;

    state.requestTimes.push(now);
    const response = await fetch(input, init);
    updateFromHeaders(state, response.headers);
    return response;
  } finally {
    release();
  }
}
