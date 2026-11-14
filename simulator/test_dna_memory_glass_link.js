'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const {JSDOM} = await import('jsdom');
  const dom = new JSDOM('<div id="testingBuildDna"></div>', {
    url: 'https://ide.example/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window, opened = [];
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false; this.dispatchEvent(new w.Event('close'));
  };
  w.DevelopmentImageView = {show: id => opened.push(id)};
  w.fetch = async url => ({ok: true, json: async () =>
    String(url).includes('?') ? {ok:true, status:'available', nodes:[], edges:[]} :
    {ok:true, bitstreams:[], namespaces:[
      {id:'namespace:copy:selected-one',label:'One',imageAvailable:true},
      {id:'namespace:copy:selected-two',label:'Two',imageAvailable:true}
    ]}});
  w.eval(fs.readFileSync('simulator/testing-build-dna.js','utf8'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  await settle();
  for (const id of ['namespace:copy:selected-one', 'namespace:copy:selected-two']) {
    const select = w.document.getElementById('tbdNamespace');
    select.value = id;
    select.dispatchEvent(new w.Event('change'));
    w.document.querySelector('[aria-label="Open Namespace DNA"]').click();
    await settle();
    const button = [...w.document.querySelectorAll('button')].find(b => b.textContent === 'Memory Glass');
    assert(button && !button.disabled, 'Link works even for an empty Namespace graph');
    button.click();
    await settle();
    assert.equal(opened.at(-1), id, 'Carry exact inspected Namespace, not a default');
  }
  const html = fs.readFileSync('simulator/index.html','utf8');
  assert(html.includes('id="namespaceDnaMemoryGlass" onclick="DevelopmentImageView.show(NamespaceSelection.current() || NamespaceSelection.read())"'));
  dom.window.close();
  console.log('PASS DNA Memory Glass navigation preserves selected Namespace');
})().catch(error => { console.error(error); process.exitCode = 1; });
