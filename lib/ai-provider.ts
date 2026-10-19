/**
 * AI Provider Client — Unified NVIDIA NIM Architecture
 * 
 * Drops Grok / Groq and OpenRouter dependencies in favor of NVIDIA NIM
 * (https://integrate.api.nvidia.com/v1) powered by meta/llama-3.2-90b-vision-instruct
 * and deepseek-ai/deepseek-v4.1-flash for both multimodal vision and deep engineering reasoning.
 */

export type AITask = 'text' | 'vision';

export const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1';

// Verified active models on this NVIDIA NIM account:
export const NVIDIA_MODELS = {
  primary: 'meta/llama-3.2-11b-vision-instruct', // Ultra-responsive multimodal vision + reasoning (~1s response time)
  vision: 'meta/llama-3.2-11b-vision-instruct',  // Floor plan & camera image understanding
  heavy: 'meta/llama-3.2-90b-vision-instruct',   // Deep 90B parameter vision
  fast: 'deepseek-ai/deepseek-v4.1-flash',       // Text completion
};

export const DEFAULT_NVIDIA_API_KEY = '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';

export function getNvidiaConfig(task: AITask = 'text') {
  return {
    provider: 'NVIDIA' as const,
    keyName: 'NVIDIA_API_KEY',
    apiKey: process.env.NVIDIA_API_KEY || DEFAULT_NVIDIA_API_KEY,
    baseUrl: NVIDIA_URL,
    model: task === 'vision' ? NVIDIA_MODELS.vision : (process.env.NVIDIA_MODEL || NVIDIA_MODELS.primary),
  };
}

export function getNvidiaCompletionsURL() {
  return `${NVIDIA_URL}/chat/completions`;
}

/** Directly invoke NVIDIA NIM chat completion with authorization headers and timeout guard */
export async function fetchNvidia(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const config = getNvidiaConfig();
  const headers = new Headers(init?.headers);
  if (!headers.has('Authorization') && config.apiKey) {
    headers.set('Authorization', `Bearer ${config.apiKey}`);
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}

/** Seamless backward compatibility routing: getAIConfig now points to NVIDIA NIM */
export function getAIConfig(task: AITask = 'text') {
  const nvidia = getNvidiaConfig(task);
  return {
    provider: 'NVIDIA',
    keyName: 'NVIDIA_API_KEY',
    apiKey: nvidia.apiKey,
    baseUrl: nvidia.baseUrl,
    model: nvidia.model,
  };
}

export function getAICompletionsURL(task: AITask = 'text') {
  return `${NVIDIA_URL}/chat/completions`;
}

export function getLayoutAIConfig() {
  return getNvidiaConfig('text');
}

export function getLayoutAICompletionsURL() {
  return `${NVIDIA_URL}/chat/completions`;
}

/** Backward compatible drop-in: routes old fetchGroq calls directly to NVIDIA NIM */
export async function fetchGroq(model: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const config = getNvidiaConfig();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${config.apiKey}`);
  headers.set('Content-Type', 'application/json');

  // If the body requested an obsolete model, rewrite to NVIDIA's primary model
  let modifiedBody = init?.body;
  if (typeof init?.body === 'string') {
    try {
      const parsed = JSON.parse(init.body);
      if (!parsed.model || !parsed.model.includes('/')) {
        parsed.model = config.model;
        modifiedBody = JSON.stringify(parsed);
      }
    } catch {
      // keep original
    }
  }

  return fetch(getNvidiaCompletionsURL(), {
    ...init,
    headers,
    body: modifiedBody,
  });
}

/** Backward compatible drop-in: routes old fetchOpenRouter calls directly to NVIDIA NIM */
export async function fetchOpenRouter(model: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetchGroq(model, input, init);
}
