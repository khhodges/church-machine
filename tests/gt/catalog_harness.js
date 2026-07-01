// Headless harness: dumps _getHardwareBootCatalog() from ChurchSimulator to stdout as JSON.
// Used by test_ns_catalog_purity.py to cross-check the Python catalog against the simulator.

global.window = { bootConfig: {} };
const ChurchSimulator = require('../../simulator/simulator.js');
const sim = new ChurchSimulator();
process.stdout.write(JSON.stringify(sim._getHardwareBootCatalog()));
