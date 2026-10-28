'use strict';
// Source export only: no Namespace, approval, simulator or hardware mutations.
const fs = require('fs'), path = require('path');
const {sources} = require('../simulator/attack_progress_sources');
const {resolved} = require('../simulator/attack_progress_candidate');
const directory = path.resolve(__dirname, '../simulator/examples/factory-build');
fs.mkdirSync(directory, {recursive:true});
const programs = {};
for (const [name, template] of Object.entries(sources())) {
    const program = resolved(template);
    const filename = path.join(directory, name + '.cloomc');
    fs.writeFileSync(filename, program.source + '\n');
    programs[name] = {path:path.relative(path.dirname(__dirname),filename),
        codeWords:program.built.words.slice(1,1+program.built.cw),
        offsets:program.offsets};
}
console.log(JSON.stringify(programs));
