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
          nodes: [{ id: 'm', slot: 1, name: 'MMIO', kind: 'Hardware' },
            { id: 't', slot: 2, name: 'Thread', kind: 'Thread' }], edges: [],
        } : { ok: true, bitstreams: [], namespaces: [{ id: 'fixture', label: 'Fixture', imageAvailable: true }] });
      } else {
        throw new Error('Unexpected request: ' + url);
      }
      return route.fulfill({ body, contentType });
    });
    await page.goto('http://dna.test/');
    const frame = page.frameLocator('iframe');
    await frame.locator('#tbdNamespace').selectOption('fixture');
    await frame.getByRole('button', { name: 'Inspect Namespace', exact: true }).click();
    await page.locator('.tbd-node').first().waitFor();
    await page.waitForFunction(() => document.querySelector('.tbd-dialog').getBoundingClientRect().width === innerWidth);
    let bounds = await page.locator('.tbd-dialog').boundingBox();
    assert.deepStrictEqual(bounds, { x: 0, y: 0, width: 1200, height: 800 });
    assert.equal(await frame.locator('.tbd-dialog').count(), 0);
    await page.locator('#tbdLayout').selectOption('organized');
    assert.deepStrictEqual(await page.locator('.tbd-node title').allTextContents(), ['t', 'm']);
    await page.setViewportSize({ width: 390, height: 844 });
    bounds = await page.locator('.tbd-dialog').boundingBox();
    assert.equal(bounds.width, 390);
    assert.equal(bounds.height, 844);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.locator('.tbd-dialog').getAttribute('open'), null);
    await frame.getByRole('button', { name: 'Inspect Namespace', exact: true }).click();
    await page.locator('.tbd-node').first().waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.tbd-dialog').open);
    assert.deepStrictEqual(errors, []);
    console.log('Build DNA full-window iframe escape, mobile sizing, layout and close: passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
