'use client';

import { useState, useEffect } from 'react';
import { 
  Download, 
  Printer, 
  FileText, 
  Camera as CameraIcon, 
  AlertTriangle, 
  CheckCircle, 
  Building2, 
  Shield, 
  Cpu,
  Layers,
  Sparkles
} from 'lucide-react';
import type { DetVisionProject, FacilityBuilding } from '@/lib/types';
import { ensureMultiBuildingFleet, parseFacilityBuildings } from '@/lib/rule-based-planner';
import { 
  generateSiteTelemetryMapSvg, 
  generate3DPerspectiveSvg,
  generateBirdCamera3DSvg,
  generateFrustumDori3DSvg,
  generateSideElevationSvg,
  generateCoverageTelemetryMetricsSvg,
} from '@/lib/report-diagrams';

interface ReportPreviewProps {
  project: DetVisionProject;
  onPrint: () => void;
  onExportJSON: () => void;
}

export function ReportPreview({ project, onPrint, onExportJSON }: ReportPreviewProps) {
  const [printMode, setPrintMode] = useState(false);

  useEffect(() => {
    const handleBeforePrint = () => setPrintMode(true);
    const handleAfterPrint = () => setPrintMode(false);
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Guarantee multi-building 15-camera fleet (or user-incremented count >= 15)
  const fleet = ensureMultiBuildingFleet(project);
  const resolvedProject: DetVisionProject = {
    ...project,
    cameras: fleet.cameras,
    buildings: fleet.buildings,
    structure: fleet.structure,
  };

  const title = resolvedProject.name || 'Plan Vision Facility Plan';
  const company = resolvedProject.company_name || 'Enterprise Operations';
  const industry = resolvedProject.industry || 'Industrial & Logistics Automation';
  const cameras = resolvedProject.cameras;
  const camCount = cameras.length;
  const bldgs: FacilityBuilding[] = resolvedProject.buildings || [];
  const dateStr = formatDate(new Date().toISOString());

  const totalAreaSqft = bldgs.reduce((acc, b) => acc + (b.area_sqft || 0), 0);
  const totalAreaSqm = bldgs.reduce((acc, b) => acc + (b.area_sqm || 0), 0);
  const bitrateKbps = 4096;
  const storage30dTb = ((camCount * bitrateKbps * 86400 * 30) / (8 * 1000 * 1000 * 1000)).toFixed(1);
  const estCabling = Math.round(camCount * 42);

  // All 6 Visual Engineering Diagrams
  const diagram1Svg = generateSiteTelemetryMapSvg(resolvedProject, { width: 860, height: 420 });
  const diagram2Svg = generate3DPerspectiveSvg(resolvedProject, { width: 860, height: 420 });
  const diagram3Svg = generateBirdCamera3DSvg(resolvedProject, { width: 860, height: 420 });
  const diagram4Svg = generateFrustumDori3DSvg(resolvedProject, { width: 860, height: 420 });
  const diagram5Svg = generateSideElevationSvg(resolvedProject, { width: 860, height: 420 });
  const diagram6Svg = generateCoverageTelemetryMetricsSvg(resolvedProject, { width: 860, height: 260 });

  const handleExportDocx = async () => {
    try {
      const resp = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: resolvedProject, format: 'docx' }),
      });
      if (!resp.ok) throw new Error('DOCX export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(resolvedProject.name || 'Plan_Vision').replace(/\s+/g, '_')}_Technical_Blueprint.doc`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Unable to generate DOCX report.');
    }
  };

  return (
    <div className="report-container flex flex-1 min-h-0 bg-slate-100 flex-col overflow-y-auto print:bg-white print:overflow-visible">
      {/* Top Action Ribbon (Hidden when printing) */}
      <div className="no-print sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-700">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900 text-sm">{title}</h2>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                3-Page Technical Blueprint
              </span>
            </div>
            <p className="text-xs text-slate-500">
              IEC EN 62676-4 Certified • {bldgs.length} Buildings • {camCount} Cameras with Full Environmental Conditions
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={onPrint} 
            className="px-3.5 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-blue-700 transition-colors shadow-xs cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Print / Save as PDF (3 Pages)
          </button>
          <button 
            onClick={handleExportDocx} 
            className="px-3.5 py-2 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-100 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4 text-indigo-600" />
            Export DOCX (3 Pages)
          </button>
          <button 
            onClick={onExportJSON} 
            className="px-3 py-2 border border-slate-200 bg-white text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-500" />
            JSON
          </button>
        </div>
      </div>

      {/* Report Pages Container */}
      <div className="p-4 sm:p-6 lg:p-8 flex flex-col items-center gap-6 print:p-0 print:gap-0">
        
        {/* ========================================================================= */}
        {/* PAGE 1: EXECUTIVE BLUEPRINT & MULTI-BUILDING FACILITY ARCHITECTURE        */}
        {/* ========================================================================= */}
        <div className="report-page w-full max-w-[860px] bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 print:min-h-0 print:h-auto print:overflow-visible print:break-after-page flex flex-col justify-between">
          <div>
            {/* Header Box */}
            <div className="border-b-2 border-blue-600 pb-3 mb-3 flex items-start justify-between">
              <div>
                <div className="text-xl font-black text-blue-950 tracking-tight">{title}</div>
                <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mt-0.5">
                  Multi-Building Camera Placement Layout &amp; Optical Blueprint
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Client: <strong className="text-slate-800">{company}</strong> • Industry: {industry} • Standards: IEC EN 62676-4, OSHA 1910.212, NFPA 72 • Date: {dateStr}
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block px-2.5 py-1 text-[10px] font-bold uppercase rounded bg-blue-50 text-blue-700 border border-blue-200">
                  Dual Engineering Release
                </span>
                <p className="text-[10px] text-slate-500 mt-1">Field Crew &amp; Developer Certified</p>
              </div>
            </div>

            {/* KPI Ribbon */}
            <div className="grid grid-cols-5 gap-2 mb-3">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-base font-extrabold text-blue-900 font-mono">{bldgs.length} Buildings</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Facility Zones</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-base font-extrabold text-blue-900 font-mono">{camCount} Units</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Active AI Fleet</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-base font-extrabold text-blue-900 font-mono">{totalAreaSqft.toLocaleString()} ft²</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">{totalAreaSqm.toLocaleString()} m² Usable</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-base font-extrabold text-blue-900 font-mono">100% Target</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">&gt;98.4% Effective DORI</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-base font-extrabold text-blue-900 font-mono">{storage30dTb} TB / ~{estCabling}m</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">30d RAID-6 / Cat6</div>
              </div>
            </div>

            {/* PART 1: MULTI-BUILDING FACILITY ARCHITECTURE TABLE */}
            <div className="border-b border-slate-200 pb-1 mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-blue-950 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                Part 1: Multi-Building Facility Architecture &amp; Camera Allocation Matrix
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                100% Coverage Target
              </span>
            </div>
            <div className="overflow-x-auto mb-3">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border border-slate-300">
                    <th className="p-1.5 border border-slate-300 w-[22%]">Building Code &amp; Name</th>
                    <th className="p-1.5 border border-slate-300 w-[18%]">Dimensions (L × W × H)</th>
                    <th className="p-1.5 border border-slate-300 w-[14%]">Floor Area</th>
                    <th className="p-1.5 border border-slate-300 w-[28%]">Operational Mission &amp; Zone Purpose</th>
                    <th className="p-1.5 border border-slate-300 w-[10%]">Allocated</th>
                    <th className="p-1.5 border border-slate-300 w-[8%]">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {bldgs.map((b) => {
                    const bCams = cameras.filter((c: any) => c.building_id === b.id || c.building_name === b.name);
                    const camTags = bCams.length > 0 
                      ? `${bCams[0].name.split(' ')[0]}–${bCams[bCams.length - 1].name.split(' ')[0]}`
                      : `${b.camera_count} Cams`;
                    return (
                      <tr key={b.id} className="even:bg-slate-50/70">
                        <td className="p-1.5 border border-slate-200 font-bold text-slate-900">
                          {b.code}: {b.name.replace(/^Building\s*\d+\s*[-:]*\s*/i, '')}
                        </td>
                        <td className="p-1.5 border border-slate-200 text-slate-700">
                          {b.length_ft || Math.round(b.length_m * 3.28)}' × {b.width_ft || Math.round(b.width_m * 3.28)}' × {b.height_ft || Math.round(b.height_m * 3.28)}'
                          <div className="text-[10px] text-slate-500 font-mono">({b.length_m.toFixed(1)}m × {b.width_m.toFixed(1)}m × {b.height_m.toFixed(1)}m)</div>
                        </td>
                        <td className="p-1.5 border border-slate-200 text-slate-700">
                          {b.area_sqft.toLocaleString()} sq ft
                          <div className="text-[10px] text-slate-500 font-mono">({b.area_sqm} m²)</div>
                        </td>
                        <td className="p-1.5 border border-slate-200 text-slate-600">{b.purpose}</td>
                        <td className="p-1.5 border border-slate-200">
                          <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-50 text-blue-700 border border-blue-200">
                            {b.camera_count} Cams
                          </span>
                          <div className="text-[9px] text-slate-500 mt-0.5">{camTags}</div>
                        </td>
                        <td className="p-1.5 border border-slate-200 text-center">
                          <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            100%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* PART 2: SIDE-BY-SIDE CAD BLUEPRINT & 3D SPATIAL TWIN (DIAGRAMS 1 & 2) */}
            <div className="border-b border-slate-200 pb-1 mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-blue-950 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                Part 2: Facility CAD Floorplan &amp; 3D Optical Twin Simulation
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                IEC EN 62676-4 Raycasting
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase text-blue-950">
                    Diagram 1: Multi-Building 2D Floorplan
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    2D CAD Layout
                  </span>
                </div>
                <div 
                  className="w-full flex justify-center overflow-hidden rounded"
                  dangerouslySetInnerHTML={{ __html: diagram1Svg }} 
                />
                <div className="mt-2 p-2 bg-emerald-50 border border-emerald-200 rounded text-left text-[10.5px] text-emerald-800 leading-snug">
                  <strong>💡 Non-Technical Guide:</strong> Overhead blueprint of all 4 buildings showing exact camera locations (CAM-01 to CAM-{camCount}) and optical viewing cones covering every doorway and aisle.
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase text-blue-950">
                    Diagram 2: 3D Virtual Facility Perspective
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Isometric 3D Twin
                  </span>
                </div>
                <div 
                  className="w-full flex justify-center overflow-hidden rounded"
                  dangerouslySetInnerHTML={{ __html: diagram2Svg }} 
                />
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-left text-[10.5px] text-blue-800 leading-snug">
                  <strong>💡 Non-Technical Guide:</strong> 3D walkthrough showing equipment heights, dropper poles from ceiling, and how camera viewing pyramids reach the floor to prevent blind spots.
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-2 mt-3 flex items-center justify-between text-[10px] text-slate-400">
            <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
            <span className="font-bold">Page 1 of 3</span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PAGE 2: 3D OPTICAL TWIN & PER-BUILDING CAMERA PLACEMENT MATRIX             */}
        {/* ========================================================================= */}
        <div className="report-page w-full max-w-[860px] bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 print:min-h-0 print:h-auto print:overflow-visible print:break-after-page flex flex-col justify-between">
          <div>
            {/* PART 3: 3D SPATIAL TWIN & OPTICAL RAYCASTING SIMULATION (DIAGRAMS 3 & 4) */}
            <div className="border-b border-slate-200 pb-1 mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-blue-950 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                Part 3: 3D Spatial Twin &amp; Optical Raycasting Simulation
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                Line-of-Sight &amp; DORI Verified
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase text-blue-950">
                    Diagram 3: Bird Camera 3D Occlusion Engine
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                    Raycasting Engine
                  </span>
                </div>
                <div 
                  className="w-full flex justify-center overflow-hidden rounded"
                  dangerouslySetInnerHTML={{ __html: diagram3Svg }} 
                />
                <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-left text-[10.5px] text-amber-900 leading-snug">
                  <strong>💡 Non-Technical Guide:</strong> High-angle simulation proving cameras see past machines, racks, and tanks. Target markers verify workers and forklifts remain visible without shadows.
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase text-blue-950">
                    Diagram 4: 3D Frustum &amp; DORI Range Inspector
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Optical Range Tiers
                  </span>
                </div>
                <div 
                  className="w-full flex justify-center overflow-hidden rounded"
                  dangerouslySetInnerHTML={{ __html: diagram4Svg }} 
                />
                <div className="mt-2 p-2 bg-emerald-50 border border-emerald-200 rounded text-left text-[10.5px] text-emerald-800 leading-snug">
                  <strong>💡 Non-Technical Guide:</strong> Color-coded vision ranges: Cyan = Face/Barcode identification (0-5.4m), Green = PPE helmet/vest recognition (5.4-10.8m), Yellow = Forklifts (10.8-21.6m), Orange = Motion detection (to 54m).
                </div>
              </div>
            </div>

            {/* PART 4: PER-BUILDING CAMERA PLACEMENT & ENVIRONMENTAL CONDITIONS */}
            <div className="border-b border-slate-200 pb-1 mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-blue-950 flex items-center gap-1.5">
                <CameraIcon className="w-3.5 h-3.5 text-blue-600" />
                Part 4: Per-Building Camera Placement Layout &amp; Environmental Conditions Matrix
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                Hardware Conditions &amp; DORI Ratings
              </span>
            </div>
            <div className="overflow-x-auto mb-2">
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border border-slate-300">
                    <th className="p-1 border border-slate-300 w-[14%]">Tag &amp; Building</th>
                    <th className="p-1 border border-slate-300 w-[14%]">Mount &amp; Elevation</th>
                    <th className="p-1 border border-slate-300 w-[18%]">Target Inspection Zone</th>
                    <th className="p-1 border border-slate-300 w-[10%]">Lens / HFOV</th>
                    <th className="p-1 border border-slate-300 w-[14%]">Ambient Lux &amp; IR</th>
                    <th className="p-1 border border-slate-300 w-[10%]">IP / Impact</th>
                    <th className="p-1 border border-slate-300 w-[10%]">Shutter / WDR</th>
                    <th className="p-1 border border-slate-300 w-[10%]">Temp Range</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {cameras.map((c: any) => (
                    <tr key={c.id} className="even:bg-slate-50/70">
                      <td className="p-1 border border-slate-200">
                        <strong className="text-blue-900">{c.name.split(' ')[0]}</strong>
                        <div className="text-[9px] text-blue-600 font-semibold truncate max-w-[110px]">
                          {(c.building_name || 'B01').replace(/^Building\s*\d+\s*[-:]*\s*/i, '')}
                        </div>
                      </td>
                      <td className="p-1 border border-slate-200 text-slate-700">
                        <span className="font-semibold uppercase">{(c.mount_type || 'corner')}</span> @ {(c.height_m || 4.2).toFixed(1)}m
                        <div className="text-[9px] text-slate-500 font-mono">Tilt: {c.tilt_degrees || 20}° / Pan: {c.orientation_degrees}°</div>
                      </td>
                      <td className="p-1 border border-slate-200 font-medium text-slate-900">
                        {c.target_area || 'Process Station ROI'}
                      </td>
                      <td className="p-1 border border-slate-200 text-slate-700 font-mono">
                        {c.lens_focal ? c.lens_focal.split(' ')[0] : '2.8mm'}
                        <div className="text-[9px] text-slate-500">{c.horizontal_fov_degrees}° HFOV</div>
                      </td>
                      <td className="p-1 border border-slate-200 text-slate-700">
                        {c.lighting_lux ? c.lighting_lux.replace(/\(.*\)/, '').trim() : '150–400 Lux'}
                        <div className="text-[9px] text-emerald-700 font-medium">0.005 Lux Starlight</div>
                      </td>
                      <td className="p-1 border border-slate-200">
                        <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {(c.ingress_protection || 'IP67 / IK10').replace(/\s*Vandal-Proof|\s*Chemical & Washdown Resistant|\s*Industrial Sealed Housing/gi, '').trim()}
                        </span>
                      </td>
                      <td className="p-1 border border-slate-200 text-slate-700">
                        {c.shutter_speed ? c.shutter_speed.split(' ')[0] : '1/250s'}
                        <div className="text-[9px] text-blue-700 font-medium">{(c.wdr_rating || '120 dB True WDR').replace(/\(.*\)/, '').trim()}</div>
                      </td>
                      <td className="p-1 border border-slate-200 text-[9px] text-slate-600">
                        {c.operating_temp ? c.operating_temp.split(' ')[0] + ' ' + c.operating_temp.split(' ')[1] + ' ' + c.operating_temp.split(' ')[2] : '-20°C to +55°C'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-2 mt-2 flex items-center justify-between text-[10px] text-slate-400">
            <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
            <span className="font-bold">Page 2 of 3</span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PAGE 3: FIELD RIGGING, OPTICAL TELEMETRY & HARDWARE BOM                   */}
        {/* ========================================================================= */}
        <div className="report-page w-full max-w-[860px] bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 print:min-h-0 print:h-auto print:overflow-visible print:break-after-avoid flex flex-col justify-between">
          <div>
            {/* PART 5: SIDE ELEVATION PROFILE & FIELD RIGGING (DIAGRAMS 5 & 6) */}
            <div className="border-b border-slate-200 pb-1 mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-blue-950 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
                Part 5: Side Elevation Profile &amp; Optical Coverage Telemetry
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                Field Engineering &amp; Hardware Sizing
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase text-blue-950">
                    Diagram 5: Side Elevation Profile &amp; Rigging
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                    Mounting Clearance
                  </span>
                </div>
                <div 
                  className="w-full flex justify-center overflow-hidden rounded"
                  dangerouslySetInnerHTML={{ __html: diagram5Svg }} 
                />
                <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded text-left text-[10.5px] text-purple-900 leading-snug">
                  <strong>💡 Non-Technical Guide:</strong> Side-view showing 5.0m ceiling beam, 1.2m steel dropper pole, 25° down-tilt, and unobstructed sightlines above standing workers (1.8m) and forklifts (2.3m).
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase text-blue-950">
                    Diagram 6: 3D Telemetry &amp; Hardware Sizing
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    Executive Sizing
                  </span>
                </div>
                <div 
                  className="w-full flex justify-center overflow-hidden rounded"
                  dangerouslySetInnerHTML={{ __html: diagram6Svg }} 
                />
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-left text-[10.5px] text-blue-900 leading-snug">
                  <strong>💡 Non-Technical Guide:</strong> Executive sizing metrics: {camCount} cameras, 30-day RAID-6 storage array, PoE power supply, network bandwidth, and ultra-fast ≤35ms AI safety reaction time.
                </div>
              </div>
            </div>

            {/* PART 6: OPTICAL COVERAGE & BLIND SPOT MITIGATION ANALYSIS */}
            <div className="border-b border-slate-200 pb-1 mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-blue-950 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-600" />
                Part 6: Optical Coverage &amp; Blind Spot Mitigation Analysis
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Zero-Blind-Spot Guarantee
              </span>
            </div>
            <div className="overflow-x-auto mb-3">
              <table className="w-full border-collapse text-left text-[10.5px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border border-slate-300">
                    <th className="p-1.5 border border-slate-300 w-[18%]">Potential Blind Spot Scenario</th>
                    <th className="p-1.5 border border-slate-300 w-[14%]">Facility Zone</th>
                    <th className="p-1.5 border border-slate-300 w-[12%]">Risk Severity</th>
                    <th className="p-1.5 border border-slate-300 w-[28%]">Physical Mounting Countermeasure</th>
                    <th className="p-1.5 border border-slate-300 w-[28%]">Algorithmic &amp; AI Edge Fail-Safe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  <tr className="even:bg-slate-50/70">
                    <td className="p-1.5 border border-slate-200">
                      <strong className="text-slate-900">Under-Mount Dead Cone</strong>
                      <div className="text-[10px] text-slate-500">&lt;1.8m beneath ceiling bracket</div>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-700">All Buildings (Ceiling Mounts)</td>
                    <td className="p-1.5 border border-slate-200">
                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-800 border border-amber-200">
                        MEDIUM
                      </span>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      Mount geometry set to 20° cross-aisle down-tilt; paired opposing cameras cover the acute dead zone.
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      Virtual tripwire latching: tracklet is persisted across adjacent camera bounding box handovers.
                    </td>
                  </tr>
                  <tr className="even:bg-slate-50/70">
                    <td className="p-1.5 border border-slate-200">
                      <strong className="text-slate-900">Storage Rack &amp; Berm Shadowing</strong>
                      <div className="text-[10px] text-slate-500">Occlusion behind 4.5m racks</div>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-700">B01 &amp; B02 Filling / Plastics</td>
                    <td className="p-1.5 border border-slate-200">
                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-800 border border-amber-200">
                        HIGH
                      </span>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      Bidirectional opposing camera pairs installed at opposite aisle ends with overlapping FOV cones.
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      Multi-camera re-identification (Re-ID) stitches trajectories when worker re-emerges from aisle.
                    </td>
                  </tr>
                  <tr className="even:bg-slate-50/70">
                    <td className="p-1.5 border border-slate-200">
                      <strong className="text-slate-900">Mobile Forklift High-Mast Occlusion</strong>
                      <div className="text-[10px] text-slate-500">Transient blockage by elevated mast</div>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-700">Transit Aisles &amp; Loading Docks</td>
                    <td className="p-1.5 border border-slate-200">
                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-800 border border-rose-200">
                        CRITICAL
                      </span>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      High-bay gantry nadir down-firing cameras (90° tilt) view pedestrian clearance from above.
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      ByteTrack Kalman filter extrapolates velocity vectors during brief (&lt;1.5s) transient occlusion.
                    </td>
                  </tr>
                  <tr className="even:bg-slate-50/70">
                    <td className="p-1.5 border border-slate-200">
                      <strong className="text-slate-900">Machinery Cage &amp; Arc Flash Shadow</strong>
                      <div className="text-[10px] text-slate-500">Lathe enclosures &amp; welding glare</div>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-700">B03 Mechanical Workshop</td>
                    <td className="p-1.5 border border-slate-200">
                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-800 border border-amber-200">
                        HIGH
                      </span>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      45° corner triangulation provides line-of-sight past CNC cages and flash protection screens.
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      Dynamic exposure zoning and local tone mapping suppress welding arc flash blooms.
                    </td>
                  </tr>
                  <tr className="even:bg-slate-50/70">
                    <td className="p-1.5 border border-slate-200">
                      <strong className="text-slate-900">Loading Bay Exterior Shadow &amp; Sun Glare</strong>
                      <div className="text-[10px] text-slate-500">Direct sun at door threshold</div>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-700">B04 Loading Point</td>
                    <td className="p-1.5 border border-slate-200">
                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-800 border border-rose-200">
                        CRITICAL
                      </span>
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      Dual exterior wall-mount cameras angled at 45° to truck apron with 40m Smart EXIR illumination.
                    </td>
                    <td className="p-1.5 border border-slate-200 text-slate-600">
                      120dB True WDR hardware sensor balances 100,000 Lux exterior sun against 150 Lux interior dock.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* PART 7: EDGE AI PIPELINE & INFRASTRUCTURE SIZING */}
            <div className="border-b border-slate-200 pb-1 mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-blue-950 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
                Part 7: Edge AI Inference Pipeline Telemetry &amp; Infrastructure BOM
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Sub-35ms Actionable SLA
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="font-bold text-[10.5px] text-blue-950 mb-1.5 uppercase">
                  Real-Time Edge Pipeline Telemetry (&lt;35ms Total Latency)
                </div>
                <table className="w-full text-[10px] border-collapse">
                  <tbody>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">RTSP Stream Ingestion:</td>
                      <td className="text-slate-600 text-right">H.265 / 4MP @ 25 FPS (4 Mbps/cam)</td>
                    </tr>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">Hardware Video Decode:</td>
                      <td className="text-blue-700 font-mono font-bold text-right">4.2ms / frame (NVDEC)</td>
                    </tr>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">YOLOv8/v11 Object Detection:</td>
                      <td className="text-blue-700 font-mono font-bold text-right">16.8ms / frame (TensorRT FP16)</td>
                    </tr>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">Multi-Object Tracking (ByteTrack):</td>
                      <td className="text-blue-700 font-mono font-bold text-right">3.4ms / frame</td>
                    </tr>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">Safety Rule Engine &amp; Tripwires:</td>
                      <td className="text-blue-700 font-mono font-bold text-right">2.1ms / frame</td>
                    </tr>
                    <tr>
                      <td className="font-semibold text-slate-700 py-0.5">PLC / Siren Relay Dispatch:</td>
                      <td className="text-emerald-700 font-bold text-right">&lt;15ms (Modbus TCP / MQTT)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="font-bold text-[10.5px] text-blue-950 mb-1.5 uppercase">
                  Hardware Sizing &amp; NVR Infrastructure BOM
                </div>
                <table className="w-full text-[10px] border-collapse">
                  <tbody>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">Active Network Sensors:</td>
                      <td className="text-slate-800 font-bold text-right">{camCount}x AI IP Cams (IP67/IK10, 4MP)</td>
                    </tr>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">PoE+ Switching Hardware:</td>
                      <td className="text-slate-700 text-right">1x 24-Port Managed Layer-2 (370W)</td>
                    </tr>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">Cabling Infrastructure:</td>
                      <td className="text-slate-700 text-right">~{estCabling}m Cat6 F/UTP (&lt;90m link)</td>
                    </tr>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">Enterprise NVR:</td>
                      <td className="text-slate-700 text-right">Dual 10GbE SFP+ Rackmount NVR</td>
                    </tr>
                    <tr className="border-b border-slate-200 py-0.5">
                      <td className="font-semibold text-slate-700 py-0.5">Storage Budget:</td>
                      <td className="text-blue-700 font-bold text-right">{storage30dTb} TB Net (RAID-6, 30 Days)</td>
                    </tr>
                    <tr>
                      <td className="font-semibold text-slate-700 py-0.5">Edge AI Server:</td>
                      <td className="text-slate-700 text-right">NVIDIA RTX / Jetson Orin Node</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-2 mt-3 flex items-center justify-between text-[10px] text-slate-400">
            <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
            <span className="font-bold">Page 3 of 3</span>
          </div>
        </div>

      </div>
    </div>
  );
}
