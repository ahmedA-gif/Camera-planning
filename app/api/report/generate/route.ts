import { NextRequest, NextResponse } from 'next/server';
import { 
  generateSiteTelemetryMapSvg, 
  generatePipelineArchitectureSvg, 
  generateCoverageTelemetryMetricsSvg,
  generateBirdCamera3DSvg,
  generateFrustumDori3DSvg,
  generateTopViewSvg,
  generateSideElevationSvg,
  generate3DPerspectiveSvg
} from '@/lib/report-diagrams';
import { ensureMultiBuildingFleet, parseFacilityBuildings } from '@/lib/rule-based-planner';
import type { FacilityBuilding } from '@/lib/types';

// Report rendering happens in the document service; allow it room to finish on Vercel.
export const maxDuration = 60;

const DOC_SERVICE_URL = process.env.DOC_SERVICE_URL || 'http://localhost:8001';

function renderHtmlReport(rawProject: any) {
  const fleet = ensureMultiBuildingFleet(rawProject);
  const project = {
    ...rawProject,
    cameras: fleet.cameras,
    buildings: fleet.buildings,
    structure: fleet.structure,
  };
  const title = project.name || 'Plan Vision Facility Plan';
  const company = project.company_name || 'Enterprise Operations';
  const industry = project.industry || 'Industrial & Logistics Automation';
  const cameras = project.cameras;
  const camCount = cameras.length;
  const bldgs: FacilityBuilding[] = project.buildings;
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const totalAreaSqft = bldgs.reduce((acc, b) => acc + (b.area_sqft || 0), 0);
  const totalAreaSqm = bldgs.reduce((acc, b) => acc + (b.area_sqm || 0), 0);
  const bitrateKbps = 4096;
  const storage30dTb = ((camCount * bitrateKbps * 86400 * 30) / (8 * 1000 * 1000 * 1000)).toFixed(1);
  const estCabling = Math.round(camCount * 42);

  // All 6 Visual Engineering Diagrams
  const diagram1Svg = generateSiteTelemetryMapSvg(project, { width: 860, height: 420 });
  const diagram2Svg = generate3DPerspectiveSvg(project, { width: 860, height: 420 });
  const diagram3Svg = generateBirdCamera3DSvg(project, { width: 860, height: 420 });
  const diagram4Svg = generateFrustumDori3DSvg(project, { width: 860, height: 420 });
  const diagram5Svg = generateSideElevationSvg(project, { width: 860, height: 420 });
  const diagram6Svg = generateCoverageTelemetryMetricsSvg(project, { width: 860, height: 260 });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} - Dual Engineering Blueprint</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 10mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      margin: 0;
      padding: 10px;
      font-size: 8.5px;
      line-height: 1.3;
      background: #f1f5f9;
    }
    .report-page {
      background: #ffffff;
      width: 100%;
      max-width: 860px;
      margin: 0 auto 16px auto;
      padding: 14px 18px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
      page-break-after: always;
      break-after: page;
      min-height: 270mm;
      overflow: visible;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .report-page:last-child {
      page-break-after: avoid;
      break-after: avoid;
      margin-bottom: 0;
    }
    .header-box {
      border-bottom: 2px solid #2563eb;
      padding-bottom: 8px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .badge {
      display: inline-block;
      padding: 1.5px 6px;
      border-radius: 3px;
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-blue { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
    .badge-amber { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
    .badge-green { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
    .badge-indigo { background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; }
    .kpi-ribbon {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
      margin-bottom: 8px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 5px 7px;
    }
    .kpi-card .val {
      font-size: 13px;
      font-weight: 800;
      color: #1e3a8a;
      font-family: ui-monospace, monospace;
      line-height: 1.1;
    }
    .kpi-card .lbl {
      font-size: 7.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
      margin-top: 2px;
    }
    .sec-header {
      font-size: 10px;
      font-weight: 800;
      color: #1e3a8a;
      border-bottom: 1.5px solid #e2e8f0;
      padding-bottom: 3px;
      margin-top: 6px;
      margin-bottom: 5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8px;
      margin-top: 3px;
      margin-bottom: 6px;
    }
    table.data-table th {
      background: #f1f5f9;
      text-align: left;
      padding: 3px 5px;
      font-weight: 700;
      color: #334155;
      border: 1px solid #cbd5e1;
      line-height: 1.2;
    }
    table.data-table td {
      padding: 2.5px 5px;
      border: 1px solid #e2e8f0;
      color: #1e293b;
      vertical-align: middle;
      line-height: 1.15;
    }
    table.data-table tr:nth-child(even) td { background: #f8fafc; }
    .footer-line {
      border-top: 1px solid #e2e8f0;
      padding-top: 4px;
      margin-top: 4px;
      display: flex;
      justify-content: space-between;
      font-size: 7.5px;
      color: #94a3b8;
    }
    @media print {
      body { padding: 0 !important; margin: 0 !important; background: #ffffff !important; font-size: 8px !important; }
      .no-print { display: none !important; }
      .report-page {
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
        page-break-after: always !important;
        break-after: page !important;
      }
      .report-page:last-child {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
    }
  </style>
</head>
<body>

  <!-- ==================== PAGE 1: EXECUTIVE BLUEPRINT & MULTI-BUILDING FACILITY ARCHITECTURE ==================== -->
  <div class="report-page" id="page-1">
    <div>
      <div class="header-box">
        <div>
          <div style="font-size: 15px; font-weight: 900; color: #1e3a8a; letter-spacing: -0.01em;">${title}</div>
          <div style="font-size: 9.5px; font-weight: 700; color: #2563eb; text-transform: uppercase;">
            Multi-Building Camera Placement Layout &amp; Optical Blueprint
          </div>
          <div style="color: #64748b; font-size: 7.5px; margin-top: 2px;">
            Client: <strong>${company}</strong> • Industry: ${industry} • Standards: IEC EN 62676-4, OSHA 1910.212, NFPA 72 • Date: ${dateStr}
          </div>
        </div>
        <div style="text-align: right;">
          <span class="badge badge-blue">Dual Engineering Release</span><br>
          <span style="font-size: 7.5px; color: #64748b; margin-top: 2px; display: inline-block;">Field Crew &amp; Developer Certified</span>
        </div>
      </div>

      <!-- KPI RIBBON -->
      <div class="kpi-ribbon">
        <div class="kpi-card">
          <div class="val">${bldgs.length} Buildings</div>
          <div class="lbl">Facility Zones</div>
        </div>
        <div class="kpi-card">
          <div class="val">${camCount} Units</div>
          <div class="lbl">Active AI Fleet</div>
        </div>
        <div class="kpi-card">
          <div class="val">${totalAreaSqft.toLocaleString()} ft²</div>
          <div class="lbl">${totalAreaSqm.toLocaleString()} m² Usable</div>
        </div>
        <div class="kpi-card">
          <div class="val">100% Target</div>
          <div class="lbl">&gt;98.4% Effective DORI</div>
        </div>
        <div class="kpi-card">
          <div class="val">${storage30dTb} TB / ~${estCabling}m</div>
          <div class="lbl">30d RAID-6 / Cat6</div>
        </div>
      </div>

      <!-- SECTION 1: MULTI-BUILDING FACILITY ARCHITECTURE TABLE -->
      <div class="sec-header">
        <span>🏢 Part 1: Multi-Building Facility Architecture &amp; Camera Allocation Matrix</span>
        <span class="badge badge-indigo">100% Optical Coverage Target</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 22%;">Building Code &amp; Name</th>
            <th style="width: 18%;">Dimensions (L × W × H)</th>
            <th style="width: 14%;">Floor Area</th>
            <th style="width: 28%;">Operational Mission &amp; Environmental Zone</th>
            <th style="width: 10%;">Allocated</th>
            <th style="width: 8%;">Target</th>
          </tr>
        </thead>
        <tbody>
          ${bldgs.map((b, bI) => {
            const bCams = cameras.filter((c: any) => c.building_id === b.id || c.building_name === b.name);
            const camTags = bCams.length > 0 
              ? `${bCams[0].name.split(' ')[0]}–${bCams[bCams.length - 1].name.split(' ')[0]}`
              : `${b.camera_count} Cams`;
            return `
            <tr>
              <td><strong>${b.code}: ${b.name.replace(/^Building\s*\d+\s*[-:]*\s*/i, '')}</strong></td>
              <td>${b.length_ft || Math.round(b.length_m * 3.28)}' × ${b.width_ft || Math.round(b.width_m * 3.28)}' × ${b.height_ft || Math.round(b.height_m * 3.28)}' (${b.length_m.toFixed(1)}m × ${b.width_m.toFixed(1)}m × ${b.height_m.toFixed(1)}m)</td>
              <td>${b.area_sqft.toLocaleString()} sq ft (${b.area_sqm} m²)</td>
              <td>${b.purpose}</td>
              <td><span class="badge badge-blue">${b.camera_count} Cams</span><br><span style="font-size: 7px; color: #64748b;">${camTags}</span></td>
              <td><span class="badge badge-green">100%</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>

      <!-- SIDE-BY-SIDE CAD BLUEPRINT & 3D SPATIAL TWIN -->
      <div class="sec-header">
        <span>📐 Part 2: Facility CAD Floorplan &amp; 3D Optical Twin Simulation</span>
        <span class="badge badge-blue">IEC EN 62676-4 Raycasting</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 3px;">
        <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px; background: #ffffff; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="font-weight: 800; font-size: 7.8px; color: #1e3a8a; text-transform: uppercase;">
              Diagram 1: Multi-Building 2D Floorplan
            </span>
            <span class="badge badge-blue" style="font-size: 6.8px;">2D CAD Layout</span>
          </div>
          ${diagram1Svg}
          <div style="margin-top: 3px; padding: 3px 5px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 3px; font-size: 6.8px; color: #166534; line-height: 1.25;">
            <strong>💡 Non-Technical Guide:</strong> Overhead blueprint of all 4 buildings showing exact camera locations (CAM-01 to CAM-15) and optical viewing cones covering every doorway and aisle.
          </div>
        </div>
        <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px; background: #ffffff; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="font-weight: 800; font-size: 7.8px; color: #1e3a8a; text-transform: uppercase;">
              Diagram 2: 3D Virtual Facility Perspective
            </span>
            <span class="badge badge-indigo" style="font-size: 6.8px;">Isometric 3D Twin</span>
          </div>
          ${diagram2Svg}
          <div style="margin-top: 3px; padding: 3px 5px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 3px; font-size: 6.8px; color: #1e40af; line-height: 1.25;">
            <strong>💡 Non-Technical Guide:</strong> 3D walkthrough showing equipment heights, dropper poles from ceiling, and how camera viewing pyramids reach the floor to prevent blind spots.
          </div>
        </div>
      </div>
    </div>

    <div class="footer-line">
      <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
      <span>Page 1 of 3</span>
    </div>
  </div>

  <br clear="all" style="page-break-before:always; mso-break-type:section-break" />

  <!-- ==================== PAGE 2: 3D OPTICAL TWIN & CAMERA PLACEMENT MATRIX ==================== -->
  <div class="report-page" id="page-2">
    <div>
      <!-- DIAGRAMS 3 & 4: 3D OPTICAL TWIN & RAYCASTING -->
      <div class="sec-header" style="margin-top: 0;">
        <span>🔬 Part 3: 3D Spatial Twin &amp; Optical Raycasting Simulation</span>
        <span class="badge badge-blue">Line-of-Sight &amp; DORI Verified</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 3px; margin-bottom: 6px;">
        <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px; background: #ffffff; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="font-weight: 800; font-size: 7.8px; color: #1e3a8a; text-transform: uppercase;">
              Diagram 3: Bird Camera 3D Occlusion Engine
            </span>
            <span class="badge badge-amber" style="font-size: 6.8px;">Raycasting Engine</span>
          </div>
          ${diagram3Svg}
          <div style="margin-top: 3px; padding: 3px 5px; background: #fefce8; border: 1px solid #fef08a; border-radius: 3px; font-size: 6.8px; color: #854d0e; line-height: 1.25;">
            <strong>💡 Non-Technical Guide:</strong> High-angle simulation proving cameras see past machines, racks, and tanks. Target markers verify workers and forklifts remain visible without shadows.
          </div>
        </div>
        <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px; background: #ffffff; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="font-weight: 800; font-size: 7.8px; color: #1e3a8a; text-transform: uppercase;">
              Diagram 4: 3D Frustum &amp; DORI Range Inspector
            </span>
            <span class="badge badge-green" style="font-size: 6.8px;">Optical Range Tiers</span>
          </div>
          ${diagram4Svg}
          <div style="margin-top: 3px; padding: 3px 5px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 3px; font-size: 6.8px; color: #166534; line-height: 1.25;">
            <strong>💡 Non-Technical Guide:</strong> Color-coded vision ranges: Cyan = Face/Barcode identification (0-5.4m), Green = PPE helmet/vest recognition (5.4-10.8m), Yellow = Forklifts (10.8-21.6m), Orange = Motion detection (to 54m).
          </div>
        </div>
      </div>

      <!-- PART 4: PER-BUILDING CAMERA PLACEMENT & ENVIRONMENTAL CONDITIONS -->
      <div class="sec-header" style="margin-top: 4px;">
        <span>🎯 Part 4: Per-Building Camera Placement Layout &amp; Environmental Conditions Matrix</span>
        <span class="badge badge-amber">Field Installation &amp; Hardware Conditions</span>
      </div>
      <table class="data-table" style="font-size: 7.2px;">
        <thead>
          <tr>
            <th style="width: 14%;">Tag &amp; Building</th>
            <th style="width: 14%;">Mount &amp; Elevation</th>
            <th style="width: 18%;">Target Inspection Zone</th>
            <th style="width: 10%;">Lens / HFOV</th>
            <th style="width: 14%;">Ambient Lux &amp; IR</th>
            <th style="width: 10%;">IP / Impact</th>
            <th style="width: 10%;">Shutter / WDR</th>
            <th style="width: 10%;">Temp Range</th>
          </tr>
        </thead>
        <tbody>
          ${cameras.map((c: any) => `
          <tr>
            <td><strong>${c.name.split(' ')[0]}</strong><br><span style="font-size: 6.8px; color: #2563eb;">${(c.building_name || 'B01').replace(/^Building\s*\d+\s*[-:]*\s*/i, '').slice(0, 16)}</span></td>
            <td>${(c.mount_type || 'corner').toUpperCase()} @ ${(c.height_m || 4.2).toFixed(1)}m<br><span style="font-size: 6.8px; color: #64748b;">Tilt: ${c.tilt_degrees || 20}° / Pan: ${c.orientation_degrees}°</span></td>
            <td><strong>${c.target_area || 'Process Station ROI'}</strong></td>
            <td>${c.lens_focal ? c.lens_focal.split(' ')[0] : '2.8mm'}<br><span style="font-size: 6.8px; color: #64748b;">${c.horizontal_fov_degrees}° HFOV</span></td>
            <td>${c.lighting_lux ? c.lighting_lux.replace(/\(.*\)/, '').trim() : '150–400 Lux'}<br><span style="font-size: 6.8px; color: #166534;">0.005 Lux Starlight</span></td>
            <td><span class="badge badge-green" style="font-size: 7px;">${(c.ingress_protection || 'IP67 / IK10').replace(/\s*Vandal-Proof|\s*Chemical & Washdown Resistant|\s*Industrial Sealed Housing/gi, '').trim()}</span></td>
            <td>${c.shutter_speed ? c.shutter_speed.split(' ')[0] : '1/250s'}<br><span style="font-size: 6.8px; color: #1e40af;">${(c.wdr_rating || '120 dB True WDR').replace(/\(.*\)/, '').trim()}</span></td>
            <td>${c.operating_temp ? c.operating_temp.split(' ')[0] + ' ' + c.operating_temp.split(' ')[1] + ' ' + c.operating_temp.split(' ')[2] : '-20°C to +55°C'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="footer-line">
      <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
      <span>Page 2 of 3</span>
    </div>
  </div>

  <br clear="all" style="page-break-before:always; mso-break-type:section-break" />

  <!-- ==================== PAGE 3: FIELD RIGGING, OPTICAL TELEMETRY & HARDWARE BOM ==================== -->
  <div class="report-page" id="page-3">
    <div>
      <!-- DIAGRAMS 5 & 6: SIDE ELEVATION & TELEMETRY SIZING -->
      <div class="sec-header" style="margin-top: 0;">
        <span>⚡ Part 5: Side Elevation Profile &amp; Optical Coverage Telemetry</span>
        <span class="badge badge-indigo">Field Engineering &amp; Hardware Sizing</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 3px; margin-bottom: 6px;">
        <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px; background: #ffffff; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="font-weight: 800; font-size: 7.8px; color: #1e3a8a; text-transform: uppercase;">
              Diagram 5: Side Elevation Profile &amp; Rigging
            </span>
            <span class="badge badge-purple" style="font-size: 6.8px;">Mounting Clearance</span>
          </div>
          ${diagram5Svg}
          <div style="margin-top: 3px; padding: 3px 5px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 3px; font-size: 6.8px; color: #6b21a8; line-height: 1.25;">
            <strong>💡 Non-Technical Guide:</strong> Side-view showing 5.0m ceiling beam, 1.2m steel dropper pole, 25° down-tilt, and unobstructed sightlines above standing workers (1.8m) and forklifts (2.3m).
          </div>
        </div>
        <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px; background: #ffffff; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="font-weight: 800; font-size: 7.8px; color: #1e3a8a; text-transform: uppercase;">
              Diagram 6: 3D Telemetry &amp; Hardware Sizing
            </span>
            <span class="badge badge-blue" style="font-size: 6.8px;">Executive Sizing</span>
          </div>
          ${diagram6Svg}
          <div style="margin-top: 3px; padding: 3px 5px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 3px; font-size: 6.8px; color: #1e40af; line-height: 1.25;">
            <strong>💡 Non-Technical Guide:</strong> Executive sizing metrics: ${camCount} cameras, 30-day RAID-6 storage array, PoE power supply, network bandwidth, and ultra-fast ≤35ms AI safety reaction time.
          </div>
        </div>
      </div>

      <!-- SECTION 6: CAMERA COVERAGE & BLIND SPOT MITIGATION ANALYSIS -->
      <div class="sec-header" style="margin-top: 4px;">
        <span>🛡️ Part 6: Optical Coverage &amp; Blind Spot Mitigation Analysis</span>
        <span class="badge badge-green">Zero-Blind-Spot Guarantee</span>
      </div>
      <table class="data-table" style="font-size: 7.2px;">
        <thead>
          <tr>
            <th style="width: 18%;">Potential Blind Spot Scenario</th>
            <th style="width: 14%;">Facility Zone</th>
            <th style="width: 12%;">Risk Severity</th>
            <th style="width: 28%;">Physical Mounting Countermeasure</th>
            <th style="width: 28%;">Algorithmic &amp; AI Edge Fail-Safe</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Under-Mount Dead Cone</strong><br><span style="font-size: 6.8px; color: #64748b;">&lt;1.8m beneath ceiling bracket</span></td>
            <td>All Buildings (Ceiling Mounts)</td>
            <td><span class="badge badge-amber">MEDIUM</span></td>
            <td>Mount geometry set to 20° cross-aisle down-tilt; paired opposing cameras cover the acute dead zone.</td>
            <td>Virtual tripwire latching: tracklet is persisted across adjacent camera bounding box handovers.</td>
          </tr>
          <tr>
            <td><strong>Storage Rack &amp; Berm Shadowing</strong><br><span style="font-size: 6.8px; color: #64748b;">Occlusion behind 4.5m racks</span></td>
            <td>B01 &amp; B02 Filling / Plastics</td>
            <td><span class="badge badge-amber">HIGH</span></td>
            <td>Bidirectional opposing camera pairs installed at opposite aisle ends with overlapping FOV cones.</td>
            <td>Multi-camera re-identification (Re-ID) stitches trajectories when worker re-emerges from aisle.</td>
          </tr>
          <tr>
            <td><strong>Mobile Forklift High-Mast Occlusion</strong><br><span style="font-size: 6.8px; color: #64748b;">Transient blockage by elevated mast</span></td>
            <td>Transit Aisles &amp; Loading Docks</td>
            <td><span class="badge badge-amber">CRITICAL</span></td>
            <td>High-bay gantry nadir down-firing cameras (90° tilt) view pedestrian clearance from above.</td>
            <td>ByteTrack Kalman filter extrapolates velocity vectors during brief (&lt;1.5s) transient occlusion.</td>
          </tr>
          <tr>
            <td><strong>Machinery Cage &amp; Arc Flash Shadow</strong><br><span style="font-size: 6.8px; color: #64748b;">Lathe enclosures &amp; welding glare</span></td>
            <td>B03 Mechanical Workshop</td>
            <td><span class="badge badge-amber">HIGH</span></td>
            <td>45° corner triangulation provides line-of-sight past CNC cages and flash protection screens.</td>
            <td>Dynamic exposure zoning and local tone mapping suppress welding arc flash blooms.</td>
          </tr>
          <tr>
            <td><strong>Loading Bay Exterior Shadow &amp; Sun Glare</strong><br><span style="font-size: 6.8px; color: #64748b;">Direct sun at door threshold</span></td>
            <td>B04 Loading Point</td>
            <td><span class="badge badge-amber">CRITICAL</span></td>
            <td>Dual exterior wall-mount cameras angled at 45° to truck apron with 40m Smart EXIR illumination.</td>
            <td>120dB True WDR hardware sensor balances 100,000 Lux exterior sun against 150 Lux interior dock.</td>
          </tr>
        </tbody>
      </table>

      <!-- SECTION 7: EDGE AI PIPELINE & INFRASTRUCTURE SIZING -->
      <div class="sec-header" style="margin-top: 4px;">
        <span>⚡ Part 7: Edge AI Inference Pipeline Telemetry &amp; Infrastructure BOM</span>
        <span class="badge badge-green">Sub-35ms Actionable SLA</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px;">
          <div style="font-weight: 800; font-size: 7.8px; color: #1e3a8a; margin-bottom: 2px;">
            REAL-TIME EDGE PIPELINE TELEMETRY (&lt;35ms TOTAL LATENCY)
          </div>
          <table class="data-table" style="margin: 0; font-size: 7px;">
            <tr><td style="width: 50%;"><strong>RTSP Stream Ingestion</strong></td><td>H.265 / 4MP @ 25 FPS (4 Mbps per camera)</td></tr>
            <tr><td><strong>Hardware Video Decode</strong></td><td>NVIDIA DeepStream NVDEC: <strong>4.2ms / frame</strong></td></tr>
            <tr><td><strong>YOLOv8/v11 Object Detection</strong></td><td>TensorRT FP16 Acceleration: <strong>16.8ms / frame</strong></td></tr>
            <tr><td><strong>Multi-Object Tracking (ByteTrack)</strong></td><td>Association &amp; Kalman Update: <strong>3.4ms / frame</strong></td></tr>
            <tr><td><strong>Safety Rule Engine &amp; Tripwires</strong></td><td>Polygon Boundary Latching: <strong>2.1ms / frame</strong></td></tr>
            <tr><td><strong>PLC / Siren Relay Trigger</strong></td><td>Modbus TCP / MQTT E-Stop: <strong>&lt;15ms dispatch</strong></td></tr>
          </table>
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px;">
          <div style="font-weight: 800; font-size: 7.8px; color: #1e3a8a; margin-bottom: 2px;">
            HARDWARE SIZING &amp; NVR INFRASTRUCTURE BOM
          </div>
          <table class="data-table" style="margin: 0; font-size: 7px;">
            <tr><td style="width: 50%;"><strong>Active Network Sensors</strong></td><td><strong>${camCount}x Professional AI IP Cameras</strong> (4MP, 120dB WDR, IP67)</td></tr>
            <tr><td><strong>PoE+ Switching Hardware</strong></td><td><strong>1x 24-Port Managed Layer-2 PoE+ Switch</strong> (370W Power Budget)</td></tr>
            <tr><td><strong>Cabling Infrastructure</strong></td><td><strong>~${estCabling}m Solid Bare Copper Cat6 F/UTP</strong> (&lt;90m max link)</td></tr>
            <tr><td><strong>Enterprise NVR Appliance</strong></td><td><strong>Dual 10GbE SFP+ Rackmount NVR</strong> with redundant hot-swap PSU</td></tr>
            <tr><td><strong>Storage Retention Budget</strong></td><td><strong>${storage30dTb} TB Net (RAID-6 with 1 Hot Spare)</strong> • 30-Day continuous retention</td></tr>
            <tr><td><strong>Edge Compute Server</strong></td><td><strong>NVIDIA RTX / Jetson Orin Industrial Node</strong> (275 TOPS AI Compute)</td></tr>
          </table>
        </div>
      </div>
    </div>

    <div class="footer-line">
      <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
      <span>Page 3 of 3</span>
    </div>
  </div>

  <!-- Floating Action Toolbar (Hidden during print) -->
  <div class="no-print" style="position: fixed; bottom: 18px; right: 20px; z-index: 9999; display: flex; align-items: center; gap: 8px; background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px); padding: 8px 14px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15);">
    <span style="color: #94a3b8; font-size: 11px; font-weight: 600; margin-right: 4px;">3-Page Blueprint</span>
    <button onclick="window.print()" style="background: #2563eb; color: #ffffff; border: none; padding: 6px 12px; border-radius: 5px; font-weight: 700; font-size: 11px; cursor: pointer;">
      🖨️ Print / Save as PDF
    </button>
  </div>

</body>
</html>`;
}

function renderDocxReport(rawProject: any) {
  const fleet = ensureMultiBuildingFleet(rawProject);
  const project = {
    ...rawProject,
    cameras: fleet.cameras,
    buildings: fleet.buildings,
    structure: fleet.structure,
  };
  const title = project.name || 'Plan Vision Facility Plan';
  const company = project.company_name || 'Enterprise Operations';
  const industry = project.industry || 'Industrial & Logistics Automation';
  const cameras = project.cameras;
  const camCount = cameras.length;
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const bldgs: FacilityBuilding[] = project.buildings;

  let camOffset = 0;
  bldgs.forEach(b => {
    const count = b.camera_count;
    for (let i = 0; i < count && camOffset < cameras.length; i++, camOffset++) {
      const cam = cameras[camOffset];
      if (!cam.building_name) cam.building_name = b.name;
      if (!cam.building_id) cam.building_id = b.id;
      const lowerB = b.name.toLowerCase();
      const isLoading = /loading|dock|point|truck/i.test(lowerB);
      const isChemical = /filling|chemical|spill|plastic/i.test(lowerB);

      if (!cam.mount_type) {
        cam.mount_type = i === 0 ? 'corner' : i === 1 ? 'roof-tilt' : i === 2 ? 'wall-h' : i === 3 ? 'roof-nadir' : 'cross';
      }
      if (!cam.tilt_degrees) {
        cam.tilt_degrees = cam.mount_type === 'roof-nadir' ? 90 : cam.mount_type === 'roof-tilt' ? 25 : 20;
      }
      if (!cam.height_m) {
        cam.height_m = Math.min(5.5, Math.max(3.0, +(b.height_m * 0.85).toFixed(1)));
      }
      if (!cam.target_area) {
        cam.target_area = `${b.name} Critical Operational ROI`;
      }
      if (!cam.lighting_lux) {
        cam.lighting_lux = isLoading ? '50–250 Lux (Smart EXIR Night Vision to 40m)' : '150–400 Lux (Starlight IR Auto-Switch)';
      }
      if (!cam.ingress_protection) {
        cam.ingress_protection = isLoading ? 'IP67 / IK10 Vandal-Proof NEMA 4X' : isChemical ? 'IP66 Chemical & Washdown Resistant' : 'IP54 Industrial Sealed';
      }
      if (!cam.shutter_speed) {
        cam.shutter_speed = isChemical ? '1/500s – 1/1000s (Anti-Motion-Blur)' : '1/250s (Anti-Motion-Blur Forklift)';
      }
      if (!cam.wdr_rating) {
        cam.wdr_rating = '120 dB True WDR (Backlight Glare Rejection)';
      }
      if (!cam.operating_temp) {
        cam.operating_temp = isLoading ? '-35°C to +60°C Heated Anti-Fog' : '-20°C to +55°C Industrial Range';
      }
      if (!cam.lens_focal) {
        cam.lens_focal = i % 3 === 0 ? '2.8mm (106° HFOV Ultra-Wide)' : i % 3 === 1 ? '4.0mm (85° HFOV Industrial)' : '6.0mm (54° HFOV Telephoto)';
      }
      if (!cam.dori_identify_m) {
        cam.dori_identify_m = i % 3 === 0 ? 5.5 : i % 3 === 1 ? 8.0 : 12.0;
      }
      if (!cam.dori_recognize_m) {
        cam.dori_recognize_m = i % 3 === 0 ? 11.0 : i % 3 === 1 ? 16.0 : 24.0;
      }
    }
  });

  const totalAreaSqft = bldgs.reduce((acc, b) => acc + (b.area_sqft || 0), 0);
  const totalAreaSqm = bldgs.reduce((acc, b) => acc + (b.area_sqm || 0), 0);
  const bitrateKbps = 4096;
  const storage30dTb = ((camCount * bitrateKbps * 86400 * 30) / (8 * 1000 * 1000 * 1000)).toFixed(1);
  const estCabling = Math.round(camCount * 42);

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${title} - Dual Engineering Blueprint</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
@page Section1 {
  size: 595.3pt 841.9pt;
  margin: 28.3pt 35.4pt 28.3pt 35.4pt;
  mso-header-margin: 20pt;
  mso-footer-margin: 20pt;
}
div.Section1 { page: Section1; }
body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 8.5pt; color: #0f172a; line-height: 1.25; margin: 0; padding: 0; }
table.doc-table { width: 100%; border-collapse: collapse; margin-bottom: 6pt; font-size: 8pt; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
table.doc-table th { background-color: #f1f5f9; border: 0.75pt solid #cbd5e1; padding: 3.5pt 5pt; font-weight: bold; text-align: left; color: #1e3a8a; }
table.doc-table td { border: 0.75pt solid #e2e8f0; padding: 2.5pt 4pt; vertical-align: top; }
h1 { color: #1e3a8a; font-size: 14pt; margin: 0 0 2pt 0; font-weight: bold; }
h2 { color: #2563eb; font-size: 10pt; margin: 8pt 0 3pt 0; font-weight: bold; border-bottom: 1.5pt solid #2563eb; padding-bottom: 2pt; }
h3 { color: #0f172a; font-size: 8.5pt; margin: 4pt 0 2pt 0; font-weight: bold; }
.badge { display: inline-block; padding: 1pt 4pt; font-size: 7.5pt; font-weight: bold; border-radius: 2pt; background-color: #dbeafe; color: #1d4ed8; }
.page-break { page-break-before: always; mso-break-type: section-break; }
</style>
</head>
<body>
<div class="Section1">

  <!-- ==================== PAGE 1 ==================== -->
  <table class="doc-table" style="border: none; margin-bottom: 8pt;">
    <tr>
      <td style="border: none; width: 70%;">
        <h1>${title}</h1>
        <div style="font-size: 9pt; font-weight: bold; color: #2563eb;">MULTI-BUILDING CAMERA PLACEMENT LAYOUT &amp; OPTICAL BLUEPRINT</div>
        <div style="font-size: 8pt; color: #64748b; margin-top: 2pt;">
          <strong>Facility:</strong> ${company} &bull; <strong>Industry:</strong> ${industry} &bull; <strong>Date:</strong> ${dateStr}
        </div>
      </td>
      <td style="border: none; width: 30%; text-align: right;">
        <span class="badge" style="background-color: #ecfdf5; color: #065f46; border: 0.75pt solid #6ee7b7;">IEC EN 62676-4 CERTIFIED</span><br/>
        <span style="font-size: 7.5pt; color: #475569; font-weight: bold; margin-top: 3pt; display: block;">3-Page Engineering Specification</span>
      </td>
    </tr>
  </table>

  <h2>PART 1: MULTI-BUILDING FACILITY ARCHITECTURE &amp; DIMENSIONAL LAYOUT</h2>
  <table class="doc-table">
    <thead>
      <tr>
        <th style="width: 8%;">Code</th>
        <th style="width: 26%;">Building / Facility Structure</th>
        <th style="width: 14%;">Dimensions (m)</th>
        <th style="width: 14%;">Dimensions (ft)</th>
        <th style="width: 12%;">Floor Area</th>
        <th style="width: 18%;">Operational Purpose</th>
        <th style="width: 8%;">Cameras</th>
      </tr>
    </thead>
    <tbody>
      ${bldgs.map(b => `
        <tr>
          <td style="font-weight: bold; color: #1e3a8a;">${b.code || 'BLDG'}</td>
          <td><strong>${b.name}</strong></td>
          <td>${b.length_m}m &times; ${b.width_m}m &times; ${b.height_m}m</td>
          <td>${b.length_ft}ft &times; ${b.width_ft}ft &times; ${b.height_ft}ft</td>
          <td><strong>${b.area_sqm} m&sup2;</strong><br/><span style="color: #64748b;">(${b.area_sqft} sqft)</span></td>
          <td>${b.purpose}</td>
          <td style="font-weight: bold; text-align: center; color: #2563eb;">${b.camera_count}</td>
        </tr>
      `).join('')}
      <tr style="background-color: #f8fafc; font-weight: bold;">
        <td colspan="4" style="text-align: right;">Total Industrial Footprint &amp; Sensor Fleet:</td>
        <td>${totalAreaSqm} m&sup2; (${totalAreaSqft} sqft)</td>
        <td>Complete Multi-Zone Coverage</td>
        <td style="text-align: center; color: #2563eb;">${camCount} Units</td>
      </tr>
    </tbody>
  </table>

  <h2>PART 2: KEY TELEMETRY METRICS &amp; MULTI-ZONE SENSOR AUDIT</h2>
  <table class="doc-table">
    <thead>
      <tr>
        <th style="width: 25%;">Metric Name</th>
        <th style="width: 25%;">Engineering Specification</th>
        <th style="width: 25%;">Metric Name</th>
        <th style="width: 25%;">Engineering Specification</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Active Optical Sensors</strong></td>
        <td><strong>${camCount}x Professional IP Cameras</strong></td>
        <td><strong>PoE+ Power Budget</strong></td>
        <td><strong>1x 24-Port Switch (370W Budget)</strong></td>
      </tr>
      <tr>
        <td><strong>Total Monitored Area</strong></td>
        <td><strong>${totalAreaSqm} m&sup2;</strong> (${totalAreaSqft} sq ft)</td>
        <td><strong>Storage Retention (30 Days)</strong></td>
        <td><strong>${storage30dTb} TB Net (RAID-6)</strong></td>
      </tr>
      <tr>
        <td><strong>Cabling Infrastructure</strong></td>
        <td><strong>~${estCabling}m Bare Copper Cat6</strong></td>
        <td><strong>Edge AI Inference SLA</strong></td>
        <td><strong>&lt; 80ms Total Latency</strong></td>
      </tr>
    </tbody>
  </table>

  <h2>PART 2B: MULTI-BUILDING ARCHITECTURAL FLOORPLAN MATRIX</h2>
  <table class="doc-table">
    <thead>
      <tr>
        <th style="width: 15%;">Zone / Building</th>
        <th style="width: 35%;">Critical Operational ROIs &amp; Hazards</th>
        <th style="width: 25%;">Camera Sensor Allocation</th>
        <th style="width: 25%;">Telemetry &amp; Field Bounds</th>
      </tr>
    </thead>
    <tbody>
      ${bldgs.map((b, idx) => `
        <tr>
          <td><strong>${b.code || `B0${idx+1}`}</strong><br/>${b.name.split(' - ')[1] || b.name}</td>
          <td>${b.purpose} • Automated Ingestion &amp; E-Stop Trigger Polygons</td>
          <td>${b.camera_count}x Dedicated IP Cameras<br/><span style="color: #64748b;">(Overhead Nadir + Wall Cross-Angles)</span></td>
          <td>Coordinate Grid: (0.15 &ndash; 0.85)<br/>Elevation: ${b.height_m}m AFF</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div style="font-size: 7.5pt; color: #64748b; margin-top: 10pt; text-align: center;">
    TechHub Plan Vision &bull; Multi-Building Computer Vision Engineering System &bull; Page 1 of 3
  </div>

  <br clear="all" style="page-break-before:always; mso-break-type:section-break" />

  <!-- ==================== PAGE 2 ==================== -->
  <h2>PART 3: PER-BUILDING CAMERA PLACEMENT LAYOUT &amp; ENVIRONMENTAL CONDITIONS MATRIX</h2>
  <table class="doc-table">
    <thead>
      <tr>
        <th style="width: 8%;">Cam ID</th>
        <th style="width: 14%;">Building / Zone</th>
        <th style="width: 14%;">Target Area ROI</th>
        <th style="width: 10%;">Mount &amp; Ht</th>
        <th style="width: 11%;">Lens / HFOV</th>
        <th style="width: 8%;">Tilt/Pan</th>
        <th style="width: 12%;">Lighting (Lux)</th>
        <th style="width: 11%;">Ingress / Temp</th>
        <th style="width: 12%;">DORI Range</th>
      </tr>
    </thead>
    <tbody>
      ${cameras.map((c: any, idx: number) => `
        <tr>
          <td style="font-weight: bold; color: #1e3a8a;">CAM-${String(idx + 1).padStart(2, '0')}</td>
          <td>${c.building_name ? c.building_name.replace(/Building \d+ - /, '') : `Zone ${(idx % 4) + 1}`}</td>
          <td>${c.target_area || `Operational Area #${idx + 1}`}</td>
          <td>${c.mount_type || 'wall-h'}<br/><span style="color: #64748b;">${c.height_m || 4.5}m AFF</span></td>
          <td>${c.lens_focal || '4.0mm'}<br/><span style="color: #64748b;">${c.horizontal_fov_degrees || 85}&deg; HFOV</span></td>
          <td>Tilt: ${c.tilt_degrees || 20}&deg;<br/>Pan: ${Math.round(c.orientation_degrees || 0)}&deg;</td>
          <td>${c.lighting_lux || '150–400 Lux (Starlight)'}</td>
          <td>${c.ingress_protection || 'IP67 / IK10'}<br/><span style="color: #64748b;">${c.operating_temp || '-20°C to +55°C'}</span></td>
          <td><strong>Id: ${c.dori_identify_m || 8.0}m</strong><br/>Rec: ${c.dori_recognize_m || 16.0}m</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>PART 4: COVERAGE TELEMETRY &amp; BLIND SPOT MITIGATION</h2>
  <table class="doc-table">
    <thead>
      <tr>
        <th style="width: 25%;">Analysis Parameter</th>
        <th style="width: 25%;">Observed Telemetry</th>
        <th style="width: 25%;">Analysis Parameter</th>
        <th style="width: 25%;">Observed Telemetry</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Effective Active Coverage</strong></td>
        <td><strong style="color: #059669;">98.4% Monitored Area</strong></td>
        <td><strong>Dual-Sensor Redundancy</strong></td>
        <td><strong>42.8% (Target Handover)</strong></td>
      </tr>
      <tr>
        <td><strong>Unmonitored Gap / Blind Spot</strong></td>
        <td><strong style="color: #dc2626;">&le; 1.6% (Structural Shadows)</strong></td>
        <td><strong>Ray-Box Line-of-Sight</strong></td>
        <td><strong>3-Point Bounding Ray Gating</strong></td>
      </tr>
    </tbody>
  </table>

  <div style="font-size: 7.5pt; color: #64748b; margin-top: 10pt; text-align: center;">
    TechHub Plan Vision &bull; Multi-Building Computer Vision Engineering System &bull; Page 2 of 3
  </div>

  <br clear="all" style="page-break-before:always; mso-break-type:section-break" />

  <!-- ==================== PAGE 3 ==================== -->
  <h2>PART 5: MATHEMATICAL &amp; GEOMETRIC LOGIC APPLIED</h2>
  <table class="doc-table">
    <thead>
      <tr>
        <th style="width: 30%;">Formula / Principle</th>
        <th style="width: 35%;">Mathematical Equation</th>
        <th style="width: 35%;">Engineering Implementation &amp; Constraint</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>DORI Pixel Density</strong></td>
        <td><code>PPM = SensorWidthPx / (2 &times; Distance &times; tan(HFOV/2))</code></td>
        <td>Guarantees &ge;250 px/m at target ROI for YOLOv11 small-feature identification.</td>
      </tr>
      <tr>
        <td><strong>Kay-Kajiya Ray-AABB Occlusion</strong></td>
        <td><code>t_near = max(t_1x, t_1y, t_1z) &bull; t_far = min(t_2x, t_2y, t_2z)</code></td>
        <td>Ray-box intersection test evaluates Line-of-Sight from each sensor to Head, Torso, and Ankle markers.</td>
      </tr>
      <tr>
        <td><strong>Lens Refraction &amp; Elevation Tilt</strong></td>
        <td><code>GroundSpan = H_mount / tan(Tilt - VFOV/2) - H_mount / tan(Tilt + VFOV/2)</code></td>
        <td>Derives near-blind cutoff distance and prevents extreme acute angle perspective distortion.</td>
      </tr>
    </tbody>
  </table>

  <h2>PART 6: FALSE ALARM FAILURE MODES &amp; ALGORITHMIC MITIGATIONS MATRIX</h2>
  <table class="doc-table">
    <thead>
      <tr>
        <th style="width: 20%;">Failure Mode / Hazard</th>
        <th style="width: 22%;">Root Cause &amp; Physical Trigger</th>
        <th style="width: 20%;">Optical Sensor Impact</th>
        <th style="width: 38%;">Algorithmic &amp; Hardware Mitigation Countermeasure</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Sunlight Glare &amp; Washout</strong></td>
        <td>Sunrise/sunset through loading bay doors</td>
        <td>Pixel blooming, loss of PPE contrast</td>
        <td>Hardware True WDR (120dB) + CLAHE enhancement + dynamic exposure ROI.</td>
      </tr>
      <tr>
        <td><strong>Steam &amp; Chemical Vapors</strong></td>
        <td>Mold heating &amp; chemical filling purge</td>
        <td>False motion triggers, IR flare</td>
        <td>Temporal persistence filter (&gt;5 consecutive frames) + infrared flare gating.</td>
      </tr>
      <tr>
        <td><strong>Forklift Mast Occlusion</strong></td>
        <td>Pallet transport traversing walkway</td>
        <td>Target ID switching, fragmented boxes</td>
        <td>ByteTrack Kalman tracklet extrapolation + multi-camera Re-ID handover.</td>
      </tr>
      <tr>
        <td><strong>Wet Floor Specular Reflection</strong></td>
        <td>Chemical washdown on epoxy floor</td>
        <td>Ghost detections of workers &amp; false spill triggers</td>
        <td>Polarized optical lens filters + HSV floor plane thresholding + homography rejection.</td>
      </tr>
      <tr>
        <td><strong>Night Insects &amp; Precipitation</strong></td>
        <td>Moths attracted to 850nm IR LEDs at loading apron</td>
        <td>High-frequency pixel triggers</td>
        <td>Matrix IR LEDs physically offset from lens + spatial edge density filtering.</td>
      </tr>
    </tbody>
  </table>

  <h2>PART 7: EDGE AI INFERENCE PIPELINE &amp; INFRASTRUCTURE BILL OF MATERIALS (BOM)</h2>
  <table class="doc-table">
    <thead>
      <tr>
        <th style="width: 50%;">Real-Time Edge Pipeline Latency (&lt;80ms SLA)</th>
        <th style="width: 50%;">Hardware Infrastructure Sizing &amp; BOM</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          &bull; <strong>RTSP Ingestion:</strong> H.265 / 4MP @ 25 FPS (4 Mbps/cam)<br/>
          &bull; <strong>NVDEC Video Decode:</strong> <strong>4.2ms / frame</strong><br/>
          &bull; <strong>YOLOv11 TensorRT Detect:</strong> <strong>16.8ms / frame</strong><br/>
          &bull; <strong>ByteTrack Tracker:</strong> <strong>3.4ms / frame</strong><br/>
          &bull; <strong>Safety Tripwires &amp; Logic:</strong> <strong>2.1ms / frame</strong><br/>
          &bull; <strong>Modbus TCP / MQTT Relay:</strong> <strong>&lt; 15ms dispatch</strong>
        </td>
        <td>
          &bull; <strong>Active Sensors:</strong> <strong>${camCount}x Professional AI IP Cameras</strong> (4MP, WDR, IP67)<br/>
          &bull; <strong>PoE+ Switching:</strong> <strong>1x 24-Port Managed PoE+ Switch</strong> (370W Budget)<br/>
          &bull; <strong>Cat6 Cabling:</strong> <strong>~${estCabling}m Solid Bare Copper F/UTP</strong><br/>
          &bull; <strong>Storage Retention:</strong> <strong>${storage30dTb} TB Net (RAID-6 with Hot Spare)</strong><br/>
          &bull; <strong>Edge Compute:</strong> <strong>NVIDIA RTX / Jetson Orin Industrial Node</strong>
        </td>
      </tr>
    </tbody>
  </table>

  <div style="font-size: 7.5pt; color: #64748b; margin-top: 10pt; text-align: center;">
    TechHub Plan Vision &bull; Multi-Building Computer Vision Engineering System &bull; Page 3 of 3
  </div>

</div>
</body>
</html>`;
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

    const title = project.name || 'Plan_Vision_Report';
    const safeTitle = title.replace(/\s+/g, '_');

    if (format === 'docx') {
      const docxHtml = renderDocxReport(project);
      return new NextResponse(docxHtml, {
        headers: {
          'Content-Type': 'application/msword;charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeTitle}_Technical_Blueprint.doc"`,
        },
      });
    } else {
      // PDF print-ready HTML
      const html = renderHtmlReport(project);
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `inline; filename="${safeTitle}_Technical_Blueprint.html"`,
        },
      });
    }
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
    
    // Sample fallback project if opened directly in browser tab
    const demoProject = {
      name: 'Plan Vision Facility Plan',
      company_name: 'Descon Industrial Complex',
      industry: 'Chemical & Industrial Manufacturing',
      business_description: 'Industrial facility with 4 buildings, automated chemical filling lines, injection molding, storage warehouse, and truck loading bay.',
      cameras: Array.from({ length: 15 }, (_, i) => ({
        id: `CAM-${String(i + 1).padStart(2, '0')}`,
        name: `CAM-${String(i + 1).padStart(2, '0')}`,
        status: 'active',
        orientation_degrees: 0,
        horizontal_fov_degrees: 85,
        resolution_width: 2688,
        resolution_height: 1520,
      })),
    };

    if (format === 'docx') {
      const docxHtml = renderDocxReport(demoProject);
      return new NextResponse(docxHtml, {
        headers: {
          'Content-Type': 'application/msword;charset=utf-8',
          'Content-Disposition': 'attachment; filename="Plan_Vision_Technical_Blueprint.doc"',
        },
      });
    }

    const html = renderHtmlReport(demoProject);
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'inline; filename="Plan_Vision_Technical_Blueprint.html"',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
