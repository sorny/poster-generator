// Runs every suite in sequence and prints one summary.
//   node test/run.js            all suites
//   node test/run.js units      only suites whose file name matches "units"

import { suite, plainSuite } from './harness.js';

const SUITES = ['geometry', 'tiling', 'guides', 'theme', 'units', 'placement', 'export', 'e2e'];

const filter = process.argv[2];
const selected = filter ? SUITES.filter((s) => s.includes(filter)) : SUITES;
if (!selected.length) {
  console.error(`No suite matches "${filter}". Available: ${SUITES.join(', ')}`);
  process.exit(2);
}

const started = Date.now();
const totals = [];

for (const key of selected) {
  const mod = await import(`./${key}.test.js`);
  console.log(`\n${mod.name}`);
  const results = mod.browser === false
    ? await plainSuite(mod.name, mod.body)
    : await suite(mod.name, mod.body);
  totals.push({ key, name: mod.name, results });
}

console.log('\n────────────────────────────────');
let failed = 0;
for (const { key, name, results } of totals) {
  const bad = results.filter((r) => !r.ok);
  failed += bad.length;
  console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${key.padEnd(8)} ${String(results.length).padStart(2)} checks  ${name}`);
  for (const r of bad) console.log(`        ↳ ${r.label}${r.detail ? `: ${r.detail}` : ''}`);
}
const checks = totals.reduce((n, t) => n + t.results.length, 0);
console.log(`\n${checks - failed}/${checks} checks passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
