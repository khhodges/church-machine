const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'clist-viewer.js'), 'utf8');

const checks = [
  ["server access check", source.includes("fetch('/api/m-bit-ide-access'")],
  ["same-origin secret verification", source.includes("credentials: 'same-origin'")],
  ["strict unlocked response", source.includes("result.unlocked === true")],
  ["private capability name", source.includes('data-cap-name=\"M_BIT_DEV\"')],
  ["fixed namespace slot", source.includes('NS[13]')],
  ["RW rights", source.includes('data-cap-rights=\"RW\"')],
  ["inform type", source.includes('clist-picker-type--inform')],
  ["one-click grant snapshot", source.includes("var mBitClickGrant = _mBitUnlocked")],
  ["synchronous click consumption", source.includes("_mBitUnlocked = false")],
  ["option removed immediately", source.includes("if (mBitRow) mBitRow.remove()")],
  ["grant required for insertion", source.includes("capName === 'M_BIT_DEV' && mBitClickGrant !== true")],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`M-bit picker regression: ${name}`);
}

console.log('M-bit picker unlock regression: PASS');