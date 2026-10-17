import { NextRequest, NextResponse } from 'next/server';
import { createPlanEngine } from '@/lib/plan-engine/engine';
import { getAIConfig } from '@/lib/ai-provider';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      business_description, 
      industry, 
      company_name, 
      requirements,
      mode = 'full' // 'full' | 'section' | 'resume'
    } = body;

    if (!business_description || business_description.length < 20) {
      return NextResponse.json(
        { error: 'Business description must be at least 20 characters' },
        { status: 400 }
      );
    }

    const ai = getAIConfig();
    if (!ai.apiKey) {
      return NextResponse.json({ error: `Plan generation needs a configured AI provider key. Add ${ai.keyName} and try again.` }, { status: 503 });
    }

    const engine = createPlanEngine({
      business_description,
      industry: industry || '',
      company_name: company_name || '',
      requirements: requirements || [],
    });

    if (mode === 'section') {
      // Generate single next section (for streaming/progressive UI)
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

    if (mode === 'resume') {
      // Resume from saved state (would need persistence layer)
      return NextResponse.json({ error: 'Resume mode requires persistence layer' }, { status: 501 });
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
  } catch (error) {
    console.error('Plan generation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('rate limited')) {
      return NextResponse.json({ error: message }, { status: 429 });
    }
    if (message.includes('timed out')) {
      return NextResponse.json({ error: message }, { status: 504 });
    }
    return NextResponse.json(
      { error: message || 'Plan generation failed' },
      { status: 500 }
    );
  }
}
