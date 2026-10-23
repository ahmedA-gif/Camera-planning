'use client';

import { useState } from 'react';
import { Send, Loader2, AlertCircle, CheckCircle, Info, Brain, Camera, ImagePlus, X, Sparkles } from 'lucide-react';
import type { AnalysisResponse } from '@/lib/types';
import { ensureMultiBuildingFleet } from '@/lib/rule-based-planner';

function asStringList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim()) return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  return fallback;
}

interface ScenarioFormProps {
  onAnalysisComplete?: (response: AnalysisResponse) => void;
  onBriefChange?: (brief: { business_description: string; industry: string; company_name: string; requirements: string[]; facility_image?: string; facility_image_name?: string; image_observation?: string; camera_specifications?: string; available_hardware?: string; critical_components?: string[]; layout_section_count?: number; layout_sections?: string[]; detection_coverage_target?: number; output_scope?: string[] }) => void;
  onGenerateAllInOne?: () => void;
  isGeneratingAllInOne?: boolean;
  initialData?: {
    business_description: string;
    industry: string;
    company_name: string;
    requirements: string[];
    facility_image?: string; facility_image_name?: string; image_observation?: string; camera_specifications?: string; available_hardware?: string; critical_components?: string[]; layout_section_count?: number; layout_sections?: string[]; detection_coverage_target?: number; output_scope?: string[];
  };
}

export function ScenarioForm({ 
  onAnalysisComplete, 
  onBriefChange, 
  onGenerateAllInOne,
  isGeneratingAllInOne = false,
  initialData 
}: ScenarioFormProps) {
  const [formData, setFormData] = useState({
    business_description: initialData?.business_description || '',
    industry: initialData?.industry || '',
    company_name: initialData?.company_name || '',
    requirements: asStringList(initialData?.requirements).join('\n'),
    facility_image: initialData?.facility_image || '', facility_image_name: initialData?.facility_image_name || '',
    image_observation: initialData?.image_observation || '', camera_specifications: initialData?.camera_specifications || '',
    available_hardware: initialData?.available_hardware || '', critical_components: asStringList(initialData?.critical_components).join('\n'),
    layout_section_count: initialData?.layout_section_count || 1, detection_coverage_target: initialData?.detection_coverage_target || 90,
    layout_sections: asStringList(initialData?.layout_sections, ['Section 1']).join('\n'),
    output_scope: asStringList(initialData?.output_scope, ['Executive summary', 'Camera plan', 'Detection coverage', 'Hardware & critical components', 'Workflow']),
    use_ai: true,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const requirements = formData.requirements
        .split('\n')
        .map(r => r.trim())
        .filter(r => r.length > 0);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_description: formData.business_description,
          industry: formData.industry,
          company_name: formData.company_name,
          requirements,
          use_ai: formData.use_ai,
          camera_specifications: formData.camera_specifications,
          available_hardware: formData.available_hardware,
          critical_components: formData.critical_components.split('\n').map(item => item.trim()).filter(Boolean),
          layout_section_count: Number(formData.layout_section_count),
          layout_sections: formData.layout_sections.split('\n').map(item => item.trim()).filter(Boolean),
          detection_coverage_target: Number(formData.detection_coverage_target),
          output_scope: formData.output_scope,
          image_observation: formData.image_observation,
        }),
      });

      const responseText = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(responseText);
      } catch {
        // Safe fallback if server sent HTML/text error
      }

      if (!response.ok) {
        const errorMsg = data?.error || (responseText.includes('<') ? `Server error (${response.status}). Please try again or create a draft.` : responseText.slice(0, 200)) || 'Analysis failed';
        throw new Error(errorMsg);
      }

      if (!data || !data.project) {
        throw new Error('Analysis response was malformed. Please try again.');
      }

      const analysisData: AnalysisResponse = data;
      const fleet = ensureMultiBuildingFleet(analysisData.project);
      const guaranteedProject = {
        ...analysisData.project,
        cameras: fleet.cameras,
        buildings: fleet.buildings,
        structure: fleet.structure,
      };
      const analysisDataGuaranteed: AnalysisResponse = {
        ...analysisData,
        project: guaranteedProject,
      };

      setResult(analysisDataGuaranteed);
      onAnalysisComplete?.(analysisDataGuaranteed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    const next = { ...formData, [field]: value };
    setFormData(next);
    onBriefChange?.({
      business_description: next.business_description,
      industry: next.industry,
      company_name: next.company_name,
      requirements: next.requirements.split('\n').map(item => item.trim()).filter(Boolean),
      facility_image: next.facility_image, facility_image_name: next.facility_image_name, image_observation: next.image_observation,
      camera_specifications: next.camera_specifications, available_hardware: next.available_hardware,
      critical_components: next.critical_components.split('\n').map(item => item.trim()).filter(Boolean),
      layout_section_count: Number(next.layout_section_count), detection_coverage_target: Number(next.detection_coverage_target), output_scope: next.output_scope,
      layout_sections: next.layout_sections.split('\n').map(item => item.trim()).filter(Boolean),
    });
  };

  const handleImage = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const name = file.name.replace(/[_-]+/g, ' ').replace(/\.[^.]+$/, '');
      const label = /factory|plant|manufactur/i.test(name) ? 'Factory / production floor image' : /warehouse|store|stock/i.test(name) ? 'Warehouse / storage area image' : /camera|cctv|lens/i.test(name) ? 'Camera or equipment image' : /machine|robot|conveyor/i.test(name) ? 'Industrial equipment image' : 'Facility or object image';
      const source = new Image();
      source.onload = async () => {
        const scale = Math.min(1, 1400 / Math.max(source.naturalWidth, source.naturalHeight));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
        canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg', 0.8);
        const fallback = `${label}. Confirm the room, objects of interest, and viewing conditions before finalizing camera placement.`;
        const next = { ...formData, facility_image: image, facility_image_name: file.name, image_observation: fallback };
        setFormData(next);
        onBriefChange?.({ ...next, requirements: next.requirements.split('\n').map(v => v.trim()).filter(Boolean), critical_components: next.critical_components.split('\n').map(v => v.trim()).filter(Boolean), layout_sections: next.layout_sections.split('\n').map(v => v.trim()).filter(Boolean) });
        try {
          const response = await fetch('/api/analyze-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, filename: file.name }) });
          if (!response.ok) return;
          const suggestion = await response.json();
          if (typeof suggestion.observation !== 'string' || !suggestion.observation.trim()) return;
          setFormData(prev => ({ ...prev, image_observation: suggestion.observation }));
          onBriefChange?.({ ...next, image_observation: suggestion.observation, requirements: next.requirements.split('\n').map(v => v.trim()).filter(Boolean), critical_components: next.critical_components.split('\n').map(v => v.trim()).filter(Boolean), layout_sections: next.layout_sections.split('\n').map(v => v.trim()).filter(Boolean) });
        } catch { /* The editable filename-based scene hint remains available without AI credentials. */ }
      };
      source.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Input Form */}
      <form onSubmit={handleSubmit} className="scenario-form space-y-4">
        <div className="scenario-form__panel rounded-xl border border-primary/15 bg-primary/5 p-4">
          <h2 className="font-semibold">Shared project brief</h2>
          <p className="mt-1 text-sm text-muted-foreground">Edit this once. Scenario analysis and the Safety Plan Generator use the same project description and requirements.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Business Description <span className="text-destructive">*</span></label>
          <textarea
            value={formData.business_description}
            onChange={e => handleChange('business_description', e.target.value)}
            rows={5}
            className="w-full px-3 py-2 border border-input rounded focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Describe the site, what the cameras should observe, and what the system should do with that information."
            required
          />
          <p className="text-xs text-muted-foreground mt-1">Be specific about the environment, objects of interest, and desired outcomes.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Company Name</label>
            <input
              type="text"
              value={formData.company_name}
              onChange={e => handleChange('company_name', e.target.value)}
              className="w-full px-3 py-2 border border-input rounded focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Company name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Industry</label>
            <input
              type="text"
              value={formData.industry}
              onChange={e => handleChange('industry', e.target.value)}
              className="w-full px-3 py-2 border border-input rounded focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Industry"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Requirements (one per line)</label>
          <textarea
            value={formData.requirements}
            onChange={e => handleChange('requirements', e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-input rounded focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Add one goal or requirement per line"
          />
        </div>

        <section className="scenario-form__panel panel p-5 sm:p-6 space-y-5 bg-card border-border shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              <h3 className="font-bold text-sm text-foreground">Site & Optical Planning Telemetry</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Provide site geometry, camera requirements, compute hardware, and coverage targets for the optical solver.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 rounded-xl border border-dashed border-border bg-surface/50 p-4">
              <label className="flex cursor-pointer items-center gap-3">
                <ImagePlus className="h-5 w-5 text-primary"/>
                <span>
                  <b className="block text-xs font-bold text-foreground">Upload site floorplan or equipment image</b>
                  <span className="text-[11px] text-muted-foreground">AI automatically analyzes architectural sectors, obstacles, and sightlines.</span>
                </span>
                <input type="file" accept="image/*" className="sr-only" onChange={e => handleImage(e.target.files?.[0])}/>
              </label>
              {formData.facility_image && (
                <div className="mt-3 flex items-start gap-3">
                  <img src={formData.facility_image} alt="Uploaded planning reference" className="h-24 w-36 rounded-lg border border-border object-cover"/>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground">{formData.facility_image_name}</p>
                    <p className="text-xs text-primary mt-0.5">{formData.image_observation}</p>
                    <button 
                      type="button" 
                      onClick={() => { 
                        const next = { ...formData, facility_image: '', facility_image_name: '', image_observation: '' }; 
                        setFormData(next); 
                        onBriefChange?.({ ...next, requirements: next.requirements.split('\n').filter(Boolean), critical_components: next.critical_components.split('\n').filter(Boolean), layout_sections: next.layout_sections.split('\n').map(v => v.trim()).filter(Boolean) }); 
                      }} 
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-rose-500 hover:text-rose-600"
                    >
                      <X className="h-3 w-3"/>Remove image
                    </button>
                  </div>
                </div>
              )}
              <textarea 
                aria-label="Describe uploaded image" 
                value={formData.image_observation} 
                onChange={e => handleChange('image_observation', e.target.value)} 
                rows={2} 
                placeholder="What is shown? e.g. packaging line, forklift aisle, perimeter gate" 
                className="mt-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </div>

            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Camera specifications
              <textarea 
                value={formData.camera_specifications} 
                onChange={e => handleChange('camera_specifications', e.target.value)} 
                rows={3} 
                placeholder="Resolution, lens/FOV, frame rate, low-light or IP rating" 
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground font-normal focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Available hardware / input feeds
              <textarea 
                value={formData.available_hardware} 
                onChange={e => handleChange('available_hardware', e.target.value)} 
                rows={3} 
                placeholder="Existing cameras, NVR/VMS, edge GPU, network, PLC or sensors" 
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground font-normal focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Critical components (one per line)
              <textarea 
                value={formData.critical_components} 
                onChange={e => handleChange('critical_components', e.target.value)} 
                rows={3} 
                placeholder="Conveyor belt&#10;Safety gate&#10;Emergency stop" 
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground font-normal focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Describe each layout section
              <textarea 
                value={formData.layout_sections} 
                onChange={e => handleChange('layout_sections', e.target.value)} 
                rows={3} 
                placeholder="Section 1 · Receiving&#10;Section 2 · Production&#10;Section 3 · Packing" 
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground font-normal focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Layout sections
                <input 
                  type="number" 
                  min={1} 
                  max={50} 
                  value={formData.layout_section_count} 
                  onChange={e => setFormData(prev => ({ ...prev, layout_section_count: Number(e.target.value) }))} 
                  onBlur={() => onBriefChange?.({ ...formData, requirements: formData.requirements.split('\n').filter(Boolean), critical_components: formData.critical_components.split('\n').filter(Boolean), layout_sections: formData.layout_sections.split('\n').map(v => v.trim()).filter(Boolean), layout_section_count: Number(formData.layout_section_count) })} 
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Coverage target %
                <input 
                  type="number" 
                  min={1} 
                  max={100} 
                  value={formData.detection_coverage_target} 
                  onChange={e => setFormData(prev => ({ ...prev, detection_coverage_target: Number(e.target.value) }))} 
                  onBlur={() => onBriefChange?.({ ...formData, requirements: formData.requirements.split('\n').filter(Boolean), critical_components: formData.critical_components.split('\n').filter(Boolean), layout_sections: formData.layout_sections.split('\n').map(v => v.trim()).filter(Boolean), detection_coverage_target: Number(formData.detection_coverage_target) })} 
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
              </label>
            </div>
          </div>

          <div className="block">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Planned Blueprint Sections
            </p>
            <div className="flex flex-wrap gap-1.5">
              {['Executive summary', 'Use cases', 'Camera plan', 'Detection coverage', 'Hardware & critical components', 'Workflow', 'Assumptions & open questions', 'Implementation roadmap'].map(item => (
                <label 
                  key={item} 
                  className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-all font-medium ${
                    formData.output_scope.includes(item)
                      ? 'border-primary/40 bg-primary/10 text-primary font-semibold' 
                      : 'border-border bg-surface text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <input 
                    type="checkbox" 
                    className="sr-only" 
                    checked={formData.output_scope.includes(item)} 
                    onChange={e => {
                      if (!e.target.checked && formData.output_scope.length === 1) return;
                      const output_scope = e.target.checked ? [...formData.output_scope, item] : formData.output_scope.filter(v => v !== item);
                      setFormData(prev => ({ ...prev, output_scope }));
                      onBriefChange?.({ ...formData, output_scope, requirements: formData.requirements.split('\n').filter(Boolean), critical_components: formData.critical_components.split('\n').filter(Boolean), layout_sections: formData.layout_sections.split('\n').map(v => v.trim()).filter(Boolean) });
                    }}
                  />
                  {item}
                </label>
              ))}
            </div>
          </div>
        </section>

        <div className="flex items-center gap-2 p-3 bg-surface border border-border/60 rounded-lg">
          <input
            type="checkbox"
            id="use-ai"
            checked={formData.use_ai}
            onChange={e => setFormData(prev => ({ ...prev, use_ai: e.target.checked }))}
            className="w-4 h-4 accent-primary"
          />
          <label htmlFor="use-ai" className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer">
            <Brain className="w-4 h-4 text-primary" />
            <span>Use NVIDIA & Spatial AI Geometry Engine</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isLoading || isGeneratingAllInOne || !formData.business_description.trim()}
            className="w-full sm:w-auto px-5 py-2.5 bg-surface border border-border hover:bg-card text-foreground rounded-lg font-semibold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-2xs"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>Analyzing Brief…</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4 text-primary" />
                <span>{formData.use_ai ? 'Run AI Analysis' : 'Save Brief Draft'}</span>
              </>
            )}
          </button>

          {onGenerateAllInOne && (
            <button
              type="button"
              onClick={onGenerateAllInOne}
              disabled={isLoading || isGeneratingAllInOne || !formData.business_description.trim()}
              className="w-full sm:w-auto px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-bold text-xs hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
              title="Automatically analyze requirements, design 3D telemetry, solve camera placements, and generate safety plan"
            >
              {isGeneratingAllInOne ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Designing Fleet & Blueprint…</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 fill-current text-white animate-pulse" />
                  <span>AI All-In-One Design</span>
                </>
              )}
            </button>
          )}
        </div>
      </form>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Analysis Failed</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Results Display */}
      {result && (
        <div className="space-y-4 animate-fade-in">
          {result.project.camera_recommendations?.length ? <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4"><h3 className="flex items-center gap-2 font-semibold text-emerald-900"><Camera className="h-4 w-4"/>Camera &amp; Hardware Specifications</h3><ul className="mt-2 space-y-1 text-sm text-emerald-900">{result.project.camera_recommendations.map((item, index) => <li key={index}>• {item}</li>)}</ul><p className="mt-2 text-xs text-emerald-800">Recommendations are preliminary; validate lens, mounting, lighting, and pixel density on site.</p></section> : null}
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="font-medium">{result.model_used === 'Project draft' ? 'Your draft is ready' : 'AI analysis complete'}</span>
            <span className="ml-2 px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800 rounded font-medium">
              {result.model_used === 'Project draft' ? 'Built from your requirements' : 'NVIDIA AI Engine'}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Use Cases */}
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Suggested use cases ({result.project.use_cases?.length || 0})</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {result.project.use_cases?.map(uc => (
                  <div key={uc.id} className="p-3 border border-border rounded-lg bg-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{uc.name}</div>
                        <p className="text-sm text-muted-foreground mt-1">{uc.description}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">{uc.task_type}</span>
                          <span className={`px-2 py-0.5 text-xs rounded capitalize ${uc.feasibility_status === 'feasible' ? 'bg-green-100 text-green-800' : uc.feasibility_status === 'conditional' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{uc.feasibility_status.replace('_', ' ')}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      <strong>Techniques:</strong> {uc.candidate_techniques.slice(0, 3).join(', ')}
                      {uc.candidate_techniques.length > 3 && <span> +{uc.candidate_techniques.length - 3} more</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Assumptions & Missing Info */}
            {/* Assumptions & Missing Info */}
            <div className="space-y-4">
              {result.project.assumptions && result.project.assumptions.length > 0 ? (
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Info className="w-5 h-5 text-blue-600" />
                    Assumptions ({result.project.assumptions.length})
                  </h3>
                  <ul className="space-y-1">
                    {result.project.assumptions.map((a, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.project.missing_information && result.project.missing_information.length > 0 ? (
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                    Missing Information ({result.project.missing_information.length})
                  </h3>
                  <ul className="space-y-1">
                    {result.project.missing_information.map((m, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-amber-600 mt-0.5">•</span>
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.project.requirements && result.project.requirements.length > 0 ? (
                <div>
                  <h3 className="font-semibold text-lg">Requirements ({result.project.requirements.length})</h3>
                  <ul className="space-y-1">
                    {result.project.requirements.map((r, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          {/* Cameras Preview */}
          {result.project.cameras && result.project.cameras.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Camera className="w-5 h-5 text-primary" />
                  Configured Camera Fleet ({result.project.cameras.length} Units)
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    const currentCams = (result.project.cameras && result.project.cameras.length > 0)
                      ? result.project.cameras
                      : ensureMultiBuildingFleet(result.project).cameras;
                    const newId = crypto.randomUUID();
                    const newNum = currentCams.length + 1;
                    const rawUcs = (result.project.use_cases || []).map(u => ({ ...u, camera_ids: [...u.camera_ids] }));
                    const assignedUc = rawUcs.length > 0 ? rawUcs[currentCams.length % rawUcs.length] : null;
                    if (assignedUc && !assignedUc.camera_ids.includes(newId)) {
                      assignedUc.camera_ids.push(newId);
                    }
                    const newCam = {
                      id: newId,
                      name: `CAM-${String(newNum).padStart(2, '0')}: Additional Area Monitor #${newNum}`,
                      status: 'active' as const,
                      x: 0.50,
                      y: 0.50,
                      orientation_degrees: 0,
                      horizontal_fov_degrees: 106,
                      view_range: 0.45,
                      resolution_width: 2688,
                      resolution_height: 1520,
                      assigned_use_case_ids: assignedUc ? [assignedUc.id] : [],
                    };
                    const updatedCams = [...currentCams, newCam];
                    const updated = {
                      ...result.project,
                      cameras: updatedCams,
                      use_cases: rawUcs,
                    };
                    const newResponse = { ...result, project: updated };
                    setResult(newResponse);
                    onAnalysisComplete?.(newResponse);
                  }}
                  className="px-3 py-1 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
                >
                  + Increase Cameras
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {result.project.cameras.map(cam => (
                  <div key={cam.id} className="p-3 border border-border rounded-lg bg-card shadow-xs">
                    <div className="font-medium text-foreground">{cam.name}</div>
                    <div className="text-sm text-muted-foreground mt-1 font-mono text-xs">
                      FOV: {cam.horizontal_fov_degrees}° • Range: {(cam.view_range * 100).toFixed(0)}% • {cam.resolution_width}x{cam.resolution_height}
                    </div>
                    <div className="text-xs font-semibold text-emerald-700 mt-1 capitalize">{cam.status}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Zones Preview */}
          {result.project.zones && result.project.zones.length > 0 ? (
            <div>
              <h3 className="font-semibold text-lg mb-2">Suggested Zones ({result.project.zones.length})</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {result.project.zones.map(zone => (
                  <div key={zone.id} className="p-3 border border-border rounded-lg bg-card flex items-center gap-3">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: zone.color }}></div>
                    <div>
                      <div className="font-medium">{zone.name}</div>
                      <div className="text-sm text-muted-foreground capitalize">{zone.type}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
