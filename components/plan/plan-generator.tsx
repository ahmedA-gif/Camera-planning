'use client';

import { useState, useEffect } from 'react';
import { 
  Send, 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  Info, 
  Edit, 
  Save, 
  Download,
  RotateCcw,
  Eye,
  EyeOff,
  Zap,
  FileText,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import type { DetVisionProject } from '@/lib/types';

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
  const [activeSection, setActiveSection] = useState<string | null>(null);
  useEffect(() => {
    setResult(project.safety_plan as GenerateResponse | undefined ?? null);
  }, [project.id, project.safety_plan]);

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
    if (!editedContext) return;
    setError(null);
    setIsGenerating(true);
    onSaveProject();

    try {
      const facility = editedContext.facility || {};
      const requirements = [
        ...(editedContext.objectives || []),
        ...(editedContext.operations || []),
        ...(editedContext.identified_hazards || []).map((value: string) => `Risk to assess: ${value}`),
        ...(editedContext.unknowns || []).map((value: string) => `Please account for unknown: ${value}`),
      ];
      const response = await fetch('/api/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_description: [facility.description, ...(editedContext.operations || []).map((value: string) => `Operation: ${value}`), ...(editedContext.identified_hazards || []).map((value: string) => `Hazard: ${value}`), ...(editedContext.existing_controls || []).map((value: string) => `Existing control: ${value}`), ...(editedContext.incident_history || []).map((value: string) => `Incident history: ${value}`)].filter(Boolean).join('\n'),
          industry: facility.industry || '',
          company_name: facility.company_name || '',
          requirements,
          mode: 'full',
        }),
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
    if (result?.state) {
      setEditedContext(JSON.parse(JSON.stringify(result.state.normalized_context)));
      setEditingPlan(true);
    }
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
    setActiveSection(activeSection === sectionId ? null : sectionId);
  };

  const downloadFullReport = () => {
    if (!result?.sections) return;
    const fullReport = Object.entries(result.sections)
      .map(([id, content]) => `# ${id.replace(/_/g, ' ').toUpperCase()}\n\n${content}`)
      .join('\n\n---\n\n');
    const blob = new Blob([fullReport], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `safety-plan-${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sections = result?.state?.outline?.sections || [];
  const completedCount = Object.keys(result?.state?.completed_sections || {}).length;
  const totalSections = sections.length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <Zap className="h-6 w-6 text-primary" />
              <h2 className="text-xl font-bold">Safety Plan</h2>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Uses shared project brief</span>
            </div>
            <p className="text-sm text-muted-foreground">One AI request creates the complete plan. Scenario analysis, camera mapping, and this plan all belong to the same project.</p>
            <div className="mt-4 rounded-xl bg-muted/60 p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span>{project.name}</span>
                {project.company_name && <span className="font-normal text-muted-foreground">· {project.company_name}</span>}
                {project.industry && <span className="font-normal text-muted-foreground">· {project.industry}</span>}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{project.business_description || 'No project description yet. Add it once in the shared brief to use it for both scenario analysis and the safety plan.'}</p>
              {project.requirements.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">{project.requirements.map((item, index) => <li key={`${index}-${item}`} className="rounded-full border border-border bg-white px-3 py-1 text-xs">{item}</li>)}</ul>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button onClick={onEditBrief} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Edit shared brief</button>
            <button onClick={handleSubmit} disabled={isGenerating || project.business_description.trim().length < 20} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
              {isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating all sections…</> : <><Send className="h-4 w-4" />{result ? 'Regenerate plan' : 'Generate safety plan'}</>}
            </button>
          </div>
        </div>
        {isGenerating && <p role="status" className="mt-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">Generating the complete plan in one AI request. Your project brief is saved if the provider is busy.</p>}
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
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white border border-border rounded-xl">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">{result.state?.normalized_context?.facility?.company_name || 'Safety Plan'}</h3>
                <p className="text-sm text-muted-foreground">
                  {result.state?.normalized_context?.facility?.type} • {result.state?.normalized_context?.facility?.industry}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2 py-1 text-xs rounded bg-green-100 text-green-800">AI generated</span>
              <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                {Object.keys(result.sections).length}/{result.state?.outline?.sections?.length || 12} sections
              </span>

              <button
                onClick={handleEditPlan}
                className="px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded transition-colors flex items-center gap-1"
              >
                <Edit className="w-4 h-4" />
                Edit Plan
              </button>

              <button
                onClick={downloadFullReport}
                className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors flex items-center gap-1"
              >
                <Download className="w-4 h-4" />
                Download MD
              </button>

              <button
                onClick={handleSubmit}
                disabled={isGenerating}
                className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Regenerate
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="p-4 bg-white border border-border rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Generation Progress</span>
              <span className="text-sm text-muted-foreground">{completedCount}/{totalSections} sections</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${totalSections > 0 ? (completedCount / totalSections) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Provider-reported tokens: {result.state?.total_generated_tokens ?? 0}
              {result.metadata?.generated_at && <> · Generated {new Date(result.metadata.generated_at).toLocaleString()}</>}
            </p>
          </div>

          {/* Normalized Context Editor */}
          {editingPlan && editedContext && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  Editing Normalized Plan Context
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingPlan(false)}
                    className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                    className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90"
                  >
                    Regenerate Full Report
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

          {/* View Normalized Context */}
          {result && !editingPlan && (
            <div className="p-4 bg-white border border-border rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Info className="w-5 h-5" />
                  Normalized Context (Auto-Generated)
                </h3>
                <button
                  onClick={() => setShowNormalized(!showNormalized)}
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  {showNormalized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {showNormalized ? 'Hide' : 'Show'}
                </button>
              </div>
              {showNormalized && (
                <pre className="bg-muted p-4 rounded text-xs overflow-x-auto max-h-96">
                  {JSON.stringify(result.state.normalized_context, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Report Sections */}
          <div className="space-y-4">
            {sections
              .map((section: any) => {
                const content = result.sections[section.id];
                const isComplete = !!content;
                return (
                  <ReportSectionCard
                    key={section.id}
                    section={section}
                    content={content}
                    isComplete={isComplete}
                    isActive={activeSection === section.id}
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
                    className="flex-1 px-2 py-1 text-sm border border-input rounded"
                  />
                  <button
                    onClick={() => onRemoveItem(path, idx)}
                    className="text-red-500 hover:text-red-700"
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
            className="text-sm text-primary hover:underline mt-1"
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
              <label className="text-xs text-muted-foreground block mb-1">{k}</label>
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
        className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
      />
    );
  }

  return (
    <div className="space-y-4 max-h-96 overflow-y-auto">
      {Object.entries(context).map(([key, value]) => (
        <div key={key} className="border border-border rounded-lg p-4 bg-white">
          <h4 className="font-medium text-sm text-gray-700 mb-3 capitalize">{key.replace(/_/g, ' ')}</h4>
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
  isActive, 
  onToggle 
}: { 
  section: any; 
  content: string | undefined; 
  isComplete: boolean; 
  isActive: boolean; 
  onToggle: () => void; 
}) {
  return (
    <div 
      className={`p-4 bg-white border border-border rounded-xl transition-all ${
        isActive ? 'border-primary shadow-md' : 'hover:border-primary/50'
      }`}
      onClick={onToggle}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
            isComplete ? 'bg-green-100 text-green-600' : 'bg-muted text-muted-foreground'
          }`}>
            {isComplete ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <span className="text-xs font-medium">{section.id.charAt(0)}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium truncate">{section.title}</h4>
              {section.required && (
                <span className="px-1.5 py-0.5 text-xs bg-red-50 text-red-600 rounded">Required</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 truncate">{section.description}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span>~{section.estimated_tokens} tokens</span>
              {section.dependencies.length > 0 && (
                <span>Depends on: {section.dependencies.join(', ')}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isComplete && (
            <button className="px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded">
              <Eye className="w-3 h-3" />
              View
            </button>
          )}
          {!isComplete && (
            <span className="px-2 py-1 text-xs bg-muted text-muted-foreground rounded">
              Pending
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            {isActive ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isActive && isComplete && (
        <div className="mt-4 p-4 bg-muted/30 rounded-lg border border-border/50 animate-fade-in">
          <div className="prose prose-sm max-w-none text-sm">
            {content?.split('\n').map((line, i) => (
              <p key={i} className="whitespace-pre-wrap">{line}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
