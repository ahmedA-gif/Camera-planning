import {
  generateSiteTelemetryMapSvg,
  generateCoverageTelemetryMetricsSvg,
  generateBirdCamera3DSvg,
  generateFrustumDori3DSvg,
  generateSideElevationSvg,
  generate3DPerspectiveSvg,
} from './report-diagrams';
import {
  computeCoverage,
  rangesFromResolution,
  type CameraPose,
  type LensSpec,
  type Obstacle,
  type MountType,
} from './coverage-engine';
import { ensureMultiBuildingFleet } from './rule-based-planner';

export type ReportMode = 'pdf' | 'docx';

export interface ReportMetrics {
  coveragePct: number | null;
  blindPct: number | null;
  gapPct: number | null;
  largestGapM: number | null;
  target: number;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Turn technical markdown from the safety plan into short plain text. */
function plain(text: string, max = 520): string {
  const t = (text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}

/** Real coverage numbers calculated from the cameras the user actually has. */
export function computeReportMetrics(project: any): ReportMetrics {
  const target = project.detection_coverage_target || 95;
  try {
    const cams: any[] = project.cameras || [];
    const L = project.facility_length_m || 30;
    const W = project.facility_width_m || 20;
    const H = project.facility_height_m || 4.5;
    if (!cams.length) return { coveragePct: null, blindPct: null, gapPct: null, largestGapM: null, target };
    const hfov = cams[0].horizontal_fov_degrees || 90;
    const hpx = cams[0].resolution_width || 2688;
    const vfov = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) * 9 / 16) * 180) / Math.PI;
    const lens: LensSpec = {
      focalMm: 2.8,
      hfovDeg: hfov,
      vfovDeg: +vfov.toFixed(1),
      ranges: rangesFromResolution(hpx, hfov),
    };
    const poses: CameraPose[] = cams.map((c, i) => ({
      id: i + 1,
      mount: ((c.mount_type as MountType) || 'cross'),
      x: Math.max(0.2, Math.min(L - 0.2, (c.x ?? 0.5) * L)),
      y: Math.max(0.2, Math.min(W - 0.2, (c.y ?? 0.5) * W)),
      z: Math.min(H, c.height_m || H * 0.9),
      panDeg: c.orientation_degrees || 0,
      tiltDeg: c.tilt_degrees ?? 25,
    }));
    const obstacles: Obstacle[] = (project.structure || [])
      .filter((s: any) => s.type === 'obstacle' && s.points?.length >= 2)
      .map((s: any, idx: number) => {
        const xs = s.points.map((p: any) => p.x * L);
        const ys = s.points.map((p: any) => p.y * W);
        return {
          id: s.id || `o${idx}`,
          name: s.name || `Obstacle ${idx + 1}`,
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: s.width_m || Math.max(0.5, Math.max(...xs) - Math.min(...xs)),
          d: s.depth_m || Math.max(0.5, Math.max(...ys) - Math.min(...ys)),
          h: s.height_m || Math.min(H, 3),
          type: (s.obstacle_type || 'rack') as any,
        } as Obstacle;
      });
    const res = computeCoverage(
      poses,
      lens,
      { length: L, width: W, mountHeight: H, targetHeight: 1.5, marginPct: 10, obstacles },
      'observe',
    );
    const cov = +res.metrics.coveragePct.toFixed(1);
    return {
      coveragePct: cov,
      blindPct: +(100 - cov).toFixed(1),
      gapPct: Math.max(0, +(100 - cov).toFixed(1)),
      largestGapM: +res.metrics.largestGapM.toFixed(1),
      target,
    };
  } catch {
    return { coveragePct: null, blindPct: null, gapPct: null, largestGapM: null, target };
  }
}

const mountWords: Record<string, string> = {
  'wall-h': 'Wall, looking straight ahead',
  'wall-v': 'Wall, angled down',
  'roof-nadir': 'Ceiling, looking straight down',
  'roof-tilt': 'Ceiling, angled',
  corner: 'Corner, looking diagonally',
  cross: 'Side wall, looking across',
  pole360: 'Pole, 360° view',
  underside: 'Low mount, looking up',
};

function compassWord(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const names = ['East', 'South-East', 'South', 'South-West', 'West', 'North-West', 'North', 'North-East'];
  return names[Math.round(d / 45) % 8];
}

interface Figure { title: string; what: string; read: string; svg: string }

export async function buildReportHtml(rawProject: any, mode: ReportMode): Promise<string> {
  const fleet = ensureMultiBuildingFleet(rawProject);
  const project: any = { ...rawProject, cameras: fleet.cameras, buildings: fleet.buildings, structure: fleet.structure };
  const cams: any[] = project.cameras;
  const bldgs: any[] = project.buildings || [];
  const camCount = cams.length;
  const title = esc(project.name || 'Camera Safety Plan');
  const company = esc(project.company_name || 'Your Company');
  const industry = esc(project.industry || 'Facility');
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const totalSqm = Math.round(bldgs.reduce((a, b) => a + (b.area_sqm || 0), 0)) ||
    Math.round((project.facility_length_m || 0) * (project.facility_width_m || 0));
  const m = computeReportMetrics(project);
  const storageTb = ((camCount * 4096 * 86400 * 30) / (8 * 1e9)).toFixed(1);
  const switches = Math.max(1, Math.ceil(camCount / 24));

  const w = mode === 'pdf' ? 760 : 640;
  const h = mode === 'pdf' ? 330 : 280;
  const raw: Array<[string, string, string, string]> = [
    ['Top View (floor plan)', generateSiteTelemetryMapSvg(project, { width: w, height: h }),
      'A bird\'s-eye map of every building with each camera drawn as a dot and a cone showing where it looks.',
      'Look for gaps between cones — those are spots no camera watches.'],
    ['3D Perspective', generate3DPerspectiveSvg(project, { width: w, height: h }),
      'A 3D picture of the site so you can see how cameras sit above the floor and equipment.',
      'Cones that overlap well mean a person walking through is never lost.'],
    ['Bird Camera 3D', generateBirdCamera3DSvg(project, { width: w, height: h }),
      'A high 3D view that shows where racks, walls and machines hide the floor from a camera.',
      'Dark or shaded areas behind objects are hidden spots (blind spots).'],
    ['Frustum & DORI 3D (picture clarity)', generateFrustumDori3DSvg(project, { width: w, height: h }),
      'Shows how clear the picture is with distance: close = can identify a face, far = can only notice someone is there.',
      'Colour bands: green = very clear, blue = clear, yellow = fair, grey = just detect.'],
    ['Side Elevation', generateSideElevationSvg(project, { width: w, height: h }),
      'A side-on slice showing how high cameras are mounted and how they tilt toward people.',
      'The small area right under a camera is always unseen — a second camera nearby covers it.'],
    ['Coverage Summary', generateCoverageTelemetryMetricsSvg(project, { width: w, height: Math.round(h * 0.75) }),
      'Scorecard of picture-clarity levels, coverage and storage needs.',
      'Compare the coverage figure with your target.'],
  ];

  let figs: Figure[] = raw.map(([t, svg, what, read]) => ({ title: t, svg, what, read }));

  if (mode === 'docx') {
    // Word cannot show inline SVG, so convert each diagram to a PNG picture when possible.
    try {
      const sharp = (await import('sharp')).default;
      figs = await Promise.all(
        figs.map(async f => {
          try {
            const svgFixed = f.svg.replace('width="100%" height="auto"', `width="${w}" height="${h}"`);
            const png = await sharp(Buffer.from(svgFixed), { density: 144 }).png().toBuffer();
            return { ...f, svg: `<img src="data:image/png;base64,${png.toString('base64')}" width="${w}" style="width:${w}px" alt="${esc(f.title)}"/>` };
          } catch {
            return f;
          }
        }),
      );
    } catch {
      /* keep inline SVG */
    }
  }

  const figHtml = (n: number) => {
    const f = figs[n];
    return `
    <div class="fig">
      <div class="fig-title">Diagram ${n + 1} of 6 — ${esc(f.title)}</div>
      <div class="fig-box">${f.svg}</div>
      <div class="fig-note"><b>What you are looking at:</b> ${esc(f.what)}<br/><b>How to read it:</b> ${esc(f.read)}</div>
    </div>`;
  };

  // ---------- plain-language verdict ----------
  let verdictClass = 'v-amber';
  let verdictTitle = 'Coverage could not be measured';
  let verdictBody = 'Add cameras and building sizes, then regenerate this report to see the coverage score.';
  if (m.coveragePct !== null) {
    if (m.coveragePct >= m.target) {
      verdictClass = 'v-green';
      verdictTitle = `${m.coveragePct}% of the floor is watched — target of ${m.target}% met`;
      verdictBody = `Your ${camCount} cameras cover the site well. Only ${m.blindPct}% of the floor is unseen.`;
    } else {
      verdictClass = m.coveragePct >= 70 ? 'v-amber' : 'v-red';
      verdictTitle = `${m.gapPct}% coverage gap — ${m.coveragePct}% watched, target is ${m.target}%`;
      verdictBody = `Adjust camera mount angles, or click <b>Auto-Solve (≥95%)</b> in the Camera Map screen and regenerate this report. ` +
        (m.largestGapM ? `The biggest unwatched stretch is about ${m.largestGapM} m wide.` : '');
    }
  }

  // ---------- camera table ----------
  const byBuilding = bldgs.map(b => ({
    b,
    list: cams.filter(c => c.building_id === b.id || c.building_name === b.name),
  }));
  let cameraSection: string;
  if (camCount <= 24) {
    cameraSection = `<table class="t"><tr><th>Camera</th><th>Building</th><th>Where it is fixed</th><th>Height</th><th>Faces</th></tr>` +
      cams.map(c => `<tr><td><b>${esc(c.id)}</b></td><td>${esc(c.building_name || '—')}</td><td>${esc(mountWords[c.mount_type] || 'Wall / ceiling')}</td><td>${(c.height_m || 0).toFixed(1)} m</td><td>${compassWord(c.orientation_degrees || 0)}</td></tr>`).join('') +
      `</table>`;
  } else {
    cameraSection = `<table class="t"><tr><th>Building</th><th>Cameras</th><th>Camera numbers</th></tr>` +
      byBuilding.map(({ b, list }) => `<tr><td><b>${esc(b.name)}</b></td><td>${list.length}</td><td>${esc(list.map(c => c.id).join(', '))}</td></tr>`).join('') +
      `</table>`;
  }

  const buildingRows = bldgs.length
    ? `<table class="t"><tr><th>Building</th><th>What happens here</th><th>Size</th><th>Cameras</th></tr>` +
      bldgs.map(b => `<tr><td><b>${esc(b.name)}</b></td><td>${esc(b.purpose || '—')}</td><td>${Math.round(b.area_sqm || 0)} m²</td><td>${b.camera_count ?? 0}</td></tr>`).join('') +
      `</table>`
    : '';

  // ---------- safety highlights ----------
  const sec: Record<string, string> = (project.safety_plan?.sections as any) || {};
  const pick = (k: string, alt?: string) => plain(sec[k] || (alt ? sec[alt] : '') || '', 420);
  const safetyRows: Array<[string, string]> = [
    ['Overview', pick('executive_summary', 'exec_summary')],
    ['Main dangers found', pick('hazard_identification')],
    ['What we recommend', pick('recommended_controls')],
    ['First steps', pick('corrective_actions')],
  ].filter(([, v]) => v) as Array<[string, string]>;
  const safetyHtml = safetyRows.length
    ? safetyRows.map(([k, v]) => `<div class="sf"><b>${k}</b><p>${esc(v)}</p></div>`).join('')
    : `<p>No safety plan has been generated yet. Open the <b>Safety Plan</b> tab and click <b>Generate</b>, then download this report again.</p>`;

  const css = `
  @page { size: A4 portrait; margin: 12mm; }
  *{box-sizing:border-box}
  body{font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#1e293b;font-size:${mode === 'pdf' ? '11.5px' : '10.5pt'};line-height:1.45;margin:0;background:${mode === 'pdf' ? '#e2e8f0' : '#fff'}}
  .page{background:#fff;width:${mode === 'pdf' ? '186mm' : '100%'};min-height:${mode === 'pdf' ? '272mm' : 'auto'};margin:${mode === 'pdf' ? '8px auto' : '0'};padding:${mode === 'pdf' ? '10mm' : '0'};page-break-after:always;break-after:page;overflow:hidden}
  .page:last-child{page-break-after:auto;break-after:auto}
  h1{font-size:24px;color:#0f2a5c;margin:0 0 4px}
  h2{font-size:15px;color:#0f2a5c;border-bottom:2px solid #2563eb;padding-bottom:3px;margin:12px 0 8px}
  .sub{color:#475569;font-size:12px;margin-bottom:10px}
  .cards{width:100%;border-collapse:separate;border-spacing:6px}
  .cards td{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;text-align:center;padding:8px 4px;width:16.6%}
  .cards .n{font-size:20px;font-weight:700;color:#0f2a5c}.cards .l{font-size:10px;color:#64748b;text-transform:uppercase}
  .verdict{border-radius:8px;padding:10px 12px;margin:10px 0;border:1px solid}
  .v-green{background:#ecfdf5;border-color:#6ee7b7;color:#065f46}.v-amber{background:#fffbeb;border-color:#fcd34d;color:#92400e}.v-red{background:#fef2f2;border-color:#fca5a5;color:#991b1b}
  .verdict b.t1{font-size:14px;display:block;margin-bottom:2px}
  .fig{margin-bottom:12px}.fig-title{font-weight:700;color:#0f2a5c;font-size:13px;margin-bottom:4px}
  .fig-box{border:1px solid #cbd5e1;border-radius:6px;padding:3px;background:#fff;text-align:center}
  .fig-box svg,.fig-box img{max-width:100%;height:auto}
  .fig-note{font-size:11px;color:#334155;margin-top:4px;background:#f8fafc;border-left:3px solid #2563eb;padding:5px 8px}
  table.t{width:100%;border-collapse:collapse;font-size:11px;margin:6px 0}
  table.t th{background:#0f2a5c;color:#fff;text-align:left;padding:4px 6px}
  table.t td{border:1px solid #e2e8f0;padding:4px 6px;vertical-align:top}
  .sf{margin:6px 0}.sf p{margin:2px 0 0;color:#334155}
  .legend td{padding:3px 6px;font-size:11px}
  .foot{color:#64748b;font-size:10px;margin-top:8px;text-align:center}
  `;

  const page1 = `
  <div class="page">
    <h1>${title}</h1>
    <div class="sub">Camera Safety &amp; Coverage Plan &bull; ${company} &bull; ${industry} &bull; ${dateStr}</div>
    <table class="cards"><tr>
      <td><div class="n">${camCount}</div><div class="l">Cameras</div></td>
      <td><div class="n">${bldgs.length || 1}</div><div class="l">Buildings</div></td>
      <td><div class="n">${totalSqm ? totalSqm.toLocaleString() : '—'}</div><div class="l">Square metres</div></td>
      <td><div class="n">${m.coveragePct !== null ? m.coveragePct + '%' : '—'}</div><div class="l">Floor watched</div></td>
      <td><div class="n">${storageTb} TB</div><div class="l">30-day video</div></td>
      <td><div class="n">${switches}</div><div class="l">Network switch${switches > 1 ? 'es' : ''}</div></td>
    </tr></table>
    <div class="verdict ${verdictClass}"><b class="t1">${verdictTitle}</b>${verdictBody}</div>
    <h2>In plain words</h2>
    <p>This plan shows where to place <b>${camCount} cameras</b> so people, vehicles and hazards can be seen across your site. The pictures on the next pages show the cameras from above, from the side and in 3D, so you can check them without any technical background.</p>
    <h2>How to read picture clarity</h2>
    <table class="t legend">
      <tr><td><b>Identify</b></td><td>Clear enough to confirm exactly who a person is.</td></tr>
      <tr><td><b>Recognize</b></td><td>Clear enough to tell clothing, safety vest or helmet.</td></tr>
      <tr><td><b>Observe</b></td><td>Clear enough to see what someone or a forklift is doing.</td></tr>
      <tr><td><b>Detect</b></td><td>Only enough to notice that something is there.</td></tr>
    </table>
    <h2>Your buildings</h2>
    ${buildingRows || '<p>No separate buildings were defined; the site is treated as one area.</p>'}
  </div>`;

  const page2 = `<div class="page"><h2>Seeing the site</h2>${figHtml(0)}${figHtml(1)}</div>`;
  const page3 = `<div class="page"><h2>Hidden spots and picture clarity</h2>${figHtml(2)}${figHtml(3)}</div>`;
  const page4 = `
  <div class="page"><h2>Mounting height and coverage score</h2>${figHtml(4)}${figHtml(5)}
    <div class="verdict ${verdictClass}"><b class="t1">What to do next</b>${
      m.coveragePct !== null && m.coveragePct < m.target
        ? `Coverage is below your ${m.target}% target. Open <b>Camera Map</b>, adjust mount angles or click <b>Auto-Solve (≥95%)</b>, then download this report again.`
        : 'Your coverage meets the target. Keep cameras clean and re-check after any layout change.'
    }</div>
  </div>`;
  const page5 = `
  <div class="page">
    <h2>Camera list</h2>${cameraSection}
    <h2>Safety plan highlights</h2>${safetyHtml}
    <h2>Equipment in simple terms</h2>
    <p>${camCount} cameras · about ${storageTb} TB of storage to keep 30 days of video · ${switches} network switch${switches > 1 ? 'es' : ''} (24 cameras each) · one recorder/computer to run the smart detection.</p>
    <div class="foot">Generated ${dateStr}. Figures are planning estimates; confirm with a site visit before installation.</div>
  </div>`;

  const body = `${page1}${page2}${page3}${page4}${page5}`;

  if (mode === 'docx') {
    return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${title}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page Section1{size:595.3pt 841.9pt;margin:40pt 42pt}div.Section1{page:Section1}${css}</style></head>
<body><div class="Section1">${body}</div></body></html>`;
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title} — Camera Safety Plan</title>
<style>${css}@media print{body{background:#fff}.page{margin:0;box-shadow:none}}</style></head><body>${body}</body></html>`;
}
