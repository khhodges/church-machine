'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const start = src.indexOf('function _historyActivationEligibility(');
const end = src.indexOf('function _updateLumpBootstrapRepairControls(', start);
const ctx = { _escHtml: value => String(value).replaceAll('<', '&lt;') };
vm.createContext(ctx);
vm.runInContext(src.slice(start, end), ctx);
const check = { code: 'bootstrap_identity_mismatch', category: 'destination',
    status: 'fail', message: 'Record token differs from destination.', next_action: 'Review reissue.' };
const data = { activation_eligibility: { status: 'blocked',
    checks: [check, {...check, message: 'Different wording for the same reason.'}],
    reasons: [check] },
    preview_issues: [{message: 'Direct History activation is disabled because this revision is not a valid live candidate.'}],
    validation_errors: ['Duplicate legacy validation text'] };
const html = ctx._lumpHistoryPreviewIssueSummary(data, false, true);
assert.equal((html.match(/data-reason-code=/g) || []).length, 1);
assert.ok(html.includes('Review reissue.'));
assert.ok(!html.includes('valid live candidate'));
assert.ok(!html.includes('Duplicate legacy'));
const missing = ctx._lumpHistoryPreviewIssueSummary({binary_valid:true}, false, true);
assert.ok(missing.includes('Activation eligibility could not be determined'));
assert.equal(ctx._historyActivationEligibility({binary_valid:true,restore_enabled:true}).status, 'unknown');
assert.equal(ctx._historyActivationEligibility({activation_eligibility:{
    status:'eligible',checks:[],reasons:[]},historical_record:true}).status, 'eligible');
assert.ok(src.includes("eligibility.status === 'eligible'"));
console.log('PASS server authority, missing report, historical status, coded deduplication and next actions');