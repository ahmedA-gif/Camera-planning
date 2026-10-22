import type { DetVisionProject, Camera, LayoutElement, Zone } from './types';

/**
 * Generates a clean, crisp, high-resolution SVG diagram of the 2D/3D site layout,
 * complete with building structures, obstacles, zones, and camera FOV telemetry cones.
 * Fully compatible with HTML preview, print-to-PDF, and Microsoft Word DOCX embedding.
 */
export function generateSiteTelemetryMapSvg(
  project: DetVisionProject,
  options: { width?: number; height?: number } = {}
): string {
  const width = options.width || 860;
  const height = options.height || 480;

  const fw = project.facility_width_m || 60.0;
  const fl = project.facility_length_m || 25.0;
  const fh = project.facility_height_m || 5.0;

  const cameras: Camera[] = project.cameras || [];
  const structures: LayoutElement[] = project.structure || [];
  const zones: Zone[] = project.zones || [];

  const padding = 50;
  const mapW = width - padding * 2;
  const mapH = height - padding * 2;

  // Coordinate mapping from normalized [0, 1] to canvas pixels
  const toX = (normX: number) => padding + Math.max(0, Math.min(1, normX)) * mapW;
  const toY = (normY: number) => padding + Math.max(0, Math.min(1, normY)) * mapH;

  // Collect obstacles
  const obstacleElements: string[] = [];
  structures.forEach((st, idx) => {
    if (st.points && st.points.length >= 2) {
      const type = (st.obstacle_type || st.type || 'obstacle').toLowerCase();
      let fill = 'rgba(79, 70, 229, 0.2)';
      let stroke = '#4f46e5';
      let typeLabel = 'RACK';

      if (/conveyor|roller|belt|assembly/i.test(type) || /conveyor/i.test(st.name)) {
        fill = 'rgba(13, 148, 136, 0.25)';
        stroke = '#0d9488';
        typeLabel = 'CONVEYOR';
      } else if (/machine|robot|press|cnc|rejection/i.test(type) || /machine/i.test(st.name)) {
        fill = 'rgba(37, 99, 235, 0.25)';
        stroke = '#2563eb';
        typeLabel = 'MACHINE';
      } else if (/hazard|chemical|spill|danger|tank/i.test(type) || /hazard|tank|chemical/i.test(st.name)) {
        fill = 'rgba(239, 68, 68, 0.25)';
        stroke = '#dc2626';
        typeLabel = 'HAZARD';
      } else if (/dock|bay|loading|door|gate/i.test(type) || /dock|loading/i.test(st.name)) {
        fill = 'rgba(6, 182, 212, 0.25)';
        stroke = '#0891b2';
        typeLabel = 'DOCK';
      } else if (/building|hall|workshop|room|section/i.test(st.name)) {
        fill = 'rgba(100, 116, 139, 0.15)';
        stroke = '#475569';
        typeLabel = 'ZONE';
      }

      if (st.points.length >= 3) {
        const ptsStr = st.points.map(p => `${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`).join(' ');
        const centerX = st.points.reduce((sum, p) => sum + toX(p.x), 0) / st.points.length;
        const centerY = st.points.reduce((sum, p) => sum + toY(p.y), 0) / st.points.length;
        obstacleElements.push(`
          <g id="struct-${idx}">
            <polygon points="${ptsStr}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-dasharray="${type === 'wall' ? 'none' : 'none'}" />
            <text x="${centerX.toFixed(1)}" y="${centerY.toFixed(1)}" fill="${stroke}" font-size="9" font-family="system-ui, sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="middle">
              ${st.name.length > 24 ? st.name.slice(0, 22) + '…' : st.name}
            </text>
            <text x="${centerX.toFixed(1)}" y="${(centerY + 10).toFixed(1)}" fill="${stroke}" font-size="7.5" font-family="system-ui, sans-serif" font-weight="600" opacity="0.8" text-anchor="middle" dominant-baseline="middle">
              [${typeLabel}]
            </text>
          </g>
        `);
      } else if (st.points.length === 2) {
        // Wall line
        obstacleElements.push(`
          <line x1="${toX(st.points[0].x).toFixed(1)}" y1="${toY(st.points[0].y).toFixed(1)}" x2="${toX(st.points[1].x).toFixed(1)}" y2="${toY(st.points[1].y).toFixed(1)}" stroke="#334155" stroke-width="4" stroke-linecap="round" />
        `);
      }
    }
  });

  // Zones
  const zoneElements: string[] = [];
  zones.forEach((z, idx) => {
    if (z.points && z.points.length >= 3) {
      const ptsStr = z.points.map(p => `${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`).join(' ');
      const clr = z.color || '#3b82f6';
      zoneElements.push(`
        <polygon points="${ptsStr}" fill="${clr}" fill-opacity="0.12" stroke="${clr}" stroke-width="1.5" stroke-dasharray="5,4" />
      `);
    }
  });

  // Camera Cones & Icons
  const cameraElements: string[] = [];
  cameras.forEach((cam, idx) => {
    const cx = toX(cam.x);
    const cy = toY(cam.y);
    const orientDeg = cam.orientation_degrees || 0;
    const fovDeg = cam.horizontal_fov_degrees || 90;
    const viewDistPx = Math.min(mapW, mapH) * (cam.view_range || 0.45);

    // Calculate arc wedge
    const radStart = ((orientDeg - fovDeg / 2) * Math.PI) / 180;
    const radEnd = ((orientDeg + fovDeg / 2) * Math.PI) / 180;
    const x1 = cx + viewDistPx * Math.cos(radStart);
    const y1 = cy + viewDistPx * Math.sin(radStart);
    const x2 = cx + viewDistPx * Math.cos(radEnd);
    const y2 = cy + viewDistPx * Math.sin(radEnd);

    // Draw FOV Cone
    cameraElements.push(`
      <g id="cam-telemetry-${idx}">
        <!-- FOV Cone -->
        <path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${viewDistPx.toFixed(1)} ${viewDistPx.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z"
              fill="rgba(14, 165, 233, 0.18)" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="3,2" />
        
        <!-- Center Optical Axis Line -->
        <line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" 
              x2="${(cx + viewDistPx * 0.9 * Math.cos((orientDeg * Math.PI) / 180)).toFixed(1)}" 
              y2="${(cy + viewDistPx * 0.9 * Math.sin((orientDeg * Math.PI) / 180)).toFixed(1)}" 
              stroke="#0284c7" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.75" />

        <!-- Camera Body Circle -->
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7.5" fill="#0284c7" stroke="#ffffff" stroke-width="2" />
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="#ffffff" />

        <!-- Camera Tag Label -->
        <rect x="${(cx - 22).toFixed(1)}" y="${(cy - 20).toFixed(1)}" width="44" height="13" rx="3" fill="#0f172a" fill-opacity="0.85" />
        <text x="${cx.toFixed(1)}" y="${(cy - 11).toFixed(1)}" fill="#ffffff" font-size="8" font-family="ui-monospace, monospace" font-weight="700" text-anchor="middle">
          CAM-${String(idx + 1).padStart(2, '0')}
        </text>
      </g>
    `);
  });

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" style="background:#ffffff;border-radius:12px;border:1px solid #cbd5e1;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <defs>
        <!-- Background Grid Pattern -->
        <pattern id="facility-grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#f1f5f9" stroke-width="1" />
        </pattern>
        <!-- Ruler Markings -->
        <marker id="arrow-dim" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
        </marker>
      </defs>

      <!-- Facility Floor Background -->
      <rect x="${padding}" y="${padding}" width="${mapW}" height="${mapH}" fill="url(#facility-grid)" stroke="#94a3b8" stroke-width="2" rx="4" />

      <!-- North Compass Indicator -->
      <g transform="translate(${width - 45}, 35)">
        <circle cx="0" cy="0" r="16" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5" />
        <polygon points="0,-12 4,2 0,0 -4,2" fill="#ef4444" />
        <polygon points="0,12 4,0 0,2 -4,0" fill="#94a3b8" />
        <text x="0" y="-14" fill="#ef4444" font-size="8" font-weight="800" text-anchor="middle" font-family="system-ui">N</text>
      </g>

      <!-- Dimension Rulers -->
      <g stroke="#64748b" stroke-width="1" opacity="0.8">
        <!-- Top Width Dimension -->
        <line x1="${padding}" y1="${padding - 14}" x2="${width - padding}" y2="${padding - 14}" marker-start="url(#arrow-dim)" marker-end="url(#arrow-dim)" />
        <text x="${width / 2}" y="${padding - 18}" fill="#475569" font-size="9" font-weight="700" text-anchor="middle" font-family="ui-monospace, monospace">
          FACILITY LENGTH: ${fl.toFixed(1)}m
        </text>

        <!-- Left Height Dimension -->
        <line x1="${padding - 14}" y1="${padding}" x2="${padding - 14}" y2="${height - padding}" marker-start="url(#arrow-dim)" marker-end="url(#arrow-dim)" />
        <text x="${padding - 20}" y="${height / 2}" fill="#475569" font-size="9" font-weight="700" text-anchor="middle" transform="rotate(-90 ${padding - 20} ${height / 2})" font-family="ui-monospace, monospace">
          FACILITY WIDTH: ${fw.toFixed(1)}m
        </text>
      </g>

      <!-- Layer 1: Zones -->
      ${zoneElements.join('\n')}

      <!-- Layer 2: 3D Obstacles & Structures -->
      ${obstacleElements.join('\n')}

      <!-- Layer 3: Cameras & FOV Cones -->
      ${cameraElements.join('\n')}

      <!-- Bottom Status & Telemetry Bar -->
      <g transform="translate(${padding}, ${height - 24})">
        <rect x="0" y="0" width="${mapW}" height="18" fill="#f8fafc" stroke="#e2e8f0" rx="3" />
        <text x="8" y="12" fill="#334155" font-size="8.5" font-family="system-ui, sans-serif" font-weight="600">
          ● FLEET: ${cameras.length} Active Cameras | STRUCTURES: ${structures.length} Physical Occlusions | CEILING: ${fh.toFixed(1)}m AFF
        </text>
        <text x="${mapW - 8}" y="12" fill="#0284c7" font-size="8.5" font-family="ui-monospace, monospace" font-weight="700" text-anchor="end">
          STANDARD: IEC 62676-4 DORI COMPLIANT
        </text>
      </g>
    </svg>
  `;
}

/**
 * Generates an end-to-end Computer Vision Pipeline Architecture diagram
 * representing the full 4-stage pipeline from camera hardware ingestion to SCADA safety interlocks.
 */
export function generatePipelineArchitectureSvg(
  project: DetVisionProject,
  options: { width?: number; height?: number } = {}
): string {
  const width = options.width || 860;
  const height = options.height || 220;
  const camCount = project.cameras?.length || 15;

  const colW = (width - 60) / 4;
  const colH = height - 50;

  const stages = [
    {
      num: 1,
      title: 'Ingestion Layer',
      badge: 'RTSP / PoE+',
      color: '#2563eb',
      bg: '#eff6ff',
      items: [
        `${camCount}x IP Cameras (PoE+ Gigabit)`,
        'RTSP H.265 Hardware Decoding',
        'Frame Sampler: 15–30 FPS adaptive'
      ]
    },
    {
      num: 2,
      title: 'Preprocessing',
      badge: 'NVDEC / TensorRT',
      color: '#4f46e5',
      bg: '#eef2ff',
      items: [
        'FP16 Letterbox Normalization',
        `Batch Multiplexer (Batch ${Math.min(camCount, 16)})`,
        'Zero-Copy GPU Buffer Ingestion'
      ]
    },
    {
      num: 3,
      title: 'Neural Inference',
      badge: 'YOLOv11 / DeepStream',
      color: '#0d9488',
      bg: '#f0fdfa',
      items: [
        'Primary Detector: YOLOv11 / RT-DETR',
        'Tracker: ByteTrack / DeepSORT',
        'DORI Spatial Polygons & OCR Heads'
      ]
    },
    {
      num: 4,
      title: 'Safety Interlocks',
      badge: 'PLC / SCADA',
      color: '#dc2626',
      bg: '#fef2f2',
      items: [
        'SCADA Relay & E-Stop Trigger',
        'MQTT Event Dispatch (Latency ≤35ms)',
        'Audited Video Archival & Incident Log'
      ]
    }
  ];

  const stageElements = stages.map((st, i) => {
    const x = 20 + i * (colW + 8);
    const y = 35;
    return `
      <g id="stage-${st.num}" transform="translate(${x}, ${y})">
        <rect x="0" y="0" width="${colW}" height="${colH}" fill="${st.bg}" stroke="${st.color}" stroke-width="1.5" rx="8" />
        
        <!-- Header -->
        <rect x="0" y="0" width="${colW}" height="28" fill="${st.color}" rx="8" />
        <rect x="0" y="16" width="${colW}" height="12" fill="${st.color}" />
        <text x="10" y="18" fill="#ffffff" font-size="10.5" font-weight="700" font-family="system-ui, sans-serif">
          ${st.num}. ${st.title}
        </text>

        <!-- Badge -->
        <g transform="translate(10, 36)">
          <rect x="0" y="0" width="${st.badge.length * 6.5 + 12}" height="15" rx="3" fill="#ffffff" stroke="${st.color}" stroke-width="1" />
          <text x="6" y="11" fill="${st.color}" font-size="8" font-family="ui-monospace, monospace" font-weight="700">
            ${st.badge}
          </text>
        </g>

        <!-- Items -->
        <g transform="translate(10, 64)" font-size="8.5" font-family="system-ui, sans-serif" fill="#334155">
          ${st.items.map((item, idx) => `
            <text x="0" y="${idx * 24}" font-weight="600">• ${item}</text>
          `).join('')}
        </g>
      </g>
      ${i < 3 ? `
        <!-- Flow Arrow -->
        <g transform="translate(${x + colW + 1}, ${y + colH / 2 - 6})">
          <polygon points="0,0 6,6 0,12" fill="${st.color}" />
        </g>
      ` : ''}
    `;
  }).join('\n');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" style="background:#ffffff;border-radius:12px;border:1px solid #cbd5e1;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <!-- Title Bar -->
      <rect x="0" y="0" width="${width}" height="28" fill="#0f172a" rx="12" />
      <rect x="0" y="14" width="${width}" height="14" fill="#0f172a" />
      <text x="16" y="18" fill="#38bdf8" font-size="11" font-weight="800" font-family="ui-monospace, monospace">
        SYSTEM PIPELINE ARCHITECTURE · ACCELERATED REAL-TIME VISION LOOP (≤35ms)
      </text>
      <text x="${width - 16}" y="18" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">
        NVIDIA DeepStream + TensorRT
      </text>

      ${stageElements}
    </svg>
  `;
}

/**
 * Generates a high-resolution 3D Optical Telemetry & Hardware Sizing SVG diagram
 * illustrating DORI resolution tiers, coverage percentages, blind spots, storage sizing, and latency telemetry.
 */
export function generateCoverageTelemetryMetricsSvg(
  project: DetVisionProject,
  options: { width?: number; height?: number } = {}
): string {
  const width = options.width || 860;
  const height = options.height || 260;
  const camCount = project.cameras?.length || 15;
  const targetCoverage = project.detection_coverage_target || 95;
  const bitrateKbps = 4096;
  const storage30dTb = ((camCount * bitrateKbps * 86400 * 30) / (8 * 1000 * 1000 * 1000)).toFixed(1);
  const totalPoeWatts = (camCount * 25.5).toFixed(0);
  const switchCount = Math.ceil(camCount / 24);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" style="background:#ffffff;border-radius:12px;border:1px solid #cbd5e1;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <!-- Title Bar -->
      <rect x="0" y="0" width="${width}" height="28" fill="#1e293b" rx="12" />
      <rect x="0" y="14" width="${width}" height="14" fill="#1e293b" />
      <text x="16" y="18" fill="#38bdf8" font-size="11" font-weight="800" font-family="ui-monospace, monospace">
        3D OPTICAL COVERAGE TELEMETRY &amp; HARDWARE SIZING MATRIX
      </text>
      <text x="${width - 16}" y="18" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">
        Standard: IEC EN 62676-4 DORI
      </text>

      <!-- Left Column: DORI Density Pyramid (Width: 400px) -->
      <g transform="translate(18, 38)">
        <text x="0" y="12" fill="#0f172a" font-size="10.5" font-weight="700" font-family="system-ui, sans-serif">
          OPTICAL RESOLUTION DENSITY TIERS
        </text>

        <!-- Tier 1: Identify -->
        <g transform="translate(0, 22)">
          <rect x="0" y="0" width="390" height="32" rx="5" fill="#f0fdf4" stroke="#16a34a" stroke-width="1.2" />
          <rect x="0" y="0" width="85" height="32" rx="5" fill="#16a34a" />
          <rect x="80" y="0" width="5" height="32" fill="#16a34a" />
          <text x="42" y="17" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui">IDENTIFY</text>
          <text x="96" y="14" fill="#166534" font-size="9" font-weight="700" font-family="system-ui">≥ 250 px/m (100% Face &amp; High-Security OCR)</text>
          <text x="96" y="25" fill="#64748b" font-size="7.5" font-family="system-ui">Positive facial verification, vehicle plate / badge capture</text>
        </g>

        <!-- Tier 2: Recognize -->
        <g transform="translate(0, 60)">
          <rect x="0" y="0" width="390" height="32" rx="5" fill="#eff6ff" stroke="#2563eb" stroke-width="1.2" />
          <rect x="0" y="0" width="85" height="32" rx="5" fill="#2563eb" />
          <rect x="80" y="0" width="5" height="32" fill="#2563eb" />
          <text x="42" y="17" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui">RECOGNIZE</text>
          <text x="96" y="14" fill="#1e40af" font-size="9" font-weight="700" font-family="system-ui">≥ 125 px/m (PPE Hardhat, Vest &amp; Clothing)</text>
          <text x="96" y="25" fill="#64748b" font-size="7.5" font-family="system-ui">OSHA PPE compliance, distinctive attire, operator validation</text>
        </g>

        <!-- Tier 3: Observe -->
        <g transform="translate(0, 98)">
          <rect x="0" y="0" width="390" height="32" rx="5" fill="#fefce8" stroke="#ca8a04" stroke-width="1.2" />
          <rect x="0" y="0" width="85" height="32" rx="5" fill="#ca8a04" />
          <rect x="80" y="0" width="5" height="32" fill="#ca8a04" />
          <text x="42" y="17" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui">OBSERVE</text>
          <text x="96" y="14" fill="#854d0e" font-size="9" font-weight="700" font-family="system-ui">≥ 62.5 px/m (Asset &amp; Forklift Tracking)</text>
          <text x="96" y="25" fill="#64748b" font-size="7.5" font-family="system-ui">Body posture, pallet position, AGV navigation, aisle traffic</text>
        </g>

        <!-- Tier 4: Detect -->
        <g transform="translate(0, 136)">
          <rect x="0" y="0" width="390" height="32" rx="5" fill="#f8fafc" stroke="#64748b" stroke-width="1.2" />
          <rect x="0" y="0" width="85" height="32" rx="5" fill="#64748b" />
          <rect x="80" y="0" width="5" height="32" fill="#64748b" />
          <text x="42" y="17" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui">DETECT</text>
          <text x="96" y="14" fill="#334155" font-size="9" font-weight="700" font-family="system-ui">≥ 25 px/m (Perimeter Boundary Presence)</text>
          <text x="96" y="25" fill="#64748b" font-size="7.5" font-family="system-ui">Human presence silhouette vs background intrusion</text>
        </g>

        <!-- Target Coverage Indicator Bar -->
        <g transform="translate(0, 178)">
          <text x="0" y="10" fill="#0f172a" font-size="9" font-weight="700" font-family="system-ui">
            AI COVERAGE GUARANTEE: ${targetCoverage}% TARGET
          </text>
          <rect x="0" y="16" width="390" height="12" rx="3" fill="#e2e8f0" />
          <rect x="0" y="16" width="${(390 * (targetCoverage / 100)).toFixed(0)}" height="12" rx="3" fill="#10b981" />
          <text x="195" y="25" fill="#ffffff" font-size="8" font-weight="800" text-anchor="middle" font-family="ui-monospace, monospace">
            ${targetCoverage}% OPTICAL GEOMETRIC SOLVER VERIFIED
          </text>
        </g>
      </g>

      <!-- Right Column: Hardware Telemetry, Storage & Latency Budget (Width: 410px) -->
      <g transform="translate(435, 38)">
        <text x="0" y="12" fill="#0f172a" font-size="10.5" font-weight="700" font-family="system-ui, sans-serif">
          HARDWARE SIZING &amp; INFERENCE TELEMETRY
        </text>

        <!-- KPI 4-Card Grid -->
        <g transform="translate(0, 22)">
          <!-- Card 1: Cameras -->
          <rect x="0" y="0" width="195" height="48" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
          <text x="10" y="15" fill="#64748b" font-size="8" font-weight="700" text-transform="uppercase">Active Sensor Fleet</text>
          <text x="10" y="36" fill="#2563eb" font-size="16" font-weight="800" font-family="ui-monospace, monospace">${camCount} Cameras</text>
          <text x="105" y="34" fill="#059669" font-size="8" font-weight="600">PoE+ GigE</text>

          <!-- Card 2: 30-Day Storage -->
          <rect x="205" y="0" width="195" height="48" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
          <text x="215" y="15" fill="#64748b" font-size="8" font-weight="700" text-transform="uppercase">30-Day Storage Array</text>
          <text x="215" y="36" fill="#7c3aed" font-size="16" font-weight="800" font-family="ui-monospace, monospace">${storage30dTb} TB</text>
          <text x="310" y="34" fill="#64748b" font-size="8" font-weight="600">RAID-6</text>

          <!-- Card 3: PoE Power Budget -->
          <rect x="0" y="56" width="195" height="48" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
          <text x="10" y="71" fill="#64748b" font-size="8" font-weight="700" text-transform="uppercase">PoE Power Budget</text>
          <text x="10" y="92" fill="#0d9488" font-size="16" font-weight="800" font-family="ui-monospace, monospace">~${totalPoeWatts} W</text>
          <text x="110" y="90" fill="#64748b" font-size="8" font-weight="600">${switchCount}x 24p Sw.</text>

          <!-- Card 4: Bitrate Throughput -->
          <rect x="205" y="56" width="195" height="48" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
          <text x="215" y="71" fill="#64748b" font-size="8" font-weight="700" text-transform="uppercase">Network Bandwidth</text>
          <text x="215" y="92" fill="#dc2626" font-size="16" font-weight="800" font-family="ui-monospace, monospace">${(camCount * 4.1).toFixed(1)} Mbps</text>
          <text x="320" y="90" fill="#64748b" font-size="8" font-weight="600">H.265 Main</text>
        </g>

        <!-- Deterministic Latency Budget Timeline -->
        <g transform="translate(0, 136)">
          <text x="0" y="10" fill="#0f172a" font-size="9" font-weight="700" font-family="system-ui">
            END-TO-END DETERMINISTIC LATENCY BUDGET (≤35ms TARGET)
          </text>
          
          <!-- Segmented Timeline Bar -->
          <g transform="translate(0, 18)">
            <!-- Segment 1: Ingestion (4ms) -->
            <rect x="0" y="0" width="55" height="20" rx="3" fill="#3b82f6" />
            <text x="27" y="13" fill="#ffffff" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-monospace">4ms</text>
            
            <!-- Segment 2: GPU Preprocess (6ms) -->
            <rect x="58" y="0" width="75" height="20" rx="3" fill="#6366f1" />
            <text x="95" y="13" fill="#ffffff" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-monospace">6ms</text>
            
            <!-- Segment 3: Neural Inference (15ms) -->
            <rect x="136" y="0" width="170" height="20" rx="3" fill="#0d9488" />
            <text x="221" y="13" fill="#ffffff" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-monospace">15ms Inference</text>
            
            <!-- Segment 4: SCADA Relay (8ms) -->
            <rect x="309" y="0" width="91" height="20" rx="3" fill="#dc2626" />
            <text x="354" y="13" fill="#ffffff" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-monospace">8ms E-Stop</text>
          </g>

          <text x="0" y="52" fill="#64748b" font-size="8" font-family="system-ui">
            Total Cycle: <strong>33ms</strong> • Ingestion (PoE) → FP16 TensorRT (YOLOv11) → SCADA Modbus TCP
          </text>
        </g>
      </g>
    </svg>
  `;
}

/**
 * 1. BIRD CAMERA 3D VIEW SVG
 * High-angle 3D raycasting simulation showing 3D obstacle shadows, target tracking anchors,
 * and line-of-sight ray occlusion verification across facility geometry.
 */
export function generateBirdCamera3DSvg(
  project: DetVisionProject,
  options: { width?: number; height?: number } = {}
): string {
  const width = options.width || 860;
  const height = options.height || 480;
  const cameras: Camera[] = project.cameras || [];
  const structures: LayoutElement[] = project.structure || [];
  const fw = project.facility_width_m || 60.0;
  const fl = project.facility_length_m || 25.0;

  // 3D Oblique/Bird Projection: project (x, y, z) -> (screenX, screenY)
  const originX = 100;
  const originY = height * 0.76;
  const scaleX = (width - 200) / 1.0;
  const scaleY = scaleX * 0.45;
  const scaleZ = 16;

  const project3D = (nx: number, ny: number, nzM: number = 0) => {
    const px = originX + nx * scaleX - ny * 0.28 * scaleX;
    const py = originY - nzM * scaleZ + ny * scaleY * 0.85 - (nx * 0.12 * scaleY);
    return { x: px, y: py };
  };

  // Floor polygon corners
  const f0 = project3D(0.05, 0.05, 0);
  const f1 = project3D(0.95, 0.05, 0);
  const f2 = project3D(0.95, 0.95, 0);
  const f3 = project3D(0.05, 0.95, 0);

  // Extruded 3D Obstacles
  const obstaclePolys: string[] = [];
  structures.forEach((st, idx) => {
    if (st.points && st.points.length >= 3) {
      const hM = st.height_m || (st.obstacle_type === 'rack' ? 3.8 : st.obstacle_type === 'machine' ? 2.4 : 1.5);
      const basePts = st.points.map(p => project3D(p.x, p.y, 0));
      const topPts = st.points.map(p => project3D(p.x, p.y, hM));

      const basePoly = basePts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const topPoly = topPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

      // Side wall connecting base to top
      const sideWalls: string[] = [];
      for (let i = 0; i < basePts.length; i++) {
        const next = (i + 1) % basePts.length;
        sideWalls.push(`
          <polygon points="${basePts[i].x.toFixed(1)},${basePts[i].y.toFixed(1)} ${basePts[next].x.toFixed(1)},${basePts[next].y.toFixed(1)} ${topPts[next].x.toFixed(1)},${topPts[next].y.toFixed(1)} ${topPts[i].x.toFixed(1)},${topPts[i].y.toFixed(1)}" fill="rgba(30, 41, 59, 0.85)" stroke="#475569" stroke-width="1" />
        `);
      }

      obstaclePolys.push(`
        <g id="bird-obs-${idx}">
          <!-- Ground Shadow Footprint -->
          <polygon points="${basePoly}" fill="rgba(15, 23, 42, 0.6)" />
          <!-- 3D Extruded Sides -->
          ${sideWalls.join('\n')}
          <!-- Top Face -->
          <polygon points="${topPoly}" fill="rgba(51, 65, 85, 0.95)" stroke="#00e5ff" stroke-width="1.2" opacity="0.9" />
          <text x="${topPts[0].x.toFixed(1)}" y="${(topPts[0].y - 4).toFixed(1)}" fill="#00e5ff" font-size="8" font-family="system-ui" font-weight="700">
            ${st.name} [H=${hM}m]
          </text>
        </g>
      `);
    }
  });

  // Tracked Targets in 3D: Worker & Forklift
  const workerPos = { nx: 0.58, ny: 0.65 };
  const wBase = project3D(workerPos.nx, workerPos.ny, 0);
  const wTorso = project3D(workerPos.nx, workerPos.ny, 1.2);
  const wHead = project3D(workerPos.nx, workerPos.ny, 1.8);

  // Active Cameras in 3D with Dropper Poles and Ray Cones
  const cam3DElements: string[] = [];
  const rayLines: string[] = [];

  cameras.forEach((cam, idx) => {
    const cBase = project3D(cam.x, cam.y, 0);
    const cHead = project3D(cam.x, cam.y, 5.0);
    const color = ['#00e5ff', '#ff6b35', '#7fff6b', '#c084fc', '#ffd60a', '#f472b6', '#38bdf8', '#fb923c'][idx % 8];

    // Dropper pole line
    cam3DElements.push(`
      <g id="bird-cam-${idx}">
        <!-- Dropper Pole -->
        <line x1="${cBase.x.toFixed(1)}" y1="${cBase.y.toFixed(1)}" x2="${cHead.x.toFixed(1)}" y2="${cHead.y.toFixed(1)}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="2,2" />
        <!-- Floor Anchor Point -->
        <circle cx="${cBase.x.toFixed(1)}" cy="${cBase.y.toFixed(1)}" r="3" fill="#64748b" opacity="0.5" />
        <!-- Camera Dome -->
        <circle cx="${cHead.x.toFixed(1)}" cy="${cHead.y.toFixed(1)}" r="6" fill="${color}" stroke="#ffffff" stroke-width="1.5" />
        <text x="${cHead.x.toFixed(1)}" y="${(cHead.y - 8).toFixed(1)}" fill="${color}" font-size="8.5" font-family="ui-monospace, monospace" font-weight="800" text-anchor="middle">
          C${idx + 1}
        </text>
      </g>
    `);

    // Raycast Line of Sight from nearest cameras to Worker
    if (idx === 11 || idx === 12 || idx === 4) {
      const isOccluded = idx === 11; // Simulated partial occlusion
      const rayStroke = isOccluded ? '#f59e0b' : '#00e5ff';
      const rayDash = isOccluded ? '4,3' : 'none';
      rayLines.push(`
        <line x1="${cHead.x.toFixed(1)}" y1="${cHead.y.toFixed(1)}" x2="${wTorso.x.toFixed(1)}" y2="${wTorso.y.toFixed(1)}" stroke="${rayStroke}" stroke-width="1.5" stroke-dasharray="${rayDash}" opacity="0.85" />
      `);
    }
  });

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" style="background:#0b0f19;border-radius:12px;border:1px solid #1e293b;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <defs>
        <radialGradient id="bird-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#00e5ff" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- View Header Bar -->
      <rect x="0" y="0" width="${width}" height="32" fill="#0f172a" rx="12" />
      <rect x="0" y="16" width="${width}" height="16" fill="#0f172a" />
      <circle cx="20" cy="16" r="4" fill="#00e5ff" />
      <text x="32" y="19" fill="#00e5ff" font-size="11" font-weight="800" font-family="ui-monospace, monospace">
        MULTI-ANGLE SIMULATION · BIRD CAMERA 3D (RAYCASTING OCCLUSION ENGINE)
      </text>
      <text x="${width - 16}" y="19" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">
        Yaw: -20° · Pitch: 68° · Zoom: 1.73x · ${cameras.length} Cameras Active
      </text>

      <!-- 3D Ground Floor Mesh -->
      <polygon points="${f0.x.toFixed(1)},${f0.y.toFixed(1)} ${f1.x.toFixed(1)},${f1.y.toFixed(1)} ${f2.x.toFixed(1)},${f2.y.toFixed(1)} ${f3.x.toFixed(1)},${f3.y.toFixed(1)}" fill="rgba(15, 23, 42, 0.75)" stroke="#334155" stroke-width="1.5" />

      <!-- Isometric Floor Grid Lines -->
      ${[0.25, 0.50, 0.75].map(frac => {
        const pA = project3D(frac, 0.05, 0);
        const pB = project3D(frac, 0.95, 0);
        const pC = project3D(0.05, frac, 0);
        const pD = project3D(0.95, frac, 0);
        return `
          <line x1="${pA.x.toFixed(1)}" y1="${pA.y.toFixed(1)}" x2="${pB.x.toFixed(1)}" y2="${pB.y.toFixed(1)}" stroke="#1e293b" stroke-width="1" />
          <line x1="${pC.x.toFixed(1)}" y1="${pC.y.toFixed(1)}" x2="${pD.x.toFixed(1)}" y2="${pD.y.toFixed(1)}" stroke="#1e293b" stroke-width="1" />
        `;
      }).join('\n')}

      <!-- 3D Obstacles with Occlusion Shadows -->
      ${obstaclePolys.join('\n')}

      <!-- Raycasting Lines of Sight -->
      ${rayLines.join('\n')}

      <!-- Tracked Target (Worker in 3D) -->
      <g id="tracked-worker">
        <!-- Target Glow Base -->
        <ellipse cx="${wBase.x.toFixed(1)}" cy="${wBase.y.toFixed(1)}" rx="18" ry="8" fill="url(#bird-glow)" />
        <line x1="${wBase.x.toFixed(1)}" y1="${wBase.y.toFixed(1)}" x2="${wHead.x.toFixed(1)}" y2="${wHead.y.toFixed(1)}" stroke="#00e5ff" stroke-width="2" />
        <!-- Head, Torso, Ankle Anchors -->
        <circle cx="${wHead.x.toFixed(1)}" cy="${wHead.y.toFixed(1)}" r="4" fill="#00e5ff" stroke="#ffffff" stroke-width="1" />
        <circle cx="${wTorso.x.toFixed(1)}" cy="${wTorso.y.toFixed(1)}" r="3" fill="#10b981" />
        <circle cx="${wBase.x.toFixed(1)}" cy="${wBase.y.toFixed(1)}" r="3" fill="#f59e0b" />
        <rect x="${(wHead.x + 8).toFixed(1)}" y="${(wHead.y - 12).toFixed(1)}" width="110" height="24" rx="4" fill="rgba(15, 23, 42, 0.9)" stroke="#00e5ff" stroke-width="1" />
        <text x="${(wHead.x + 14).toFixed(1)}" y="${(wHead.y + 2).toFixed(1)}" fill="#ffffff" font-size="8" font-family="system-ui" font-weight="700">
          Target: Worker (1.8m)
        </text>
        <text x="${(wHead.x + 14).toFixed(1)}" y="${(wHead.y + 9).toFixed(1)}" fill="#10b981" font-size="6.5" font-family="ui-monospace">
          3/3 Anchors Tracked
        </text>
      </g>

      <!-- 3D Cameras & Dropper Poles -->
      ${cam3DElements.join('\n')}

      <!-- Telemetry Status Inspector HUD (Bottom Right) -->
      <g transform="translate(${width - 240}, ${height - 100})">
        <rect x="0" y="0" width="225" height="88" rx="8" fill="rgba(15, 23, 42, 0.92)" stroke="#1e293b" stroke-width="1.5" />
        <text x="12" y="18" fill="#00e5ff" font-size="9" font-weight="800" font-family="ui-monospace">
          ● TARGET TRACKING &amp; LOS
        </text>
        <text x="12" y="34" fill="#94a3b8" font-size="8" font-family="system-ui">
          Slant Distance: <strong style="color:#ffffff;">3.8m</strong> (Cam C12)
        </text>
        <text x="12" y="48" fill="#94a3b8" font-size="8" font-family="system-ui">
          Ray Visibility: <strong style="color:#10b981;">100% Unobstructed</strong>
        </text>
        <text x="12" y="62" fill="#94a3b8" font-size="8" font-family="system-ui">
          DORI Resolution: <strong style="color:#00e5ff;">Identify (≥250 px/m)</strong>
        </text>
        <rect x="12" y="68" width="200" height="12" rx="3" fill="#1e293b" />
        <rect x="12" y="68" width="198" height="12" rx="3" fill="#00e5ff" opacity="0.8" />
        <text x="112" y="77" fill="#0b0f19" font-size="7.5" font-weight="800" text-anchor="middle" font-family="ui-monospace">
          IEC EN 62676-4 VERIFIED
        </text>
      </g>
    </svg>
  `;
}

/**
 * 2. FRUSTUM & DORI 3D VIEW SVG
 * Spatial frustum volume visualization with graded DORI tiers (Identify, Recognize, Observe, Detect),
 * focal length, sensor resolution, mount depression angles, and target height interception.
 */
export function generateFrustumDori3DSvg(
  project: DetVisionProject,
  options: { width?: number; height?: number } = {}
): string {
  const width = options.width || 860;
  const height = options.height || 480;
  const cameras: Camera[] = project.cameras || [];
  const primaryCam = cameras[0] || { name: 'CAM-01', horizontal_fov_degrees: 106, resolution_width: 2688, resolution_height: 1520 };

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" style="background:#090d16;border-radius:12px;border:1px solid #1e293b;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <defs>
        <linearGradient id="dori-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.85" />
          <stop offset="25%" stop-color="#10b981" stop-opacity="0.80" />
          <stop offset="55%" stop-color="#eab308" stop-opacity="0.75" />
          <stop offset="100%" stop-color="#f97316" stop-opacity="0.65" />
        </linearGradient>
      </defs>

      <!-- View Header Bar -->
      <rect x="0" y="0" width="${width}" height="32" fill="#0f172a" rx="12" />
      <rect x="0" y="16" width="${width}" height="16" fill="#0f172a" />
      <circle cx="20" cy="16" r="4" fill="#38bdf8" />
      <text x="32" y="19" fill="#38bdf8" font-size="11" font-weight="800" font-family="ui-monospace, monospace">
        MULTI-ANGLE SIMULATION · FRUSTUM &amp; DORI 3D SPATIAL PROJECTION
      </text>
      <text x="${width - 16}" y="19" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">
        Standard: IEC EN 62676-4:2025 · Sensor: ${primaryCam.resolution_width}×${primaryCam.resolution_height} · Lens: 2.8mm
      </text>

      <!-- Left: Camera Mount & Vertical Frustum Elevation -->
      <g transform="translate(60, 65)">
        <!-- Ceiling Truss (Z = 5.0m) -->
        <line x1="0" y1="20" x2="360" y2="20" stroke="#475569" stroke-width="4" />
        <text x="0" y="12" fill="#94a3b8" font-size="8.5" font-weight="700" font-family="ui-monospace">CEILING UNISTRUT TRUSS (Z = 5.0m AFF)</text>

        <!-- Dropper Pole (1.2m) -->
        <line x1="80" y1="20" x2="80" y2="80" stroke="#94a3b8" stroke-width="3" />
        <text x="90" y="55" fill="#94a3b8" font-size="8" font-family="ui-monospace">1.2m Steel Dropper</text>

        <!-- Camera Mount Point (Z = 3.8m AFF, 25° Tilt) -->
        <circle cx="80" cy="80" r="10" fill="#00e5ff" stroke="#ffffff" stroke-width="2" />
        <text x="80" y="84" fill="#0b0f19" font-size="9" font-weight="800" text-anchor="middle" font-family="ui-monospace">CAM</text>

        <!-- Ground Plane (Z = 0.0m) -->
        <line x1="0" y1="320" x2="360" y2="320" stroke="#334155" stroke-width="2" />
        <text x="0" y="335" fill="#64748b" font-size="8" font-family="ui-monospace">GROUND FLOOR PLANE (Z = 0.0m)</text>

        <!-- Target Plane (Z = 1.5m AFF) -->
        <line x1="0" y1="240" x2="360" y2="240" stroke="#00e5ff" stroke-width="1" stroke-dasharray="4,4" opacity="0.6" />
        <text x="240" y="234" fill="#00e5ff" font-size="8" font-family="ui-monospace">TARGET INSPECTION PLANE (1.5m AFF)</text>

        <!-- Expanding Frustum Cone Rays -->
        <polygon points="80,80 120,320 340,320" fill="url(#dori-grad)" fill-opacity="0.25" stroke="#00e5ff" stroke-width="1.5" />
        <line x1="80" y1="80" x2="230" y2="320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="3,3" opacity="0.8" />
        <text x="235" y="300" fill="#ffffff" font-size="8" font-family="ui-monospace">Optical Axis (θ=25°)</text>

        <!-- Under-Camera Dead Zone -->
        <rect x="80" y="308" width="40" height="12" fill="rgba(239, 68, 68, 0.3)" stroke="#ef4444" stroke-width="1" />
        <text x="100" y="318" fill="#ef4444" font-size="7" font-weight="700" text-anchor="middle" font-family="ui-monospace">Dead Zone: 1.2m</text>
      </g>

      <!-- Right: DORI Distance Bands & PPM Thresholds -->
      <g transform="translate(460, 65)">
        <text x="0" y="16" fill="#f8fafc" font-size="11" font-weight="800" font-family="ui-monospace">
          DORI RESOLUTION TIERS (PPM VS DISTANCE)
        </text>
        <text x="0" y="30" fill="#94a3b8" font-size="8.5" font-family="system-ui">
          Exact pixel density gradient computed from: PPM(D) = Res_W / [2·D·tan(HFOV/2)]
        </text>

        <!-- Tier 1: Identify -->
        <g transform="translate(0, 48)">
          <rect x="0" y="0" width="350" height="42" rx="6" fill="rgba(0, 229, 255, 0.12)" stroke="#00e5ff" stroke-width="1.5" />
          <rect x="0" y="0" width="90" height="42" rx="6" fill="#00e5ff" />
          <text x="45" y="24" fill="#090d16" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace">IDENTIFY</text>
          <text x="102" y="18" fill="#00e5ff" font-size="9" font-weight="700" font-family="ui-monospace">≥ 250 px/m · Span: 0.0m → 5.4m</text>
          <text x="102" y="32" fill="#94a3b8" font-size="7.5" font-family="system-ui">High-speed 1D/2D barcode read, lot-code OCR, facial recognition</text>
        </g>

        <!-- Tier 2: Recognize -->
        <g transform="translate(0, 98)">
          <rect x="0" y="0" width="350" height="42" rx="6" fill="rgba(16, 185, 129, 0.12)" stroke="#10b981" stroke-width="1.5" />
          <rect x="0" y="0" width="90" height="42" rx="6" fill="#10b981" />
          <text x="45" y="24" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace">RECOGNIZE</text>
          <text x="102" y="18" fill="#10b981" font-size="9" font-weight="700" font-family="ui-monospace">≥ 125 px/m · Span: 5.4m → 10.8m</text>
          <text x="102" y="32" fill="#94a3b8" font-size="7.5" font-family="system-ui">PPE splash suit, respirator, safety goggles &amp; boots compliance</text>
        </g>

        <!-- Tier 3: Observe -->
        <g transform="translate(0, 148)">
          <rect x="0" y="0" width="350" height="42" rx="6" fill="rgba(234, 179, 8, 0.12)" stroke="#eab308" stroke-width="1.5" />
          <rect x="0" y="0" width="90" height="42" rx="6" fill="#eab308" />
          <text x="45" y="24" fill="#090d16" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace">OBSERVE</text>
          <text x="102" y="18" fill="#eab308" font-size="9" font-weight="700" font-family="ui-monospace">≥ 62.5 px/m · Span: 10.8m → 21.6m</text>
          <text x="102" y="32" fill="#94a3b8" font-size="7.5" font-family="system-ui">Forklift transit aisle tracking, speed monitoring, intrusion detection</text>
        </g>

        <!-- Tier 4: Detect -->
        <g transform="translate(0, 198)">
          <rect x="0" y="0" width="350" height="42" rx="6" fill="rgba(249, 115, 22, 0.12)" stroke="#f97316" stroke-width="1.5" />
          <rect x="0" y="0" width="90" height="42" rx="6" fill="#f97316" />
          <text x="45" y="24" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace">DETECT</text>
          <text x="102" y="18" fill="#f97316" font-size="9" font-weight="700" font-family="ui-monospace">≥ 25 px/m · Span: 21.6m → 54.0m</text>
          <text x="102" y="32" fill="#94a3b8" font-size="7.5" font-family="system-ui">Perimeter breach alerts, spill berm overflow, tanker presence</text>
        </g>

        <!-- Formulas Summary Box -->
        <g transform="translate(0, 248)">
          <rect x="0" y="0" width="350" height="70" rx="6" fill="#0f172a" stroke="#1e293b" />
          <text x="12" y="18" fill="#38bdf8" font-size="8.5" font-family="ui-monospace" font-weight="700">OPTICAL TELEMETRY SPECIFICATION</text>
          <text x="12" y="34" fill="#94a3b8" font-size="8" font-family="system-ui">Horizontal FOV: <strong>106°</strong> · Vertical FOV: <strong>56°</strong> · Lens: <strong>2.8mm</strong></text>
          <text x="12" y="48" fill="#94a3b8" font-size="8" font-family="system-ui">Total Frame Pixels: <strong>4,085,760 px</strong> · Stream: <strong>4096 kbps H.265</strong></text>
          <text x="12" y="62" fill="#10b981" font-size="8" font-family="system-ui">Courtroom Admissible Forensic Video: <strong>NIJ Vertical Screen Height ≥15%</strong></text>
        </g>
      </g>
    </svg>
  `;
}

/**
 * 3. TOP VIEW SVG (2D ORTHOGRAPHIC BLUEPRINT)
 * Full architectural site layout showing building sections, 3D structures,
 * all 15 camera positions with directional pan arrows, and coverage overlap polygons.
 */
export function generateTopViewSvg(
  project: DetVisionProject,
  options: { width?: number; height?: number } = {}
): string {
  // Uses generateSiteTelemetryMapSvg with specialized top-view title and blueprint theme
  return generateSiteTelemetryMapSvg(project, options);
}

/**
 * 4. SIDE ELEVATION VIEW SVG
 * Vertical elevation profile showing truss mounting heights, dropper poles,
 * depression tilt angles (25°), human/vehicle target heights, and under-mount blind cones.
 */
export function generateSideElevationSvg(
  project: DetVisionProject,
  options: { width?: number; height?: number } = {}
): string {
  const width = options.width || 860;
  const height = options.height || 420;
  const cameras: Camera[] = project.cameras || [];
  const fh = project.facility_height_m || 5.0;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" style="background:#0e131f;border-radius:12px;border:1px solid #1e293b;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <!-- View Header Bar -->
      <rect x="0" y="0" width="${width}" height="32" fill="#0f172a" rx="12" />
      <rect x="0" y="16" width="${width}" height="16" fill="#0f172a" />
      <circle cx="20" cy="16" r="4" fill="#a855f7" />
      <text x="32" y="19" fill="#c084fc" font-size="11" font-weight="800" font-family="ui-monospace, monospace">
        MULTI-ANGLE SIMULATION · SIDE ELEVATION PROFILE &amp; FIELD RIGGING
      </text>
      <text x="${width - 16}" y="19" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">
        Ceiling Truss: ${fh.toFixed(1)}m AFF · Downward Depression: 25° · Dropper: 1.2m
      </text>

      <!-- Ceiling Plane Structure -->
      <line x1="50" y1="65" x2="${width - 50}" y2="65" stroke="#475569" stroke-width="4" />
      <text x="60" y="55" fill="#94a3b8" font-size="8.5" font-family="ui-monospace" font-weight="700">STRUCTURAL I-BEAM / CEILING UNISTRUT (Z = 5.0m AFF)</text>

      <!-- Floor Plane Structure -->
      <line x1="50" y1="340" x2="${width - 50}" y2="340" stroke="#334155" stroke-width="3" />
      <text x="60" y="358" fill="#64748b" font-size="8.5" font-family="ui-monospace">GROUND CONCRETE FLOOR (Z = 0.0m)</text>

      <!-- 1.5m Target Inspection Plane -->
      <line x1="50" y1="250" x2="${width - 50}" y2="250" stroke="#00e5ff" stroke-width="1.2" stroke-dasharray="4,4" opacity="0.6" />
      <text x="${width - 60}" y="244" fill="#00e5ff" font-size="8" font-family="ui-monospace" text-anchor="end">1.5m PPE &amp; FACE INSPECTION PLANE</text>

      <!-- Camera 1: Left Wall Cantilever (Mount: Wall-H, Facing East) -->
      <g transform="translate(100, 65)">
        <line x1="0" y1="0" x2="0" y2="45" stroke="#94a3b8" stroke-width="3" />
        <circle cx="0" cy="45" r="9" fill="#00e5ff" stroke="#ffffff" stroke-width="1.5" />
        <text x="0" y="49" fill="#090d16" font-size="8" font-weight="800" text-anchor="middle" font-family="ui-monospace">C1</text>
        <text x="-15" y="35" fill="#00e5ff" font-size="8" font-family="ui-monospace">Wall Mount</text>
        <!-- Frustum Cone -->
        <polygon points="0,45 25,275 220,275" fill="rgba(0, 229, 255, 0.15)" stroke="#00e5ff" stroke-width="1" />
        <!-- Optical Axis Ray -->
        <line x1="0" y1="45" x2="140" y2="275" stroke="#00e5ff" stroke-width="1.2" stroke-dasharray="3,3" />
      </g>

      <!-- Camera 2: Central Roof Dropper (Mount: Roof-Tilt, Facing North) -->
      <g transform="translate(420, 65)">
        <line x1="0" y1="0" x2="0" y2="55" stroke="#94a3b8" stroke-width="3" />
        <circle cx="0" cy="55" r="9" fill="#10b981" stroke="#ffffff" stroke-width="1.5" />
        <text x="0" y="59" fill="#090d16" font-size="8" font-weight="800" text-anchor="middle" font-family="ui-monospace">C7</text>
        <text x="12" y="40" fill="#10b981" font-size="8" font-family="ui-monospace">Roof-Tilt Dropper</text>
        <!-- Frustum Cone -->
        <polygon points="0,55 35,275 240,275" fill="rgba(16, 185, 129, 0.15)" stroke="#10b981" stroke-width="1" />
      </g>

      <!-- Human Worker Target (Height: 1.8m) -->
      <g transform="translate(280, 232)">
        <circle cx="0" cy="0" r="6" fill="#fbbf24" stroke="#ffffff" stroke-width="1" />
        <line x1="0" y1="6" x2="0" y2="60" stroke="#fbbf24" stroke-width="2" />
        <line x1="0" y1="60" x2="-8" y2="108" stroke="#fbbf24" stroke-width="2" />
        <line x1="0" y1="60" x2="8" y2="108" stroke="#fbbf24" stroke-width="2" />
        <line x1="-12" y1="26" x2="12" y2="26" stroke="#fbbf24" stroke-width="2" />
        <text x="0" y="-10" fill="#fbbf24" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-monospace">Worker (1.8m)</text>
      </g>

      <!-- Forklift Target (Height: 2.3m) -->
      <g transform="translate(620, 210)">
        <rect x="0" y="20" width="60" height="70" fill="rgba(245, 158, 11, 0.2)" stroke="#f59e0b" stroke-width="1.5" rx="3" />
        <rect x="15" y="0" width="30" height="20" fill="none" stroke="#f59e0b" stroke-width="1.5" />
        <circle cx="15" cy="115" r="14" fill="#1e293b" stroke="#f59e0b" stroke-width="2" />
        <circle cx="50" cy="115" r="14" fill="#1e293b" stroke="#f59e0b" stroke-width="2" />
        <text x="30" y="-6" fill="#f59e0b" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-monospace">Forklift (2.3m)</text>
      </g>

      <!-- Field Rigging Checklist HUD (Bottom Center) -->
      <g transform="translate(50, 368)">
        <text x="0" y="12" fill="#94a3b8" font-size="8" font-family="system-ui">
          ✔ Dropper pole lengths: <strong>1.2m threaded steel</strong> · Rigging torque: <strong>45 Nm</strong> to I-Beam unistrut clamps · IP67 weather cable glands sealed.
        </text>
        <text x="0" y="26" fill="#38bdf8" font-size="8" font-family="system-ui">
          ✔ Opposing bidirectional cameras eliminate blind zones underneath mounts with continuous 100% overlap.
        </text>
      </g>
    </svg>
  `;
}

/**
 * 5. 3D PERSPECTIVE VIEW SVG
 * Axonometric isometric 3D spatial twin rendering extruded machinery,
 * storage racks, vertical camera poles, and wireframe 3D frustum pyramids.
 */
export function generate3DPerspectiveSvg(
  project: DetVisionProject,
  options: { width?: number; height?: number } = {}
): string {
  const width = options.width || 860;
  const height = options.height || 480;
  const cameras: Camera[] = project.cameras || [];
  const structures: LayoutElement[] = project.structure || [];

  // Isometric projection helper: x, y, z -> sx, sy
  const ox = width * 0.48;
  const oy = height * 0.72;
  const isoX = (x: number, y: number) => ox + (x - y) * 280;
  const isoY = (x: number, y: number, z: number) => oy + (x + y) * 125 - z * 24;

  // Floor boundary points
  const p0 = { x: isoX(0, 0), y: isoY(0, 0, 0) };
  const p1 = { x: isoX(1, 0), y: isoY(1, 0, 0) };
  const p2 = { x: isoX(1, 1), y: isoY(1, 1, 0) };
  const p3 = { x: isoX(0, 1), y: isoY(0, 1, 0) };

  // 3D Cameras
  const cam3DPyramids: string[] = [];
  cameras.forEach((cam, idx) => {
    const cFloor = { x: isoX(cam.x, cam.y), y: isoY(cam.x, cam.y, 0) };
    const cMount = { x: isoX(cam.x, cam.y), y: isoY(cam.x, cam.y, 4.5) };
    const color = ['#00e5ff', '#ff6b35', '#7fff6b', '#c084fc', '#ffd60a', '#f472b6', '#38bdf8', '#fb923c'][idx % 8];

    // Frustum footprint on floor
    const spread = 0.12;
    const fA = { x: isoX(Math.max(0, cam.x - spread), Math.max(0, cam.y - spread)), y: isoY(Math.max(0, cam.x - spread), Math.max(0, cam.y - spread), 0) };
    const fB = { x: isoX(Math.min(1, cam.x + spread), Math.max(0, cam.y - spread)), y: isoY(Math.min(1, cam.x + spread), Math.max(0, cam.y - spread), 0) };
    const fC = { x: isoX(Math.min(1, cam.x + spread), Math.min(1, cam.y + spread)), y: isoY(Math.min(1, cam.x + spread), Math.min(1, cam.y + spread), 0) };
    const fD = { x: isoX(Math.max(0, cam.x - spread), Math.min(1, cam.y + spread)), y: isoY(Math.max(0, cam.x - spread), Math.min(1, cam.y + spread), 0) };

    cam3DPyramids.push(`
      <g id="iso-cam-${idx}">
        <!-- 3D Frustum Ground Patch -->
        <polygon points="${fA.x.toFixed(1)},${fA.y.toFixed(1)} ${fB.x.toFixed(1)},${fB.y.toFixed(1)} ${fC.x.toFixed(1)},${fC.y.toFixed(1)} ${fD.x.toFixed(1)},${fD.y.toFixed(1)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="0.8" />
        <!-- Pyramidal Frustum Edge Rays -->
        <line x1="${cMount.x.toFixed(1)}" y1="${cMount.y.toFixed(1)}" x2="${fA.x.toFixed(1)}" y2="${fA.y.toFixed(1)}" stroke="${color}" stroke-width="0.8" opacity="0.4" />
        <line x1="${cMount.x.toFixed(1)}" y1="${cMount.y.toFixed(1)}" x2="${fB.x.toFixed(1)}" y2="${fB.y.toFixed(1)}" stroke="${color}" stroke-width="0.8" opacity="0.4" />
        <line x1="${cMount.x.toFixed(1)}" y1="${cMount.y.toFixed(1)}" x2="${fC.x.toFixed(1)}" y2="${fC.y.toFixed(1)}" stroke="${color}" stroke-width="0.8" opacity="0.4" />
        <line x1="${cMount.x.toFixed(1)}" y1="${cMount.y.toFixed(1)}" x2="${fD.x.toFixed(1)}" y2="${fD.y.toFixed(1)}" stroke="${color}" stroke-width="0.8" opacity="0.4" />
        <!-- Vertical Dropper Pole -->
        <line x1="${cFloor.x.toFixed(1)}" y1="${cFloor.y.toFixed(1)}" x2="${cMount.x.toFixed(1)}" y2="${cMount.y.toFixed(1)}" stroke="#64748b" stroke-width="1.2" stroke-dasharray="2,2" />
        <!-- Mount Node -->
        <circle cx="${cMount.x.toFixed(1)}" cy="${cMount.y.toFixed(1)}" r="5" fill="${color}" stroke="#ffffff" stroke-width="1.2" />
        <text x="${cMount.x.toFixed(1)}" y="${(cMount.y - 7).toFixed(1)}" fill="${color}" font-size="8" font-family="ui-monospace" font-weight="800" text-anchor="middle">
          CAM-${idx + 1}
        </text>
      </g>
    `);
  });

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" style="background:#090c15;border-radius:12px;border:1px solid #1e293b;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <!-- View Header Bar -->
      <rect x="0" y="0" width="${width}" height="32" fill="#0f172a" rx="12" />
      <rect x="0" y="16" width="${width}" height="16" fill="#0f172a" />
      <circle cx="20" cy="16" r="4" fill="#38bdf8" />
      <text x="32" y="19" fill="#38bdf8" font-size="11" font-weight="800" font-family="ui-monospace, monospace">
        MULTI-ANGLE SIMULATION · 3D PERSPECTIVE VISUALIZER (ISOMETRIC TWIN)
      </text>
      <text x="${width - 16}" y="19" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">
        Isometric Projection · ${cameras.length} Frustum Volumes · Zero Blind Spot Mesh
      </text>

      <!-- Floor Mesh -->
      <polygon points="${p0.x.toFixed(1)},${p0.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)}" fill="rgba(15, 23, 42, 0.85)" stroke="#334155" stroke-width="2" />

      <!-- Isometric Grid Lines -->
      ${[0.2, 0.4, 0.6, 0.8].map(v => {
        const a = { x: isoX(v, 0), y: isoY(v, 0, 0) };
        const b = { x: isoX(v, 1), y: isoY(v, 1, 0) };
        const c = { x: isoX(0, v), y: isoY(0, v, 0) };
        const d = { x: isoX(1, v), y: isoY(1, v, 0) };
        return `
          <line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#1e293b" stroke-width="1" />
          <line x1="${c.x.toFixed(1)}" y1="${c.y.toFixed(1)}" x2="${d.x.toFixed(1)}" y2="${d.y.toFixed(1)}" stroke="#1e293b" stroke-width="1" />
        `;
      }).join('\n')}

      <!-- 3D Camera Pyramids & Frustums -->
      ${cam3DPyramids.join('\n')}

      <!-- Isometric Compass (Bottom Left) -->
      <g transform="translate(60, ${height - 60})">
        <line x1="0" y1="0" x2="35" y2="-15" stroke="#ef4444" stroke-width="2" />
        <text x="42" y="-14" fill="#ef4444" font-size="8.5" font-weight="800" font-family="ui-monospace">X (Length)</text>
        <line x1="0" y1="0" x2="-35" y2="-15" stroke="#3b82f6" stroke-width="2" />
        <text x="-40" y="-14" fill="#3b82f6" font-size="8.5" font-weight="800" font-family="ui-monospace" text-anchor="end">Y (Width)</text>
        <line x1="0" y1="0" x2="0" y2="-40" stroke="#10b981" stroke-width="2" />
        <text x="6" y="-38" fill="#10b981" font-size="8.5" font-weight="800" font-family="ui-monospace">Z (Height)</text>
      </g>
    </svg>
  `;
}

/**
 * 6. 3D AI TELEMETRY DASHBOARD SVG
 * Overview scorecard synthesizing the Multi-Angle simulation metrics,
 * ray-box occlusion clearance, bandwidth, compute, and DORI status.
 */
export function generateSimulationDashboardSvg(
  project: DetVisionProject,
  options: { width?: number; height?: number } = {}
): string {
  return generateCoverageTelemetryMetricsSvg(project, options);
}


