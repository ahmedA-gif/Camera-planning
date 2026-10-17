import { NextRequest, NextResponse } from 'next/server';
import { fetchGroq, getAIConfig, getAICompletionsURL } from '@/lib/ai-provider';

// Allow slow AI providers room to answer on Vercel (Hobby plan caps at 60s).
export const maxDuration = 60;

const AI_CONFIG = getAIConfig('vision');
const MODEL = AI_CONFIG.model;
const CAMERA_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low', 'info'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          camera_ids: { type: 'array', items: { type: 'string' } },
          use_case_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['severity', 'title', 'detail', 'camera_ids', 'use_case_ids'],
        additionalProperties: false,
      },
    },
    next_steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'findings', 'next_steps'],
  additionalProperties: false,
};

function callAI(model: string, apiKey: string, content: Array<Record<string, unknown>>) {
  return fetchGroq(model, getAICompletionsURL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You review camera layouts for computer-vision projects. Use only supplied facts, distinguish assumptions from findings, and return concise valid JSON.' },
        { role: 'user', content },
      ],
      temperature: 0.2,
      max_completion_tokens: 900,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'camera_setup_review', strict: true, schema: CAMERA_REVIEW_SCHEMA },
      },
    }),
    signal: AbortSignal.timeout(45000),
  });
}

function getRetryDelayMs(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  const duration = value.match(/(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/);
  return duration && (duration[1] || duration[2]) ? Math.max(0, (Number(duration[1] || 0) * 60 + Number(duration[2] || 0)) * 1000) : 0;
}

export async function POST(request: NextRequest) {
  const apiKey = AI_CONFIG.apiKey;
  if (!apiKey) {
    return NextResponse.json({ error: `AI camera review needs ${AI_CONFIG.keyName} configured on the server.` }, { status: 503 });
  }

  try {
    const { project, diagram_image } = await request.json();
    if (!project || !Array.isArray(project.cameras) || !Array.isArray(project.use_cases)) {
      return NextResponse.json({ error: 'Project camera and use-case data is required for review.' }, { status: 400 });
    }

    const reviewInput = {
      project: {
        name: project.name,
        industry: project.industry,
        facility_description: project.business_description,
        use_cases: project.use_cases.map((item: Record<string, unknown>) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          task_type: item.task_type,
          input_description: item.input_description,
          camera_ids: item.camera_ids,
        })),
        cameras: project.cameras.map((camera: Record<string, unknown>) => ({
          id: camera.id,
          name: camera.name,
          x: camera.x,
          y: camera.y,
          orientation_degrees: camera.orientation_degrees,
          horizontal_fov_degrees: camera.horizontal_fov_degrees,
          view_range: camera.view_range,
          resolution: `${camera.resolution_width}x${camera.resolution_height}`,
          assigned_use_case_ids: camera.assigned_use_case_ids,
        })),
        zones: (project.zones ?? []).map((zone: Record<string, unknown>) => ({ name: zone.name, type: zone.type, points: zone.points, camera_ids: zone.camera_ids })),
        structure: (project.structure ?? []).map((element: Record<string, unknown>) => ({ name: element.name, type: element.type, points: element.points })),
      },
    };

    const prompt = `Review this proposed camera layout as a computer-vision system designer. Assess camera placement, FOV, range, resolution fit, sight lines, use-case assignments, and missing information. Coordinates are normalized from 0 to 1; orientations are degrees clockwise from north. The attached diagram is the complete current map: its visible labels identify cameras, walls, obstacles, entrances, zones, and counting lines. Cross-check the diagram against the structured geometry below; use the structured geometry as authoritative if visual interpretation differs. Do not discuss workflow design or invent dimensions. Return at most 6 important findings and at most 5 next steps. Keep each finding detail to one concise sentence. The response must follow the supplied JSON schema exactly.\n\nLabeled camera setup diagram and layout data:\n${JSON.stringify(reviewInput)}`;

    const userContent: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
    const attachedDiagram = typeof diagram_image === 'string' && diagram_image.startsWith('data:image/') && diagram_image.length < 8_000_000
      ? diagram_image
      : project.floor_plan_image;
    if (typeof attachedDiagram === 'string' && attachedDiagram.startsWith('data:image/') && attachedDiagram.length < 8_000_000) {
      userContent.push({ type: 'image_url', image_url: { url: attachedDiagram } });
    }

    const modelChain = [MODEL];
    let modelUsed = MODEL;
    let firstModelFailure: number | null = null;
    let response: Response | null = null;

    for (let index = 0; index < modelChain.length; index++) {
      modelUsed = modelChain[index];
      // Include the optional diagram for multimodal models; all models get full layout geometry.
      const modelContent = index === 0 ? userContent : [{ type: 'text', text: prompt }];
      response = await callAI(modelUsed, apiKey, modelContent);
      if (response.ok) break;
      if (firstModelFailure === null) firstModelFailure = response.status;

      const canFailOver = [400, 404, 429].includes(response.status) && index < modelChain.length - 1;
      if (canFailOver) continue;

      // Respect one short provider cooldown after exhausting model failover.
      if (response.status === 429 && index === modelChain.length - 1) {
        const retryDelayMs = getRetryDelayMs(response.headers.get('retry-after'));
        if (retryDelayMs > 0 && retryDelayMs <= 5000) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          response = await callAI(modelUsed, apiKey, modelContent);
        }
      }
      break;
    }

    if (!response) throw new Error('No camera-review model was available.');

    if (!response.ok) {
      let detail = '';
      const responseText = await response.text();
      try {
        const body = JSON.parse(responseText);
        detail = body?.error?.message || '';
      } catch {
        detail = responseText.slice(0, 240);
      }
      const status = response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 503 : 502;
      const retryDelay = response.status === 429 ? getRetryDelayMs(response.headers.get('retry-after') || response.headers.get('x-ratelimit-reset-tokens') || response.headers.get('x-ratelimit-reset-requests')) : 0;
      const retry_after_seconds = retryDelay > 0 ? Math.ceil(retryDelay / 1000) : null;
      const waitMessage = retry_after_seconds ? ` Try again in about ${retry_after_seconds} seconds.` : ' Check the Groq project token and request limits before retrying.';
      const message = response.status === 429 ? `${detail.startsWith('Local Groq guard') ? detail : 'Groq rate-limited this camera review.'}${waitMessage} The local layout checks are still available.`
        : response.status === 401 || response.status === 403 ? `AI provider rejected ${AI_CONFIG.keyName}. Check that the key is valid.`
        : response.status === 404 ? `AI model "${modelUsed}" was not found. Check the selected provider model setting.`
        : `AI camera review failed${detail ? `: ${detail}` : ` (${response.status})`}.`;
      return NextResponse.json({ error: message, retry_after_seconds, rate_limit: response.status === 429 ? {
        reset_requests: response.headers.get('x-ratelimit-reset-requests'),
        reset_tokens: response.headers.get('x-ratelimit-reset-tokens'),
        remaining_requests: response.headers.get('x-ratelimit-remaining-requests'),
        remaining_tokens: response.headers.get('x-ratelimit-remaining-tokens'),
      } : undefined, provider_detail: response.status === 429 ? detail : undefined }, { status });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('The AI returned an empty camera review.');
    const review = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (typeof review.summary !== 'string' || !Array.isArray(review.findings) || !Array.isArray(review.next_steps)) {
      throw new Error('The AI returned an incomplete camera review. Try again.');
    }
    return NextResponse.json({
      ...review,
      mode: modelUsed !== MODEL ? 'ai_model_failover' : 'ai',
      model_used: modelUsed,
      usage: data.usage ? {
        prompt_tokens: Number(data.usage.prompt_tokens) || 0,
        completion_tokens: Number(data.usage.completion_tokens) || 0,
        total_tokens: Number(data.usage.total_tokens) || 0,
      } : null,
      provider_notice: modelUsed !== MODEL ? `The primary model returned ${firstModelFailure}; this review was generated by alternate model ${modelUsed}.` : undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Camera review timed out after 45 seconds. Try again.' }, { status: 504 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Camera review failed.' }, { status: 502 });
  }
}
