import { parseCameraHardware, extractDesiredCameraCount, detectFacilityProfile, generateStructuredLayout } from '../lib/rule-based-planner';
import { generateSiteTelemetryMapSvg, generatePipelineArchitectureSvg, generateCoverageTelemetryMetricsSvg } from '../lib/report-diagrams';
import type { DetVisionProject } from '../lib/types';

console.log('--- TESTING ALL-IN-ONE UNIFIED LOGIC ---');

// Test 1: Descon Chemical Prompt with 15 cameras, 4MP, Hikvision, 4 buildings
const desconPrompt = `
All the measurements are in ft
Building 01-Sundar plastic
Length = 50
Width = 50
Height = 15 

Building 02-Filling hall
Length = 100
Width = 80
Height = 15

Building 03- Mechanical workshop
Length = 50
Width = 50
height=16
Building 04- Loading point 
Length = 17
Width = 7.5
Height = 12

Total camera 15 - 4 MP-  HIK Vision Brand - IP camera
100% coverage needed
`;

// Parse Hardware
const hw = parseCameraHardware('Total camera 15 - 4 MP- HIK Vision Brand - IP camera', desconPrompt);
console.log('Brand parsed:', hw.brand);
if (hw.brand !== 'Hikvision') throw new Error(`Expected Hikvision, got ${hw.brand}`);
if (hw.resolutionPreset !== '4mp') throw new Error(`Expected 4mp, got ${hw.resolutionPreset}`);
if (hw.sensorWidthPx !== 2688) throw new Error(`Expected 2688 sensorWidthPx, got ${hw.sensorWidthPx}`);
console.log('✓ Hardware parsing passed!');

// User Camera Count Extraction
const userCamCount = extractDesiredCameraCount(desconPrompt, null);
console.log('User Camera Count parsed:', userCamCount);
if (userCamCount !== 15) throw new Error(`Expected 15 cameras, got ${userCamCount}`);
console.log('✓ Camera count extraction passed (exactly 15, no hardcoded fallback)!');

// Facility Profile Detection with Multi-building Dimensions
const prof = detectFacilityProfile(desconPrompt);
console.log('Facility Dimensions (m):', prof.length, 'x', prof.width, 'x', prof.height);
if (prof.length < 15 || prof.width < 10) throw new Error(`Facility dimensions too small: ${prof.length}x${prof.width}`);
console.log('✓ Facility multi-building dimension detection passed!');

// Generate Layout
const layout = generateStructuredLayout({
  business_description: desconPrompt,
  requirements: ['100% coverage needed', 'chemical safety'],
  critical_components: ['Conveyor', 'Filling machine', 'Loading dock'],
  layout_sections: ['Sundar plastic', 'Filling hall', 'Mechanical workshop', 'Loading point'],
  layout_section_count: 4,
  detection_coverage_target: 100,
  camera_specifications: 'Total camera 15 - 4 MP- HIK Vision Brand - IP camera',
});

console.log('Layout generated cameras count:', layout.cameras.length);
if (layout.cameras.length !== 15) throw new Error(`Expected exactly 15 cameras in layout, got ${layout.cameras.length}`);
console.log('Layout generated structures count:', layout.structure.length);
if (layout.structure.length < 4) throw new Error(`Expected at least 4 building structures, got ${layout.structure.length}`);
console.log('✓ Layout generation strictly prioritized user requirement of 15 cameras & 4 structures!');

// Test Diagrams Generation
const sampleProject: DetVisionProject = {
  id: 'test-descon-proj',
  name: 'Descon Chemical Project',
  company_name: 'Descon Chemical',
  industry: 'Chemical Manufacturing',
  business_description: desconPrompt,
  requirements: ['100% coverage needed'],
  facility_width_m: prof.width,
  facility_length_m: prof.length,
  facility_height_m: prof.height,
  detection_coverage_target: 100,
  cameras: layout.cameras,
  structure: layout.structure,
  zones: [],
  use_cases: [],
  assumptions: [],
  missing_information: [],
  workflow: { nodes: [], edges: [] },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mapSvg = generateSiteTelemetryMapSvg(sampleProject);
if (!mapSvg.includes('<svg') || !mapSvg.includes('FACILITY LENGTH') || !mapSvg.includes('CAM-15')) {
  throw new Error('generateSiteTelemetryMapSvg missing expected SVG elements or CAM-15');
}
console.log('✓ Site Telemetry Map SVG generated with all 15 cameras and buildings!');

const pipeSvg = generatePipelineArchitectureSvg(sampleProject);
if (!pipeSvg.includes('<svg') || !pipeSvg.includes('15x IP Cameras') || !pipeSvg.includes('NVIDIA DeepStream')) {
  throw new Error('generatePipelineArchitectureSvg missing expected SVG elements');
}
console.log('✓ Pipeline Architecture SVG generated with user camera count!');

const doriSvg = generateCoverageTelemetryMetricsSvg(sampleProject);
if (!doriSvg.includes('<svg') || !doriSvg.includes('15 Cameras') || !doriSvg.includes('100% TARGET')) {
  throw new Error('generateCoverageTelemetryMetricsSvg missing expected metrics');
}
console.log('✓ 3D Optical Coverage Telemetry & Sizing SVG generated!');

console.log('\n--- ALL UNIFIED VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
