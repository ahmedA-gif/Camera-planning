import {
  buildFrame, footprintOnPlane, computeCoverage, defaultLayout, optimizeLayout,
  impliedHorizontalPixels, refocusLens, samplePoint, nearBlindDistance,
  type LensSpec, type SiteSpec,
} from '../lib/coverage-engine';

const lens: LensSpec = { focalMm: 2.8, hfovDeg: 106, vfovDeg: 56, ranges: { detect: 88, observe: 35.2, recognize: 17.6, identify: 8.8 } };
const site: SiteSpec = { length: 90, width: 10, mountHeight: 4, targetHeight: 1.5, marginPct: 10, obstacles: [] };
const rad = (d: number) => d * Math.PI / 180;
let fails = 0;
const near = (name: string, got: number, want: number, tol = 0.02) => {
  const ok = Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(3)} want ${want.toFixed(3)}`);
};

// 1. Implied pixels: 88 · 25 · 2 · tan(53°)
near('implied Hpx', impliedHorizontalPixels(lens), 88 * 25 * 2 * Math.tan(rad(53)));

// 2. Nadir footprint at target plane: half-sizes (H−h)·tan(FOV/2), pan 90 → width along x
const nadir = buildFrame({ id: 1, mount: 'roof-nadir', x: 45, y: 5, z: 4, panDeg: 90, tiltDeg: 90 }, lens, site);
const fpN = footprintOnPlane(nadir, 1.5, 100);
const xs = fpN.map(p => p.x), ys = fpN.map(p => p.y);
near('nadir half-length (x)', (Math.max(...xs) - Math.min(...xs)) / 2, 2.5 * Math.tan(rad(53)));
near('nadir half-width (y)', (Math.max(...ys) - Math.min(...ys)) / 2, 2.5 * Math.tan(rad(28)));

// 3. Horizontal wall camera: near edge at (H−h)/tan(VFOV/2), far edge at derated range
const wallH = buildFrame({ id: 1, mount: 'wall-h', x: 0, y: 5, z: 4, panDeg: 0, tiltDeg: 0 }, lens, site);
const fpW = footprintOnPlane(wallH, 1.5, 17.6 * 0.9);
near('wall-h near edge', Math.min(...fpW.map(p => p.x)), 2.5 / Math.tan(rad(28)));
near('wall-h far edge', Math.max(...fpW.map(p => p.x)), 15.84);
near('wall-h far half-width', Math.max(...fpW.map(p => p.y)) - 5, 15.84 * Math.tan(rad(53)));
near('wall-h near blind', nearBlindDistance(wallH, fpW), 2.5 / Math.tan(rad(28)));

// 4. Point sampling: on-axis point at 8 m → identify (8 ≤ 8.8·0.9 = 7.92? no → recognize)
near('level @ 7.5m on axis', samplePoint(wallH, 7.5, 5, 4, []).level, 4, 0);
near('level @ 9m on axis', samplePoint(wallH, 9, 5, 4, []).level, 3, 0);
near('ppm @ 10m', samplePoint(wallH, 10, 5, 4, []).ppm, impliedHorizontalPixels(lens) / (2 * 10 * Math.tan(rad(53))));
// behind the camera / outside FOV
near('behind camera', samplePoint(wallH, -1, 5, 1.5, []).level, 0, 0);

// 5. Occlusion: rack between camera and target
const blocked = samplePoint(wallH, 12, 5, 1.5, [{ id: 'r', name: 'rack', x: 8, y: 3, w: 1, d: 4, h: 6 }]);
near('occluded by 6 m rack', blocked.level, 0, 0);
const lowRack = samplePoint(wallH, 12, 5, 1.5, [{ id: 'r', name: 'rack', x: 8, y: 3, w: 1, d: 4, h: 1.0 }]);
near('seen over 1 m rack', lowRack.level > 0 ? 1 : 0, 1, 0);

// 6. Refocus 2.8 → 5.6 mm: FOV narrows, ranges ≈ double
const tele = refocusLens(lens, 5.6);
near('refocus HFOV', tele.hfovDeg, 2 * Math.atan(Math.tan(rad(53)) / 2) * 180 / Math.PI, 0.01);
near('refocus detect range', tele.ranges.detect, 88 * Math.tan(rad(53)) / Math.tan(rad(tele.hfovDeg / 2)), 0.01);

// 7. Sample layout (5 cams) and optimizer
const sample = defaultLayout(5, site, lens, 'recognize');
const res = computeCoverage(sample, lens, site, 'recognize');
console.log('\nSample 5-camera layout:', res.metrics.coveragePct.toFixed(1) + '% area coverage,',
  res.metrics.lengthCoveragePct.toFixed(1) + '% length coverage');
res.cameras.forEach(c => console.log(`  C${c.id} start ${c.coverStart.toFixed(2)} end ${c.coverEnd.toFixed(2)} blind ${c.nearBlind.toFixed(2)} area ${c.coveredArea.toFixed(1)} unique ${c.uniqueArea.toFixed(1)}`));
const t0 = Date.now();
const opt = optimizeLayout(lens, site, 'recognize', { targetPct: 95, maxCameras: 75 });
const verify = computeCoverage(opt.poses, lens, site, 'recognize');
console.log(`\nOptimizer: ${opt.poses.length} cameras, ${opt.achievedPct.toFixed(1)}% (fine grid ${verify.metrics.coveragePct.toFixed(1)}%) from ${opt.candidates} candidates in ${Date.now() - t0} ms`);
const t1 = Date.now();
computeCoverage(defaultLayout(70, { ...site, length: 400, width: 60 }, lens, 'recognize'), lens, { ...site, length: 400, width: 60 }, 'recognize');
console.log(`70 cameras / 400×60 m grid evaluation: ${Date.now() - t1} ms`);
console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
