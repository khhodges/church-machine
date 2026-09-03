const fs = require('fs');

const source = fs.readFileSync('simulator/index.html', 'utf8');
const checks = [
  ['truthy non-Error values are guarded', source.includes('if (!(event.error instanceof Error))')],
  ['non-Error values are normalized', source.includes('function describeNonError(value, fallback)')],
  ['circular thrown values cannot crash the guard', source.includes('catch (_serializationError)')],
  ['guard prevents artifact crash propagation', source.includes("console.warn('[Church Machine] Caught non-Error window error:'") &&
    source.includes('event.preventDefault();') &&
    source.includes('event.stopImmediatePropagation();')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`Non-Error runtime guard regression: ${name}`);
}

console.log('Non-Error runtime guard regression: PASS');