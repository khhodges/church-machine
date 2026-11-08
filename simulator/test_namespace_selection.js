const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('simulator/namespace-selection.js', 'utf8');
const data = new Map();
function view() {
  const context = vm.createContext({localStorage:{
    getItem:key=>data.has(key)?data.get(key):null, setItem:(key,value)=>data.set(key,value),
  }});
  vm.runInContext(source, context);
  return context.NamespaceSelection;
}
const dna = view(), approval = view(), glass = view();
assert.equal(dna.read(), null);
dna.remember('inspection-amoeba-retry-image');
assert.equal(approval.read(), 'inspection-amoeba-retry-image');
assert.equal(glass.read(), approval.read());
assert.equal(view().read(), approval.read());
assert.equal(dna.name('inspection-amoeba-retry', 'old'), glass.name(glass.read(), 'different'));
assert.equal(approval.name('other', 'Existing name'), 'Existing name');
glass.remember('unavailable-exact-id');
assert.equal(approval.read(), 'unavailable-exact-id');
dna.remember('');
assert.equal(view().read(), '');
console.log('PASS shared exact identity, naming, reload and explicit clearing');
assert.equal(dna.select('namespace:ascending'), true);
assert.equal(glass.current(), 'namespace:ascending');
assert.equal(dna.select('namespace:copy:example'), true);
assert.equal(view().current(), 'namespace:copy:example');
assert.equal(dna.select('arbitrary-revision'), false);
assert.equal(view().current(), 'namespace:copy:example');
