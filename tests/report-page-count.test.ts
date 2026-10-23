import { buildReportHtml, cleanZoneName } from '../lib/report-content';
import { parseFacilityBuildings } from '../lib/rule-based-planner';

const userScenario = `Building 01 - Sundar Plastic (50 ft x 50 ft x 15 ft [15.2m x 15.2m x 4.6m]), Building 02 - Filling Hall (100 ft x 80 ft x 15 ft [30.5m x 24.4m x 4.6m]), Building 03 - Mechanical Workshop (50 ft x 50 ft x 16 ft [15.2m x 15.2m x 4.9m]), and Building 04 - Loading Point (17 ft x 7.5 ft x 12 ft [5.2m x 2.3m x 3.7m]). The vision architecture requires 100% continuous coverage with zero blind spots using exactly 15 Hikvision 4MP IP cameras. Key operational goals include: continuous chemical spill and leak anomaly detection, automated drum and IBC tote liquid-level filling oversight, 1D/2D barcode and lot-code OCR, mandatory chemical splash suit/PPE compliance verification, heavy forklift/pedestrian collision prevention, tanker truck grounding clamp safety interlock, and emergency shower/exit route clearance monitoring.`;

// Test 1: Building parsing from single inline prompt
const bldgs = parseFacilityBuildings(userScenario, 15);
console.log(`Parsed ${bldgs.length} buildings:`);
bldgs.forEach(b => console.log(` - ${b.name}: ${b.length_ft}x${b.width_ft}x${b.height_ft} ft, ${b.camera_count} cameras`));

if (bldgs.length !== 4) {
  throw new Error(`Expected 4 buildings, got ${bldgs.length}`);
}
if (!bldgs[0].name.includes('Sundar Plastic') || bldgs[0].name.includes('Filling Hall')) {
  throw new Error(`Building 01 name corrupted: ${bldgs[0].name}`);
}

// Verify no NaN in camera counts
bldgs.forEach(b => {
  if (isNaN(b.camera_count) || typeof b.camera_count !== 'number') {
    throw new Error(`Building ${b.name} has invalid camera count: ${b.camera_count}`);
  }
});
console.log('✓ All building camera counts are valid positive integers (no NaN)!');

// Test 2: cleanZoneName sanitizer
const cleaned = cleanZoneName(userScenario);
console.log('Sanitized zone name:', cleaned);
if (cleaned !== 'Building 01 - Sundar Plastic') {
  throw new Error(`Expected 'Building 01 - Sundar Plastic', got '${cleaned}'`);
}

// Test 3: Generate PDF report HTML
async function testReport() {
  const project = {
    name: 'Descon chemical project',
    company_name: 'Descon Chemical',
    industry: 'Chemical & Petrochemical Processing',
    business_description: userScenario,
    camera_specifications: '15 Hikvision 4MP IP cameras',
    cameras: Array.from({ length: 15 }, (_, i) => ({
      id: `c-${i}`,
      name: `CAM-${String(i + 1).padStart(2, '0')}`,
      x: 0.1 + (i % 5) * 0.18,
      y: 0.2 + Math.floor(i / 5) * 0.25,
      height_m: 4.6,
      mount_type: 'cross',
      orientation_degrees: (i * 45) % 360,
    })),
  };

  const html = await buildReportHtml(project, 'pdf');

  // Verify page count: exactly 3 `.page` blocks for the short executive blueprint
  const pageMatches = html.match(/<div class="page">/g);
  const pageCount = pageMatches ? pageMatches.length : 0;
  console.log(`Report generated with ${pageCount} pages.`);
  if (pageCount !== 3) {
    throw new Error(`Expected exactly 3 pages for executive blueprint, got ${pageCount}`);
  }
  console.log('✓ Exactly 3 pages verified!');

  // Verify core diagrams are included
  if (!html.includes('Diagram 1 — 2D Architectural Blueprint') || !html.includes('Diagram 2 — 3D Spatial Twin')) {
    throw new Error('Missing core executive blueprint diagrams!');
  }
  console.log('✓ Both core visual engineering diagrams included!');

  // Verify no NaN in generated HTML
  if (html.includes('>NaN<') || html.includes('NaN m²') || html.includes('NaN Cameras')) {
    throw new Error('HTML report contains NaN output!');
  }
  console.log('✓ Zero NaN values in generated report!');

  // Verify no long paragraph descriptions in camera schedule table
  if (html.includes('The vision architecture requires 100% continuous coverage')) {
    throw new Error('Camera schedule table still contains full scenario paragraph text!');
  }
  console.log('✓ Camera schedule is clean and free of multi-paragraph clutter!');

  // Verify Placement Coordinates column exists
  if (!html.includes('Placement Coordinates') || !html.includes('coord-pill')) {
    throw new Error('Placement Coordinates column or badge missing!');
  }
  console.log('✓ Placement Coordinates column verified!');

  // Verify Official Engineering Sign-off & Client Approval Block exists
  if (!html.includes('Official Engineering Sign-Off') || !html.includes('Lead Vision Systems Engineer')) {
    throw new Error('Official Engineering Sign-Off block is missing!');
  }
  console.log('✓ Official Engineering Sign-Off & Client Approval Block verified!');

  console.log('\n--- ALL 3-PAGE REPORT VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
}

testReport().catch(err => {
  console.error(err);
  process.exit(1);
});
