// Regression: shared select standard matches Target selector and is loaded.
const fs = require('fs'), path = require('path'), assert = require('assert');
const css = fs.readFileSync(path.join(__dirname, 'styles-select.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
for (const s of ['#e7e7f2', '#1a1a2a', '1px solid #4a4a68', 'border-radius: 3px', 'font-size: .7rem', 'padding: 2px'])
  assert(css.includes(s), 'missing ' + s);
assert(!/body select\s*\{[^}]*max-width/.test(css), 'shared rule must not truncate width');
assert(/styles-select\.css\?v=/.test(html), 'index.html must link styles-select.css');
assert(html.indexOf('styles-select.css') > html.indexOf('styles-tools.css'), 'must load after other sheets');
assert(/\.programming-target select \{ max-width:185px/.test(html), 'Target keeps its max-width');
console.log('select standard: ok');
