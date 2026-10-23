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
  ShieldCheck, 
  Sparkles,
  ArrowRight,
  Sliders,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import type { DetVisionProject, FacilityBuilding } from '@/lib/types';
import { ensureMultiBuildingFleet } from '@/lib/rule-based-planner';
import { computeReportMetrics, cleanZoneName } from '@/lib/report-content';
import { 
  generateSiteTelemetryMapSvg, 
  generate3DPerspectiveSvg,
  generateBirdCamera3DSvg,
  generateFrustumDori3DSvg,
  generateSideElevationSvg,
  generateCoverageTelemetryMetricsSvg,
} from '@/lib/report-diagrams';
import { useView } from '@/components/view-context';

interface ReportPreviewProps {
  project: DetVisionProject;
  onPrint: () => void;
  onExportJSON: () => void;
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

export function ReportPreview({ project, onPrint, onExportJSON }: ReportPreviewProps) {
  let viewCtx: any = null;
  try {
    viewCtx = useView();
  } catch {
    // optional fallback
  }

  const [printMode, setPrintMode] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

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

  const fleet = ensureMultiBuildingFleet(project);
  const resolvedProject: DetVisionProject = {
    ...project,
    cameras: fleet.cameras,
    buildings: fleet.buildings,
    structure: fleet.structure,
  };

  const title = resolvedProject.name || 'Plan Vision Facility Plan';
  const company = resolvedProject.company_name || 'Enterprise Facility';
  const industry = resolvedProject.industry || 'Operations & Logistics';
  const cameras = resolvedProject.cameras;
  const camCount = cameras.length;
  const bldgs: FacilityBuilding[] = resolvedProject.buildings || [];
  const dateStr = formatDate(new Date().toISOString());

  const totalAreaSqm = Math.round(bldgs.reduce((acc, b) => acc + (b.area_sqm || 0), 0)) ||
    Math.round((resolvedProject.facility_length_m || 30) * (resolvedProject.facility_width_m || 20));
  const storage30dTb = ((camCount * 4096 * 86400 * 30) / (8 * 1e9)).toFixed(1);
  const switches = Math.max(1, Math.ceil(camCount / 24));

  const m = computeReportMetrics(resolvedProject);

  // All 6 Visual Diagrams generated with calibrated dimensions
  const diagram1Svg = generateSiteTelemetryMapSvg(resolvedProject, { width: 860, height: 420 });
  const diagram2Svg = generateSideElevationSvg(resolvedProject, { width: 860, height: 420 });
  const diagram3Svg = generateBirdCamera3DSvg(resolvedProject, { width: 860, height: 440 });
  const diagram4Svg = generate3DPerspectiveSvg(resolvedProject, { width: 860, height: 440 });
  const diagram5Svg = generateFrustumDori3DSvg(resolvedProject, { width: 860, height: 420 });
  const diagram6Svg = generateCoverageTelemetryMetricsSvg(resolvedProject, { width: 860, height: 280 });

  const handleExportDocx = async () => {
    setDownloadingDocx(true);
    try {
      const resp = await fetch('/api/report/generate?mode=docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: resolvedProject, format: 'docx' }),
      });
      if (!resp.ok) throw new Error('DOCX export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(resolvedProject.name || 'Plan_Vision').replace(/\s+/g, '_')}_Camera_Safety_Plan.doc`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Unable to generate DOCX report.');
    } finally {
      setDownloadingDocx(false);
    }
  };

  const handleExportPdf = async () => {
    setDownloadingPdf(true);
    try {
      const resp = await fetch('/api/report/generate?mode=pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: resolvedProject, format: 'pdf' }),
      });
      if (!resp.ok) throw new Error('PDF export failed');
      const html = await resp.text();
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
        }, 400);
      } else {
        onPrint();
      }
    } catch (err) {
      console.error(err);
      onPrint();
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleModifyCameraMapping = () => {
    if (viewCtx?.setActiveView) {
      viewCtx.setActiveView('camera-map');
    } else {
      window.location.href = '/camera-map';
    }
  };

  return (
    <div className="report-container flex flex-1 min-h-0 bg-slate-100 flex-col overflow-y-auto print:bg-white print:overflow-visible font-sans">
      {/* Top Action Ribbon (Hidden when printing) */}
      <div className="no-print sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900 text-sm">{title}</h2>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                5-Page Executive Blueprint
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {camCount} Cameras • {bldgs.length || 1} Building Zones • {m.coveragePct !== null ? `${m.coveragePct}% Floor Watched` : 'Coverage Verified'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Modify Camera Mapping Primary CTA */}
          <button 
            onClick={handleModifyCameraMapping} 
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            title="Open Camera Map to reposition cameras, adjust angles, or auto-solve coverage"
          >
            <CameraIcon className="w-4 h-4" />
            Modify Camera Mapping
          </button>

          <button 
            onClick={onPrint} 
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            title="Open browser print dialog with pre-configured 5-page A4 layout"
          >
            <Printer className="w-4 h-4" />
            Print / Save PDF (5 Pages)
          </button>

          <button 
            onClick={handleExportDocx} 
            disabled={downloadingDocx}
            className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
            title="Download editable Microsoft Word DOCX document with all 6 diagrams"
          >
            <FileText className="w-4 h-4 text-blue-600" />
            {downloadingDocx ? 'Generating Word DOCX…' : 'Download DOCX'}
          </button>

          <button 
            onClick={handleExportPdf} 
            disabled={downloadingPdf}
            className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
            title="Download standalone 5-page printable PDF"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            {downloadingPdf ? 'Opening PDF…' : 'Download PDF'}
          </button>

          <button 
            onClick={onExportJSON} 
            className="px-3 py-2 border border-slate-200 bg-white text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
          >
            JSON
          </button>
        </div>
      </div>

      {/* Floating Status Notification Banner (Non-Printable) */}
      <div className="no-print max-w-[860px] w-full mx-auto px-4 sm:px-6 pt-4">
        {m.coveragePct !== null && m.coveragePct < m.target ? (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-xl text-xs flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>
                <strong>{m.gapPct}% Coverage Gap Detected:</strong> Currently {m.coveragePct}% of floor is watched (target is {m.target}%). Click <strong>Modify Camera Mapping</strong> to reposition cameras or auto-solve, then confirm to refresh this report.
              </span>
            </div>
            <button 
              onClick={handleModifyCameraMapping} 
              className="ml-3 shrink-0 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg transition-colors flex items-center gap-1"
            >
              Modify Mapping <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3.5 rounded-xl text-xs flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>
                <strong>Verified Camera Plan:</strong> All {camCount} cameras satisfy safety coverage standards ({m.coveragePct ?? 100}% watched).
              </span>
            </div>
            <button 
              onClick={handleModifyCameraMapping} 
              className="ml-3 shrink-0 px-3 py-1 border border-emerald-300 bg-white hover:bg-emerald-100 text-emerald-800 font-semibold rounded-lg transition-colors"
            >
              Edit Cameras
            </button>
          </div>
        )}
      </div>

      {/* Report Pages Container */}
      <div className="p-4 sm:p-6 lg:p-8 flex flex-col items-center gap-6 print:p-0 print:gap-0">
        
        {/* ========================================================================= */}
        {/* PAGE 1: EXECUTIVE BLUEPRINT & HEALTH SCORECARD                            */}
        {/* ========================================================================= */}
        <div className="report-page w-full max-w-[860px] bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 print:min-h-0 print:h-auto print:overflow-visible print:break-after-page flex flex-col justify-between">
          <div>
            {/* Header Box */}
            <div className="border-b-2 border-blue-600 pb-3 mb-4 flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">{title}</h1>
                <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mt-0.5">
                  Camera Safety &amp; Coverage Blueprint
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Client: <strong className="text-slate-800">{company}</strong> • Industry: {industry} • Assessment Date: {dateStr}
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block px-2.5 py-1 text-[10px] font-bold uppercase rounded bg-blue-50 text-blue-700 border border-blue-200">
                  Verified Blueprint
                </span>
                <p className="text-[10px] text-slate-500 mt-1">Plan Vision Architectural Engine</p>
              </div>
            </div>

            {/* KPI Ribbon */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-4 text-center">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-xl font-black text-blue-900">{camCount}</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Total Cameras</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-xl font-black text-blue-900">{bldgs.length || 1}</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Facility Zones</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-xl font-black text-blue-900">{totalAreaSqm.toLocaleString()} m²</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Floor Area</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-xl font-black text-emerald-700">{m.coveragePct !== null ? `${m.coveragePct}%` : '—'}</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Floor Watched</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-xl font-black text-blue-900">{storage30dTb} TB</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">30-Day Storage</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                <div className="text-xl font-black text-blue-900">{switches}</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Network Switch{switches > 1 ? 'es' : ''}</div>
              </div>
            </div>

            {/* Verdict Box */}
            <div className={`p-3.5 rounded-lg border mb-4 ${
              m.coveragePct !== null && m.coveragePct >= m.target
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <div className="text-xs font-bold mb-1 flex items-center gap-1.5">
                {m.coveragePct !== null && m.coveragePct >= m.target ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-600" />
                )}
                {m.coveragePct !== null && m.coveragePct >= m.target
                  ? `100% Target Met — ${m.coveragePct}% of the facility floor is fully protected`
                  : `${m.gapPct}% Coverage Gap — ${m.coveragePct}% watched, safety target is ${m.target}%`}
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] leading-relaxed flex-1 min-w-[280px]">
                  {m.coveragePct !== null && m.coveragePct >= m.target
                    ? `Your ${camCount} cameras provide complete, unbroken protection across all work zones. Only ${m.blindPct}% of minor perimeter space is unmonitored.`
                    : `Adjust camera mount angles, or click Auto-Solve (≥95%) in the Camera Map screen and click Confirm Camera Mapping to update this report.` +
                      (m.largestGapM ? ` The largest unwatched blind spot is approximately ${m.largestGapM} meters wide.` : '')}
                </p>
                <button
                  onClick={handleModifyCameraMapping}
                  className="no-print px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
                >
                  <CameraIcon className="w-3.5 h-3.5 text-blue-400" />
                  Modify Camera Mapping →
                </button>
              </div>
            </div>

            {/* How This Site is Protected (In Plain Words) */}
            <div className="mb-4">
              <h3 className="text-xs font-bold text-blue-950 uppercase tracking-wide border-b border-blue-200 pb-1 mb-2">
                How This Site is Protected (In Plain Words)
              </h3>
              <p className="text-xs text-slate-700 leading-relaxed">
                This plan specifies where to install <strong>{camCount} cameras</strong> across your facility to protect personnel, monitor machinery, and eliminate blind spots. The 6 diagrams on the following pages show every camera angle from above, from the side, and in realistic 3D so you can verify coverage without any technical background.
              </p>
            </div>

            {/* Picture Clarity Guide */}
            <div className="mb-4">
              <h3 className="text-xs font-bold text-blue-950 uppercase tracking-wide border-b border-blue-200 pb-1 mb-2">
                Picture Clarity Standards (What Cameras See Clearly)
              </h3>
              <table className="w-full border-collapse text-left text-[11px]">
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="py-1.5 pr-2 font-bold text-slate-900 w-[24%]">Face &amp; ID Level</td>
                    <td className="py-1.5 pr-2 w-[22%]">
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[10px]">
                        Identify (≥250 px/m)
                      </span>
                    </td>
                    <td className="py-1.5 text-slate-600">
                      High resolution to confirm a person's identity, read employee badges, and capture license plates.
                    </td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1.5 pr-2 font-bold text-slate-900">Safety Gear &amp; Uniforms</td>
                    <td className="py-1.5 pr-2">
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-bold text-[10px]">
                        Recognize (≥125 px/m)
                      </span>
                    </td>
                    <td className="py-1.5 text-slate-600">
                      Clear vision to confirm hard hats, high-visibility safety vests, and distinctive clothing.
                    </td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1.5 pr-2 font-bold text-slate-900">Vehicles &amp; Equipment</td>
                    <td className="py-1.5 pr-2">
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-bold text-[10px]">
                        Observe (≥62.5 px/m)
                      </span>
                    </td>
                    <td className="py-1.5 text-slate-600">
                      Clear sight of forklifts, pallet movements, machinery operations, and conveyor lines.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-2 font-bold text-slate-900">Motion &amp; Entry</td>
                    <td className="py-1.5 pr-2">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-bold text-[10px]">
                        Detect (≥25 px/m)
                      </span>
                    </td>
                    <td className="py-1.5 text-slate-600">
                      Wide-area detection alerting supervisors whenever any person or vehicle enters a zone.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Building Zones Table */}
            <div>
              <h3 className="text-xs font-bold text-blue-950 uppercase tracking-wide border-b border-blue-200 pb-1 mb-2">
                Monitored Facility Buildings &amp; Zones
              </h3>
              {bldgs.length > 0 ? (
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-bold">
                      <th className="p-1.5 border border-slate-200">Building Zone</th>
                      <th className="p-1.5 border border-slate-200">Facility Purpose</th>
                      <th className="p-1.5 border border-slate-200">Floor Size</th>
                      <th className="p-1.5 border border-slate-200">Cameras</th>
                      <th className="p-1.5 border border-slate-200">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bldgs.map((b) => {
                      let p = b.purpose || 'Operations & Active Floor';
                      if (p.length > 60) p = p.slice(0, 58) + '…';
                      return (
                        <tr key={b.id} className="border-b border-slate-200">
                          <td className="p-1.5 font-bold text-slate-900">{cleanZoneName(b.name)}</td>
                          <td className="p-1.5 text-slate-600">{p}</td>
                          <td className="p-1.5 text-slate-700">{Math.round(b.area_sqm || 0)} m²</td>
                          <td className="p-1.5 font-bold text-blue-900">{b.camera_count ?? 0}</td>
                          <td className="p-1.5">
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[9.5px]">
                              Monitored
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-slate-500">The entire facility is monitored as an integrated single-building footprint.</p>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-2 mt-4 flex items-center justify-between text-[10px] text-slate-400">
            <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
            <span className="font-bold">Page 1 of 5</span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PAGE 2: ARCHITECTURAL SITE LAYOUT (TOP VIEW & SIDE ELEVATION)             */}
        {/* ========================================================================= */}
        <div className="report-page w-full max-w-[860px] bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 print:min-h-0 print:h-auto print:overflow-visible print:break-after-page flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-950 border-b-2 border-blue-600 pb-1.5 mb-3 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-blue-600" />
              Architectural Site Layout: Top View &amp; Side Elevation
            </h2>

            {/* Diagram 1: Top View */}
            <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left mb-3 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-blue-950">
                  Diagram 1 of 6 — Top View (2D Architectural Floor Plan)
                </span>
                <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  Floor Plan
                </span>
              </div>
              <div 
                className="w-full flex justify-center overflow-hidden rounded bg-white"
                dangerouslySetInnerHTML={{ __html: diagram1Svg }} 
              />
              <div className="mt-2 p-2 bg-slate-50 border-l-3 border-blue-600 rounded-r text-left text-[10.5px] text-slate-700 leading-snug">
                <div><strong>What this shows:</strong> A bird's-eye view of your facility showing where each camera is positioned and which direction its lens points.</div>
                <div className="mt-0.5"><strong>How to read it:</strong> Shaded cones show the area each camera protects. Clear spaces between cones indicate unprotected zones.</div>
              </div>
            </div>

            {/* Diagram 2: Side Elevation */}
            <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-blue-950">
                  Diagram 2 of 6 — Side Elevation (Mounting Height &amp; Angles)
                </span>
                <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                  Side Profile
                </span>
              </div>
              <div 
                className="w-full flex justify-center overflow-hidden rounded bg-white"
                dangerouslySetInnerHTML={{ __html: diagram2Svg }} 
              />
              <div className="mt-2 p-2 bg-slate-50 border-l-3 border-blue-600 rounded-r text-left text-[10.5px] text-slate-700 leading-snug">
                <div><strong>What this shows:</strong> A side cross-section showing camera mounting heights above the floor and downward tilt angles toward work areas.</div>
                <div className="mt-0.5"><strong>How to read it:</strong> The dead-zone directly under a camera is protected by adjacent overlapping camera cones.</div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-2 mt-4 flex items-center justify-between text-[10px] text-slate-400">
            <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
            <span className="font-bold">Page 2 of 5</span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PAGE 3: 3D SPATIAL SIMULATION (BIRD CAMERA 3D & 3D PERSPECTIVE)           */}
        {/* ========================================================================= */}
        <div className="report-page w-full max-w-[860px] bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 print:min-h-0 print:h-auto print:overflow-visible print:break-after-page flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-950 border-b-2 border-blue-600 pb-1.5 mb-3 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-blue-600" />
              3D Spatial Simulation: Bird Camera &amp; Perspective Twin
            </h2>

            {/* Diagram 3: Bird Camera 3D */}
            <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left mb-3 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-blue-950">
                  Diagram 3 of 6 — Bird Camera 3D (Obstacle Clearance &amp; Blind Spots)
                </span>
                <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  Obstacle Clearance
                </span>
              </div>
              <div 
                className="w-full flex justify-center overflow-hidden rounded bg-white"
                dangerouslySetInnerHTML={{ __html: diagram3Svg }} 
              />
              <div className="mt-2 p-2 bg-slate-50 border-l-3 border-blue-600 rounded-r text-left text-[10.5px] text-slate-700 leading-snug">
                <div><strong>What this shows:</strong> A high-angle 3D view showing if tall equipment, storage racks, or machines block camera sightlines.</div>
                <div className="mt-0.5"><strong>How to read it:</strong> Shaded spots behind objects highlight blind spots where extra camera angles are placed to maintain unbroken sight.</div>
              </div>
            </div>

            {/* Diagram 4: 3D Perspective */}
            <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-blue-950">
                  Diagram 4 of 6 — 3D Perspective (Depth &amp; Facility Simulation)
                </span>
                <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200">
                  Perspective Twin
                </span>
              </div>
              <div 
                className="w-full flex justify-center overflow-hidden rounded bg-white"
                dangerouslySetInnerHTML={{ __html: diagram4Svg }} 
              />
              <div className="mt-2 p-2 bg-slate-50 border-l-3 border-blue-600 rounded-r text-left text-[10.5px] text-slate-700 leading-snug">
                <div><strong>What this shows:</strong> A realistic 3D perspective showing camera sightlines working together across the facility interior.</div>
                <div className="mt-0.5"><strong>How to read it:</strong> Overlapping cones ensure workers and forklifts remain visible as they move through aisles and doors.</div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-2 mt-4 flex items-center justify-between text-[10px] text-slate-400">
            <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
            <span className="font-bold">Page 3 of 5</span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PAGE 4: OPTICAL CLARITY & COVERAGE GAP TELEMETRY                           */}
        {/* ========================================================================= */}
        <div className="report-page w-full max-w-[860px] bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 print:min-h-0 print:h-auto print:overflow-visible print:break-after-page flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-950 border-b-2 border-blue-600 pb-1.5 mb-3 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-blue-600" />
              Optical Clarity &amp; Coverage Gap Telemetry
            </h2>

            {/* Diagram 5: Frustum & DORI 3D */}
            <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left mb-3 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-blue-950">
                  Diagram 5 of 6 — Frustum &amp; DORI 3D (Optical Clarity Zones)
                </span>
                <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Clarity Ranges
                </span>
              </div>
              <div 
                className="w-full flex justify-center overflow-hidden rounded bg-white"
                dangerouslySetInnerHTML={{ __html: diagram5Svg }} 
              />
              <div className="mt-2 p-2 bg-slate-50 border-l-3 border-blue-600 rounded-r text-left text-[10.5px] text-slate-700 leading-snug">
                <div><strong>What this shows:</strong> Distance-based clarity cones: closer to the camera provides face identification; further out provides motion detection.</div>
                <div className="mt-0.5"><strong>How to read it:</strong> Color zones: Green = Face/ID level; Blue = Safety vest/uniform; Yellow = Forklift observation; Orange = Motion detection.</div>
              </div>
            </div>

            {/* Diagram 6: Multi-Angle Coverage Gap & Telemetry */}
            <div className="border border-slate-200 rounded-lg p-2.5 bg-white text-left mb-3 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-blue-950">
                  Diagram 6 of 6 — Multi-Angle Coverage Gap &amp; Telemetry Scorecard
                </span>
                <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  Telemetry Scorecard
                </span>
              </div>
              <div 
                className="w-full flex justify-center overflow-hidden rounded bg-white"
                dangerouslySetInnerHTML={{ __html: diagram6Svg }} 
              />
              <div className="mt-2 p-2 bg-slate-50 border-l-3 border-blue-600 rounded-r text-left text-[10.5px] text-slate-700 leading-snug">
                <div><strong>What this shows:</strong> Scorecard showing overall facility protection percentage, blind spot gap measurements, and hardware sizing.</div>
                <div className="mt-0.5"><strong>How to read it:</strong> Compare the coverage percentage with your 95% target to verify compliance.</div>
              </div>
            </div>

            {/* Next Action Box */}
            <div className={`p-3 rounded-lg border text-xs ${
              m.coveragePct !== null && m.coveragePct >= m.target
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}>
              <div className="font-bold mb-0.5">Camera Mapping Status &amp; Next Action:</div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] leading-relaxed flex-1 min-w-[280px]">
                  {m.coveragePct !== null && m.coveragePct < m.target
                    ? `Coverage is currently below your ${m.target}% target. In the Camera Map screen, adjust camera angles or click Auto-Solve (≥95%), then click Confirm Camera Mapping to update this report.`
                    : 'Your camera layout satisfies all safety coverage targets. Re-verify after any facility equipment reconfiguration.'}
                </p>
                <button
                  onClick={handleModifyCameraMapping}
                  className="no-print px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
                >
                  <CameraIcon className="w-3.5 h-3.5" />
                  Modify Cameras in Map →
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-2 mt-4 flex items-center justify-between text-[10px] text-slate-400">
            <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
            <span className="font-bold">Page 4 of 5</span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PAGE 5: CAMERA FLEET SCHEDULE & HARDWARE SUMMARY                          */}
        {/* ========================================================================= */}
        <div className="report-page w-full max-w-[860px] bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 print:min-h-0 print:h-auto print:overflow-visible print:break-after-avoid flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-950 border-b-2 border-blue-600 pb-1.5 mb-3 flex items-center gap-1.5">
              <CameraIcon className="w-4 h-4 text-blue-600" />
              Camera Placement Schedule
            </h2>

            {/* Camera Schedule Table */}
            <div className="overflow-x-auto mb-4">
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300">
                    <th className="p-1.5 border border-slate-200">Camera #</th>
                    <th className="p-1.5 border border-slate-200">Facility Zone</th>
                    <th className="p-1.5 border border-slate-200">Mount Location</th>
                    <th className="p-1.5 border border-slate-200">Height</th>
                    <th className="p-1.5 border border-slate-200">Direction</th>
                    <th className="p-1.5 border border-slate-200">Placement Coordinates</th>
                  </tr>
                </thead>
                <tbody>
                  {cameras.slice(0, 18).map((c, i) => {
                    const fl = resolvedProject.facility_length_m || 25;
                    const fw = resolvedProject.facility_width_m || 20;
                    const coordStr = `X: ${(c.x * fl).toFixed(1)}m, Y: ${(c.y * fw).toFixed(1)}m`;
                    return (
                      <tr key={c.id || i} className="border-b border-slate-200 even:bg-slate-50/60">
                        <td className="p-1.5 font-bold text-blue-900">CAM-{String(i + 1).padStart(2, '0')}</td>
                        <td className="p-1.5 text-slate-800 font-bold">{cleanZoneName(c.building_name)}</td>
                        <td className="p-1.5 text-slate-600">{mountWords[c.mount_type || 'wall-v'] || 'Wall / Ceiling Mount'}</td>
                        <td className="p-1.5 text-slate-700">{(c.height_m || 4.2).toFixed(1)} m</td>
                        <td className="p-1.5 text-slate-600">{compassWord(c.orientation_degrees || 0)}</td>
                        <td className="p-1.5">
                          <span className="font-mono text-[9px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">
                            {coordStr}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Hardware & Equipment in Simple Terms */}
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-950 border-b-2 border-blue-600 pb-1.5 mb-3">
              Hardware &amp; Equipment in Simple Terms
            </h2>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 mb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    📷 {camCount} Weatherproof AI Cameras
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Equipped with automatic night vision and wide-angle lenses tailored to room dimensions.
                  </p>
                </div>
                <div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    💾 {storage30dTb} TB Video Storage
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Dedicated hard drive capacity keeping 30 full days of continuous high-definition recording.
                  </p>
                </div>
                <div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    🔌 {switches} PoE Network Switch{switches > 1 ? 'es' : ''}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Supplies power and data over standard network cables (up to 24 cameras per switch).
                  </p>
                </div>
                <div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    🖥️ 1 Smart Video Analytics Station
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Processes video feeds locally in real time for instant hazard and PPE alerts without cloud delay.
                  </p>
                </div>
              </div>
            </div>

            {/* Site Installation Checklist */}
            <h2 className="text-sm font-bold uppercase tracking-wide text-blue-950 border-b-2 border-blue-600 pb-1.5 mb-2">
              Site Installation &amp; Verification Checklist
            </h2>
            <table className="w-full border-collapse text-left text-[11px]">
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="p-1.5 font-bold text-slate-400 w-[5%]">[ &nbsp; ]</td>
                  <td className="p-1.5 text-slate-700 w-[45%]">
                    <strong>Camera Mount Verification</strong>: Walk site to confirm wall/ceiling brackets match layout coordinates.
                  </td>
                  <td className="p-1.5 font-bold text-slate-400 w-[5%]">[ &nbsp; ]</td>
                  <td className="p-1.5 text-slate-700 w-[45%]">
                    <strong>Sightline Check</strong>: Verify no new tall racks or pallets obstruct designated camera cones.
                  </td>
                </tr>
                <tr>
                  <td className="p-1.5 font-bold text-slate-400">[ &nbsp; ]</td>
                  <td className="p-1.5 text-slate-700">
                    <strong>Network Cable Runs</strong>: Ensure cable distances from switch to cameras remain within 100 meters.
                  </td>
                  <td className="p-1.5 font-bold text-slate-400">[ &nbsp; ]</td>
                  <td className="p-1.5 text-slate-700">
                    <strong>Live Angle Calibration</strong>: Fine-tune pan and tilt on live monitor to eliminate ground blind spots.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-200 pt-2 mt-4 flex items-center justify-between text-[10px] text-slate-400">
            <span>TechHub Plan Vision • Multi-Building Computer Vision Engineering System</span>
            <span className="font-bold">Page 5 of 5</span>
          </div>
        </div>

      </div>
    </div>
  );
}
