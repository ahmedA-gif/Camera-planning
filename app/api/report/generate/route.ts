import { NextRequest, NextResponse } from 'next/server';
import { buildReportHtml } from '@/lib/report-content';

// Report rendering can rasterise 6 diagrams for Word; allow it room to finish on Vercel.
export const maxDuration = 60;

function respond(html: string, format: string, safeTitle: string) {
  if (format === 'docx') {
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'application/msword;charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeTitle}_Plan_Report.doc"`,
      },
    });
  }
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="${safeTitle}_Plan_Report.html"`,
    },
  });
}

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

    const safeTitle = String(project.name || 'Plan_Vision_Report').replace(/\s+/g, '_');
    const html = await buildReportHtml(project, format === 'docx' ? 'docx' : 'pdf');
    return respond(html, format, safeTitle);
  } catch (error) {
    console.error('Report generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Report generation failed.' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'pdf';
    const count = Math.max(1, Math.min(100, parseInt(searchParams.get('cameras') || '12', 10) || 12));

    // Demo project when opened directly in a browser tab; camera count is adjustable via ?cameras=N
    const demoProject = {
      name: 'Plan Vision Facility Plan',
      company_name: 'Demo Industrial Complex',
      industry: 'Industrial Manufacturing',
      business_description: `Industrial facility with 4 buildings. Total cameras ${count}.`,
      cameras: Array.from({ length: count }, (_, i) => ({
        id: `CAM-${String(i + 1).padStart(2, '0')}`,
        name: `CAM-${String(i + 1).padStart(2, '0')}`,
        status: 'active',
        x: 0.1 + (0.8 * (i % 6)) / 5,
        y: i % 2 === 0 ? 0.2 : 0.8,
        orientation_degrees: i % 2 === 0 ? 90 : 270,
        horizontal_fov_degrees: 85,
        resolution_width: 2688,
        resolution_height: 1520,
      })),
    };

    const html = await buildReportHtml(demoProject, format === 'docx' ? 'docx' : 'pdf');
    return respond(html, format, 'Plan_Vision');
  } catch (err) {
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
