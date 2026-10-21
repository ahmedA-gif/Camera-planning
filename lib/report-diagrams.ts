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
  const camCount = project.cameras?.length || 4;

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
  const camCount = project.cameras?.length || 4;
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

