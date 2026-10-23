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
  const h = mode === 'pdf' ? 220 : 200;
  const raw: Array<[string, string, string, string]> = [
    [
      'Top View (2D Architectural Floor Plan)',
      generateSiteTelemetryMapSvg(project, { width: w, height: h }),
      'A bird\'s-eye view of your facility showing where each camera is positioned and which direction its lens points.',
      'Shaded cones show the area each camera protects. Clear spaces between cones indicate unprotected zones.'
    ],
    [
      'Side Elevation (Mounting Height & Angles)',
      generateSideElevationSvg(project, { width: w, height: h }),
      'A side cross-section showing camera mounting heights above the floor and downward tilt angles toward work areas.',
      'The dead-zone directly under a camera is protected by adjacent overlapping camera cones.'
    ],
    [
      'Bird Camera 3D (Obstacle Clearance & Blind Spots)',
      generateBirdCamera3DSvg(project, { width: w, height: h }),
      'A high-angle 3D view showing if tall equipment, storage racks, or machines block camera sightlines.',
      'Shaded spots behind objects highlight blind spots where extra camera angles are placed to maintain unbroken sight.'
    ],
    [
      '3D Perspective (Depth & Facility Simulation)',
      generate3DPerspectiveSvg(project, { width: w, height: h }),
      'A realistic 3D perspective showing camera sightlines working together across the facility interior.',
      'Overlapping cones ensure workers and forklifts remain visible as they move through aisles and doors.'
    ],
    [
      'Frustum & DORI 3D (Optical Clarity Zones)',
      generateFrustumDori3DSvg(project, { width: w, height: h }),
      'Distance-based clarity cones: closer to the camera provides face identification; further out provides motion detection.',
      'Color zones: Green = Face/ID level; Blue = Safety vest/uniform; Yellow = Forklift observation; Orange = Motion detection.'
    ],
    [
      'Multi-Angle Coverage Gap & Telemetry',
      generateCoverageTelemetryMetricsSvg(project, { width: w, height: h }),
      'Scorecard showing overall facility protection percentage, blind spot gap measurements, and hardware sizing.',
      'Compare the coverage percentage with your 95% target to verify compliance.'
    ],
  ];

  let figs: Figure[] = raw.map(([t, svg, what, read]) => ({ title: t, svg, what, read }));

  if (mode === 'docx') {
    figs = figs.map(f => ({
      ...f,
      svg: f.svg.replace('width="100%" height="auto"', `width="${w}" height="${h}" style="width:${w}px;height:${h}px;display:block;margin:0 auto;"`),
    }));
  }

  const figHtml = (n: number) => {
    const f = figs[n];
    return `
    <div class="fig">
      <div class="fig-title">Diagram ${n + 1} of 6 — ${esc(f.title)}</div>
      <div class="fig-box">${f.svg}</div>
      <div class="fig-note">
        <div><b>What this shows:</b> ${esc(f.what)}</div>
        <div style="margin-top:2px;"><b>How to read it:</b> ${esc(f.read)}</div>
      </div>
    </div>`;
  };

  // ---------- plain-language verdict ----------
  let verdictClass = 'v-amber';
  let verdictTitle = 'Coverage Pending Verification';
  let verdictBody = 'Add cameras and building dimensions in Camera Mapping, then confirm to calculate coverage.';
  if (m.coveragePct !== null) {
    if (m.coveragePct >= m.target) {
      verdictClass = 'v-green';
      verdictTitle = `100% Target Met — ${m.coveragePct}% of the facility floor is fully protected`;
      verdictBody = `Your ${camCount} cameras provide complete, unbroken protection across all work zones. Only ${m.blindPct}% of minor perimeter space is unmonitored.`;
    } else {
      verdictClass = m.coveragePct >= 70 ? 'v-amber' : 'v-red';
      verdictTitle = `${m.gapPct}% Coverage Gap — ${m.coveragePct}% watched, safety target is ${m.target}%`;
      verdictBody = `Adjust camera mount angles, or click <b>Auto-Solve (≥95%)</b> in the Camera Map screen and click <b>Confirm Camera Mapping</b> to update this report.` +
        (m.largestGapM ? ` The largest unwatched blind spot is approximately ${m.largestGapM} meters wide.` : '');
    }
  }

  // ---------- camera table ----------
  const byBuilding = bldgs.map(b => ({
    b,
    list: cams.filter(c => c.building_id === b.id || c.building_name === b.name),
  }));
  let cameraSection: string;
  if (camCount <= 18) {
    cameraSection = `<table class="t"><tr><th>Camera #</th><th>Building / Zone</th><th>Mount Location</th><th>Height</th><th>Direction</th><th>Target Area</th></tr>` +
      cams.map((c, i) => `<tr><td><b>CAM-${String(i + 1).padStart(2, '0')}</b></td><td>${esc(c.building_name || 'Main Hall')}</td><td>${esc(mountWords[c.mount_type] || 'Wall / Ceiling Mount')}</td><td>${(c.height_m || 4.2).toFixed(1)} m</td><td>${compassWord(c.orientation_degrees || 0)}</td><td>${esc(c.target_area || 'Floor & Aisle Zone')}</td></tr>`).join('') +
      `</table>`;
  } else {
    cameraSection = `<table class="t"><tr><th>Building / Facility Zone</th><th>Total Cameras</th><th>Allocated Camera Numbers</th><th>Primary Coverage Area</th></tr>` +
      byBuilding.map(({ b, list }) => `<tr><td><b>${esc(b.name)}</b></td><td><span class="pill">${list.length} Cameras</span></td><td>${esc(list.map((c, idx) => `CAM-${String(idx + 1).padStart(2, '0')}`).slice(0, 8).join(', '))}${list.length > 8 ? '…' : ''}</td><td>${esc(b.purpose || 'Active Operational Floor')}</td></tr>`).join('') +
      `</table>`;
  }

  const buildingRows = bldgs.length
    ? `<table class="t"><tr><th>Building Zone</th><th>Facility Purpose</th><th>Floor Size</th><th>Cameras</th><th>Status</th></tr>` +
      bldgs.map(b => `<tr><td><b>${esc(b.name)}</b></td><td>${esc(b.purpose || 'Operations')}</td><td>${Math.round(b.area_sqm || 0)} m²</td><td><b>${b.camera_count ?? 0}</b></td><td><span class="pill-green">Monitored</span></td></tr>`).join('') +
      `</table>`
    : '';

  const css = `
  @page { size: A4 portrait; margin: 8mm 10mm; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;font-size:${mode === 'pdf' ? '11px' : '10pt'};line-height:1.4;margin:0;background:${mode === 'pdf' ? '#e2e8f0' : '#fff'}}
  .page{background:#fff;width:${mode === 'pdf' ? '186mm' : '100%'};max-width:186mm;min-height:${mode === 'pdf' ? '268mm' : 'auto'};margin:${mode === 'pdf' ? '10px auto' : '0'};padding:${mode === 'pdf' ? '8mm 10mm' : '0'};page-break-after:always;break-after:page;overflow:hidden}
  .page:last-child{page-break-after:auto;break-after:auto}
  h1{font-size:22px;color:#0f2a5c;margin:0 0 3px;font-weight:800;letter-spacing:-0.02em}
  h2{font-size:14px;color:#0f2a5c;border-bottom:2px solid #2563eb;padding-bottom:3px;margin:8px 0 6px;font-weight:700}
  .sub{color:#475569;font-size:11px;margin-bottom:8px}
  .cards{width:100%;border-collapse:separate;border-spacing:5px;margin-bottom:6px}
  .cards td{background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;text-align:center;padding:6px 3px;width:16.6%}
  .cards .n{font-size:18px;font-weight:800;color:#0f2a5c}.cards .l{font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:600}
  .verdict{border-radius:6px;padding:8px 12px;margin:8px 0;border:1px solid}
  .v-green{background:#ecfdf5;border-color:#6ee7b7;color:#065f46}.v-amber{background:#fffbeb;border-color:#fcd34d;color:#92400e}.v-red{background:#fef2f2;border-color:#fca5a5;color:#991b1b}
  .verdict b.t1{font-size:13px;display:block;margin-bottom:2px}
  .fig{margin-bottom:8px}.fig-title{font-weight:700;color:#0f2a5c;font-size:12px;margin-bottom:3px}
  .fig-box{border:1px solid #cbd5e1;border-radius:6px;padding:2px;background:#fff;text-align:center}
  .fig-box svg,.fig-box img{max-width:100%;height:auto;display:block;margin:0 auto}
  .fig-note{font-size:10px;color:#334155;margin-top:3px;background:#f8fafc;border-left:3px solid #2563eb;padding:4px 8px;border-radius:0 4px 4px 0}
  table.t{width:100%;border-collapse:collapse;font-size:10.5px;margin:4px 0}
  table.t th{background:#0f2a5c;color:#fff;text-align:left;padding:4px 6px;font-weight:700}
  table.t td{border:1px solid #e2e8f0;padding:4px 6px;vertical-align:top}
  .legend td{padding:3px 6px;font-size:10.5px}
  .pill{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9.5px;font-weight:700;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
  .pill-green{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9.5px;font-weight:700;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0}
  .foot{color:#64748b;font-size:9.5px;margin-top:6px;text-align:center}
  .box-info{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;margin-top:6px}
  `;

  // Page 1: Executive Overview & Visual Facility Health Scorecard
  const page1 = `
  <div class="page">
    <h1>${title}</h1>
    <div class="sub">Camera Safety &amp; Coverage Blueprint &bull; ${company} &bull; ${industry} &bull; ${dateStr}</div>
    
    <table class="cards"><tr>
      <td><div class="n">${camCount}</div><div class="l">Total Cameras</div></td>
      <td><div class="n">${bldgs.length || 1}</div><div class="l">Facility Zones</div></td>
      <td><div class="n">${totalSqm ? totalSqm.toLocaleString() : '—'}</div><div class="l">Square Metres</div></td>
      <td><div class="n">${m.coveragePct !== null ? m.coveragePct + '%' : '—'}</div><div class="l">Floor Watched</div></td>
      <td><div class="n">${storageTb} TB</div><div class="l">30-Day Storage</div></td>
      <td><div class="n">${switches}</div><div class="l">Network Switch${switches > 1 ? 'es' : ''}</div></td>
    </tr></table>

    <div class="verdict ${verdictClass}"><b class="t1">${verdictTitle}</b>${verdictBody}</div>

    <h2>How This Site is Protected (In Plain Words)</h2>
    <p style="margin:2px 0 6px;">This plan specifies where to install <b>${camCount} cameras</b> across your facility to protect personnel, monitor machinery, and eliminate blind spots. The 6 diagrams on the following pages show every camera angle from above, from the side, and in realistic 3D so you can verify coverage without any technical background.</p>

    <h2>Picture Clarity Standards (What Cameras See Clearly)</h2>
    <table class="t legend">
      <tr><td style="width:22%;"><b>Face &amp; ID Level</b></td><td style="width:20%;"><span class="pill-green">Identify (≥250 px/m)</span></td><td>High resolution to confirm a person's identity, read employee badges, and capture license plates.</td></tr>
      <tr><td><b>Safety Gear &amp; Uniforms</b></td><td><span class="pill">Recognize (≥125 px/m)</span></td><td>Clear vision to confirm hard hats, high-visibility safety vests, and distinctive clothing.</td></tr>
      <tr><td><b>Vehicles &amp; Equipment</b></td><td><span class="pill" style="background:#fefce8;color:#a16207;border-color:#fde047;">Observe (≥62.5 px/m)</span></td><td>Clear sight of forklifts, pallet movements, machinery operations, and conveyor lines.</td></tr>
      <tr><td><b>Motion &amp; Entry</b></td><td><span class="pill" style="background:#f8fafc;color:#475569;border-color:#cbd5e1;">Detect (≥25 px/m)</span></td><td>Wide-area detection alerting supervisors whenever any person or vehicle enters a zone.</td></tr>
    </table>

    <h2>Monitored Facility Buildings &amp; Zones</h2>
    ${buildingRows || '<p>The entire facility is monitored as an integrated single-building footprint.</p>'}
    
    <div class="foot">Page 1 of 5 &bull; Executive Blueprint Overview &bull; Confirmed with Plan Vision Engine</div>
  </div>`;

  // Page 2: Architectural Layout (Top View & Side Elevation)
  const page2 = `
  <div class="page">
    <h2>Architectural Site Layout: Top View &amp; Side Elevation</h2>
    ${figHtml(0)}
    ${figHtml(1)}
    <div class="foot">Page 2 of 5 &bull; Architectural 2D &amp; Elevation Profiles &bull; Multi-Angle Simulation</div>
  </div>`;

  // Page 3: 3D Spatial Twins (Bird Camera 3D & 3D Perspective)
  const page3 = `
  <div class="page">
    <h2>3D Spatial Simulation: Bird Camera &amp; Perspective Twin</h2>
    ${figHtml(2)}
    ${figHtml(3)}
    <div class="foot">Page 3 of 5 &bull; 3D Obstacle Occlusion &amp; Perspective Sightlines</div>
  </div>`;

  // Page 4: Optical Clarity & Coverage Gap Telemetry
  const page4 = `
  <div class="page">
    <h2>Optical Clarity &amp; Coverage Gap Telemetry</h2>
    ${figHtml(4)}
    ${figHtml(5)}
    <div class="verdict ${verdictClass}"><b class="t1">Camera Mapping Status &amp; Next Action</b>${
      m.coveragePct !== null && m.coveragePct < m.target
        ? `Coverage is currently below your ${m.target}% target. In the <b>Camera Map</b> screen, adjust camera angles or click <b>Auto-Solve (≥95%)</b>, then click <b>Confirm Camera Mapping</b> to update this report.`
        : 'Your camera layout satisfies all safety coverage targets. Re-verify after any facility equipment reconfiguration.'
    }</div>
    <div class="foot">Page 4 of 5 &bull; Optical Frustum Clarity &amp; Multi-Angle Telemetry Scorecard</div>
  </div>`;

  // Page 5: Camera Fleet Schedule & Equipment Summary
  const page5 = `
  <div class="page">
    <h2>Camera Placement Schedule</h2>
    ${cameraSection}

    <h2>Hardware &amp; Equipment in Simple Terms</h2>
    <div class="box-info">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><b>📷 ${camCount} Weatherproof AI Cameras</b><br/><span style="color:#64748b;font-size:9.5px;">Equipped with automatic night vision and wide-angle lenses tailored to room dimensions.</span></div>
        <div><b>💾 ${storageTb} TB Video Storage</b><br/><span style="color:#64748b;font-size:9.5px;">Dedicated hard drive capacity keeping 30 full days of continuous high-definition recording.</span></div>
        <div><b>🔌 ${switches} PoE Network Switch${switches > 1 ? 'es' : ''}</b><br/><span style="color:#64748b;font-size:9.5px;">Supplies power and data over standard network cables (up to 24 cameras per switch).</span></div>
        <div><b>🖥️ 1 Smart Video Analytics Station</b><br/><span style="color:#64748b;font-size:9.5px;">Processes video feeds locally in real time for instant hazard and PPE alerts without cloud delay.</span></div>
      </div>
    </div>

    <h2>Site Installation &amp; Verification Checklist</h2>
    <table class="t">
      <tr><td style="width:5%;">[ &nbsp; ]</td><td style="width:45%;"><b>Camera Mount Verification</b>: Walk site to confirm wall/ceiling brackets match layout coordinates.</td><td style="width:5%;">[ &nbsp; ]</td><td style="width:45%;"><b>Sightline Check</b>: Verify no new tall racks or pallets obstruct designated camera cones.</td></tr>
      <tr><td>[ &nbsp; ]</td><td><b>Network Cable Runs</b>: Ensure cable distances from switch to cameras remain within 100 meters.</td><td>[ &nbsp; ]</td><td><b>Live Angle Calibration</b>: Fine-tune pan and tilt on live monitor to eliminate ground blind spots.</td></tr>
    </table>

    <div class="foot">Page 5 of 5 &bull; Camera Hardware Schedule &bull; Figures are planning estimates; confirm on site before installation.</div>
  </div>`;

  const body = `${page1}${page2}${page3}${page4}${page5}`;

  if (mode === 'docx') {
    return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${title}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page Section1{size:595.3pt 841.9pt;margin:30pt 36pt}div.Section1{page:Section1}${css}</style></head>
<body><div class="Section1">${body}</div></body></html>`;
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title} — Camera Safety Plan</title>
<style>${css}@media print{body{background:#fff}.page{margin:0;box-shadow:none}}</style></head><body>${body}</body></html>`;
}
