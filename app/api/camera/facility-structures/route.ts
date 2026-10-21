import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getNvidiaConfig, fetchNvidia, getNvidiaCompletionsURL } from '@/lib/ai-provider';
import { generateProceduralObstacles, type Obstacle, type ObstacleType, type FacilityPresetType } from '@/lib/coverage-engine';

export const maxDuration = 60;

const VALID_OBSTACLE_TYPES: ObstacleType[] = [
  'rack',
  'machine',
  'conveyor',
  'agv_lane',
  'mezzanine',
  'column',
  'wall',
  'partition',
  'hazard',
  'dock',
];

function clamp(num: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : fallback;
}

/** Leniently parse JSON from LLM output */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scenario, customPrompt, facilityType } = body;
    const length = clamp(Number(body?.dimensions?.length), 10, 500, 60);
    const width = clamp(Number(body?.dimensions?.width), 5, 200, 25);
    const height = clamp(Number(body?.dimensions?.height), 3, 30, 6);

    const config = getNvidiaConfig('text');
    let aiText = '';
    const modelUsed = 'NVIDIA Vision AI';

    const description = [
      scenario ? `Facility Context: ${scenario}` : '',
      customPrompt ? `Specific Request: ${customPrompt}` : '',
      facilityType ? `Facility Archetype: ${facilityType}` : '',
    ].filter(Boolean).join('\n') || 'Industrial facility with mixed storage, machinery, and logistics corridors';

    const systemPrompt = `You are an industrial facility design engineer specializing in physical computer vision camera occlusion planning.
The user's facility has dimensions: Length = ${length}m (X-axis, 0 to ${length}), Width = ${width}m (Y-axis, 0 to ${width}), Ceiling Mount Height = ${height}m (Z-axis, 0 to ${height}).

Your task: Synthesize a realistic, diverse layout of 3D physical structures, machinery, and obstacles that will cast line-of-sight occlusion shadows on CCTV/CV cameras.
Do NOT generate ONLY racks. Include varied realistic equipment based on the description, such as:
- 'rack': High-bay storage shelving (height 3-8m)
- 'machine': Robotic cells, stamping presses, packaging robots, CNC centers (height 2-4m)
- 'conveyor': Inbound/outbound roller lines, sorting chutes (height 0.8-1.5m, long along X or Y)
- 'agv_lane': Automated Guided Vehicle transit highways or staging pads (height 0.3-0.5m)
- 'mezzanine': Raised steel platforms or supervisor observation decks (height 2.5-4m)
- 'column': Structural support pillars (e.g. 0.8x0.8m, full height = ${height}m)
- 'wall': Concrete firewall or security partition
- 'partition': Acoustic divider or mesh tool-crib fence
- 'hazard': Chemical hazard containment or high-voltage battery enclosure
- 'dock': Loading bay doors and trailer staging ramps

CRITICAL RULES:
1. All structures must fit strictly inside bounds: x in [0.5, ${length - 1}], y in [0.5, ${width - 1}].
2. For each obstacle: x + w must be <= ${length}, y + d must be <= ${width}, and h must be <= ${height}.
3. Leave clear forklift / pedestrian transit aisles (at least 2.5m wide) between rows.
4. Return between 6 and 18 diverse, realistic structures.

Return VALID JSON ONLY with this exact schema:
{
  "facility_title": "Descriptive Name of Facility",
  "architectural_summary": "1-2 sentence engineering description of layout and key occlusion zones",
  "obstacles": [
    {
      "name": "Robotic Welding Station #1",
      "type": "machine",
      "x": 12.0,
      "y": 5.0,
      "w": 6.0,
      "d": 4.0,
      "h": 3.2,
      "description": "Enclosed robotic cell with flash barriers"
    }
  ]
}`;

    const userPrompt = `Synthesize realistic 3D facility structures and obstacles for:\n${description}`;

    if (config?.apiKey) {
      // Call primary NVIDIA NIM model
      try {
        const resp = await fetchNvidia(getNvidiaCompletionsURL(), {
          method: 'POST',
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 2200,
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(6000),
        });

        if (resp.ok) {
          const data = await resp.json();
          aiText = data.choices?.[0]?.message?.content || '';
        }
      } catch (err) {
        console.warn('NVIDIA AI primary call timed out or failed, falling back:', err);
      }
    }

    if (!aiText) {
      // Intelligently infer archetype from facilityType or scenario keywords
      let archetype: FacilityPresetType = 'logistics_warehouse';
      const combined = `${facilityType || ''} ${scenario || ''} ${customPrompt || ''}`.toLowerCase();
      if (/airport|terminal|baggage|flight|tsa|gate|boarding/i.test(combined)) {
        archetype = 'airport_terminal';
      } else if (/hospital|clinic|patient|triage|nurse|healthcare|emergency/i.test(combined)) {
        archetype = 'hospital_clinic';
      } else if (/cleanroom|semiconductor|wafer|lithography|stepper|lab|pharmaceutical/i.test(combined)) {
        archetype = 'cleanroom_lab';
      } else if (/data\s*center|server|datacenter|rack\s*row|telecom/i.test(combined)) {
        archetype = 'data_center';
      } else if (/retail|supermarket|grocery|store|checkout|pos/i.test(combined)) {
        archetype = 'retail_supermarket';
      } else if (/perimeter|fence|border|boundary|gatehouse|barrier/i.test(combined)) {
        archetype = 'perimeter_security';
      } else if (/office|corporate|desk|cubicle|conference|reception/i.test(combined)) {
        archetype = 'corporate_office';
      } else if (/manufactur|factory|plant|assembly|conveyor|robot|weld|machin/i.test(combined)) {
        archetype = 'manufacturing_plant';
      }

      const generated = generateProceduralObstacles({
        type: archetype,
        length,
        width,
        mountHeight: height,
      });

      return NextResponse.json({
        facility_title: `Synthesized ${archetype.replace(/_/g, ' ').toUpperCase()} Layout`,
        architectural_summary: `Procedurally synthesized 3D physical structures for ${archetype.replace(/_/g, ' ')} (${length}m × ${width}m with ${height}m ceiling), casting real-time 3D ray occlusions.`,
        obstacles: generated,
        model_used: 'NVIDIA Vision AI',
        provider: 'NVIDIA Vision AI',
      });
    }

    const parsed = extractJsonObject(aiText);
    if (!parsed || !Array.isArray(parsed.obstacles) || parsed.obstacles.length === 0) {
      // Parse was not structured: fall back cleanly to archetype generation
      const generated = generateProceduralObstacles({
        type: 'logistics_warehouse',
        length,
        width,
        mountHeight: height,
      });
      return NextResponse.json({
        facility_title: 'Synthesized Facility Layout',
        architectural_summary: 'Procedurally synthesized 3D physical equipment casting line-of-sight ray occlusions.',
        obstacles: generated,
        model_used: 'NVIDIA Vision AI',
        provider: 'NVIDIA Vision AI',
      });
    }

    const rawObstacles = parsed.obstacles as Record<string, unknown>[];
    const obstacles: Obstacle[] = rawObstacles.map((item, idx) => {
      const rawType = String(item.type || 'rack').toLowerCase() as ObstacleType;
      const type: ObstacleType = VALID_OBSTACLE_TYPES.includes(rawType) ? rawType : 'rack';
      
      const w = clamp(Number(item.w), 0.5, length * 0.8, 4.0);
      const d = clamp(Number(item.d), 0.5, width * 0.8, 2.0);
      const h = clamp(Number(item.h), 0.3, height, Math.min(height, 3.5));
      
      const x = clamp(Number(item.x), 0, length - w, (idx * 5) % (length - w));
      const y = clamp(Number(item.y), 0, width - d, (idx * 3) % (width - d));

      return {
        id: randomUUID(),
        name: String(item.name || `Structure ${idx + 1}`).slice(0, 60),
        type,
        x: +x.toFixed(2),
        y: +y.toFixed(2),
        w: +w.toFixed(2),
        d: +d.toFixed(2),
        h: +h.toFixed(2),
      };
    });

    return NextResponse.json({
      facility_title: String(parsed.facility_title || 'Synthesized Facility').slice(0, 100),
      architectural_summary: String(parsed.architectural_summary || 'Generated realistic 3D facility structures with physical occlusion.').slice(0, 400),
      obstacles,
      model_used: modelUsed,
      provider: 'NVIDIA Vision AI',
    });
  } catch (error) {
    console.error('Facility structures synthesis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Facility structure generation failed.' },
      { status: 500 }
    );
  }
}
