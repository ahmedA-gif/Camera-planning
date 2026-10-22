import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { fetchOpenRouter, getLayoutAIConfig, getLayoutAICompletionsURL, getNvidiaConfig, fetchNvidia, getNvidiaCompletionsURL } from '@/lib/ai-provider';
import { generateStructuredLayout, extractDesiredCameraCount } from '@/lib/rule-based-planner';
import type { Camera, LayoutElement } from '@/lib/types';

// Allow room to answer on Vercel
export const maxDuration = 60;

const AI_CONFIG = getLayoutAIConfig();
const NVIDIA_CONFIG = getNvidiaConfig();

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

/** Leniently read a JSON object from a model reply */
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
      // try next
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
  for (const entry of raw.slice(0, 80)) {
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

/** Attempt to call Python planner service if available */
async function callPythonPlanner(scenario: string, desiredCount: number, useCases: any[]) {
  const docServiceUrl = process.env.DOC_SERVICE_URL || 'http://localhost:8001';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(`${docServiceUrl}/api/v1/planner/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario,
        desired_camera_count: desiredCount,
        use_cases: useCases,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.cameras) && data.cameras.length > 0) {
        return data;
      }
    }
  } catch {
    // Python service not running or unreachable, fallback to TypeScript rule planner
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const project = body?.project;
    if (!project || typeof project.id !== 'string' || typeof project.business_description !== 'string') {
      return NextResponse.json({ error: 'Choose a project with a scenario description before generating a layout.' }, { status: 400 });
    }

    const useCases = Array.isArray(project.use_cases) ? project.use_cases.slice(0, 50).map((item: Record<string, unknown>) => ({
      id: String(item.id || ''), name: String(item.name || '').slice(0, 120), description: String(item.description || '').slice(0, 500), task_type: String(item.task_type || 'other'),
    })) : [];
    const validUseCaseIds = new Set(useCases.map((item: { id: string }) => item.id));

    // Determine requested camera count: strictly respects user specification (body or project cameras or text)
    const rawExplicit = body.desired_camera_count ?? (project.cameras?.length > 0 ? project.cameras.length : undefined);
    const scenarioDetected = extractDesiredCameraCount(project.business_description, rawExplicit);
    const targetCameraCount = Math.max(1, Math.min(250, scenarioDetected || (project.cameras?.length || 12)));

    const forceRuleBased = body.use_rules === true || targetCameraCount > 12 || (!AI_CONFIG.apiKey && !NVIDIA_CONFIG.apiKey);

    // If large camera count (e.g. 70 cameras) or rule-based requested or no AI key:
    // Execute Python script or local geometric rule engine (0 tokens, instant, complete with obstacles)
    if (forceRuleBased) {
      // 1. Try Python service
      const pyResult = await callPythonPlanner(project.business_description, targetCameraCount, useCases);
      if (pyResult) {
        return NextResponse.json({
          project_id: project.id,
          summary: pyResult.summary,
          reasoning: pyResult.reasoning,
          cameras: pyResult.cameras,
          structure: pyResult.structure,
          model_used: 'Python Geometric Rule Engine',
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          source: 'python_rule_engine',
        });
      }

      // 2. Direct TypeScript rule planner
      const ruleResult = generateStructuredLayout(project.business_description, targetCameraCount, useCases);
      return NextResponse.json({
        project_id: project.id,
        summary: ruleResult.summary,
        reasoning: ruleResult.reasoning,
        cameras: ruleResult.cameras,
        structure: ruleResult.structure,
        model_used: 'Local Rule-Based Keyword Engine',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        source: 'local_rule_engine',
      });
    }

    // Otherwise, for small camera requests with AI configured, attempt AI with fallback to rule engine
    try {
      const systemPrompt = `You are a computer-vision site layout planner. Return valid JSON only with keys: summary, reasoning, structure, cameras. Support ${targetCameraCount} cameras. Each camera must have name, x (0.05-0.95), y (0.05-0.95), orientation_degrees (0-359), horizontal_fov_degrees, view_range (0.2-0.8), assigned_use_case_ids, target_area, rationale. Structure must have wall, obstacle, entrance elements with points. Shape: {"summary":"...","reasoning":["..."],"structure":[{"name":"...","type":"wall|obstacle|entrance","points":[{"x":0.1,"y":0.1},{"x":0.9,"y":0.1}],"rationale":"..."}],"cameras":[{"name":"...","x":0.5,"y":0.5,"orientation_degrees":180,"horizontal_fov_degrees":90,"view_range":0.5,"resolution_width":1920,"resolution_height":1080,"assigned_use_case_ids":[],"target_area":"...","rationale":"..."}]}.`;
      const userPrompt = `Generate site structure and ${targetCameraCount} cameras for this scenario:\n${project.business_description}`;

      let aiResponseText = '';
      let modelUsed = 'ai-model';

      if (NVIDIA_CONFIG.apiKey) {
        modelUsed = `NVIDIA (${NVIDIA_CONFIG.model})`;
        const resp = await fetchNvidia(getNvidiaCompletionsURL(), {
          method: 'POST',
          body: JSON.stringify({
            model: NVIDIA_CONFIG.model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            max_tokens: 2500,
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          const resData = await resp.json();
          aiResponseText = resData.choices?.[0]?.message?.content || '';
        }
      }

      if (!aiResponseText && AI_CONFIG.apiKey) {
        modelUsed = AI_CONFIG.model;
        const resp = await fetchOpenRouter(AI_CONFIG.model, getLayoutAICompletionsURL(), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${AI_CONFIG.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: AI_CONFIG.model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            max_completion_tokens: 2500,
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (resp.ok) {
          const resData = await resp.json();
          aiResponseText = resData.choices?.[0]?.message?.content || '';
        }
      }

      if (aiResponseText) {
        const parsed = extractJsonObject(aiResponseText);
        const parsedCameras = Array.isArray(parsed?.cameras) ? parsed.cameras : [];
        if (parsed && parsedCameras.length > 0) {
          const cameras = parsedCameras.map((rawCamera: any, index: number) => ({
            id: randomUUID(),
            name: String(rawCamera.name || `CAM-${index + 1}`).slice(0, 80),
            status: 'planned' as const,
            x: clamp(rawCamera.x, 0.05, 0.95, (index + 1) / (parsedCameras.length + 1)),
            y: clamp(rawCamera.y, 0.05, 0.95, index % 2 ? 0.75 : 0.25),
            orientation_degrees: clamp(rawCamera.orientation_degrees, 0, 359, 180),
            horizontal_fov_degrees: clamp(rawCamera.horizontal_fov_degrees, 30, 180, 90),
            view_range: clamp(rawCamera.view_range, 0.2, 0.8, 0.5),
            resolution_width: 1920,
            resolution_height: 1080,
            assigned_use_case_ids: Array.isArray(rawCamera.assigned_use_case_ids) ? rawCamera.assigned_use_case_ids.filter((id: string) => validUseCaseIds.has(id)) : [],
            target_area: String(rawCamera.target_area || `Section ${index + 1}`).slice(0, 120),
            rationale: String(rawCamera.rationale || 'AI suggested camera view').slice(0, 300),
          }));
          const structureElements = normalizeStructure(parsed.structure).map(item => ({ id: randomUUID(), ...item }));
          const reasoning = Array.isArray(parsed.reasoning) ? parsed.reasoning.map(String).slice(0, 6) : [];

          return NextResponse.json({
            project_id: project.id,
            summary: String(parsed.summary || 'AI generated camera layout.').slice(0, 500),
            reasoning,
            cameras,
            structure: structureElements,
            model_used: modelUsed,
            usage: null,
          });
        }
      }
    } catch (e) {
      console.warn('AI layout attempt failed, falling back to rule engine:', e);
    }

    // Fallback: rule-based generation
    const ruleResult = generateStructuredLayout(project.business_description, targetCameraCount, useCases);
    return NextResponse.json({
      project_id: project.id,
      summary: ruleResult.summary,
      reasoning: ruleResult.reasoning,
      cameras: ruleResult.cameras,
      structure: ruleResult.structure,
      buildings: ruleResult.facility_profile.buildings,
      facility_profile: ruleResult.facility_profile,
      model_used: 'Rule-Based Engine (Fallback)',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      source: 'local_rule_engine',
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Camera layout generation failed.' }, { status: 500 });
  }
}
