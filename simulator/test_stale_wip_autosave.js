const fs = require('fs');

const shell = fs.readFileSync('simulator/app-shell.js', 'utf8');
const index = fs.readFileSync('simulator/index.html', 'utf8');

const checks = [
  ['404 response is handled', shell.includes('if (resp.status === 404')],
  ['response is correlated to the active token',
    shell.includes("localStorage.getItem('church_wip_token') === _tok")],
  ['only the stale token is removed',
    shell.includes("localStorage.removeItem('church_wip_token')")],
  ['browser cache is busted',
    index.includes('app-shell.js?v=20260903-stale-wip-guard1')],
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  failures.forEach(([name]) => console.error('FAIL:', name));
  process.exit(1);
}
console.log('Stale WIP autosave regression: PASS');