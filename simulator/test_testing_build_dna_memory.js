'use strict';
const assert = require('assert');
const fs = require('fs');

(async () => {
  const {JSDOM} = await import('jsdom');
  const dom = new JSDOM('<div id="testingBuildDna"></div>', {
    url: 'https://ide.example/', runScripts: 'outside-only'
  });
  const w = dom.window;
  w.localStorage.setItem('tbd_selected_bitstream', 'saved-bitstream');
  let authorized = false;
  w.fetch = async () => ({
    ok: authorized, status: authorized ? 200 : 401,
    json: async () => authorized
      ? {ok: true, bitstreams: [{id: 'saved-bitstream', label: 'Saved build'}], namespaces: []}
      : {ok: false, error: 'Unauthorized'}
  });
  w.eval(fs.readFileSync('simulator/testing-build-dna.js', 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 30));
  const select = w.document.getElementById('tbdBitstream');
  assert.equal(select.value, 'saved-bitstream');
  assert.match(select.textContent, /remembered, unverified/);
  assert.equal(select.disabled, true);
  assert.equal(w.document.querySelector('[aria-label="Open Bitstream DNA"]').disabled, true);
  assert.equal(w.localStorage.getItem('tbd_selected_bitstream'), 'saved-bitstream');
  authorized = true;
  [...w.document.querySelectorAll('button')].find(b => b.textContent === 'Retry').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(select.value, 'saved-bitstream');
  assert.equal(select.disabled, false);
  assert.equal(w.document.querySelector('[aria-label="Open Bitstream DNA"]').disabled, false);
  [...w.document.querySelectorAll('button')].find(b => b.textContent === 'Clear selection').click();
  assert.equal(w.localStorage.getItem('tbd_selected_bitstream'), null);
  assert.equal(select.value, '');
  dom.window.close();
  console.log('PASS remembered selection survives authorization failure, restores on retry, and clears explicitly');
})().catch(error => { console.error(error); process.exitCode = 1; });
