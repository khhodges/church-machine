'use strict';

// Compatibility entry point for consumers of the retired hardware-simulator
// assembler path. Keep one canonical ChurchAssembler implementation so browser
// and hardware-simulation callers cannot drift.
module.exports = require('../simulator/assembler.js');