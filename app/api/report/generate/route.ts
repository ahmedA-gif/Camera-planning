import { NextRequest, NextResponse } from 'next/server';

const DOC_SERVICE_URL = process.env.DOC_SERVICE_URL || 'http://localhost:8001';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { project, format = 'pdf' } = body;

    if (!project || !['pdf', 'docx'].includes(format)) {
      return NextResponse.json(
        { error: !project ? 'Project data is required' : 'Format must be pdf or docx.' },
        { status: 400 }
      );
    }

    let response: Response;
    try {
      response = await fetch(`${DOC_SERVICE_URL}/api/v1/report/generate?format=${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, format }),
        signal: AbortSignal.timeout(90000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return NextResponse.json({
        error: timedOut
          ? 'Document service took too long to generate the report.'
          : `Document service is unavailable at ${DOC_SERVICE_URL}. Start the service, then try again.`,
        details: timedOut ? undefined : 'Run: cd detvision-doc-service && python3 -m uvicorn app.main:app --reload --port 8001',
      }, { status: timedOut ? 504 : 503 });
    }

    if (!response.ok) {
      const body = await response.text();
      let detail = body.slice(0, 500);
      try {
        const parsed = JSON.parse(body);
        detail = parsed.detail || parsed.error || detail;
      } catch {}
      return NextResponse.json({ error: `Document service rejected the report (${response.status}).`, details: detail }, { status: response.status >= 500 ? 502 : response.status });
    }

    const blob = await response.blob();
    const filename = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '')
      || `plan-vision-report.${format}`;

    return new NextResponse(blob, {
      headers: {
        'Content-Type': format === 'pdf' 
          ? 'application/pdf' 
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Report generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Report generation failed.' },
      { status: 500 }
    );
  }
}
