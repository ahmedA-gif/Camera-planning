import { PlanSection, GenerationState, DEFAULT_PLAN_OUTLINE, SYSTEM_PROMPT, SECTION_PROMPTS } from './types';
import { normalizeUserInput } from './normalize';
import { fetchGroq, getAIConfig, getAICompletionsURL } from '@/lib/ai-provider';

const AI_CONFIG = getAIConfig();
export class PlanEngine {
  private state: GenerationState;

  constructor(userInput: { business_description: string; industry: string; company_name: string; requirements: string[] }) {
    const normalized = normalizeUserInput(userInput);
    this.state = {
      normalized_context: normalized,
      outline: DEFAULT_PLAN_OUTLINE,
      completed_sections: {},
      remaining_sections: DEFAULT_PLAN_OUTLINE.sections.filter(s => s.required).map(s => s.id),
      current_section: null,
      total_generated_tokens: 0,
      rate_limit_remaining: 0,
      last_error: null,
    };
  }

  getState(): GenerationState {
    return { ...this.state };
  }

  async generateNextSection(): Promise<{ section: PlanSection; content: string } | null> {
    if (this.state.remaining_sections.length === 0) return null;

    const sectionId = this.state.remaining_sections[0];
    const section = this.state.outline.sections.find(s => s.id === sectionId);
    if (!section) {
      this.state.remaining_sections.shift();
      return this.generateNextSection();
    }

    this.state.current_section = sectionId;
    const content = await this.generateSection(section);

    this.state.completed_sections[sectionId] = content;
    this.state.remaining_sections.shift();
    this.state.current_section = null;
    return { section, content };
  }

  async generateAllSections(onProgress?: (section: PlanSection, content: string, progress: number) => void): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    const total = this.state.remaining_sections.length;
    let completed = 0;

    while (this.state.remaining_sections.length > 0) {
      const result = await this.generateNextSection();
      if (result) {
        results[result.section.id] = result.content;
        completed++;
        if (onProgress) onProgress(result.section, result.content, completed / total);
      }
    }
    return results;
  }

  async generateFullReport(): Promise<Record<string, string>> {
    const sectionList = this.state.outline.sections;
    const prompt = `Create a practical safety plan using this facility context. Return one valid JSON object with exactly these keys: ${sectionList.map(section => section.id).join(', ')}. Each value should be concise (about 30–45 words), actionable, and specific to the provided facts. Identify unknowns briefly. Never invent measurements, incident history, inspection findings, dates, or regulations.\n\nSections:\n${sectionList.map(section => `${section.id}: ${section.title} — ${section.description}`).join('\n')}\n\nFacility context:\n${JSON.stringify(this.state.normalized_context)}`;
    const raw = await this.callGroqOnce(prompt, 1800, true);
    let parsed: Record<string, unknown>;
    try {
      const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      parsed = JSON.parse(json);
    } catch {
      throw new Error('The AI returned an unreadable plan. Your project brief is saved; please try again.');
    }

    const sections: Record<string, string> = {};
    for (const section of sectionList) {
      const value = parsed[section.id];
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error('The AI returned an incomplete plan. Your project brief is saved; please try again.');
      }
      sections[section.id] = value.trim();
    }
    this.state.completed_sections = sections;
    this.state.remaining_sections = [];
    this.state.current_section = null;
    return sections;
  }

  async generateSection(section: PlanSection): Promise<string> {
    const prompt = `${SECTION_PROMPTS[section.id]}\n\nNormalized Facility Context:\n${JSON.stringify(this.state.normalized_context, null, 2)}\n\nPrevious Sections:\n${this.getPreviousSectionsText()}`;

    if (!AI_CONFIG.apiKey) {
      throw new Error('Plan generation needs a configured AI provider key.');
    }

    try {
      const content = await this.callGroqOnce(prompt, section.estimated_tokens);
      return content;
    } catch (error) {
      this.state.last_error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Section ${section.id} generation failed:`, error);
      throw error;
    }
  }

  private getPreviousSectionsText(): string {
    const completed = Object.entries(this.state.completed_sections);
    if (completed.length === 0) return 'None (first section)';
    return completed.map(([id, content]) => `=== ${id.toUpperCase()} ===\n${content}\n`).join('\n');
  }

  private async callGroqOnce(prompt: string, maxTokens: number, jsonOutput = false): Promise<string> {
    if (!AI_CONFIG.apiKey) throw new Error(`Plan generation needs a configured AI provider key. Add ${AI_CONFIG.keyName}.`);
    const send = async (outputTokens: number): Promise<Response> => {
      try {
        return await fetchGroq(AI_CONFIG.model, getAICompletionsURL(), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: AI_CONFIG.model,
            messages: [
              { role: 'system', content: jsonOutput
                ? 'Write concise, practical workplace safety plans. Use only supplied facts, label unknowns, and never fabricate measurements, incidents, dates, or regulations. Return only the requested JSON object.'
                : SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            max_completion_tokens: outputTokens,
            ...(jsonOutput ? { response_format: { type: 'json_object' as const } } : {}),
          }),
          signal: AbortSignal.timeout(45000),
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new Error('Plan generation timed out. Your brief is saved; please try again.');
        }
        throw new Error('Could not reach the AI provider. Your brief is saved; please try again.');
      }
    };

    let response = await send(Math.min(maxTokens, 1800));
    if (response.status === 429) {
      // Retry the section once with a smaller expected output if tokens-per-minute threshold reached.
      const limitText = await response.text();
      if (/output tokens per minute|too large for model|OTPM/i.test(limitText)) {
        response = await send(Math.min(900, Math.max(300, maxTokens)));
      } else {
        response = new Response(limitText, { status: 429, headers: { 'content-type': 'application/json' } });
      }
    }

    if (response.status === 429) {
      const remainingHeader = response.headers.get('x-ratelimit-remaining-tokens');
      const remainingTokens = remainingHeader === null || remainingHeader.trim() === '' ? Number.NaN : Number(remainingHeader);
      if (Number.isFinite(remainingTokens) && remainingTokens >= 0) this.state.rate_limit_remaining = remainingTokens;
      const limitBody = await response.json().catch(() => ({}));
      const retryAfter = response.headers.get('retry-after');
      const waitHint = retryAfter ? ` Try again in about ${retryAfter} seconds.` : ' Please wait briefly and retry.';
      throw new Error(`${limitBody?.error?.message || 'AI rate limit reached.'}${waitHint} Your brief is saved.`);
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      throw new Error(`AI provider error (${response.status}). ${detail || 'Please try again.'}`);
    }
    const data = await response.json();
    const reportedUsage = Number(data.usage?.total_tokens);
    if (Number.isFinite(reportedUsage) && reportedUsage >= 0) this.state.total_generated_tokens += reportedUsage;
    const remainingHeader = response.headers.get('x-ratelimit-remaining-tokens');
    const remainingTokens = remainingHeader === null || remainingHeader.trim() === '' ? Number.NaN : Number(remainingHeader);
    if (Number.isFinite(remainingTokens) && remainingTokens >= 0) this.state.rate_limit_remaining = remainingTokens;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('The AI provider returned an empty response. Your brief is saved; please try again.');
    return content;
  }


}

export function createPlanEngine(userInput: { business_description: string; industry: string; company_name: string; requirements: string[] }) {
  return new PlanEngine(userInput);
}
