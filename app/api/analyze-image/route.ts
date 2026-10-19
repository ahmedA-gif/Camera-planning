import { NextRequest, NextResponse } from 'next/server';
import { fetchNvidia, getNvidiaConfig, getNvidiaCompletionsURL } from '@/lib/ai-provider';

// Allow slow AI providers room to answer on Vercel (Hobby plan caps at 60s).
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { image, filename } = await request.json();
    if (typeof image !== 'string' || !image.startsWith('data:image/')) {
      return NextResponse.json({ error: 'A site image is required.' }, { status: 400 });
    }
    if (image.length > 8_000_000) {
      return NextResponse.json({ error: 'Image is too large after compression.' }, { status: 413 });
    }
    const config = getNvidiaConfig('vision');
    if (!config.apiKey) return NextResponse.json({ error: `Image AI is not configured. Add ${config.keyName} on the server.` }, { status: 503 });

    const response = await fetchNvidia(getNvidiaCompletionsURL(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 250,
        messages: [{ role: 'user', content: [
          { type: 'text', text: `Briefly describe the visible scene and likely objects for a computer vision camera plan. Start with a cautious scene label such as factory floor, warehouse, office, outdoor area, or object close-up. Mention only visible details, then note one useful camera-planning consideration. Treat filename as a weak clue only: ${String(filename || '').slice(0, 100)}. Do not infer hidden site facts.` },
          { type: 'image_url', image_url: { url: image } },
        ] }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return NextResponse.json({ error: 'Image analysis is unavailable.' }, { status: 502 });
    const data = await response.json();
    const observation = data.choices?.[0]?.message?.content;
    if (typeof observation !== 'string' || !observation.trim()) return NextResponse.json({ error: 'No image suggestion was returned.' }, { status: 502 });
    return NextResponse.json({ observation: observation.trim() });
  } catch {
    return NextResponse.json({ error: 'Image analysis failed.' }, { status: 500 });
  }
}
