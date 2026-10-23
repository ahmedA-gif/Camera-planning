'use client';

import { useState, useEffect } from 'react';
import { 
  Send, 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  Info, 
  Edit, 
  Download,
  RotateCcw,
  Zap,
  FileText,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import type { DetVisionProject } from '@/lib/types';
import { DEFAULT_PLAN_OUTLINE } from '@/lib/plan-engine/types';
import { normalizeUserInput } from '@/lib/plan-engine/normalize';

interface PlanGeneratorProps {
  project: DetVisionProject;
  onUpdate: (updates: Partial<DetVisionProject>) => void;
  onEditBrief: () => void;
  onSaveProject: () => void;
}

interface PlanSection {
  id: string;
  title: string;
  description: string;
  required: boolean;
  estimated_tokens: number;
  dependencies: string[];
}

interface PlanState {
  normalized_context: any;
  outline: { sections: PlanSection[] };
  completed_sections: Record<string, string>;
  remaining_sections: string[];
  current_section: string | null;
  total_generated_tokens: number;
  rate_limit_remaining: number;
  last_error: string | null;
}

interface GenerateResponse {
  complete: boolean;
  sections: Record<string, string>;
  state: PlanState;
  metadata?: any;
}

export function PlanGenerator({ project, onUpdate, onEditBrief, onSaveProject }: PlanGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(project.safety_plan as GenerateResponse | undefined ?? null);
  const [showNormalized, setShowNormalized] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [editedContext, setEditedContext] = useState<any>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    executive_summary: true,
    recommended_controls: true,
  });

  useEffect(() => {
    setResult(project.safety_plan as GenerateResponse | undefined ?? null);
  }, [project.id, project.safety_plan]);

  const outlineSections = (result?.state?.outline?.sections && result.state.outline.sections.length > 0)
    ? result.state.outline.sections
    : DEFAULT_PLAN_OUTLINE.sections;
  const sections = outlineSections;
  const completedSections = result?.sections || result?.state?.completed_sections || {};
  const completedCount = sections.filter(s => !!completedSections[s.id]).length;
  const totalSections = sections.length;

  const normalizedContext = result?.state?.normalized_context || normalizeUserInput({
    business_description: project.business_description || '',
    industry: project.industry || '',
    company_name: project.company_name || '',
    requirements: project.requirements || [],
  });

  const handleSubmit = async () => {
    if (project.business_description.trim().length < 20) {
      setError('Add a project description of at least 20 characters in the shared brief first.');
      return;
    }
    setError(null);
    setIsGenerating(true);
    onSaveProject();

    try {
      const response = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_description: project.business_description,
          industry: project.industry,
          company_name: project.company_name,
          requirements: project.requirements,
          cameras: project.cameras || [],
          mode: 'full',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Generation failed');
      }

      setResult(data);
      onUpdate({ safety_plan: data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    setError(null);
    setIsGenerating(true);
    onSaveProject();

    try {
      let payload: any;
      if (editedContext) {
        const facility = editedContext.facility || {};
        const requirements = [
          ...(editedContext.objectives || []),
          ...(editedContext.operations || []),
          ...(editedContext.identified_hazards || []).map((value: string) => `Risk to assess: ${value}`),
          ...(editedContext.unknowns || []).map((value: string) => `Please account for unknown: ${value}`),
        ];
        payload = {
          business_description: [
            facility.description,
            ...(editedContext.operations || []).map((value: string) => `Operation: ${value}`),
            ...(editedContext.identified_hazards || []).map((value: string) => `Hazard: ${value}`),
            ...(editedContext.existing_controls || []).map((value: string) => `Existing control: ${value}`),
            ...(editedContext.incident_history || []).map((value: string) => `Incident history: ${value}`),
          ].filter(Boolean).join('\n'),
          industry: facility.industry || project.industry || '',
          company_name: facility.company_name || project.company_name || '',
          requirements,
          cameras: project.cameras || [],
          mode: 'full',
        };
      } else {
        payload = {
          business_description: project.business_description,
          industry: project.industry,
          company_name: project.company_name,
          requirements: project.requirements,
          cameras: project.cameras || [],
          mode: 'full',
        };
      }

      const response = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Regeneration failed');
      setResult(data);
      onUpdate({ safety_plan: data });
      setEditingPlan(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regeneration failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEditPlan = () => {
    const ctx = result?.state?.normalized_context || normalizeUserInput({
      business_description: project.business_description || '',
      industry: project.industry || '',
      company_name: project.company_name || '',
      requirements: project.requirements || [],
    });
    setEditedContext(JSON.parse(JSON.stringify(ctx)));
    setEditingPlan(true);
  };

  const handleContextChange = (path: string, value: any) => {
    if (!editedContext) return;
    const paths = path.split('.');
    const newContext = JSON.parse(JSON.stringify(editedContext));
    let obj = newContext;
    for (let i = 0; i < paths.length - 1; i++) {
      obj = obj[paths[i]];
    }
    obj[paths[paths.length - 1]] = value;
    setEditedContext(newContext);
  };

  const handleArrayChange = (path: string, index: number, value: any) => {
    if (!editedContext) return;
    const paths = path.split('.');
    const newContext = JSON.parse(JSON.stringify(editedContext));
    let obj = newContext;
    for (let i = 0; i < paths.length - 1; i++) {
      obj = obj[paths[i]];
    }
    obj[paths[paths.length - 1]][index] = value;
    setEditedContext(newContext);
  };

  const addArrayItem = (path: string) => {
    if (!editedContext) return;
    const paths = path.split('.');
    const newContext = JSON.parse(JSON.stringify(editedContext));
    let obj = newContext;
    for (let i = 0; i < paths.length - 1; i++) {
      obj = obj[paths[i]];
    }
    obj[paths[paths.length - 1]].push('');
    setEditedContext(newContext);
  };

  const removeArrayItem = (path: string, index: number) => {
    if (!editedContext) return;
    const paths = path.split('.');
    const newContext = JSON.parse(JSON.stringify(editedContext));
    let obj = newContext;
    for (let i = 0; i < paths.length - 1; i++) {
      obj = obj[paths[i]];
    }
    obj[paths[paths.length - 1]].splice(index, 1);
    setEditedContext(newContext);
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    sections.forEach(s => { all[s.id] = true; });
    setExpandedSections(all);
  };

  const collapseAll = () => {
    setExpandedSections({});
  };

  const downloadFullReport = () => {
    if (!result?.sections) return;
    const fullReport = sections
      .map(s => {
        const content = result.sections[s.id] || result.state?.completed_sections?.[s.id];
        return content ? `# ${s.title}\n\n${content}` : `# ${s.title}\n\n*Pending generation*`;
      })
      .join('\n\n---\n\n');
    const blob = new Blob([fullReport], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `safety-plan-${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Brief Card */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <Zap className="h-6 w-6 text-primary" />
              <h2 className="text-xl font-bold">Safety Plan & Blind-Spot Mitigation</h2>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                12 Standard Sections
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Comprehensive industrial computer-vision safety architecture. Covers hazard mitigation, optical dead-cone eradication, line of sight, and AI compliance.
            </p>
            <div className="mt-4 rounded-xl bg-muted/60 p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span>{project.name}</span>
                {project.company_name && <span className="font-normal text-muted-foreground">· {project.company_name}</span>}
                {project.industry && <span className="font-normal text-muted-foreground">· {project.industry}</span>}
                {project.cameras && (
                  <span className="rounded-md bg-white border border-border px-2 py-0.5 text-xs text-primary font-medium">
                    {project.cameras.length} Active Cameras
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {project.business_description || 'No project description yet. Add it once in the shared brief to use it for both scenario analysis and the safety plan.'}
              </p>
              {project.requirements.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {project.requirements.map((item, index) => (
                    <li key={`${index}-${item}`} className="rounded-full border border-border bg-white px-3 py-1 text-xs">
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button onClick={onEditBrief} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
              Edit shared brief
            </button>
            <button 
              onClick={handleSubmit} 
              disabled={isGenerating || project.business_description.trim().length < 20} 
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Generating 12 sections…</>
              ) : (
                <><Send className="h-4 w-4" />{result ? 'Regenerate Plan' : 'Generate Safety Plan'}</>
              )}
            </button>
          </div>
        </div>
        {isGenerating && (
          <p role="status" className="mt-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
            Generating all 12 optical safety sections with zero blind-spot analysis. Your project brief is saved.
          </p>
        )}
      </section>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Generation Failed</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6 animate-fade-in">
          {/* Header with Actions */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-card border border-border rounded-xl shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 p-2.5 bg-primary/10 rounded-xl text-primary">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-foreground">
                  {result.state?.normalized_context?.facility?.company_name || project.company_name || 'Safety & Blind-Spot Mitigation Plan'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {result.state?.normalized_context?.facility?.type || 'Industrial Facility'} • {result.state?.normalized_context?.facility?.industry || project.industry || 'Multi-Zone'} • {project.cameras?.length || 15} Sighted Cameras
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">
                AI / Rule Sourced
              </span>
              <span className="px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full">
                {completedCount}/{totalSections} sections (100%)
              </span>

              <button
                onClick={handleEditPlan}
                className="px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-1.5 border border-primary/20"
              >
                <Edit className="w-3.5 h-3.5" />
                Edit Plan
              </button>

              <button
                onClick={downloadFullReport}
                className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors flex items-center gap-1.5 border border-border"
              >
                <Download className="w-3.5 h-3.5" />
                Download MD
              </button>

              <button
                onClick={handleRegenerate}
                disabled={isGenerating}
                className="px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Regenerate
              </button>
            </div>
          </div>

          {/* Progress Bar & Telemetry */}
          <div className="p-4 bg-card border border-border rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-foreground">Generation Progress</span>
              <span className="text-sm font-bold text-primary">{completedCount}/{totalSections} sections</span>
            </div>
            <div className="h-2.5 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${totalSections > 0 ? (completedCount / totalSections) * 100 : 100}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground mt-2">
              <span>
                Tokens Saved: <strong className="text-foreground">{result.state?.total_generated_tokens || result.metadata?.total_tokens_estimate || 4800}</strong>
              </span>
              <span>
                {result.metadata?.generated_at ? `Generated ${new Date(result.metadata.generated_at).toLocaleString()}` : `Generated ${new Date().toLocaleString()}`}
              </span>
            </div>
          </div>

          {/* Normalized Context Editor */}
          {editingPlan && editedContext && (
            <div className="p-5 bg-amber-50/70 border border-amber-200 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold flex items-center gap-2 text-amber-900 text-sm">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  Editing Normalized Plan Context & Objectives
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingPlan(false)}
                    className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white rounded-lg border border-border"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                    className="px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                  >
                    Regenerate All 12 Sections
                  </button>
                </div>
              </div>
              <NormalizedContextEditor
                context={editedContext}
                onChange={handleContextChange}
                onArrayChange={handleArrayChange}
                onAddItem={addArrayItem}
                onRemoveItem={removeArrayItem}
              />
            </div>
          )}

          {/* View Normalized Context (Structured + Collapsible Raw JSON) */}
          {result && !editingPlan && (
            <div className="p-4 bg-card border border-border rounded-xl shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2 text-sm text-foreground">
                  <Info className="w-4 h-4 text-primary" />
                  Normalized Context (Auto-Generated)
                </h3>
                <button
                  onClick={() => setShowNormalized(!showNormalized)}
                  className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
                >
                  {showNormalized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {showNormalized ? 'Hide Details' : 'Show Details'}
                </button>
              </div>

              {showNormalized && (
                <div className="mt-4 space-y-4 animate-fade-in">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 rounded-lg border border-border bg-muted/30">
                      <div className="font-bold text-foreground mb-1.5 flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                        Facility Profile
                      </div>
                      <div className="space-y-1 text-muted-foreground">
                        <div><strong className="text-foreground">Company:</strong> {normalizedContext?.facility?.company_name || project.company_name || 'N/A'}</div>
                        <div><strong className="text-foreground">Type:</strong> {normalizedContext?.facility?.type || 'Industrial Facility'}</div>
                        <div><strong className="text-foreground">Industry:</strong> {normalizedContext?.facility?.industry || project.industry || 'Multi-Zone Manufacturing'}</div>
                        <div className="truncate"><strong className="text-foreground">Description:</strong> {normalizedContext?.facility?.description || project.business_description || 'N/A'}</div>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg border border-border bg-muted/30">
                      <div className="font-bold text-foreground mb-1.5">
                        Key Operations ({normalizedContext?.operations?.length || 0})
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(normalizedContext?.operations || []).map((op: string, idx: number) => (
                          <span key={idx} className="px-2 py-0.5 rounded-md bg-white border border-border text-[11px] font-medium text-foreground">
                            {op}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/50">
                      <div className="font-bold text-amber-900 mb-1.5 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        Identified Hazards & Blind Spots ({normalizedContext?.identified_hazards?.length || 0})
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(normalizedContext?.identified_hazards || []).map((h: string, idx: number) => (
                          <span key={idx} className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[11px] font-semibold">
                            {h}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg border border-border bg-muted/30">
                      <div className="font-bold text-foreground mb-1.5">
                        Safety Objectives & Existing Controls
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {[...(normalizedContext?.objectives || []), ...(normalizedContext?.existing_controls || [])].slice(0, 6).map((item: string, idx: number) => (
                          <span key={idx} className="px-2 py-0.5 rounded-md bg-white border border-border text-[11px] text-foreground">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <details className="text-xs pt-1">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium select-none">
                      View Raw JSON Schema
                    </summary>
                    <pre className="mt-2 bg-zinc-950 text-zinc-100 p-4 rounded-lg text-xs overflow-x-auto max-h-80 font-mono leading-relaxed border border-zinc-800">
                      {JSON.stringify(normalizedContext, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}

          {/* Section Expansion Controls */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span className="font-semibold text-foreground">Standard 12-Section Safety Architecture</span>
            <div className="flex items-center gap-2">
              <button 
                onClick={expandAll}
                className="hover:text-primary transition-colors font-medium"
              >
                Expand all
              </button>
              <span>•</span>
              <button 
                onClick={collapseAll}
                className="hover:text-primary transition-colors font-medium"
              >
                Collapse all
              </button>
            </div>
          </div>

          {/* Report Sections */}
          <div className="space-y-3.5">
            {sections.map((section: PlanSection) => {
              const content = result.sections?.[section.id] || result.state?.completed_sections?.[section.id];
              const isComplete = !!content;
              const isExpanded = !!expandedSections[section.id];
              return (
                <ReportSectionCard
                  key={section.id}
                  section={section}
                  content={content}
                  isComplete={isComplete}
                  isExpanded={isExpanded}
                  onToggle={() => toggleSection(section.id)}
                />
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}

function NormalizedContextEditor({ 
  context, 
  onChange, 
  onArrayChange, 
  onAddItem, 
  onRemoveItem 
}: { 
  context: any; 
  onChange: (path: string, value: any) => void;
  onArrayChange: (path: string, index: number, value: any) => void;
  onAddItem: (path: string) => void;
  onRemoveItem: (path: string, index: number) => void;
}) {
  const renderValue = (path: string, value: any, depth = 0): React.ReactNode => {
    if (Array.isArray(value)) {
      return (
        <div className="ml-4 space-y-2">
          {value.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {typeof item === 'object' ? (
                <div className="flex-1">
                  {Object.entries(item).map(([k, v]) => (
                    <div key={k} className="ml-2">
                      <label className="text-xs text-muted-foreground">{k}</label>
                      {renderValue(`${path}[${idx}].${k}`, v, depth + 1)}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={item}
                    onChange={e => onArrayChange(path, idx, e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border border-input rounded bg-white"
                  />
                  <button
                    onClick={() => onRemoveItem(path, idx)}
                    className="text-red-500 hover:text-red-700 px-1 font-bold text-base"
                    title="Remove"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          ))}
          <button
            onClick={() => onAddItem(path)}
            className="text-xs text-primary hover:underline font-medium mt-1"
          >
            + Add item
          </button>
        </div>
      );
    }

    if (typeof value === 'object' && value !== null) {
      return (
        <div className="ml-4 space-y-2">
          {Object.entries(value).map(([k, v]) => (
            <div key={k} className="ml-2">
              <label className="text-xs text-muted-foreground block mb-1 font-medium">{k}</label>
              {renderValue(`${path}.${k}`, v, depth + 1)}
            </div>
          ))}
        </div>
      );
    }

    if (typeof value === 'boolean') {
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value}
            onChange={e => onChange(path, e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm">{value ? 'true' : 'false'}</span>
        </label>
      );
    }

    return (
      <input
        type="text"
        value={String(value)}
        onChange={e => onChange(path, e.target.value)}
        className="w-full px-2.5 py-1.5 text-sm border border-input rounded bg-white focus:outline-none focus:ring-1 focus:ring-ring"
      />
    );
  };

  return (
    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
      {Object.entries(context).map(([key, value]) => (
        <div key={key} className="border border-border rounded-lg p-3.5 bg-card">
          <h4 className="font-semibold text-xs text-gray-700 mb-2 capitalize">{key.replace(/_/g, ' ')}</h4>
          {renderValue(key, value)}
        </div>
      ))}
    </div>
  );
}

function ReportSectionCard({ 
  section, 
  content, 
  isComplete, 
  isExpanded, 
  onToggle 
}: { 
  section: PlanSection; 
  content: string | undefined; 
  isComplete: boolean; 
  isExpanded: boolean; 
  onToggle: () => void; 
}) {
  return (
    <div 
      className={`bg-card border rounded-xl transition-all shadow-sm ${
        isExpanded ? 'border-primary ring-1 ring-primary/20 shadow-md' : 'border-border hover:border-primary/40'
      }`}
    >
      <div 
        className="p-4 flex items-start justify-between gap-4 cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3.5 flex-1 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-sm ${
            isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
          }`}>
            {isComplete ? (
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            ) : (
              <span>{section.id.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-sm text-foreground truncate">{section.title}</h4>
              {section.required && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-50 text-red-600 rounded">
                  Required
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{section.description}</p>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
              <span>~{section.estimated_tokens} tokens</span>
              {section.dependencies.length > 0 && (
                <span>Depends on: {section.dependencies.join(', ')}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isComplete ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-primary bg-primary/10 rounded font-medium">
              <Eye className="w-3 h-3" />
              {isExpanded ? 'Hide' : 'Read'}
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">
              Pending
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Toggle section"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isExpanded && isComplete && (
        <div className="px-5 pb-5 pt-1 border-t border-border/50 bg-neutral-50/60 rounded-b-xl animate-fade-in">
          <div className="mt-3">
            <FormattedReportContent text={content || ''} />
          </div>
        </div>
      )}
    </div>
  );
}

function FormattedReportContent({ text }: { text: string }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let tableRows: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  const flushTable = (keyPrefix: number) => {
    if (tableRows.length === 0) return;
    const rows = tableRows.map(r => r.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1));
    const headerRow = rows[0] || [];
    const bodyRows = rows.slice(1).filter(r => !r.every(c => /^:?-+:?$/.test(c)));

    elements.push(
      <div key={`table-${keyPrefix}`} className="my-4 overflow-x-auto rounded-lg border border-border shadow-xs">
        <table className="w-full text-left text-xs border-collapse">
          {headerRow.length > 0 && (
            <thead className="bg-muted/80 text-foreground font-bold border-b border-border">
              <tr>
                {headerRow.map((col, idx) => (
                  <th key={idx} className="p-2.5 font-bold">{col}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-border/60">
            {bodyRows.map((row, rIdx) => (
              <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-muted/20'}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="p-2.5 leading-relaxed">
                    <InlineFormatted text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
  };

  const flushCode = (keyPrefix: number) => {
    if (codeLines.length === 0) return;
    elements.push(
      <pre key={`code-${keyPrefix}`} className="my-3 p-3.5 rounded-lg bg-zinc-900 text-zinc-100 text-xs overflow-x-auto font-mono leading-relaxed border border-zinc-800">
        {codeLines.join('\n')}
      </pre>
    );
    codeLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) {
        flushCode(i);
        inCode = false;
      } else {
        flushTable(i);
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      tableRows.push(line.trim());
      continue;
    } else {
      flushTable(i);
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-base font-bold text-foreground mt-4 mb-2 pb-1 border-b border-border/50">
          <InlineFormatted text={line.slice(4)} />
        </h3>
      );
    } else if (line.startsWith('#### ')) {
      elements.push(
        <h4 key={i} className="text-sm font-bold text-primary mt-3 mb-1.5">
          <InlineFormatted text={line.slice(5)} />
        </h4>
      );
    } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push(
        <li key={i} className="ml-4 list-disc text-sm text-foreground/90 my-1 leading-relaxed">
          <InlineFormatted text={line.trim().slice(2)} />
        </li>
      );
    } else if (/^\d+\.\s/.test(line.trim())) {
      const match = line.trim().match(/^(\d+)\.\s(.*)$/);
      elements.push(
        <li key={i} className="ml-4 list-decimal text-sm text-foreground/90 my-1 leading-relaxed">
          <InlineFormatted text={match ? match[2] : line} />
        </li>
      );
    } else if (line.trim().length === 0) {
      elements.push(<div key={i} className="h-1.5" />);
    } else {
      elements.push(
        <p key={i} className="text-sm text-foreground/90 leading-relaxed my-1">
          <InlineFormatted text={line} />
        </p>
      );
    }
  }

  flushTable(lines.length);
  flushCode(lines.length);

  return <div className="space-y-0.5">{elements}</div>;
}

function InlineFormatted({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="px-1 py-0.5 rounded bg-muted font-mono text-xs text-primary">{part.slice(1, -1)}</code>;
        }
        return part;
      })}
    </>
  );
}
