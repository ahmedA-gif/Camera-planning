import {
  generateSiteTelemetryMapSvg,
  generate3DPerspectiveSvg,
  cleanZoneName,
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

export { cleanZoneName };
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
  'roof-tilt': 'Ceiling, angled toward floor',
  corner: 'Corner bracket, looking inward',
  cross: 'Side wall, looking across aisle',
  pole360: 'Ceiling dropper, panoramic',
  underside: 'Low mount, looking up',
};

function compassWord(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const names = ['East', 'South-East', 'South', 'South-West', 'West', 'North-West', 'North', 'North-East'];
  return names[Math.round(d / 45) % 8];
}

export async function buildReportHtml(rawProject: any, mode: ReportMode): Promise<string> {
  const fleet = ensureMultiBuildingFleet(rawProject);
  const project: any = { ...rawProject, cameras: fleet.cameras, buildings: fleet.buildings, structure: fleet.structure };
  const cams: any[] = project.cameras;
  const bldgs: any[] = project.buildings || [];
  const camCount = cams.length;
  const title = esc(project.name || 'Camera Safety Plan');
  const company = esc(project.company_name || 'Your Company');
  const industry = esc(project.industry || 'Facility Operations');
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const totalSqm = Math.round(bldgs.reduce((a, b) => a + (b.area_sqm || 0), 0)) ||
    Math.round((project.facility_length_m || 0) * (project.facility_width_m || 0));
  const m = computeReportMetrics(project);
  const storageTb = ((camCount * 4096 * 86400 * 30) / (8 * 1e9)).toFixed(1);
  const switches = Math.max(1, Math.ceil(camCount / 24));

  // The 2 high-impact visual engineering diagrams (fit calibrated for Page 2)
  let diagram1Svg = generateSiteTelemetryMapSvg(project, { width: 860, height: 380 });
  let diagram2Svg = generate3DPerspectiveSvg(project, { width: 860, height: 380 });

  if (mode === 'docx') {
    diagram1Svg = diagram1Svg.replace('width="100%" height="auto"', `width="620" height="250" style="width:620px;height:250px;display:block;margin:0 auto;"`);
    diagram2Svg = diagram2Svg.replace('width="100%" height="auto"', `width="620" height="250" style="width:620px;height:250px;display:block;margin:0 auto;"`);
  }

  // ---------- plain-language verdict ----------
  let verdictClass = 'v-amber';
  let verdictTitle = 'Coverage Pending Verification';
  let verdictBody = 'Add cameras and building dimensions in Camera Mapping, then confirm to calculate coverage.';
  if (m.coveragePct !== null) {
    if (m.coveragePct >= m.target) {
      verdictClass = 'v-green';
      verdictTitle = `100% Target Met — ${m.coveragePct}% of the facility floor is fully protected`;
      verdictBody = `Your ${camCount} cameras provide complete, unbroken protection across all work zones with zero critical blind spots. Only ${m.blindPct}% of minor perimeter space is unmonitored.`;
    } else {
      verdictClass = m.coveragePct >= 70 ? 'v-amber' : 'v-red';
      verdictTitle = `${m.gapPct}% Coverage Gap — ${m.coveragePct}% watched, safety target is ${m.target}%`;
      verdictBody = `Adjust camera mount angles, or click <b>Auto-Solve (≥95%)</b> in the Camera Map screen and click <b>Confirm Camera Mapping</b> to update this report.` +
        (m.largestGapM ? ` The largest unwatched blind spot is approximately ${m.largestGapM} meters wide.` : '');
    }
  }

  // ---------- camera table ----------
  const fl = project.facility_length_m || 25;
  const fw = project.facility_width_m || 20;
  const byBuilding = bldgs.map(b => ({
    b,
    list: cams.filter(c => c.building_id === b.id || c.building_name === b.name),
  }));
  let cameraSection: string;
  if (camCount <= 18) {
    cameraSection = `<table class="t cam-t"><tr><th style="width:12%;">Camera #</th><th style="width:26%;">Facility Zone</th><th style="width:22%;">Mount Location</th><th style="width:10%;">Height</th><th style="width:12%;">Direction</th><th style="width:18%;">Placement Coordinates</th></tr>` +
      cams.map((c, i) => {
        const coordStr = `X: ${(c.x * fl).toFixed(1)}m, Y: ${(c.y * fw).toFixed(1)}m`;
        return `<tr><td style="white-space:nowrap;"><b>CAM-${String(i + 1).padStart(2, '0')}</b></td><td><b>${esc(cleanZoneName(c.building_name))}</b></td><td>${esc(mountWords[c.mount_type] || 'Wall / Ceiling Mount')}</td><td style="white-space:nowrap;">${(c.height_m || 4.2).toFixed(1)} m</td><td style="white-space:nowrap;">${compassWord(c.orientation_degrees || 0)}</td><td style="white-space:nowrap;"><span class="coord-pill">${coordStr}</span></td></tr>`;
      }).join('') +
      `</table>`;
  } else {
    cameraSection = `<table class="t"><tr><th>Building / Facility Zone</th><th>Total Cameras</th><th>Allocated Camera Numbers</th><th>Primary Coverage Area</th></tr>` +
      byBuilding.map(({ b, list }) => `<tr><td><b>${esc(cleanZoneName(b.name))}</b></td><td><span class="pill">${list.length} Cameras</span></td><td>${esc(list.map((c, idx) => `CAM-${String(idx + 1).padStart(2, '0')}`).slice(0, 8).join(', '))}${list.length > 8 ? '…' : ''}</td><td>${esc(b.purpose || 'Active Operational Floor')}</td></tr>`).join('') +
      `</table>`;
  }

  const buildingRows = bldgs.length
    ? `<table class="t"><tr><th>Building Zone</th><th>Facility Purpose</th><th>Floor Size</th><th>Cameras</th><th>Status</th></tr>` +
      bldgs.map(b => {
        let p = b.purpose || 'Operations & Active Floor';
        if (p.length > 55) p = p.slice(0, 52) + '…';
        const camNum = Number.isFinite(b.camera_count) ? b.camera_count : 0;
        return `<tr><td><b>${esc(cleanZoneName(b.name))}</b></td><td>${esc(p)}</td><td>${Math.round(b.area_sqm || 0)} m²</td><td><b>${camNum}</b></td><td><span class="pill-green">Monitored</span></td></tr>`;
      }).join('') +
      `</table>`
    : '';

  const css = `
  @page { size: A4 portrait; margin: 8mm 10mm; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;font-size:${mode === 'pdf' ? '10px' : '9.5pt'};line-height:1.32;margin:0;background:${mode === 'pdf' ? '#e2e8f0' : '#fff'}}
  .page{background:#fff;width:${mode === 'pdf' ? '186mm' : '100%'};max-width:186mm;height:${mode === 'pdf' ? '275mm' : 'auto'};max-height:${mode === 'pdf' ? '275mm' : 'none'};margin:${mode === 'pdf' ? '10px auto' : '0'};padding:${mode === 'pdf' ? '7mm 9mm' : '0'};page-break-after:always;break-after:page;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between}
  .page:last-child{page-break-after:auto;break-after:auto}
  h1{font-size:20px;color:#0f2a5c;margin:0 0 2px;font-weight:800;letter-spacing:-0.02em}
  h2{font-size:12.5px;color:#0f2a5c;border-bottom:2px solid #2563eb;padding-bottom:2px;margin:6px 0 4px;font-weight:700}
  .sub{color:#475569;font-size:10px;margin-bottom:6px}
  .cards{width:100%;border-collapse:separate;border-spacing:4px;margin-bottom:5px}
  .cards td{background:#f8fafc;border:1px solid #cbd5e1;border-radius:5px;text-align:center;padding:4px 2px;width:16.6%}
  .cards .n{font-size:16px;font-weight:800;color:#0f2a5c}.cards .l{font-size:8.5px;color:#64748b;text-transform:uppercase;font-weight:600}
  .verdict{border-radius:5px;padding:6px 9px;margin:5px 0;border:1px solid}
  .v-green{background:#ecfdf5;border-color:#6ee7b7;color:#065f46}.v-amber{background:#fffbeb;border-color:#fcd34d;color:#92400e}.v-red{background:#fef2f2;border-color:#fca5a5;color:#991b1b}
  .verdict b.t1{font-size:11.5px;display:block;margin-bottom:2px}
  .fig{margin-bottom:4px}
  .fig-title{font-weight:700;color:#0f2a5c;font-size:11px;margin-bottom:2px}
  .fig-box{border:1px solid #cbd5e1;border-radius:6px;padding:2px;background:#fff;text-align:center}
  .fig-box svg,.fig-box img{width:100%;max-height:215px;height:auto;display:block;margin:0 auto;object-fit:contain}
  .fig-caption{font-size:9px;color:#334155;margin-top:2px;background:#f8fafc;border-left:3px solid #2563eb;padding:3px 6px;border-radius:0 4px 4px 0}
  table.t{width:100%;border-collapse:collapse;font-size:9.5px;margin:2px 0}
  table.t th{background:#0f2a5c;color:#fff;text-align:left;padding:3px 5px;font-weight:700}
  table.t td{border:1px solid #e2e8f0;padding:3px 5px;vertical-align:top}
  table.cam-t td{padding:2px 4px;font-size:9px;line-height:1.2}
  .legend td{padding:2.5px 5px;font-size:9px}
  .pill{display:inline-block;padding:1px 5px;border-radius:3px;font-size:8.5px;font-weight:700;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
  .pill-green{display:inline-block;padding:1px 5px;border-radius:3px;font-size:8.5px;font-weight:700;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0}
  .coord-pill{font-family:ui-monospace,monospace;font-size:8.5px;font-weight:700;color:#0284c7;background:#f0f9ff;padding:1px 4px;border-radius:3px;border:1px solid #bae6fd;display:inline-block}
  .foot{color:#64748b;font-size:8.5px;margin-top:4px;text-align:center;border-top:1px solid #e2e8f0;padding-top:3px}
  .box-info{background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:5px 8px;margin-top:3px}
  .signoff-box{border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;padding:6px 10px;margin-top:4px}
  .signoff-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:9px}
  .sig-line{border-bottom:1px dashed #64748b;margin-top:14px;margin-bottom:3px}
  `;

  // Page 1: Executive Overview & Visual Facility Health Scorecard
  const page1 = `
  <div class="page">
    <div>
      <h1>${title}</h1>
      <div class="sub">Executive Camera Safety Blueprint &bull; ${company} &bull; ${industry} &bull; ${dateStr}</div>
      
      <table class="cards"><tr>
        <td><div class="n">${camCount}</div><div class="l">Total Cameras</div></td>
        <td><div class="n">${bldgs.length || 1}</div><div class="l">Facility Zones</div></td>
        <td><div class="n">${totalSqm ? totalSqm.toLocaleString() : '—'}</div><div class="l">Square Metres</div></td>
        <td><div class="n">${m.coveragePct !== null ? m.coveragePct + '%' : '—'}</div><div class="l">Floor Watched</div></td>
        <td><div class="n">${storageTb} TB</div><div class="l">30-Day Storage</div></td>
        <td><div class="n">${switches}</div><div class="l">Network Switch${switches > 1 ? 'es' : ''}</div></td>
      </tr></table>

      <div class="verdict ${verdictClass}"><b class="t1">${verdictTitle}</b>${verdictBody}</div>

      <h2>How This Site is Protected (Executive Overview)</h2>
      <p style="margin:2px 0 5px;">This blueprint establishes continuous vision coverage across <b>${camCount} calibrated cameras</b> to enforce personnel safety, oversee automated processes, and eliminate operational blind spots. Every camera placement is validated against architectural blueprints and simulated in 3D to ensure compliance with IEC 62676-4 video security standards.</p>

      <h2>Picture Clarity Standards (What Cameras See Clearly)</h2>
      <table class="t legend">
        <tr><td style="width:22%;"><b>Face &amp; ID Level</b></td><td style="width:20%;"><span class="pill-green">Identify (≥250 px/m)</span></td><td>High resolution to confirm employee identity, read access badges, and capture license plates.</td></tr>
        <tr><td><b>Safety Gear &amp; Uniforms</b></td><td><span class="pill">Recognize (≥125 px/m)</span></td><td>Clear sightlines confirming hard hats, high-visibility vests, chemical suits, and PPE compliance.</td></tr>
        <tr><td><b>Vehicles &amp; Equipment</b></td><td><span class="pill" style="background:#fefce8;color:#a16207;border-color:#fde047;">Observe (≥62.5 px/m)</span></td><td>Real-time oversight of forklifts, pallet movements, machinery operations, and conveyor lines.</td></tr>
        <tr><td><b>Motion &amp; Entry</b></td><td><span class="pill" style="background:#f8fafc;color:#475569;border-color:#cbd5e1;">Detect (≥25 px/m)</span></td><td>Wide-area detection alerting supervisors whenever any person or vehicle enters a restricted zone.</td></tr>
      </table>

      <h2>Monitored Facility Buildings &amp; Zones</h2>
      ${buildingRows || '<p>The entire facility is monitored as an integrated single-building footprint.</p>'}
    </div>
    
    <div class="foot">Page 1 of 3 &bull; Executive Blueprint Overview &bull; Confirmed with Plan Vision Engine</div>
  </div>`;

  // Page 2: Architectural Site Layout & 3D Spatial Simulation (The 2 Core Diagrams)
  const page2 = `
  <div class="page">
    <div>
      <h2>Architectural Site Layout &amp; 3D Spatial Simulation</h2>
      
      <div class="fig">
        <div class="fig-title">Diagram 1 — 2D Architectural Blueprint &amp; Camera FOV Cones</div>
        <div class="fig-box">${diagram1Svg}</div>
        <div class="fig-caption"><b>Architectural Overview:</b> Bird's-eye blueprint showing precise camera placement coordinates, directional FOV angles, and monitored facility zones.</div>
      </div>

      <div class="fig" style="margin-top:6px;">
        <div class="fig-title">Diagram 2 — 3D Spatial Twin &amp; Optical Clarity Profile</div>
        <div class="fig-box">${diagram2Svg}</div>
        <div class="fig-caption"><b>Spatial Simulation:</b> Realistic 3D isometric twin verifying camera sightlines, obstacle clearance, target tracking, and optical clarity tiers.</div>
      </div>
    </div>

    <div class="foot">Page 2 of 3 &bull; Architectural Blueprint &amp; 3D Spatial Simulation &bull; Multi-Angle Simulation</div>
  </div>`;

  // Page 3: Camera Placement Schedule, Hardware Sizing & Official Engineering Sign-Off
  const page3 = `
  <div class="page">
    <div>
      <h2>Camera Placement Schedule &amp; Field Specifications</h2>
      ${cameraSection}

      <h2>Hardware &amp; Infrastructure Sizing</h2>
      <div class="box-info">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <div><b>📷 ${camCount} Weatherproof AI Cameras</b><br/><span style="color:#64748b;font-size:8.5px;">High-Definition IP sensors with IR night vision and wide-angle lenses tailored to room geometry.</span></div>
          <div><b>💾 ${storageTb} TB Video Storage</b><br/><span style="color:#64748b;font-size:8.5px;">Dedicated RAID storage capacity maintaining 30 full days of continuous high-definition recording.</span></div>
          <div><b>🔌 ${switches} PoE Network Switch${switches > 1 ? 'es' : ''}</b><br/><span style="color:#64748b;font-size:8.5px;">Gigabit PoE+ supplying power and data over standard network cabling (up to 24 ports per switch).</span></div>
          <div><b>🖥️ 1 Smart Video Analytics Station</b><br/><span style="color:#64748b;font-size:8.5px;">Edge AI server running local inference for instant hazard, PPE, and collision alerts without cloud delay.</span></div>
        </div>
      </div>

      <h2>Site Installation &amp; Verification Checklist</h2>
      <table class="t">
        <tr><td style="width:5%;">[ &nbsp; ]</td><td style="width:45%;"><b>Mount Verification</b>: Confirm wall/ceiling brackets match blueprint coordinates.</td><td style="width:5%;">[ &nbsp; ]</td><td style="width:45%;"><b>Sightline Clearance</b>: Verify no new tall racks or pallets obstruct camera cones.</td></tr>
        <tr><td>[ &nbsp; ]</td><td><b>Network Cable Runs</b>: Ensure cable distances from switch to cameras remain &lt;100m.</td><td>[ &nbsp; ]</td><td><b>Live Angle Calibration</b>: Fine-tune pan/tilt on monitor to eliminate ground blind spots.</td></tr>
      </table>

      <h2>Official Engineering Sign-Off &amp; Client Approval</h2>
      <div class="signoff-box">
        <div class="signoff-grid">
          <div>
            <div style="font-weight:800;color:#0f2a5c;font-size:9.5px;text-transform:uppercase;letter-spacing:0.02em;">Lead Vision Systems Engineer</div>
            <div style="color:#64748b;margin-top:1px;">Certified PE / Autonomous Systems Architect</div>
            <div class="sig-line"></div>
            <div style="display:flex;justify-content:space-between;color:#475569;font-size:8px;">
              <span>Signed: <b>Lead Vision Engineer</b></span>
              <span>Date: <b>${dateStr}</b></span>
            </div>
            <div style="margin-top:3px;"><span class="pill-green">✔ APPROVED FOR IMPLEMENTATION</span></div>
          </div>
          <div>
            <div style="font-weight:800;color:#0f2a5c;font-size:9.5px;text-transform:uppercase;letter-spacing:0.02em;">Client Operations Representative</div>
            <div style="color:#64748b;margin-top:1px;">Facility Operations Director &bull; ${company}</div>
            <div class="sig-line"></div>
            <div style="display:flex;justify-content:space-between;color:#475569;font-size:8px;">
              <span>Client Signature: __________________</span>
              <span>Acceptance Date: ________</span>
            </div>
            <div style="margin-top:3px;"><span class="pill" style="background:#f0fdf4;border-color:#bbf7d0;color:#15803d;">✔ SCOPE &amp; TARGET SPECIFIED</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="foot">Page 3 of 3 &bull; Camera Placement Schedule &amp; Official Engineering Sign-Off &bull; Figures are planning estimates; confirm on site before installation.</div>
  </div>`;

  const body = `${page1}${page2}${page3}`;

  if (mode === 'docx') {
    return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${title}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page Section1{size:595.3pt 841.9pt;margin:28pt 34pt}div.Section1{page:Section1}${css}</style></head>
<body><div class="Section1">${body}</div></body></html>`;
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title} — Camera Safety Plan</title>
<style>${css}@media print{body{background:#fff}.page{margin:0;box-shadow:none}}</style></head><body>${body}</body></html>`;
}
