const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/namespace-binding-windows.js','utf8');
const cascade = source.slice(source.indexOf('    function cascade()'), source.indexOf('    function drag('));
for (const width of [400, 768, 1280]) {
    const wins = Array.from({length:8}, () => ({style:{},classList:{remove(){}}}));
    const ctx = {root:{innerWidth:width,innerHeight:900},wins,STEP:28,z:10,front(){}};
    vm.runInNewContext(cascade+';cascade();',ctx);
    for (const w of wins) {
        assert(parseFloat(w.style.left) >= 0);
        assert(parseFloat(w.style.left)+Math.min(560,width-24)<=width,
            'all title controls must fit horizontally');
    }
    assert(new Set(wins.map(w=>w.style.top)).size===8,'all headers remain staggered');
}
console.log('Binding window cascade fits narrow and wide screens: PASS');
