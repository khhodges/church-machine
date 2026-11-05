'use strict';
// Isolated same-origin iframe fixture: no app APIs or hardware commands.
const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim(),
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      let body, contentType = 'text/html';
      if (url.pathname === '/') {
        body = '<h1>IDE</h1><iframe src="/testing" style="width:400px;height:300px"></iframe>';
      } else if (url.pathname === '/testing') {
        body = '<div id="testingBuildDna"></div><script src="/simulator/testing-build-dna.js"></script>';
      } else if (url.pathname === '/simulator/testing-build-dna.js') {
        body = fs.readFileSync('simulator/testing-build-dna.js', 'utf8'); contentType = 'text/javascript';
      } else if (url.pathname === '/simulator/testing-build-dna.css') {
        body = fs.readFileSync('simulator/testing-build-dna.css', 'utf8'); contentType = 'text/css';
      } else if (url.pathname === '/api/testing/build-dna') {
        contentType = 'application/json';
        body = JSON.stringify(url.search ? {
          ok: true, status: 'available',
          namespaceRevisionId: 'fixture',
          nodes: [{ id: 'ns', slot: 1, name: 'NS[1]', kind: 'Namespace' }, { id: 'm', slot: 3, name: 'MMIO', kind: 'Hardware' },
            { id: 't', slot: 2, name: 'Thread', kind: 'Thread' }], edges: [{ id: 'e1', source: 'ns', target: 't', raw: 2, register: 'CR0', kind: 'Inform', status: 'resolved' }],
        } : { ok: true, bitstreams: [{ id: 'bit', label: 'Bit fixture', namespaceRevisionId: 'fixture' }],
          namespaces: [{ id: 'fixture', label: 'Fixture', imageAvailable: true }] });
      } else {
        throw new Error('Unexpected request: ' + url);
      }
      return route.fulfill({ body, contentType });
    });
    await page.goto('http://dna.test/');
    const frame = page.frameLocator('iframe');
    await frame.locator('#tbdNamespace').selectOption('fixture');
    await frame.getByRole('button', { name: 'Open Namespace DNA', exact: true }).click();
    await page.locator('.tbd-node').first().waitFor();
    await page.waitForFunction(() => document.querySelector('.tbd-workspace').getBoundingClientRect().width === innerWidth);
    let bounds = await page.locator('.tbd-workspace').boundingBox();
    assert.deepStrictEqual(bounds, { x: 0, y: 0, width: 1200, height: 800 });
    assert.equal(await frame.locator('.tbd-dialog').count(), 0);
    async function checkFit() {
      await page.waitForFunction(() => {
        const stage = document.querySelector('.tbd-stage').getBoundingClientRect();
        const graph = document.querySelector('.tbd-svg > g').getBoundingClientRect();
        return graph.width > 0 && graph.left >= stage.left + 20 &&
          graph.right <= stage.right - 20 && graph.top >= stage.top + 20 &&
          graph.bottom <= stage.bottom - 20 &&
          (Math.abs(graph.width - (stage.width - 48)) < 3 ||
           Math.abs(graph.height - (stage.height - 48)) < 3);
      });
    }
    await checkFit();
    assert.equal(await page.locator('.tbd-detail').isVisible(), false);
    await page.locator('.tbd-node').first().click();
    assert.equal(await page.locator('.tbd-detail').isVisible(), true);
    await checkFit();
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await checkFit();
    await page.locator('#tbdLayout-namespace').selectOption('organized');
    assert.deepStrictEqual(await page.locator('.tbd-node title').allTextContents(), ['ns', 't', 'm']);
    // NS[1] encloses every inner node; Slot[0] absent is shown as missing, not invented.
    const contain = await page.evaluate(() => {
      const box = document.querySelector('.tbd-encl-box').getBoundingClientRect();
      const inner = [...document.querySelectorAll('.tbd-node:not(.tbd-hdr)')].map(n => n.getBoundingClientRect());
      return { ok: inner.every(r => r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom),
        missing: document.querySelector('.tbd-hdr-missing').textContent, hdr: document.querySelectorAll('.tbd-node.tbd-hdr').length };
    });
    assert.ok(contain.ok); assert.equal(contain.hdr, 1); assert.match(contain.missing, /Slot\[0\].*no slot evidence/);
    await page.locator('.tbd-node.tbd-hdr').click();
    assert.match(await page.locator('.tbd-detail-body h3').textContent(), /NS\[1\]/);
    assert.equal(await page.locator('.tbd-edge.is-hot').count(), 1);
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await page.locator('#tbdBitstream').selectOption('bit');
    await page.getByRole('button', { name: 'Open Bitstream DNA', exact: true }).click();
    const bit = page.locator('[data-viewer="bitstream"]');
    const ns = page.locator('[data-viewer="namespace"]');
    await bit.locator('.tbd-node').first().waitFor();
    assert.equal(await page.locator('.tbd-dialog').count(), 2);
    assert.equal(await ns.locator('.tbd-layout').inputValue(), 'organized');
    assert.equal(await bit.locator('.tbd-layout').inputValue(), 'default');
    await ns.locator('.tbd-node').first().click();
    assert.equal(await ns.locator('.tbd-detail').isVisible(), true);
    assert.equal(await bit.locator('.tbd-detail').isVisible(), false);
    const oldBitTransform = await bit.locator('.tbd-svg > g').getAttribute('transform');
    await ns.getByRole('button', { name: 'Zoom in', exact: true }).click();
    assert.equal(await bit.locator('.tbd-svg > g').getAttribute('transform'), oldBitTransform);
    await page.getByRole('button', { name: 'Open Bitstream DNA', exact: true }).click();
    assert.equal(await page.locator('.tbd-dialog').count(), 2);
    await bit.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.locator('.tbd-dialog').count(), 1);
    assert.equal(await ns.locator('.tbd-layout').inputValue(), 'organized');
    await ns.getByRole('button', { name: 'Close details', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    bounds = await page.locator('.tbd-workspace').boundingBox();
    assert.equal(bounds.width, 390);
    assert.equal(bounds.height, 844);
    await checkFit();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.tbd-workspace').open);
    await frame.getByRole('button', { name: 'Open Namespace DNA', exact: true }).click();
    await page.locator('.tbd-node').first().waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.tbd-workspace').open);
    assert.equal(await frame.locator('#tbdNamespace').count(), 1);
    assert.deepStrictEqual(errors, []);
    console.log('Build DNA full-window iframe escape, mobile sizing, layout and close: passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
