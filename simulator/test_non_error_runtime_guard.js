const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('simulator/index.html', 'utf8');
const abstractionsSource = fs.readFileSync('simulator/abstractions.js', 'utf8');
const runtimeSources = [
  'simulator/app-source-library.js',
  'simulator/app-compile.js',
  'simulator/app-memory.js',
].map(path => fs.readFileSync(path, 'utf8')).join('\n');
const checks = [
  ['truthy non-Error values are guarded', source.includes('if (!isRealError(event.error))')],
  ['cross-realm Error values remain observable',
    source.includes('function isRealError(value)') &&
    source.includes("Object.prototype.toString.call(value) === '[object Error]'")],
  ['non-Error values are normalized', source.includes('function describeNonError(value, fallback)')],
  ['circular thrown values cannot crash the guard', source.includes('catch (_serializationError)')],
  ['guard prevents artifact crash propagation', source.includes("console.warn('[Church Machine] Caught non-Error window error:'") &&
    source.includes('event.preventDefault();') &&
    source.includes('event.stopImmediatePropagation();')],
  ['guard observes resource errors in capture phase',
    /window\.addEventListener\('error',[\s\S]*?\}, true\);/.test(source)],
  ['guard observes malformed promise rejections in capture phase',
    /window\.addEventListener\('unhandledrejection',[\s\S]*?\}, true\);/.test(source)],
  ['resource failures remain observable',
    source.includes('Resource failures stay visible') &&
    source.includes('target.tagName === \'SCRIPT\'')],
  ['startup does not abort assets with a second client-side version redirect',
    !abstractionsSource.includes('_simulatorCacheBust') &&
    !abstractionsSource.includes("window.location.replace('/simulator/~/")],
  ['runtime promises never reject with scalar literals',
    !/Promise\.reject\(\s*['"`]/.test(runtimeSources)],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`Non-Error runtime guard regression: ${name}`);
}

const describeIndex = source.indexOf('function describeNonError');
const scriptStart = source.lastIndexOf('<script>', describeIndex);
const scriptEnd = source.indexOf('</script>', describeIndex);
if (scriptStart < 0 || scriptEnd < 0) {
  throw new Error('Non-Error runtime guard regression: inline guard script not found');
}
const guardHandlers = {};
const warnings = [];
const guardContext = {
  window: {
    addEventListener(name, fn) {
      guardHandlers[name] = fn;
    },
  },
  console: {warn: (...args) => warnings.push(args)},
};
vm.createContext(guardContext);
vm.runInContext(source.slice(scriptStart + '<script>'.length, scriptEnd), guardContext);
const foreignError = vm.runInNewContext('new Error("cross-realm")');
let prevented = 0;
let stopped = 0;
const controls = {
  preventDefault: () => { prevented++; },
  stopImmediatePropagation: () => { stopped++; },
};
guardHandlers.error(Object.assign({
  target: guardContext.window,
  error: foreignError,
  message: '',
}, controls));
if (prevented !== 0 || stopped !== 0) {
  throw new Error('Non-Error runtime guard regression: cross-realm Error was suppressed');
}
guardHandlers.unhandledrejection(Object.assign({
  reason: foreignError,
}, controls));
if (prevented !== 0 || stopped !== 0) {
  throw new Error('Non-Error runtime guard regression: cross-realm rejection was suppressed');
}
guardHandlers.error(Object.assign({
  target: guardContext.window,
  error: 'scalar non-Error',
  message: '',
}, controls));
if (prevented !== 1 || stopped !== 1 || warnings.length !== 1) {
  throw new Error('Non-Error runtime guard regression: scalar containment failed');
}
prevented = 0;
stopped = 0;
guardHandlers.error(Object.assign({
  target: {tagName: 'LINK', href: '/styles.css'},
  error: undefined,
  message: '',
}, controls));
if (prevented !== 0 || stopped !== 0) {
  throw new Error('Non-Error runtime guard regression: resource failure was suppressed');
}

console.log('Non-Error runtime guard regression: PASS');