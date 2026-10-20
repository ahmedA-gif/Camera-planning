'use client';

import { useState, useEffect } from 'react';
import { 
  Download, 
  Printer, 
  FileText, 
  Camera as CameraIcon, 
  GitBranch, 
  AlertTriangle, 
  Info, 
  CheckCircle, 
  Clock,
  Building2,
  Target,
  ListChecks,
  Shield,
  Wrench,
  MapPin,
  Eye,
  EyeOff,
  Cpu,
} from 'lucide-react';
import type { DetVisionProject, UseCase, Camera, Zone } from '@/lib/types';
import { getNodeCategoryInfo } from '@/lib/workflow-generator';

interface ReportPreviewProps {
  project: DetVisionProject;
  onPrint: () => void;
  onExportJSON: () => void;
}

export function ReportPreview({ project, onPrint, onExportJSON }: ReportPreviewProps) {
  const [showAssumptions, setShowAssumptions] = useState(true);
  const [showMissing, setShowMissing] = useState(true);
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

  const getFeasibilityColor = (status: string) => {
    switch (status) {
      case 'feasible': return 'text-green-700 bg-green-100';
      case 'conditional': return 'text-amber-700 bg-amber-100';
      case 'infeasible': return 'text-red-700 bg-red-100';
      default: return 'text-gray-700 bg-gray-100';
    }
  };

  const getFeasibilityIcon = (status: string) => {
    switch (status) {
      case 'feasible': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'conditional': return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      case 'infeasible': return <AlertTriangle className="w-4 h-4 text-red-600" />;
      default: return <Info className="w-4 h-4 text-gray-600" />;
    }
  };

  const getCameraStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-700 bg-green-100';
      case 'installed': return 'text-blue-700 bg-blue-100';
      case 'planned': return 'text-gray-700 bg-gray-100';
      case 'maintenance': return 'text-amber-700 bg-amber-100';
      case 'offline': return 'text-red-700 bg-red-100';
      default: return 'text-gray-700 bg-gray-100';
    }
  };

  return (
    <div className="flex flex-1 min-h-0 bg-gray-50 max-lg:flex-col">
      {/* Sidebar Navigation */}
      <div className="w-48 shrink-0 bg-white border-r border-border max-lg:w-full max-lg:border-r-0 max-lg:border-b">
        <nav className="flex flex-col gap-1 overflow-y-auto p-4 max-lg:flex-row max-lg:overflow-x-auto max-lg:overflow-y-hidden">
          <a href="#overview" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Overview</a>
          <a href="#objectives" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Objectives</a>
          <a href="#use-cases" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Use Cases</a>
          <a href="#techniques" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Techniques</a>
          <a href="#cameras" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Cameras</a>
          <a href="#installation-guide" className="block flex-none px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded transition-colors">Field Installation</a>
          <a href="#developer-guide" className="block flex-none px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded transition-colors">Developer Specs</a>
          <a href="#zones" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Zones</a>
          <a href="#workflow" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Workflow</a>
          <a href="#assumptions" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Assumptions</a>
          <a href="#risks" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Risks</a>
          <a href="#roadmap" className="block flex-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">Roadmap</a>
        </nav>
      </div>
      
      {/* Report Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-12">
        <div className="max-w-4xl mx-auto bg-white shadow-sm rounded-lg overflow-hidden report-container">
          {/* Header Controls */}
          {!printMode && (
            <div className="no-print p-4 border-b border-border flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2">
                <button onClick={onPrint} className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm flex items-center gap-1 hover:bg-primary/90">
                  <Printer className="w-4 h-4" />
                  Print / Save as PDF
                </button>
                <button onClick={onExportJSON} className="px-3 py-1.5 border border-input rounded text-sm hover:bg-muted flex items-center gap-1">
                  <Download className="w-4 h-4" />
                  Export JSON
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-sm text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={showAssumptions} onChange={e => setShowAssumptions(e.target.checked)} className="w-4 h-4 accent-primary" />
                  Assumptions
                </label>
                <label className="flex items-center gap-1 text-sm text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={showMissing} onChange={e => setShowMissing(e.target.checked)} className="w-4 h-4 accent-primary" />
                  Missing Info
                </label>
              </div>
            </div>
          )}

          {/* Report Header */}
          <div className="p-8 border-b-2 border-primary print:page-break-after-auto">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center">
                    <CameraIcon className="w-7 h-7 text-primary-foreground" />
                  </div>
                  <div>
                    <div className="mb-5 flex items-center gap-4"><img src="/techhub-logo.svg" alt="TechHub logo" className="h-14 w-auto"/><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">TechHub · Plan Vision</p><h1 className="text-3xl font-bold">Technical Blueprint</h1></div></div>
                    <p className="text-muted-foreground">Computer Vision Use-Case Planning Report</p>
                  </div>
                </div>
                <p className="text-muted-foreground">Generated on {formatDate(new Date().toISOString())} • Project ID: {project.id.slice(0, 8)}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{project.name}</p>
                <p className="text-muted-foreground">{project.company_name}</p>
                <p className="text-sm text-muted-foreground">{project.industry}</p>
              </div>
            </div>
          </div>

          {/* Executive Summary */}
          <section id="overview" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Executive summary')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <FileText className="w-6 h-6 text-primary" />
              Executive Summary
            </h2>
            <div className="prose max-w-none text-muted-foreground">
              <p className="mb-4">{project.business_description}</p>
              <div className="mb-4 grid gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm sm:grid-cols-2"><p><b>Layout:</b> {project.layout_section_count || 1} section(s){project.layout_sections?.length ? ` · ${project.layout_sections.join(' · ')}` : ''}</p><p><b>Detection coverage target:</b> {project.detection_coverage_target || 90}%</p>{project.camera_specifications && <p><b>Camera specifications:</b> {project.camera_specifications}</p>}{project.image_observation && <p><b>Image suggestion:</b> {project.image_observation}</p>}</div>
              {project.facility_image && <img src={project.facility_image} alt={project.facility_image_name || 'Uploaded site reference'} className="mb-5 max-h-72 rounded-xl border object-contain"/>}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-primary">{project.use_cases.length}</p>
                  <p className="text-sm text-muted-foreground">Use Cases</p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-primary">{project.cameras.length}</p>
                  <p className="text-sm text-muted-foreground">Cameras</p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-primary">{project.zones.length}</p>
                  <p className="text-sm text-muted-foreground">Zones/Lines</p>
                </div>
              </div>
              <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Camera assignment coverage: {project.zones.length ? Math.round(project.zones.filter(zone => zone.camera_ids.length > 0).length / project.zones.length * 100) : 0}% of configured zones have a camera assigned. This is an assignment check, not a measured field-of-view estimate.</p>
            </div>
          </section>

          {/* Business Objectives */}
          <section id="objectives" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Executive summary')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Target className="w-6 h-6 text-primary" />
              Business Objectives & Scope
            </h2>
            <div className="space-y-4">
              {project.requirements.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Requirements</h3>
                  <ul className="space-y-1">
                    {project.requirements.map((req, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                        <span>{req}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold mb-2">Project Metadata</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between"><dt className="text-muted-foreground">Created</dt><dd>{formatDate(project.created_at)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Updated</dt><dd>{formatDate(project.updated_at)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Project ID</dt><dd className="font-mono text-xs">{project.id}</dd></div>
                  </dl>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Scope Summary</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    <li>• {project.use_cases.filter(u => u.feasibility_status === 'feasible').length} feasible use cases</li>
                    <li>• {project.use_cases.filter(u => u.feasibility_status === 'conditional').length} conditional use cases</li>
                    <li>• {project.use_cases.filter(u => u.feasibility_status === 'infeasible').length} infeasible use cases</li>
                    <li>• {project.assumptions.length} documented assumptions</li>
                    <li>• {project.missing_information.length} missing information items</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* Use Case Analysis */}
          <section id="use-cases" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Use cases')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <ListChecks className="w-6 h-6 text-primary" />
              Use Case Analysis
            </h2>
            <div className="space-y-4">
              {project.use_cases.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No use cases generated yet. Run scenario analysis to populate.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-2 font-medium">Use Case</th>
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 font-medium">Feasibility</th>
                        <th className="pb-2 font-medium">Cameras</th>
                        <th className="pb-2 font-medium">Key Techniques</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.use_cases.map(uc => (
                        <tr key={uc.id} className="border-b border-border/50">
                          <td className="py-3">
                            <div className="font-medium">{uc.name}</div>
                            <div className="text-muted-foreground text-xs mt-1 line-clamp-2">{uc.description}</div>
                          </td>
                          <td className="py-3">
                            <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">{uc.task_type.replace('_', ' ')}</span>
                          </td>
                          <td className="py-3">
                            <span className={`px-2 py-0.5 text-xs rounded ${getFeasibilityColor(uc.feasibility_status)}`}>
                              {getFeasibilityIcon(uc.feasibility_status)}
                              {uc.feasibility_status.charAt(0).toUpperCase() + uc.feasibility_status.slice(1)}
                            </span>
                          </td>
                          <td className="py-3 text-muted-foreground">{uc.camera_ids.length}</td>
                          <td className="py-3 text-muted-foreground">{uc.candidate_techniques.slice(0, 2).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Detailed Use Case Cards */}
              <div className="space-y-4 mt-6">
                {project.use_cases.map(uc => (
                  <div key={uc.id} className="border border-border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold">{uc.name}</h3>
                        <p className="text-sm text-muted-foreground">{uc.description}</p>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded ${getFeasibilityColor(uc.feasibility_status)}`}>
                        {uc.feasibility_status}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <h4 className="font-medium mb-1">Input / Output</h4>
                        <p className="text-muted-foreground"><strong>Input:</strong> {uc.input_description}</p>
                        <p className="text-muted-foreground"><strong>Output:</strong> {uc.output_description}</p>
                      </div>
                      <div>
                        <h4 className="font-medium mb-1">Candidate Techniques</h4>
                        <ul className="space-y-1">
                          {uc.candidate_techniques.map((t, i) => (
                            <li key={i} className="text-muted-foreground flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-primary rounded-full"></span>
                              {t}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {uc.feasibility_notes.length > 0 && (
                      <div className="mt-3 p-3 bg-amber-50 rounded">
                        <h4 className="font-medium text-amber-800 mb-1 flex items-center gap-1">
                          <AlertTriangle className="w-4 h-4" />
                          Feasibility Notes
                        </h4>
                        <ul className="text-sm text-amber-700 space-y-1">
                          {uc.feasibility_notes.map((note, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <span>•</span> {note}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {uc.acceptance_criteria.length > 0 && (
                      <div className="mt-3">
                        <h4 className="font-medium mb-1">Acceptance Criteria</h4>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          {uc.acceptance_criteria.map((criteria, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                              {criteria}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Proposed Techniques */}
          <section id="techniques" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Use cases')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Cpu className="w-6 h-6 text-primary" />
              Proposed Vision Techniques
            </h2>
            <div className="space-y-4">
              {project.use_cases.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No techniques proposed yet.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {project.use_cases.flatMap(uc => uc.candidate_techniques).filter((v, i, a) => a.indexOf(v) === i).map((technique, i) => (
                    <div key={i} className="p-4 border border-border rounded-lg bg-slate-50/50">
                      <h4 className="font-semibold text-slate-900">{technique}</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Applicable to: {project.use_cases.filter(uc => uc.candidate_techniques.includes(technique)).map(uc => uc.name).join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Global Camera Mapping Standards: DORI, OODPCVS, Johnson's Criteria, DHS/NIJ & French Standards */}
              <div className="mt-6 pt-6 border-t border-border space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900">Multi-Standard Camera Mapping &amp; Resolution Frameworks</h3>
                  <span className="text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    IEC 62676-4:2025 · US Military · DHS/NIJ · French Code
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Unified cross-framework optical and thermal density benchmarks dimensioned to guarantee computer vision precision and courtroom-admissible forensic evidence:
                </p>

                {/* Comprehensive Standards Matrix */}
                <div className="overflow-x-auto border border-border rounded-lg shadow-2xs">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-border">
                      <tr>
                        <th className="p-3">Standard / Framework</th>
                        <th className="p-3">Authority &amp; Domain</th>
                        <th className="p-3">Metric Unit</th>
                        <th className="p-3">Key Resolution Tiers &amp; Thresholds</th>
                        <th className="p-3">Analytical &amp; Operational Goal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="p-3 font-bold text-slate-900">DORI</td>
                        <td className="p-3 text-slate-600">IEC EN 62676-4:2015 (Visible Light)</td>
                        <td className="p-3 font-mono font-semibold text-sky-700">Pixels / Metre (px/m)</td>
                        <td className="p-3 text-slate-700">Detect (25), Observe (62.5), Recognize (125), Identify (250 px/m)</td>
                        <td className="p-3 text-slate-600">Standard European security surveillance and human activity classification.</td>
                      </tr>
                      <tr className="bg-slate-50/70">
                        <td className="p-3 font-bold text-violet-800">OODPCVS (2025)</td>
                        <td className="p-3 text-slate-600">IEC 62676-4:2025 (Ultra-HD / AI)</td>
                        <td className="p-3 font-mono font-semibold text-violet-700">Pixels / Metre (px/m)</td>
                        <td className="p-3 text-slate-700">Overview (20), Outline (40), Discern (80), Perceive (125), Characterize (250), Validate (500), <strong className="text-violet-700">Scrutinize (1500 px/m)</strong></td>
                        <td className="p-3 text-slate-600">Designed for 4K/8K sensors. Scrutinize tier guarantees passport-grade 3D biometric facial recognition.</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-bold text-amber-800">Johnson's Criteria</td>
                        <td className="p-3 text-slate-600">US Military / NVESD (Thermal IR)</td>
                        <td className="p-3 font-mono font-semibold text-amber-700">Line Pairs (lp) on Target</td>
                        <td className="p-3 text-slate-700"><strong>Detection (1.0–1.5 lp)</strong>, <strong>Recognition (3.0–4.0 lp)</strong>, <strong>Identification (6.0–8.0 lp)</strong></td>
                        <td className="p-3 text-slate-600">Thermal security equivalent across target critical dimensions (human 1.8m, vehicle 2.3m).</td>
                      </tr>
                      <tr className="bg-slate-50/70">
                        <td className="p-3 font-bold text-sky-800">US DHS / NIJ</td>
                        <td className="p-3 text-slate-600">Dept of Homeland Security (Forensic Video)</td>
                        <td className="p-3 font-mono font-semibold text-sky-700">% Vertical Screen Height (% VSH)</td>
                        <td className="p-3 text-slate-700">General (5%), Classification (10%), <strong className="text-sky-700">Forensic Evidence ID (≥15% VSH)</strong>, High-Security (≥25% VSH)</td>
                        <td className="p-3 text-slate-600">Forensic court admissibility. A suspect's face must occupy ≥15% of vertical frame height for conviction.</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-bold text-slate-900">French Standards</td>
                        <td className="p-3 text-slate-600">Ministère de l'Intérieur / CNIL (France)</td>
                        <td className="p-3 font-mono font-semibold text-slate-700">Pixels / Metre (px/m)</td>
                        <td className="p-3 text-slate-700">Surveillance (30), Reconnaissance (150), <strong className="text-slate-800">Identification Stricte (300)</strong>, Contrôle d'Accès (800 px/m)</td>
                        <td className="p-3 text-slate-600">Strict French municipal surveillance regulation integrated into JVSG CCTV design tools.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Mathematical Formulations Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 bg-slate-50 border border-border rounded-lg">
                    <span className="font-bold text-primary block mb-1">1. Optical Pixel Density (PPM) Formula</span>
                    <code className="block bg-white p-2 rounded border border-border text-sky-800 font-mono mb-1.5">
                      PPM(D) = Resolution_W / [ 2 · D · tan(HFOV / 2) ]
                    </code>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      Calculates optical density at distance D on ground target plane (1.5m AFF). Ensures pixel density matches the assigned deep learning model input requirements.
                    </p>
                  </div>

                  <div className="p-3.5 bg-slate-50 border border-border rounded-lg">
                    <span className="font-bold text-primary block mb-1">2. Thermal Johnson's Criteria Line-Pair Formula</span>
                    <code className="block bg-white p-2 rounded border border-border text-sky-800 font-mono mb-1.5">
                      N_lp = [ PPM(D) · H_target ] / 2 = [ Res_W · H_target ] / [ 4 · D · tan(HFOV/2) ]
                    </code>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      Measures line pairs resolved across a target object dimension (human 1.8m, vehicle 2.3m). Identification requires 6–8 lp; Recognition requires 3–4 lp; Detection requires 1–1.5 lp.
                    </p>
                  </div>

                  <div className="p-3.5 bg-slate-50 border border-border rounded-lg">
                    <span className="font-bold text-primary block mb-1">3. US DHS / NIJ % Vertical Screen Height</span>
                    <code className="block bg-white p-2 rounded border border-border text-sky-800 font-mono mb-1.5">
                      VSH_% = [ H_target / (2 · D · tan(VFOV / 2)) ] × 100%
                    </code>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      Maps camera distance based on vertical frame percentage. For court-admissible forensic evidence under NIJ standards, the target face must occupy at least 15% of the total vertical screen height.
                    </p>
                  </div>

                  <div className="p-3.5 bg-slate-50 border border-border rounded-lg">
                    <span className="font-bold text-primary block mb-1">4. 3D Bird Camera View &amp; Ray-Box Occlusion</span>
                    <code className="block bg-white p-2 rounded border border-border text-sky-800 font-mono mb-1.5">
                      D_blind = (Mount_Z - Target_Z) / tan(θ_tilt + VFOV / 2)
                    </code>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      Top-down 3D bird's-eye projection with 3D ray-box slab intersection testing against physical obstacles. Eliminates blind zone occlusions behind storage racks and structural columns via longitudinal aisle aiming.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Camera Inventory */}
          <section id="cameras" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Camera plan')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <CameraIcon className="w-6 h-6 text-primary" />
              Camera Inventory & Assignments
            </h2>
            {project.camera_recommendations?.length ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><h3 className="font-semibold text-emerald-900">Suggested camera details</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-900">{project.camera_recommendations.map((item, i) => <li key={i}>{item}</li>)}</ul><p className="mt-2 text-xs text-emerald-800">Preliminary recommendations; validate lens, mounting, lighting, and pixel density on site.</p></div> : null}
            <div className="space-y-4">
              {project.cameras.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No cameras configured. Use Camera Map to add cameras.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="pb-2 font-medium">Camera</th>
                          <th className="pb-2 font-medium">Status</th>
                          <th className="pb-2 font-medium">Position</th>
                          <th className="pb-2 font-medium">Orientation</th>
                          <th className="pb-2 font-medium">FOV / Range</th>
                          <th className="pb-2 font-medium">Resolution</th>
                          <th className="pb-2 font-medium">Assigned Use Cases</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.cameras.map(cam => (
                          <tr key={cam.id} className="border-b border-border/50">
                            <td className="py-3 font-medium">{cam.name}</td>
                            <td className="py-3">
                              <span className={`px-2 py-0.5 text-xs rounded ${getCameraStatusColor(cam.status)}`}>
                                {cam.status}
                              </span>
                            </td>
                            <td className="py-3 text-muted-foreground">({(cam.x * 100).toFixed(1)}%, {(cam.y * 100).toFixed(1)}%)</td>
                            <td className="py-3 text-muted-foreground">{cam.orientation_degrees}°</td>
                            <td className="py-3 text-muted-foreground">{cam.horizontal_fov_degrees}° / {(cam.view_range * 100).toFixed(0)}%</td>
                            <td className="py-3 text-muted-foreground">{cam.resolution_width}×{cam.resolution_height}</td>
                            <td className="py-3 text-muted-foreground">
                              {cam.assigned_use_case_ids.length > 0 
                                ? cam.assigned_use_case_ids.map(id => {
                                    const uc = project.use_cases.find(u => u.id === id);
                                    return uc ? uc.name : id.slice(0, 8);
                                  }).join(', ')
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Camera Detail Cards */}
                  <div className="space-y-3 mt-6">
                    {project.cameras.map(cam => (
                      <div key={cam.id} className="p-4 border border-border rounded-lg bg-gray-50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                              <CameraIcon className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <h4 className="font-medium">{cam.name}</h4>
                              <p className="text-sm text-muted-foreground">{cam.status} • {(cam.x * 100).toFixed(1)}%, {(cam.y * 100).toFixed(1)}% • {cam.orientation_degrees}°</p>
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground">{cam.resolution_width}×{cam.resolution_height}</span>
                        </div>
                        {cam.assigned_use_case_ids.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {cam.assigned_use_case_ids.map(id => {
                              const uc = project.use_cases.find(u => u.id === id);
                              return uc ? (
                                <span key={id} className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">{uc.name}</span>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 5A. Field Installation & Rigging Guide (For Camera Installation Team) */}
          <section id="installation-guide" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Camera plan')} className="p-8 border-b border-border bg-slate-50/40 print:bg-white print:break-inside-avoid">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h2 className="text-2xl font-bold flex items-center gap-2 text-slate-900">
                <Wrench className="w-6 h-6 text-amber-600" />
                5A. Camera Installation & Field Engineering Package
              </h2>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wide">
                For Field Rigging Crew & Electricians
              </span>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Comprehensive physical mounting coordinates, compass pan/tilt angles, dropper pole lengths, PoE cable run schedules, and field verification procedures.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              <div className="p-3.5 bg-white border border-border rounded-lg shadow-xs">
                <span className="text-xs text-muted-foreground font-medium block">Total Cameras to Rig</span>
                <span className="text-xl font-bold text-slate-900">{project.cameras.length} Units</span>
                <span className="text-[11px] text-slate-500 block mt-0.5">IP67/IK10 rated enclosures</span>
              </div>
              <div className="p-3.5 bg-white border border-border rounded-lg shadow-xs">
                <span className="text-xs text-muted-foreground font-medium block">Est. Cat6 Structured Cabling</span>
                <span className="text-xl font-bold text-slate-900">
                  ~{project.cameras.length > 0 ? Math.round(project.cameras.reduce((acc, c) => acc + (c.x * 60 + c.y * 25) * 1.25 + 15, 0)) : 0} m
                </span>
                <span className="text-[11px] text-slate-500 block mt-0.5">UTP/STP PoE+ certified runs</span>
              </div>
              <div className="p-3.5 bg-white border border-border rounded-lg shadow-xs">
                <span className="text-xs text-muted-foreground font-medium block">PoE Power Budget</span>
                <span className="text-xl font-bold text-slate-900">
                  {project.cameras.length * 15.4}W – {project.cameras.length * 30}W
                </span>
                <span className="text-[11px] text-slate-500 block mt-0.5">IEEE 802.3af/at standard</span>
              </div>
            </div>

            {project.cameras.length === 0 ? (
              <p className="text-muted-foreground text-center py-6">No cameras configured for installation schedule.</p>
            ) : (
              <div className="space-y-6">
                <div className="overflow-x-auto bg-white border border-border rounded-lg shadow-xs">
                  <table className="w-full text-xs text-left font-mono">
                    <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px] tracking-wider border-b border-border">
                      <tr>
                        <th className="p-3">Camera Tag</th>
                        <th className="p-3">Mount Type</th>
                        <th className="p-3">Coordinates (X, Y, Z)</th>
                        <th className="p-3">Pan / Tilt</th>
                        <th className="p-3">Rigging & Dropper</th>
                        <th className="p-3">Aiming Corridor</th>
                        <th className="p-3">PoE Port & Run</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {project.cameras.map((cam, idx) => {
                        const mount = cam.y < 0.1 ? 'wall-v' : (cam.y > 0.9 ? 'wall-h' : (cam.x < 0.1 || cam.x > 0.9 ? 'cross' : 'roof-tilt'));
                        const symbols: Record<string, string> = { 'wall-h': '■', 'wall-v': '▼', 'roof-nadir': '●', 'roof-tilt': '◆', 'corner': '▲', 'cross': '◀▶', 'pole360': '⊕' };
                        const estDistM = Math.round((cam.x * 60 + cam.y * 25) * 1.25 + 15);
                        return (
                          <tr key={cam.id} className="hover:bg-slate-50">
                            <td className="p-3 font-bold text-slate-900">
                              {cam.name}
                            </td>
                            <td className="p-3">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                                <span>{symbols[mount] || '●'}</span>
                                <span className="uppercase text-[10px]">{mount}</span>
                              </span>
                            </td>
                            <td className="p-3 text-slate-700">
                              X: {(cam.x * 60).toFixed(1)}m<br />
                              Y: {(cam.y * 25).toFixed(1)}m<br />
                              Z: 4.5m
                            </td>
                            <td className="p-3">
                              <span className="font-semibold text-primary">{cam.orientation_degrees}° Azimuth</span><br />
                              <span className="text-slate-500">25° Depression</span>
                            </td>
                            <td className="p-3 text-slate-700">
                              {mount.includes('roof') ? '1.2m threaded steel dropper pole' : 'Heavy-duty wall cantilever bracket'}<br />
                              <span className="text-amber-700 text-[10px]">Dead-zone: 1.2m beneath base</span>
                            </td>
                            <td className="p-3 text-slate-700">
                              {(cam as any).target_area || `Aisle / Sector ${idx + 1}`}<br />
                              <span className="text-slate-500 text-[10px]">Plane: 1.5m PPE Height</span>
                            </td>
                            <td className="p-3 text-slate-700">
                              Port #{idx + 1}<br />
                              <span className="text-slate-500 text-[10px]">~{estDistM}m Cat6 UTP</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 5-Point Technician Sign-Off Checklist */}
                <div className="p-4 bg-white border border-amber-200 rounded-lg shadow-xs">
                  <h4 className="font-bold text-sm text-slate-900 mb-2 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    Field Rigging & Commissioning Checklist (Sign-Off Required)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50">
                      <input type="checkbox" className="rounded text-primary accent-primary" />
                      <span>Physical mount torqued to structural I-beam / concrete wall</span>
                    </label>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50">
                      <input type="checkbox" className="rounded text-primary accent-primary" />
                      <span>IP67 weather gland sealed with conduit drip loop</span>
                    </label>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50">
                      <input type="checkbox" className="rounded text-primary accent-primary" />
                      <span>Cat6 TIA-568B terminated & certified with active PoE link</span>
                    </label>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50">
                      <input type="checkbox" className="rounded text-primary accent-primary" />
                      <span>Pan/tilt optical axis aligned to corridor aiming marker</span>
                    </label>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 sm:col-span-2">
                      <input type="checkbox" className="rounded text-primary accent-primary" />
                      <span>Varifocal lens calibrated & optical focus set screw locked</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 5B. Computer Vision & Software Developer Package */}
          <section id="developer-guide" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Camera plan')} className="p-8 border-b border-border bg-white print:break-inside-avoid">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h2 className="text-2xl font-bold flex items-center gap-2 text-slate-900">
                <Cpu className="w-6 h-6 text-indigo-600" />
                5B. Computer Vision & Software Developer Package
              </h2>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200 uppercase tracking-wide">
                For CV Engineers & Software Developers
              </span>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              RTSP stream URI schemas, deep learning inference models, IEC EN 62676-4 pixel density (PPM) guarantees, DeepStream pipeline architecture, and GPU VRAM sizing.
            </p>

            {project.cameras.length === 0 ? (
              <p className="text-muted-foreground text-center py-6">No cameras configured for software pipeline specifications.</p>
            ) : (
              <div className="space-y-6">
                <div className="overflow-x-auto border border-border rounded-lg shadow-xs">
                  <table className="w-full text-xs text-left font-mono">
                    <thead className="bg-indigo-50/60 text-slate-700 uppercase font-semibold text-[10px] tracking-wider border-b border-border">
                      <tr>
                        <th className="p-3">Camera Tag</th>
                        <th className="p-3">RTSP Stream URI Schema</th>
                        <th className="p-3">Stream Profile & Codec</th>
                        <th className="p-3">Target CV Model</th>
                        <th className="p-3">IEC PPM Guarantee</th>
                        <th className="p-3">Spatial ROI Trigger</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {project.cameras.map((cam, idx) => {
                        const assignedUseCases = cam.assigned_use_case_ids.map(id => project.use_cases.find(u => u.id === id)?.name).filter(Boolean);
                        let model = 'YOLOv8x (Detection)';
                        let targetPpm = '≥125 px/m (Recognize)';
                        const lower = (assignedUseCases.join(' ') || project.business_description || '').toLowerCase();
                        if (/face|identity|lpr|license|plate/i.test(lower)) {
                          model = 'ArcFace + YOLOv8-Face';
                          targetPpm = '≥250 px/m (Identify)';
                        } else if (/ppe|helmet|vest/i.test(lower)) {
                          model = 'YOLOv8x-pose (PPE Classifier)';
                          targetPpm = '≥125 px/m (Recognize)';
                        } else if (/forklift|vehicle|traffic|agv/i.test(lower)) {
                          model = 'ByteTrack + RT-DETR';
                          targetPpm = '≥62.5 px/m (Observe)';
                        }

                        return (
                          <tr key={cam.id} className="hover:bg-slate-50">
                            <td className="p-3 font-bold text-slate-900">
                              {cam.name}
                            </td>
                            <td className="p-3 text-indigo-700 font-medium">
                              rtsp://192.168.1.{101 + idx}:554/live/ch1/main
                            </td>
                            <td className="p-3 text-slate-700">
                              {cam.resolution_width}×{cam.resolution_height} @ 20 FPS<br />
                              <span className="text-slate-500 text-[10px]">H.264 Main / 4096 kbps CBR</span>
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold text-[10px]">
                                {model}
                              </span>
                            </td>
                            <td className="p-3 font-semibold text-emerald-700">
                              {targetPpm}
                            </td>
                            <td className="p-3 text-slate-600 text-[10px]">
                              Polygon: [({(cam.x - 0.05).toFixed(2)}, {(cam.y - 0.05).toFixed(2)}) … ({(cam.x + 0.15).toFixed(2)}, {(cam.y + 0.15).toFixed(2)})]
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* DeepStream Pipeline & GPU Sizing Architecture */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 bg-slate-900 text-slate-200 rounded-lg font-mono space-y-2">
                    <div className="flex items-center justify-between text-slate-400 text-[11px] pb-1 border-b border-slate-800">
                      <span className="text-emerald-400 font-bold">NVIDIA DeepStream Pipeline Graph</span>
                      <span>GStreamer 1.20+</span>
                    </div>
                    <pre className="text-[10px] leading-relaxed text-slate-300 overflow-x-auto">
{`[RTSP Sources: ${project.cameras.length} Streams]
       │
       ▼
nvurisrcbin (Hardware Accelerated Dec: NVDEC)
       │
       ▼
nvstreammux (Batch Size: ${Math.min(project.cameras.length, 16)}, 1080p, 25 FPS)
       │
       ▼
nvinfer: Primary GIE (YOLOv8 TensorRT FP16 Engine)
       │
       ▼
nvtracker: NvDCF / ByteTrack (Trajectory Association)
       │
       ▼
nvdsanalytics: Virtual ROI Triplines & Directional Cross
       │
       ▼
msgconv + msgbroker: MQTT / Kafka Event Publishing`}
                    </pre>
                  </div>

                  <div className="p-4 bg-slate-50 border border-border rounded-lg space-y-2">
                    <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-indigo-600" />
                      Edge Compute & VRAM Sizing Calculation
                    </h4>
                    <ul className="space-y-1.5 text-slate-700 text-xs">
                      <li>• <strong>Active Streams:</strong> {project.cameras.length} simultaneous IP RTSP streams.</li>
                      <li>• <strong>VRAM Footprint:</strong> ~120 MB per 1080p stream at FP16 batch inference $\to$ ~{(project.cameras.length * 0.12).toFixed(1)} GB VRAM.</li>
                      <li>• <strong>Recommended Hardware:</strong> {project.cameras.length <= 8 ? 'NVIDIA Jetson Orin Nano (8GB)' : (project.cameras.length <= 20 ? 'NVIDIA Jetson AGX Orin (32GB)' : 'NVIDIA L4 / A2 Enterprise Server')}.</li>
                      <li>• <strong>Network Bandwidth:</strong> ~{(project.cameras.length * 4.2).toFixed(1)} Mbps aggregate ingestion throughput.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Zones */}
          <section id="zones" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Detection coverage')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <MapPin className="w-6 h-6 text-primary" />
              Detection Zones & Virtual Lines
            </h2>
            <div className="space-y-4">
              {project.zones.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No zones or lines configured. Use Camera Map to add zones.</p>
              ) : (
                <div className="space-y-3">
                  {project.zones.map(zone => (
                    <div key={zone.id} className="p-4 border border-border rounded-lg flex items-center gap-4">
                      <div className="w-3 h-3 rounded" style={{ backgroundColor: zone.color }}></div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{zone.name}</h4>
                          <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded capitalize">{zone.type.replace('_', ' ')}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{zone.points.length} points • {zone.camera_ids.length} assigned cameras</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Workflow */}
          <section id="workflow" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Workflow')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <GitBranch className="w-6 h-6 text-primary" />
              Computer Vision Workflow
            </h2>
            <div className="space-y-4">
              {project.workflow.nodes.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No workflow generated yet. Use Workflow Editor to create one.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="pb-2 font-medium">Node</th>
                          <th className="pb-2 font-medium">Type</th>
                          <th className="pb-2 font-medium">Configuration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.workflow.nodes.map(node => (
                          <tr key={node.id} className="border-b border-border/50">
<td className="py-2">
                               <div className="flex items-center gap-2">
                                 <span style={{ color: getNodeCategoryInfo(node.type).color }}>{getNodeCategoryInfo(node.type).icon}</span>
                                 <span className="font-medium">{String(node.data.label || getNodeCategoryInfo(node.type).label)}</span>
                               </div>
                             </td>
                            <td className="py-2">
                              <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">{node.type.replace('_', ' ')}</span>
                            </td>
                            <td className="py-2 text-muted-foreground text-xs">
                              {Object.entries(node.data).filter(([k]) => !['label', 'category'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('; ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <p><strong>Connections:</strong> {project.workflow.edges.length} edges</p>
                    <p className="mt-1">The workflow represents a design-time artifact showing the proposed processing pipeline from camera input through detection, tracking, logic, and alerting.</p>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Assumptions */}
          {showAssumptions && project.assumptions.length > 0 && (
            <section id="assumptions" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Assumptions & open questions')} className="p-8 border-b border-border">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Info className="w-6 h-6 text-blue-600" />
                Technical Assumptions
              </h2>
              <ul className="space-y-2">
                {project.assumptions.map((assumption, i) => (
                  <li key={i} className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                    <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">{assumption}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Missing Information */}
          {showMissing && project.missing_information.length > 0 && (
            <section id="missing" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Assumptions & open questions')} className="p-8 border-b border-border">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
                Missing Information Required
              </h2>
              <ul className="space-y-2">
                {project.missing_information.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Feasibility Risks */}
          <section id="risks" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Assumptions & open questions')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Shield className="w-6 h-6 text-red-600" />
              Feasibility Risks & Mitigations
            </h2>
            <div className="space-y-4">
              {project.use_cases.filter(u => u.feasibility_status !== 'feasible').length === 0 ? (
                <div className="p-4 bg-green-50 rounded-lg flex items-center gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                  <span className="text-green-800">All use cases assessed as feasible. No major risks identified.</span>
                </div>
              ) : (
                project.use_cases.filter(u => u.feasibility_status !== 'feasible').map(uc => (
                  <div key={uc.id} className="p-4 border border-border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-medium">{uc.name}</h4>
                      <span className={`px-2 py-0.5 text-xs rounded ${getFeasibilityColor(uc.feasibility_status)}`}>
                        {uc.feasibility_status}
                      </span>
                    </div>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {uc.feasibility_notes.map((note, i) => (
                        <li key={i} className="flex items-start gap-1">
                          <span>•</span> {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Project-specific deployment planning */}
          <section id="hardware" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Hardware & critical components')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Wrench className="w-6 h-6 text-primary" />
              Deployment Details to Confirm
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <CameraIcon className="w-5 h-5" />
                  Camera Coverage
                </h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• {project.cameras.length} camera{project.cameras.length === 1 ? '' : 's'} currently mapped</li>
                  <li>• {project.zones.length} zone{project.zones.length === 1 ? '' : 's'} or virtual line{project.zones.length === 1 ? '' : 's'} currently defined</li>
                  <li>• Confirm each use case has a clear, unobstructed view</li>
                  <li>• Validate lens, lighting, mounting, and network conditions on site</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Cpu className="w-5 h-5" />
                  Integration Requirements
                </h3>
                {project.requirements.length ? (
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {project.requirements.map((requirement, i) => <li key={i}>• {requirement}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No integration requirements have been recorded for this project yet.</p>
                )}
              </div>
            </div>
          
            {project.available_hardware && <div className="mb-4 rounded-xl bg-muted p-4"><h3 className="font-semibold">Available hardware / input feeds</h3><p className="mt-1 text-sm text-muted-foreground">{project.available_hardware}</p></div>}
            {project.critical_components?.length ? <div className="mb-4 rounded-xl bg-muted p-4"><h3 className="font-semibold">Critical components</h3><ul className="mt-2 list-disc pl-5 text-sm">{project.critical_components.map((item, i) => <li key={i}>{item}</li>)}</ul></div> : null}</section>

          {/* Acceptance Criteria Summary */}
          <section id="acceptance" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Use cases')} className="p-8 border-b border-border">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <ListChecks className="w-6 h-6 text-primary" />
              Consolidated Acceptance Criteria
            </h2>
            <div className="space-y-3">
              {project.use_cases.flatMap(uc => uc.acceptance_criteria).filter((v, i, a) => a.indexOf(v) === i).map((criteria, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sm">{criteria}</span>
                </div>
              ))}
              {project.use_cases.flatMap(uc => uc.acceptance_criteria).length === 0 && (
                <p className="text-muted-foreground text-center py-8">No acceptance criteria defined yet.</p>
              )}
            </div>
          </section>

          {/* Project-specific next steps */}
          <section id="roadmap" data-output-enabled={!project.output_scope?.length || project.output_scope.includes('Implementation roadmap')} className="p-8">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Clock className="w-6 h-6 text-primary" />
              Suggested Next Steps
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">These steps reflect the information currently saved in this project. No delivery dates have been estimated.</p>
            <div className="space-y-4">
              {[
                {
                  title: 'Complete project details',
                  items: project.missing_information.length ? project.missing_information.slice(0, 5) : project.requirements.length ? project.requirements.slice(0, 5) : ['Add requirements and site details so the plan can be tailored.'],
                },
                {
                  title: 'Review camera coverage',
                  items: project.use_cases.length ? project.use_cases.map(useCase => `${useCase.name}: confirm camera position and field of view.`) : ['Add use cases before planning camera coverage.'],
                },
                {
                  title: 'Define success checks',
                  items: project.use_cases.flatMap(useCase => useCase.acceptance_criteria.map(criteria => `${useCase.name}: ${criteria}`)).slice(0, 5).length
                    ? project.use_cases.flatMap(useCase => useCase.acceptance_criteria.map(criteria => `${useCase.name}: ${criteria}`)).slice(0, 5)
                    : ['Add measurable acceptance criteria for the use cases.'],
                },
                {
                  title: 'Validate before rollout',
                  items: ['Review assumptions with project stakeholders.', 'Test the workflow against representative camera footage.', 'Confirm privacy, retention, and integration requirements.'],
                },
              ].map(step => (
                <div key={step.title} className="rounded-r-lg border-l-4 border-primary bg-primary/5 p-4">
                  <h3 className="font-semibold text-foreground">{step.title}</h3>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {step.items.map((item, i) => <li key={i}>• {item}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Footer */}
          <div className="p-8 border-t border-border bg-gray-50 print:page-break-before-auto">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <p>TechHub Plan Vision — Computer Vision Planning</p>
              <p>Updated {formatDate(project.updated_at)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
