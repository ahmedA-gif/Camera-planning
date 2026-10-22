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

import { 
  generateBirdCamera3DSvg, 
  generateFrustumDori3DSvg, 
  generateSideElevationSvg, 
  generate3DPerspectiveSvg 
} from '../lib/report-diagrams';
import { ensureMultiBuildingFleet } from '../lib/rule-based-planner';

// Test 5: Verify all 6 diagrams
const birdSvg = generateBirdCamera3DSvg(sampleProject);
if (!birdSvg.includes('<svg') || !birdSvg.includes('BIRD CAMERA 3D')) {
  throw new Error('generateBirdCamera3DSvg failed');
}
console.log('✓ Bird Camera 3D Occlusion Engine SVG generated!');

const frustumSvg = generateFrustumDori3DSvg(sampleProject);
if (!frustumSvg.includes('<svg') || !frustumSvg.includes('FRUSTUM &amp; DORI 3D')) {
  throw new Error('generateFrustumDori3DSvg failed');
}
console.log('✓ 3D Frustum & DORI Range Inspector SVG generated!');

const elevationSvg = generateSideElevationSvg(sampleProject);
if (!elevationSvg.includes('<svg') || !elevationSvg.includes('SIDE ELEVATION PROFILE')) {
  throw new Error('generateSideElevationSvg failed');
}
console.log('✓ Side Elevation Profile SVG generated!');

const perspectiveSvg = generate3DPerspectiveSvg(sampleProject);
if (!perspectiveSvg.includes('<svg') || !perspectiveSvg.includes('3D PERSPECTIVE VISUALIZER')) {
  throw new Error('generate3DPerspectiveSvg failed');
}
console.log('✓ 3D Virtual Facility Perspective SVG generated!');

// Test 6: Verify ensureMultiBuildingFleet strictly respects user-specified camera counts (e.g. 4 cameras preserved as 4, explicit 15 cameras gives 15)
const fourCamProject: DetVisionProject = {
  ...sampleProject,
  business_description: 'Industrial chemical facility with 4 buildings. Total cameras 4.',
  camera_specifications: '4 IP cameras',
  cameras: sampleProject.cameras.slice(0, 4),
};
const resolvedFour = ensureMultiBuildingFleet(fourCamProject);
if (resolvedFour.cameras.length !== 4) {
  throw new Error(`Expected ensureMultiBuildingFleet to preserve user's 4 cameras, got ${resolvedFour.cameras.length}`);
}
if (resolvedFour.buildings.length !== 4) {
  throw new Error(`Expected 4 buildings, got ${resolvedFour.buildings.length}`);
}
const bldgCamSumFour = resolvedFour.buildings.reduce((acc, b) => acc + (b.camera_count || 0), 0);
if (bldgCamSumFour !== 4) {
  throw new Error(`Expected building camera sum to equal 4, got ${bldgCamSumFour}`);
}
console.log('✓ ensureMultiBuildingFleet successfully preserved user\'s 4 cameras across 4 buildings!');

// Test 6b: Verify explicit target count of 15 cameras yields 15 cameras
const resolvedFifteen = ensureMultiBuildingFleet(fourCamProject, 15);
if (resolvedFifteen.cameras.length !== 15) {
  throw new Error(`Expected explicit target 15 cameras to yield 15, got ${resolvedFifteen.cameras.length}`);
}
const bldgCamSumFifteen = resolvedFifteen.buildings.reduce((acc, b) => acc + (b.camera_count || 0), 0);
if (bldgCamSumFifteen !== 15) {
  throw new Error(`Expected building camera sum to equal 15, got ${bldgCamSumFifteen}`);
}
console.log('✓ ensureMultiBuildingFleet successfully honored user-specified target count of 15 cameras!');

// Test 7: Verify user incremented count (16 cameras) is strictly preserved
const sixteenCamProject: DetVisionProject = {
  ...sampleProject,
  cameras: [
    ...sampleProject.cameras,
    {
      id: 'CAM-16',
      name: 'CAM-16: Additional Zone Monitor',
      status: 'active',
      x: 0.5,
      y: 0.5,
      orientation_degrees: 0,
      horizontal_fov_degrees: 85,
      view_range: 0.45,
      assigned_use_case_ids: [],
      resolution_width: 2688,
      resolution_height: 1520,
    }
  ]
};
const resolvedSixteen = ensureMultiBuildingFleet(sixteenCamProject);
if (resolvedSixteen.cameras.length !== 16) {
  throw new Error(`Expected 16 cameras preserved, got ${resolvedSixteen.cameras.length}`);
}
console.log('✓ ensureMultiBuildingFleet successfully preserved user-incremented 16 cameras!');

console.log('\n--- ALL UNIFIED VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
