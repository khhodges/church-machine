const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, 'amobea');
const bundle = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert(!bundle.includes('/__mockup/'), 'No sandbox navigation in shipped bundle');
const menu = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
for (const id of ['hamItem-editor', 'hamItem-lump-thread', 'hamItem-amobea', 'hamItem-thread-studio']) {
  assert(menu.includes(`id="${id}"`), `${id} remains available`);
}
const dom = new JSDOM('<div id="root"></div>', {
  url: 'https://ide.example/simulator/amobea/index.html',
  runScripts: 'outside-only', pretendToBeVisual: true,
});
dom.window.TextEncoder = TextEncoder;
dom.window.structuredClone = structuredClone;
const failures = [];
dom.window.addEventListener('error', event => failures.push(event.message));
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
const doc = dom.window.document;
function button(text, scope = doc) {
  const found = [...scope.querySelectorAll('button')].find(el => el.textContent.trim() === text);
  assert(found, `Button exists: ${text}`); return found;
}
function fill(input, value) {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
(async () => {
  dom.window.eval(bundle);
  await tick();
  assert(doc.body.textContent.includes('What would you like to do?'));
  const individual = doc.querySelector('.am-individual');
  const firstInput = individual.querySelector('input');
  fill(firstInput, 'Session draft');
  await tick();
  button('Thread Studio', doc.querySelector('nav')).click();
  await tick();
  assert.equal(dom.window.location.hash, '#thread');
  const studio = doc.querySelector('.cm-studio');
  button('New Transaction', studio).click();
  await tick();
  const form = studio.querySelector('.cm-transaction-form');
  const inputs = form.querySelectorAll('input');
  fill(inputs[0], 'Integration task'); await tick();
  fill(inputs[1], 'Check additive workspace'); await tick();
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert(studio.querySelector('h1').textContent.includes('Integration task'));
  button('Reserve tuple', studio).click(); await tick();
  button('Confirm reservation', studio).click(); await tick();
  assert(studio.querySelector('.cm-records').textContent.includes('IntegrationtaskRecord'));
  studio.querySelector('.cm-delete-transaction').click(); await tick();
  button('Delete', studio.querySelector('.cm-delete-confirm')).click(); await tick();
  assert(!studio.querySelector('.cm-rail').textContent.includes('Integration task'));
  assert(studio.querySelector('.cm-rail').textContent.includes('Phone Mum'));
  studio.querySelector('[data-amobea-view="individual"]').click(); await tick();
  assert.equal(dom.window.location.hash, '#individual');
  assert.equal(firstInput.value, 'Session draft', 'Switching views preserves drafts');
  assert.deepEqual(failures, []);
  dom.window.close();
  console.log('Amobea integration: additive menu, navigation, draft retention, create/reserve/delete passed.');
})().catch(error => { dom.window.close(); console.error(error); process.exitCode = 1; });
