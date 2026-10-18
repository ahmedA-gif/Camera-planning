import { NextRequest, NextResponse } from 'next/server';
import { createPlanEngine } from '@/lib/plan-engine/engine';
import { getAIConfig, getNvidiaConfig } from '@/lib/ai-provider';
import { generateTokenFreeSafetyPlan } from '@/lib/rule-based-planner';

// Allow slow AI providers room to answer on Vercel
export const maxDuration = 60;

/** Attempt to call Python planner service for token-free safety plan */
async function callPythonSafetyPlan(project: Record<string, any>) {
  const docServiceUrl = process.env.DOC_SERVICE_URL || 'http://localhost:8001';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(`${docServiceUrl}/api/v1/planner/safety-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.sections) {
        return data;
      }
    }
  } catch {
    // Python service unreachable; fallback to TypeScript rule engine
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      business_description, 
      industry, 
      company_name, 
      requirements,
      use_ai = false,
      mode = 'full' // 'full' | 'section' | 'resume'
    } = body;

    if (!business_description || business_description.length < 10) {
      return NextResponse.json(
        { error: 'Business description must be at least 10 characters' },
        { status: 400 }
      );
    }

    const ai = getAIConfig();
    const nvidia = getNvidiaConfig();
    const hasAiKey = Boolean(ai.apiKey || nvidia.apiKey);

    // If user didn't explicitly request AI or if no AI key configured or if token-free requested:
    // Generate safety plan and token usage breakdown using Python/Rule-based script
    if (!use_ai || !hasAiKey) {
      // 1. Try Python service
      const pyPlan = await callPythonSafetyPlan({
        business_description,
        industry: industry || '',
        company_name: company_name || '',
        requirements: requirements || [],
        cameras: body.cameras || [],
      });
      if (pyPlan) {
        return NextResponse.json({
          complete: true,
          sections: pyPlan.sections,
          token_usage: pyPlan.token_usage,
          metadata: {
            total_sections: Object.keys(pyPlan.sections).length,
            total_tokens_estimate: 0,
            source: 'python_script',
            generated_at: new Date().toISOString(),
          },
        });
      }

      // 2. Direct local TypeScript rule-based plan
      const localPlan = generateTokenFreeSafetyPlan({
        business_description,
        industry: industry || '',
        company_name: company_name || '',
        requirements: requirements || [],
        cameras: body.cameras || [],
      });
      return NextResponse.json({
        complete: true,
        sections: localPlan.sections,
        token_usage: localPlan.token_usage,
        metadata: {
          total_sections: Object.keys(localPlan.sections).length,
          total_tokens_estimate: 0,
          source: 'local_rule_engine',
          generated_at: new Date().toISOString(),
        },
      });
    }

    // Otherwise attempt AI-based generation
    try {
      const engine = createPlanEngine({
        business_description,
        industry: industry || '',
        company_name: company_name || '',
        requirements: requirements || [],
      });

      if (mode === 'section') {
        const result = await engine.generateNextSection();
        if (!result) {
          return NextResponse.json({ complete: true, sections: engine.getState().completed_sections });
        }
        return NextResponse.json({
          section: result.section,
          content: result.content,
          progress: {
            completed: Object.keys(engine.getState().completed_sections).length,
            total: engine.getState().outline.sections.filter(s => s.required).length,
          },
          complete: false,
        });
      }

      // Full generation
      const sections = await engine.generateFullReport();
      return NextResponse.json({
        complete: true,
        sections,
        state: engine.getState(),
        metadata: {
          total_sections: Object.keys(sections).length,
          total_tokens_estimate: engine.getState().total_generated_tokens,
          generated_at: new Date().toISOString(),
        },
      });
    } catch (aiErr) {
      console.warn('AI plan generation error, falling back to rule-based engine:', aiErr);
      const fallbackPlan = generateTokenFreeSafetyPlan({
        business_description,
        industry: industry || '',
        company_name: company_name || '',
        requirements: requirements || [],
        cameras: body.cameras || [],
      });
      return NextResponse.json({
        complete: true,
        sections: fallbackPlan.sections,
        token_usage: fallbackPlan.token_usage,
        metadata: {
          total_sections: Object.keys(fallbackPlan.sections).length,
          total_tokens_estimate: 0,
          source: 'rule_based_fallback',
          notice: 'Generated via Python/Rule-based script to avoid token limit or rate limit errors.',
          generated_at: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('Plan generation error:', error);
    const message = error instanceof Error ? error.message : 'Plan generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
