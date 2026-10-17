import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { fetchOpenRouter, getLayoutAIConfig, getLayoutAICompletionsURL } from '@/lib/ai-provider';

// Allow OpenRouter free models room to answer on Vercel (Hobby plan caps at 60s).
export const maxDuration = 60;

const AI_CONFIG = getLayoutAIConfig();

/** Known-good free models used when the configured router/model returns unusable JSON. */
function getLayoutModelChain(primary: string): string[] {
  const fallbacks = [
    process.env.OPENROUTER_LAYOUT_FALLBACK_MODEL_1 || 'nvidia/nemotron-3-super-120b-a12b:free',
    process.env.OPENROUTER_LAYOUT_FALLBACK_MODEL_2 || 'google/gemma-4-31b-it:free',
  ];
  return [...new Set([primary, ...fallbacks].filter((model): model is string => typeof model === 'string' && model.trim().length > 0))];
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function retryAfterSeconds(response: Response): number | null {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  const reset = response.headers.get('x-ratelimit-reset-requests') || response.headers.get('x-ratelimit-reset-tokens');
  if (reset) {
    const match = reset.match(/(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/);
    if (match && (match[1] || match[2])) return Math.max(1, Math.ceil(Number(match[1] || 0) * 60 + Number(match[2] || 0)));
  }
  return null;
}

/** Leniently read a JSON object from a model reply (handles code fences and surrounding prose). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function normalizePoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

type NormalizedStructure = { name: string; type: 'wall' | 'obstacle' | 'entrance'; points: Array<{ x: number; y: number }>; rationale: string };

function normalizeStructure(raw: unknown): NormalizedStructure[] {
  if (!Array.isArray(raw)) return [];
  const allowedTypes = new Set(['wall', 'obstacle', 'entrance']);
  const items: NormalizedStructure[] = [];
  for (const entry of raw.slice(0, 40)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const type = String(item.type || '').toLowerCase();
    if (!allowedTypes.has(type)) continue;
    const points = Array.isArray(item.points) ? item.points.slice(0, 30).map(normalizePoint).filter((point): point is { x: number; y: number } => point !== null) : [];
    const expanded = type === 'obstacle' && points.length === 2
      ? (() => {
          const left = Math.min(points[0].x, points[1].x);
          const right = Math.max(points[0].x, points[1].x);
          const top = Math.min(points[0].y, points[1].y);
          const bottom = Math.max(points[0].y, points[1].y);
          return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
        })()
      : points;
    const minimumPoints = type === 'obstacle' ? 3 : 2;
    if (expanded.length < minimumPoints) continue;
    items.push({
      name: String(item.name || `${type === 'wall' ? 'Wall' : type === 'obstacle' ? 'Obstacle' : 'Entrance'} ${items.length + 1}`).slice(0, 80),
      type: type as NormalizedStructure['type'],
      points: expanded,
      rationale: String(item.rationale || '').slice(0, 300),
    });
  }
  return items;
}

export async function POST(request: NextRequest) {
  if (!AI_CONFIG.apiKey) {
    return NextResponse.json({ error: `AI layout generation needs ${AI_CONFIG.keyName} configured in .env.local.` }, { status: 503 });
  }

  try {
    const body = await request.json();
    const project = body?.project;
    if (!project || typeof project.id !== 'string' || typeof project.business_description !== 'string') {
      return NextResponse.json({ error: 'Choose a project with a scenario description before generating a layout.' }, { status: 400 });
    }

    const useCases = Array.isArray(project.use_cases) ? project.use_cases.slice(0, 30).map((item: Record<string, unknown>) => ({
      id: String(item.id || ''), name: String(item.name || '').slice(0, 120), description: String(item.description || '').slice(0, 500), task_type: String(item.task_type || 'other'),
    })) : [];
    const zones = Array.isArray(project.zones) ? project.zones.filter((item: Record<string, unknown>) => item.type !== 'virtual_line').slice(0, 30).map((item: Record<string, unknown>) => ({
      id: String(item.id || ''), name: String(item.name || '').slice(0, 100), type: String(item.type || ''), points: Array.isArray(item.points) ? item.points.slice(0, 16) : [],
    })) : [];
    const existingCameras = Array.isArray(project.cameras) ? project.cameras.slice(0, 30).map((item: Record<string, unknown>) => ({
      name: String(item.name || ''), x: item.x, y: item.y, orientation_degrees: item.orientation_degrees, assigned_use_case_ids: item.assigned_use_case_ids,
    })) : [];
    const structure = Array.isArray(project.structure) ? project.structure.slice(0, 40).map((item: Record<string, unknown>) => ({ name: String(item.name || ''), type: item.type, points: item.points })) : [];
    const explicitCount = Number(body.desired_camera_count);
    const hasExplicitCount = Number.isInteger(explicitCount) && explicitCount > 0;
    const inferredTotal = Math.max(
      Array.isArray(project.layout_sections) ? project.layout_sections.length : 0,
      Array.isArray(project.use_cases) ? project.use_cases.length : 0,
      Array.isArray(project.critical_components) ? project.critical_components.length : 0,
      Number(project.layout_section_count) || 0,
      3,
    );
    const existingCameraCount = Array.isArray(project.cameras) ? project.cameras.length : 0;
    const inferredAdditionalCount = Math.max(1, inferredTotal - existingCameraCount);
    const requestedCount = Math.round(clamp(hasExplicitCount ? explicitCount : inferredAdditionalCount, 1, 8, 3));
    const wantsStructure = structure.length === 0;
    const validUseCaseIds = new Set(useCases.map((item: { id: string }) => item.id));
    const context = {
      project_id: project.id,
      project_name: String(project.name || 'Untitled project').slice(0, 120),
      company_name: String(project.company_name || '').slice(0, 160),
      industry: String(project.industry || '').slice(0, 120),
      scenario: project.business_description.slice(0, 6000),
      requirements: Array.isArray(project.requirements) ? project.requirements.slice(0, 30).map((item: unknown) => String(item).slice(0, 300)) : [],
      use_cases: useCases,
      camera_specifications: String(project.camera_specifications || '').slice(0, 1000),
      available_hardware: String(project.available_hardware || '').slice(0, 1000),
      critical_components: Array.isArray(project.critical_components) ? project.critical_components.slice(0, 30) : [],
      layout_sections: Array.isArray(project.layout_sections) ? project.layout_sections.slice(0, 30) : [],
      target_coverage_percent: clamp(project.detection_coverage_target, 1, 100, 90),
      existing_cameras: existingCameras,
      detection_zones: zones,
      site_structure: structure,
    };

    const structureInstruction = wantsStructure
      ? `The project has no drawn site structure. Infer an editable conceptual facility layout for the scenario: the building outline and internal partitions as "wall" polylines, storage racks, machines, columns, or other blockers as "obstacle" rectangles, and doors or gates as "entrance" segments. Keep it small and simple (6-14 elements) and consistent with the scenario.`
      : `The project already has drawn site structure; do NOT duplicate it. You may return an empty "structure" array.`;
    const systemPrompt = `You are a computer-vision site and camera-layout planner with reasoning. Work from the supplied scenario, requirements, use cases, and existing drawing.
${structureInstruction}
Then produce ${requestedCount} additional camera suggestion(s) for the selected project (produce exactly ${requestedCount}, or as close as possible). Use normalized map coordinates from 0 to 1. Position cameras to cover the supplied zones, critical components, entrances, and use cases; account for existing camera positions, walls, and obstacles to avoid duplicates or blocked sight lines. Treat coordinates and view ranges as editable conceptual suggestions, never as measured placements. Keep positions within 0.05-0.95, orientation between 0-359 degrees, horizontal FOV between 30-120 degrees, and view range between 0.2-0.8. Assign only supplied use-case IDs. Explain the reasoning behind the overall plan and each camera briefly. Return compact single-line JSON only (no code fences, no pretty printing), with this shape: {"summary":"...","reasoning":["..."],"structure":[{"name":"...","type":"wall|obstacle|entrance","points":[{"x":0.1,"y":0.1},{"x":0.9,"y":0.1}],"rationale":"..."}],"cameras":[{"name":"...","x":0.5,"y":0.5,"orientation_degrees":180,"horizontal_fov_degrees":90,"view_range":0.5,"resolution_width":1920,"resolution_height":1080,"assigned_use_case_ids":[],"target_area":"...","rationale":"..."}]}. For "wall" and "entrance" use 2 points per segment; for "obstacle" use 4 points forming a rectangle. Keep "reasoning" to at most 6 short items.`;
    const userPrompt = `Requested additional camera count: ${requestedCount}. Generate site structure first if the project has none, then cameras.\nSelected project and scenario context:\n${JSON.stringify(context)}`;

    // OpenRouter free models queue unpredictably, so race the whole model chain
    // concurrently and keep the first valid layout. This keeps the total request
    // comfortably inside Vercel's 60s function budget.
    const ATTEMPT_TIMEOUT_MS = 45_000;

    async function callModel(model: string, jsonMode: boolean, signal: AbortSignal) {
      return fetchOpenRouter(model, getLayoutAICompletionsURL(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AI_CONFIG.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'DetVision Camera Layout Planner',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.2,
          max_completion_tokens: Math.min(2400, 700 + requestedCount * 200),
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.any([AbortSignal.timeout(ATTEMPT_TIMEOUT_MS), signal]),
      });
    }

    const modelChain = getLayoutModelChain(AI_CONFIG.model);

    type AttemptSuccess = { ok: true; model: string; parsed: Record<string, unknown>; cameras: unknown[]; structure: NormalizedStructure[]; usage: Record<string, unknown> | null };
    type AttemptFailure = { ok: false; model: string; status: number; detail: string; response: Response };

    async function attemptModel(model: string, signal: AbortSignal): Promise<AttemptSuccess | AttemptFailure> {
      try {
        let response: Response;
        try {
          response = await callModel(model, true, signal);
          if (response.status === 400) response = await callModel(model, false, signal);
        } catch (error) {
          if (error instanceof Error && error.name === 'TimeoutError') return { ok: false, model, status: 504, detail: 'timeout', response: new Response() };
          return { ok: false, model, status: 502, detail: error instanceof Error ? error.message : 'request failed', response: new Response() };
        }

        if (!response.ok) {
          const responseText = await response.text();
          let detail = '';
          try { detail = JSON.parse(responseText)?.error?.message || ''; } catch { detail = responseText.slice(0, 240); }
          return { ok: false, model, status: response.status, detail, response };
        }

        const data = await response.json();
        // Some routers answer HTTP 200 with an error payload (e.g. an unavailable
        // free model); treat that as a failed attempt.
        if (data && typeof data === 'object' && data.error) {
          const message = typeof data.error === 'object' ? data.error.message || JSON.stringify(data.error) : String(data.error);
          return { ok: false, model, status: 502, detail: String(message).slice(0, 240), response };
        }
        const raw = data.choices?.[0]?.message?.content;
        if (typeof raw !== 'string' || !raw.trim()) return { ok: false, model, status: 502, detail: 'The model returned an empty camera layout.', response };
        const candidate = extractJsonObject(raw);
        const candidateCameras = Array.isArray(candidate?.cameras) ? candidate.cameras : [];
        if (!candidate || candidateCameras.length === 0) return { ok: false, model, status: 502, detail: 'The model returned an incomplete camera layout.', response };
        return {
          ok: true,
          model,
          parsed: candidate,
          cameras: candidateCameras,
          structure: normalizeStructure(candidate.structure),
          usage: data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : null,
        };
      } catch (error) {
        // Never let an attempt reject: a rejected attempt would otherwise leave
        // the race without a winner and the caller waiting until the deadline.
        const detail = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : error instanceof Error ? error.message : 'request failed';
        return { ok: false, model, status: error instanceof Error && error.name === 'TimeoutError' ? 504 : 502, detail, response: new Response() };
      }
    }

    const controllers = modelChain.map(() => new AbortController());
    const failureRank = (status: number) => (status === 401 || status === 403 ? 4 : status === 429 ? 3 : status === 504 ? 2 : 1);
    const results: Array<AttemptSuccess | AttemptFailure | null> = modelChain.map(() => null);

    // Race every model concurrently and take the first valid layout. A hard
    // deadline guarantees a response even when the provider queues a request
    // for minutes and ignores aborts; slower attempts are simply abandoned.
    await new Promise<void>(resolve => {
      let settled = 0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(hardDeadline);
        resolve();
      };
      const hardDeadline = setTimeout(finish, ATTEMPT_TIMEOUT_MS + 3_000);
      hardDeadline.unref?.();
      modelChain.forEach((model, index) => {
        void attemptModel(model, controllers[index].signal).then(outcome => {
          results[index] = outcome;
          settled++;
          if (outcome.ok) {
            controllers.forEach((controller, other) => { if (other !== index) controller.abort(); });
            finish();
          } else if (settled === modelChain.length) {
            finish();
          }
        }, () => {
          results[index] = { ok: false, model, status: 502, detail: 'request failed', response: new Response() };
          settled++;
          if (settled === modelChain.length) finish();
        });
      });
    });

    const settledOutcomes = results.filter((entry): entry is AttemptSuccess | AttemptFailure => entry !== null);
    const success = settledOutcomes.find((entry): entry is AttemptSuccess => entry.ok) ?? null;
    const failure = settledOutcomes
      .filter((entry): entry is AttemptFailure => !entry.ok)
      .sort((a, b) => failureRank(b.status) - failureRank(a.status))[0] ?? null;

    const parsed = success?.parsed ?? null;
    const parsedCameras = success?.cameras ?? [];
    const parsedStructure = success?.structure ?? [];
    const responseUsage = success?.usage ?? null;
    const modelUsed = success?.model ?? modelChain[0];

    if (!parsed) {
      const { status, detail, response } = failure ?? { status: 502, detail: '', response: new Response() };
      const retry_after_seconds = retryAfterSeconds(response);
      if (status === 429) {
        const localGuard = detail.startsWith('Local OpenRouter layout guard');
        return NextResponse.json({
          error: `${localGuard ? detail : 'OpenRouter rate-limited this layout request.'} You can still use the locally generated, editable layout draft.`,
          retry_after_seconds,
          rate_limit: {
            requests: response.headers.get('x-ratelimit-reset-requests'),
            tokens: response.headers.get('x-ratelimit-reset-tokens'),
            remaining_requests: response.headers.get('x-ratelimit-remaining-requests'),
            remaining_tokens: response.headers.get('x-ratelimit-remaining-tokens'),
          },
          provider_detail: detail,
        }, { status: 429, headers: retry_after_seconds ? { 'Retry-After': String(retry_after_seconds) } : undefined });
      }
      const message = status === 504
        ? 'OpenRouter layout generation timed out. Try again or use the local layout suggestion.'
        : status === 401 || status === 403
          ? `OpenRouter rejected ${AI_CONFIG.keyName}. Check that the key is valid.`
          : status === 404
            ? `OpenRouter model "${modelUsed}" was not found.`
            : `OpenRouter layout generation failed (${status})${detail ? `: ${detail}` : '.'}`;
      return NextResponse.json({ error: message }, { status: status === 401 || status === 403 ? 503 : status === 504 ? 504 : 502 });
    }

    const cameras = parsedCameras.slice(0, Math.max(requestedCount, 1) + 2).map((rawCamera, index: number) => {
      const camera = (rawCamera && typeof rawCamera === 'object' ? rawCamera : {}) as Record<string, unknown>;
      return {
        id: randomUUID(),
        name: String(camera.name || `Suggested camera ${index + 1}`).slice(0, 80),
        status: 'planned' as const,
        x: clamp(camera.x, 0.05, 0.95, (index + 1) / (requestedCount + 1)),
        y: clamp(camera.y, 0.05, 0.95, index % 2 ? 0.75 : 0.25),
        orientation_degrees: clamp(camera.orientation_degrees, 0, 359, 180),
        horizontal_fov_degrees: clamp(camera.horizontal_fov_degrees, 30, 120, 90),
        view_range: clamp(camera.view_range, 0.2, 0.8, 0.5),
        resolution_width: Math.round(clamp(camera.resolution_width, 640, 7680, 1920)),
        resolution_height: Math.round(clamp(camera.resolution_height, 480, 4320, 1080)),
        assigned_use_case_ids: Array.isArray(camera.assigned_use_case_ids) ? camera.assigned_use_case_ids.map(String).filter((id: string) => validUseCaseIds.has(id)) : [],
        target_area: String(camera.target_area || '').slice(0, 120),
        rationale: String(camera.rationale || '').slice(0, 300),
      };
    });
    const structureElements = parsedStructure.map(item => ({ id: randomUUID(), ...item }));
    const reasoning = Array.isArray(parsed.reasoning)
      ? parsed.reasoning.filter((item): item is string => typeof item === 'string').slice(0, 6).map(item => item.slice(0, 240))
      : [];
    return NextResponse.json({
      project_id: project.id,
      summary: String(parsed.summary || '').slice(0, 500),
      reasoning,
      cameras,
      structure: structureElements,
      model_used: modelUsed,
      usage: responseUsage ? {
        prompt_tokens: Number(responseUsage.prompt_tokens) || 0,
        completion_tokens: Number(responseUsage.completion_tokens) || 0,
        total_tokens: Number(responseUsage.total_tokens) || 0,
      } : null,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return NextResponse.json({ error: 'OpenRouter layout generation timed out. Try again or use the local layout suggestion.' }, { status: 504 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Camera layout generation failed.' }, { status: 502 });
  }
}
