import { NormalizedContext } from './types';

export function normalizeUserInput(input: {
  business_description: string;
  industry: string;
  company_name: string;
  requirements: string[];
}): NormalizedContext {
  const text = `
    ${input.business_description}
    ${input.requirements.join(' ')}
  `.toLowerCase();

  const operations = extractOperations(text);
  const hazards = extractHazards(text);
  const incidents = extractIncidents(text);
  const constraints = extractConstraints(text, input.requirements);
  const objectives = extractObjectives(text, input.requirements);
  const unknowns = extractUnknowns(text);
  const existingControls = extractExistingControls(text);
  const stakeholders = extractStakeholders(text, input.industry);

  return {
    facility: {
      type: inferFacilityType(input.industry, text),
      industry: input.industry,
      company_name: input.company_name,
      description: input.business_description,
    },
    operations,
    identified_hazards: hazards,
    incident_history: incidents,
    constraints,
    objectives,
    unknowns,
    existing_controls: existingControls,
    stakeholders,
  };
}

function extractOperations(text: string): string[] {
  const ops: string[] = [];
  const keywords = {
    'forklift movement': ['forklift', 'lift truck', 'reach truck'],
    'pedestrian movement': ['pedestrian', 'worker', 'foot traffic', 'walking'],
    'loading/unloading': ['loading', 'unloading', 'dock', 'bay'],
    'material handling': ['material handling', 'pallet', 'stacking', 'racking'],
    'vehicle traffic': ['vehicle', 'truck', 'trailer', 'yard'],
    'conveyor operations': ['conveyor', 'belt', 'sortation'],
    'packing/picking': ['picking', 'packing', 'order fulfillment'],
    'maintenance': ['maintenance', 'repair', 'servicing'],
  };

  for (const [op, terms] of Object.entries(keywords)) {
    if (terms.some(t => text.includes(t))) ops.push(op);
  }
  return ops.length ? ops : ['operations not specified'];
}

function extractHazards(text: string): string[] {
  const hazards: string[] = [];
  const hazardMap: Record<string, string[]> = {
    'vehicle-pedestrian collision': ['pedestrian', 'forklift', 'near miss', 'collision', 'struck by'],
    'blocked aisles/emergency routes': ['blocked', 'obstructed', 'aisle', 'emergency exit', 'egress'],
    'PPE non-compliance': ['ppe', 'hard hat', 'safety vest', 'hi-vis', 'no ppe', 'without ppe'],
    'falling objects': ['falling', 'stack', 'rack collapse', 'overhead', 'dropped'],
    'slips/trips/falls': ['slip', 'trip', 'fall', 'wet floor', 'uneven', 'housekeeping'],
    'ergonomic strain': ['ergonomic', 'lifting', 'repetitive', 'strain', 'musculoskeletal'],
    'chemical exposure': ['chemical', 'hazardous', 'spill', 'exposure', 'sds'],
    'fire/explosion': ['fire', 'explosion', 'flammable', 'hot work', 'ignition'],
    'confined space': ['confined space', 'tank', 'vessel', 'pit'],
    'electrical hazard': ['electrical', 'arc flash', 'energized', 'lockout', 'tagout'],
    'noise exposure': ['noise', 'hearing', 'decibel', 'loud'],
    'fatigue': ['fatigue', 'shift', 'overtime', 'extended hours'],
  };

  for (const [hazard, terms] of Object.entries(hazardMap)) {
    if (terms.some(t => text.includes(t))) hazards.push(hazard);
  }

  if (hazards.length === 0) hazards.push('no specific hazards identified in the supplied information');
  return hazards;
}

function extractIncidents(text: string): string[] {
  const incidents: string[] = [];
  if (text.includes('near miss') || text.includes('near-miss')) incidents.push('near misses reported');
  if (text.includes('injury') || text.includes('hurt')) incidents.push('injuries reported');
  if (text.includes('incident') || text.includes('accident')) incidents.push('incidents recorded');
  if (text.includes('first aid') || text.includes('medical')) incidents.push('first aid/medical cases');
  return incidents.length ? incidents : ['incident history not provided'];
}

function extractConstraints(text: string, requirements: string[]): NormalizedContext['constraints'] {
  const allText = text + ' ' + requirements.join(' ');
  const budget = allText.includes('affordable') || allText.includes('low cost') || allText.includes('budget')
    ? 'affordable / cost-constrained'
    : 'not specified';
  const timeline = allText.includes('one month') || allText.includes('1 month') || allText.includes('30 day')
    ? 'one month'
    : allText.includes('quarter') ? 'quarterly' : 'not specified';
  const regulatory: string[] = [];
  if (allText.includes('osha')) regulatory.push('OSHA');
  if (allText.includes('iso 45001')) regulatory.push('ISO 45001');
  if (allText.includes('local regulation') || allText.includes('compliance')) regulatory.push('local regulations');
  return { budget, implementation_period: timeline, regulatory };
}

function extractObjectives(text: string, requirements: string[]): string[] {
  const objectives: string[] = [];
  const reqText = requirements.join(' ').toLowerCase();
  if (reqText.includes('detect') || reqText.includes('monitor')) objectives.push('real-time hazard detection');
  if (reqText.includes('alert') || reqText.includes('notify')) objectives.push('automated alerting');
  if (reqText.includes('report') || reqText.includes('dashboard')) objectives.push('reporting and analytics');
  if (reqText.includes('reduce') || reqText.includes('prevent')) objectives.push('incident reduction');
  if (reqText.includes('compliance') || reqText.includes('audit')) objectives.push('regulatory compliance');
  if (reqText.includes('training') || reqText.includes('awareness')) objectives.push('safety awareness improvement');
  return objectives.length ? objectives : ['improve overall safety'];
}

function extractUnknowns(text: string): string[] {
  const unknowns: string[] = [];
  if (!text.includes('traffic') && !text.includes('volume')) unknowns.push('people and vehicle movement patterns');
  if (!text.includes('layout') && !text.includes('dimensions')) unknowns.push('site layout and area dimensions');
  if (!text.includes('shift') && !text.includes('hour')) unknowns.push('operating hours and peak activity periods');
  if (!text.includes('ppe') && !text.includes('vest')) unknowns.push('applicable protective equipment requirements');
  if (!text.includes('near miss') && !text.includes('incident')) unknowns.push('incident and near-miss history');
  if (!text.includes('lighting') && !text.includes('lux')) unknowns.push('lighting and visibility conditions');
  if (!text.includes('training') && !text.includes('competency')) unknowns.push('current training programs and competency levels');
  return unknowns.length ? unknowns : ['site-specific details'];
}

function extractExistingControls(text: string): string[] {
  const controls: string[] = [];
  if (text.includes('camera') || text.includes('cctv') || text.includes('surveillance')) controls.push('CCTV/video surveillance');
  if (text.includes('training') || text.includes('induction')) controls.push('safety training programs');
  if (text.includes('signage') || text.includes('sign') || text.includes('marking')) controls.push('safety signage and floor markings');
  if (text.includes('ppe') || text.includes('vest') || text.includes('hard hat')) controls.push('PPE requirements');
  if (text.includes('procedure') || text.includes('sop') || text.includes('protocol')) controls.push('standard operating procedures');
  if (text.includes('inspection') || text.includes('audit') || text.includes('checklist')) controls.push('regular inspections/audits');
  if (text.includes('traffic management') || text.includes('speed limit') || text.includes('one-way')) controls.push('traffic management rules');
  return controls.length ? controls : ['existing controls not provided'];
}

function extractStakeholders(text: string, industry: string): string[] {
  const stakeholders: string[] = [];
  if (text.includes('worker') || text.includes('staff') || text.includes('employee')) stakeholders.push('workers and staff');
  if (text.includes('supervisor') || text.includes('manager')) stakeholders.push('supervisors and managers');
  if (text.includes('safety')) stakeholders.push('safety personnel');
  if (industry.toLowerCase().includes('logistic') || industry.toLowerCase().includes('distribution')) {
    stakeholders.push('truck drivers', 'loading dock personnel');
  }
  if (industry.toLowerCase().includes('manufacturing')) {
    stakeholders.push('production operators', 'maintenance technicians');
  }
  return stakeholders.length ? [...new Set(stakeholders)] : ['affected personnel not specified'];
}

function inferFacilityType(industry: string, text: string): string {
  const ind = industry.toLowerCase();
  if (ind.includes('warehouse') || ind.includes('distribution') || ind.includes('logistic') || text.includes('warehouse')) return 'warehouse';
  if (ind.includes('manufacturing') || ind.includes('factory') || ind.includes('production')) return 'manufacturing facility';
  if (ind.includes('retail') || ind.includes('store')) return 'retail distribution center';
  if (ind.includes('cold') || ind.includes('freezer') || ind.includes('refrigerated')) return 'cold storage facility';
  return industry.trim() || 'facility type not specified';
}
