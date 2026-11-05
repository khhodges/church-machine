// Read-only browser verification with synthetic board responses.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {execSync} = require('node:child_process');
(async () => {
  const browser = await chromium.launch({executablePath: execSync('which chromium').toString().trim(), args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    let live = false, calls = 0, writes = 0;
    await page.route('**/*', async route => {
      const req = route.request();
      if (!['GET', 'HEAD'].includes(req.method())) {
        writes++;
        return route.abort();
      }
      if (new URL(req.url()).pathname === '/hardware/wukong/status') {
        calls++;
        return route.fulfill({json:{physical_target: {live, device_uid:'fixture', session_id:'fixture'}}});
      }
      return route.continue();
    });
    await page.goto('https://' + process.env.REPLIT_DEV_DOMAIN + '/simulator/#development-image');
    const frame = page.frameLocator('#developmentImageFrame');
    const button = frame.getByRole('button', {name:'Send build to FPGA', exact:true});
    await button.waitFor();
    await frame.getByText('Checking the connection automatically…', {exact:true}).waitFor();
    assert(await button.isDisabled());
    const retry = frame.getByRole('button', {name:'Check again now', exact:true});
    assert.equal(await retry.count(), 0, 'No operator help before automatic attempts');
    await retry.waitFor({timeout:20000});
    assert(calls >= 4);
    await frame.getByText(/The bridge has not reconnected after four checks/).waitFor();
    await frame.locator('.kiss-send-hint').focus();
    assert(await frame.getByRole('tooltip').isVisible());
    live = true;
    await retry.click();
    await button.waitFor();
    await page.waitForFunction(() => {
      const f = document.querySelector('#developmentImageFrame');
      return f?.contentDocument?.querySelector('.kiss-send-button')?.disabled === false;
    });
    assert.equal(await retry.count(), 0, 'Help clears automatically on recovery');
    live = false;
    await frame.getByText('Checking the connection automatically…', {exact:true}).waitFor({timeout:10000});
    assert(await button.isDisabled(), 'A subsequent disconnect disables Send again');
    assert.equal(writes, 0, 'Recovery never posts commands, approval or installation');
    console.log('PASS automatic checks, delayed guidance, manual recheck, recovery and later disconnect');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
