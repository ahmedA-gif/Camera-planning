import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { fetchOpenRouter, getLayoutAIConfig, getLayoutAICompletionsURL } from '@/lib/ai-provider';

const AI_CONFIG = getLayoutAIConfig();

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

    const systemPrompt = `You are a computer-vision camera-layout planner. Produce exactly ${requestedCount} additional camera suggestions for the selected project. Use normalized map coordinates from 0 to 1. Position cameras to cover the supplied zones, critical components, entrances, and use cases; account for existing camera positions to avoid duplicates. Use the scenario and requirements as the source of intent. If there is no floor plan or dimensional data, treat coordinates and view ranges as editable conceptual suggestions, never as measured placements. Keep positions within 0.05–0.95, orientation between 0–359 degrees, horizontal FOV between 30–120 degrees, and view range between 0.2–0.8. Assign only supplied use-case IDs. Return JSON only, with this shape: {"summary":"...","cameras":[{"name":"...","x":0.5,"y":0.5,"orientation_degrees":180,"horizontal_fov_degrees":90,"view_range":0.5,"resolution_width":1920,"resolution_height":1080,"assigned_use_case_ids":[],"target_area":"...","rationale":"..."}]}. Include concise rationale per camera.`;
    const userPrompt = `Requested additional camera count: ${requestedCount}.\nSelected project and scenario context:\n${JSON.stringify(context)}`;
    const response = await fetchOpenRouter(AI_CONFIG.model, getLayoutAICompletionsURL(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'DetVision Camera Layout Planner',
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.2,
        max_completion_tokens: Math.min(1600, 240 + requestedCount * 160),
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      const responseText = await response.text();
      let detail = '';
      try { detail = JSON.parse(responseText)?.error?.message || ''; } catch { detail = responseText.slice(0, 240); }
      if (response.status === 429) {
        const retry_after_seconds = retryAfterSeconds(response);
        const localGuard = detail.startsWith('Local OpenRouter layout guard');
        const resetHeaders = {
          requests: response.headers.get('x-ratelimit-reset-requests'),
          tokens: response.headers.get('x-ratelimit-reset-tokens'),
          remaining_requests: response.headers.get('x-ratelimit-remaining-requests'),
          remaining_tokens: response.headers.get('x-ratelimit-remaining-tokens'),
        };
        return NextResponse.json({
          error: `${localGuard ? detail : 'OpenRouter rate-limited this layout request.'} You can still use the locally generated, editable layout draft.`,
          retry_after_seconds,
          rate_limit: resetHeaders,
          provider_detail: detail,
        }, { status: 429, headers: retry_after_seconds ? { 'Retry-After': String(retry_after_seconds) } : undefined });
      }
      const message = response.status === 401 || response.status === 403
        ? `OpenRouter rejected ${AI_CONFIG.keyName}. Check that the key is valid.`
        : response.status === 404 ? `OpenRouter model "${AI_CONFIG.model}" was not found.`
        : `OpenRouter layout generation failed (${response.status})${detail ? `: ${detail}` : '.'}`;
      return NextResponse.json({ error: message }, { status: response.status === 401 || response.status === 403 ? 503 : 502 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') return NextResponse.json({ error: 'OpenRouter returned an empty camera layout.' }, { status: 502 });
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (!Array.isArray(parsed.cameras) || parsed.cameras.length !== requestedCount) {
      return NextResponse.json({ error: 'OpenRouter returned an incomplete camera layout. Try again.' }, { status: 502 });
    }
    const cameras = parsed.cameras.map((camera: Record<string, unknown>, index: number) => ({
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
    }));
    const usage = data.usage ? {
      prompt_tokens: Number(data.usage.prompt_tokens) || 0,
      completion_tokens: Number(data.usage.completion_tokens) || 0,
      total_tokens: Number(data.usage.total_tokens) || 0,
    } : null;
    return NextResponse.json({ project_id: project.id, summary: String(parsed.summary || ''), cameras, model_used: data.model || AI_CONFIG.model, usage });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return NextResponse.json({ error: 'OpenRouter layout generation timed out. Try again or use the local layout suggestion.' }, { status: 504 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Camera layout generation failed.' }, { status: 502 });
  }
}
