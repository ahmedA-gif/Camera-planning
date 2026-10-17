import { NextRequest, NextResponse } from 'next/server';
import { validateAnalysisRequest } from '@/lib/validation';
import { createEmptyProject } from '@/lib/project-factory';
import type { TaskType, FeasibilityStatus } from '@/lib/types';
import { fetchGroq, getAIConfig, getAICompletionsURL } from '@/lib/ai-provider';

const SYSTEM_PROMPT = `You are a computer vision architect. Return only a JSON object with these keys: use_cases, assumptions, missing_information, camera_recommendations. Create 1–4 concise use cases based on the supplied facility and requirements. Each use case must include name, description, task_type (object_detection|classification|segmentation|ocr|measurement|tracking|counting|anomaly_detection|pose_estimation|other), candidate_techniques (array), input_description, output_description, feasibility_status (feasible|conditional|infeasible|unknown), feasibility_notes (array), acceptance_criteria (array with at least one item), and assumptions (array). camera_recommendations must be a short array of practical camera specification and placement suggestions (resolution, lens/FOV, frame rate, lighting/environment rating) guided by the supplied inputs. Treat coverage as a target, not a measured result. Use practical techniques where relevant. Do not create IDs, cameras, zones, or workflow data. Never claim unknown site facts are confirmed.`;

async function callAI(prompt: string): Promise<string> {
  const config = getAIConfig();
  const { apiKey, model, provider, keyName } = config;
  if (!apiKey) throw new Error(`AI analysis needs a configured provider key. Add ${keyName}.`);

  const send = async (maxTokens: number): Promise<Response> => {
    try {
      return await fetchGroq(model, getAICompletionsURL(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_completion_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(45000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('AI analysis timed out after 45 seconds. Try again later.');
      }
      throw new Error('Could not reach the AI provider. Check your network and try again.');
    }
  };

  let response = await send(2400);
  if (response.status === 429) {
    // Some Groq models enforce a low output-tokens-per-minute limit; retry once
    // with a smaller expected output instead of failing the whole analysis.
    const limitText = await response.text();
    if (/output tokens per minute|too large for model|OTPM/i.test(limitText)) {
      response = await send(900);
    } else {
      response = new Response(limitText, { status: 429, headers: { 'content-type': 'application/json' } });
    }
  }

  if (!response.ok) {
    let providerMessage = '';
    const responseText = await response.text();
    try {
      const body = JSON.parse(responseText);
      providerMessage = body?.error?.message || body?.message || '';
    } catch {
      providerMessage = responseText.slice(0, 240);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${provider} rejected ${keyName}. Check that the key is valid and active.`);
    }
    if (response.status === 404) {
      throw new Error(`AI model "${model}" was not found. Check the ${provider} model setting.`);
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      throw new Error(`${providerMessage || 'The Groq rate guard paused this request.'}${retryAfter ? ` Try again in about ${retryAfter} seconds.` : ''}`);
    }
    throw new Error(`AI provider returned ${response.status}${providerMessage ? `: ${providerMessage}` : '.'}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('The AI provider returned an empty analysis. Try again.');
  }
  return content;
}

export async function POST(request: NextRequest) {
  let business_description = '';
  try {
    const body = await request.json();
    const validation = validateAnalysisRequest(body);
    
    business_description = validation.business_description;
    const { industry, company_name, requirements, use_ai } = validation;
    const planningInputs = {
      camera_specifications: validation.camera_specifications || '',
      available_hardware: validation.available_hardware || '',
      critical_components: validation.critical_components || [],
      layout_section_count: validation.layout_section_count || 1,
      layout_sections: validation.layout_sections || [],
      detection_coverage_target: validation.detection_coverage_target || 90,
      output_scope: validation.output_scope || [],
      image_observation: validation.image_observation || '',
    };
    const now = new Date().toISOString();

    if (use_ai && !getAIConfig().apiKey) {
      return NextResponse.json({ error: `AI analysis is selected, but no Groq key is configured. Add GROQ_API_KEY to .env.local and restart the dev server.` }, { status: 503 });
    }

    if (!use_ai) {
      const project = createEmptyProject(
        business_description.slice(0, 60).trim(),
        company_name || '',
        industry || '',
        business_description,
      );
      project.requirements = requirements || [];
      Object.assign(project, planningInputs);
      project.camera_recommendations = [
        planningInputs.camera_specifications
          ? `Compare the supplied camera specifications with the smallest target object at the farthest viewing distance; confirm pixel density in a field test.`
          : `Start with 1080p or higher, then choose resolution from the smallest target object and farthest camera distance.`,
        `Select lens and horizontal field of view per ${planningInputs.layout_section_count} layout section(s); use overlapping views where critical areas must stay visible.`,
        `Choose frame rate for the speed of the motion being analyzed, and check lighting, exposure, and environmental protection at the mounting location.`,
      ];
      const intents = requirements?.length ? requirements : [business_description];
      project.use_cases = intents.map((intent) => {
        const text = intent.toLowerCase();
        const task_type = text.includes('count') ? 'counting'
          : text.includes('read') || text.includes('text') || text.includes('ocr') ? 'ocr'
          : text.includes('track') ? 'tracking'
          : text.includes('classif') ? 'classification'
          : text.includes('segment') ? 'segmentation'
          : text.includes('anomal') || text.includes('defect') ? 'anomaly_detection'
          : 'object_detection';
        const techniques = task_type === 'ocr' ? ['Text detection and OCR']
          : task_type === 'tracking' || task_type === 'counting' ? ['Object detection with multi-object tracking']
          : task_type === 'anomaly_detection' ? ['Visual anomaly detection']
          : task_type === 'segmentation' ? ['Instance segmentation']
          : task_type === 'classification' ? ['Image classification']
          : ['Object detection'];
        return {
          id: crypto.randomUUID(), name: intent.slice(0, 80), description: intent,
          task_type, candidate_techniques: techniques,
          input_description: 'Camera images or video streams described by the project',
          output_description: intent, camera_ids: [], feasibility_status: 'unknown' as const,
          feasibility_notes: [], acceptance_criteria: [], assumptions: [],
        };
      });
      project.created_at = now;
      project.updated_at = now;
      return NextResponse.json({
        project,
        model_used: 'Project draft',
      });
    }

    const prompt = `Facility description: ${business_description}
${industry ? `Industry: ${industry}` : ''}
${company_name ? `Company: ${company_name}` : ''}
${requirements?.length ? `Requirements:\n${requirements.map((item: string) => `- ${item}`).join('\n')}` : ''}
Camera specifications: ${planningInputs.camera_specifications || 'Not provided'}
Available hardware and input feeds: ${planningInputs.available_hardware || 'Not provided'}
Critical components: ${planningInputs.critical_components.join(', ') || 'Not provided'}
Site image suggestion: ${planningInputs.image_observation || 'No image uploaded'}
Layout sections: ${planningInputs.layout_sections.join('; ') || planningInputs.layout_section_count}; target detection coverage: ${planningInputs.detection_coverage_target}%

Suggest computer-vision use cases, practical techniques, camera placement/specification considerations based on the supplied inputs, assumptions, and missing information. Keep each field concise. Never present the target coverage percentage as measured coverage. Return JSON only.`;

    try {
      const llmResponse = await callAI(prompt);
      const parsed = JSON.parse(llmResponse);
      const draft = createEmptyProject(
        business_description.slice(0, 60).trim(),
        company_name || 'Not specified',
        industry || 'Not specified',
        business_description,
      );
      draft.requirements = requirements || [];
      Object.assign(draft, planningInputs);
      draft.camera_recommendations = Array.isArray(parsed.camera_recommendations) ? parsed.camera_recommendations.filter((value: unknown): value is string => typeof value === 'string') : [];
      const allowedTaskTypes: TaskType[] = ['object_detection', 'classification', 'segmentation', 'ocr', 'measurement', 'tracking', 'counting', 'anomaly_detection', 'pose_estimation', 'other'];
      const allowedFeasibility: FeasibilityStatus[] = ['feasible', 'conditional', 'infeasible', 'unknown'];
      draft.use_cases = (Array.isArray(parsed.use_cases) ? parsed.use_cases : []).filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).slice(0, 4).map((item: Record<string, unknown>) => ({
        id: crypto.randomUUID(),
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Computer vision use case',
        description: typeof item.description === 'string' && item.description.trim() ? item.description.trim() : business_description,
        task_type: allowedTaskTypes.includes(item.task_type as TaskType) ? item.task_type as TaskType : 'other',
        candidate_techniques: Array.isArray(item.candidate_techniques) && item.candidate_techniques.some((value: unknown) => typeof value === 'string') ? item.candidate_techniques.filter((value: unknown): value is string => typeof value === 'string') : ['Computer vision model selection after site review'],
        input_description: typeof item.input_description === 'string' ? item.input_description : 'Camera images or video from the described facility',
        output_description: typeof item.output_description === 'string' ? item.output_description : 'Events and observations related to the requested use case',
        camera_ids: [],
        feasibility_status: allowedFeasibility.includes(item.feasibility_status as FeasibilityStatus) ? item.feasibility_status as FeasibilityStatus : 'unknown',
        feasibility_notes: Array.isArray(item.feasibility_notes) ? item.feasibility_notes.filter((value: unknown) => typeof value === 'string') : [],
        acceptance_criteria: Array.isArray(item.acceptance_criteria) && item.acceptance_criteria.some((value: unknown) => typeof value === 'string') ? item.acceptance_criteria.filter((value: unknown): value is string => typeof value === 'string') : ['Confirm performance targets during a site assessment.'],
        assumptions: Array.isArray(item.assumptions) ? item.assumptions.filter((value: unknown) => typeof value === 'string') : [],
      }));
      if (draft.use_cases.length === 0) {
        throw new Error('The AI returned no use cases. Please add a little more detail and try again.');
      }
      draft.assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions.filter((value: unknown) => typeof value === 'string') : [];
      draft.missing_information = Array.isArray(parsed.missing_information) ? parsed.missing_information.filter((value: unknown) => typeof value === 'string') : [];
      const { validateProject } = await import('@/lib/validation');
      const project = validateProject(draft);

      return NextResponse.json({
        project,
        model_used: getAIConfig().model,
      });
    } catch (llmError) {
      console.error('AI analysis failed:', llmError);
      const message = llmError instanceof Error ? llmError.message : 'AI analysis failed unexpectedly.';
      return NextResponse.json({ error: message }, { status: message.includes('rate limit') ? 429 : message.includes('configured provider key') ? 503 : 502 });
    }
  } catch (error) {
    console.error('Analysis error:', error);
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Analysis request failed.' }, { status: 400 });
  }
}
