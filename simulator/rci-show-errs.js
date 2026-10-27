// rci-show-errs.js — Maps lumpAudit() RCI errors to { line, message } objects
// consumed by _showAsmErrors() in the editor.  Loaded as a plain <script> tag
// in the browser and imported via require() in Node.js tests.
//
// Exported function:
//   mapRciAuditErrorsToShowErrs(auditErrors) → Array<{ line: number|null, message: string }>

'use strict';

/**
 * Convert an array of lumpAudit() error results into the flat { line, message }
 * format expected by _showAsmErrors().
 *
 * Rules:
 *   - RCI error with violations: one entry per violation whose sourceLine > 0
 *     (line = sourceLine).  If none qualify, one fallback entry with line: null.
 *   - Non-RCI error: one entry with line: null and message "[ruleId] msg — detail".
 *
 * @param {Array} auditErrors  Elements from lumpAudit() with severity === 'error'.
 * @returns {Array<{line: number|null, message: string}>}
 */
function mapRciAuditErrorsToShowErrs(auditErrors) {
    var showErrs = [];
    for (var i = 0; i < auditErrors.length; i++) {
        var r = auditErrors[i];
        if (r.ruleId === 'RCI' && Array.isArray(r.violations) && r.violations.length > 0) {
            var beforeLen = showErrs.length;
            for (var j = 0; j < r.violations.length; j++) {
                var v = r.violations[j];
                if (v.sourceLine != null && v.sourceLine > 0) {
                    showErrs.push({ line: v.sourceLine, message: '[RCI] ' + v.msg });
                }
            }
            if (showErrs.length === beforeLen) {
                showErrs.push({ line: null, message: '[RCI] ' + r.message + ' \u2014 ' + r.detail });
            }
        } else {
            showErrs.push({ line: null, message: '[' + r.ruleId + '] ' + r.message + ' \u2014 ' + r.detail });
        }
    }
    return showErrs;
}

// Match the final LUMP layout, not concatenated method bodies: header,
// dispatch entries (including aliases), then non-aliased bodies. Never give
// generated dispatch words an invented editor line.
function buildAuditSourceLines(result, words) {
    const cw = (words[0] >>> 10) & 8191;
    const lines = new Array(cw + 1).fill(null);
    const methods = result.methods || [];
    let cursor = 1 + methods.length;
    if (methods.length + methods.reduce((n, m) =>
        n + (m.aliasOf ? 0 : (m.code || []).length), 0) !== cw) return lines;
    for (const method of methods) {
        if (method.aliasOf) continue;
        const mapping = ((result.manifest || []).find(m => m.name === method.name) || {}).mapping || [];
        let mappedLine = null;
        for (let i = 0; i < (method.code || []).length; i++, cursor++) {
            // Later records at the same address replace labels with the
            // actual emitting statement. Implicit code has no authored line.
            for (const entry of mapping) {
                if (entry.addr === i) mappedLine = /implicit|^label\b/i.test(entry.desc || '')
                    ? null : entry.src;
            }
            const line = method.lineNums?.[i] ?? mappedLine;
            // Metadata describes this compile, not arbitrary saved bytes.
            // A relocated/otherwise different word is left unlocated rather
            // than falsely highlighting unrelated source.
            if ((words[cursor] >>> 0) === (method.code[i] >>> 0) &&
                Number.isInteger(line) && line > 0) lines[cursor] = line;
        }
    }
    return lines;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mapRciAuditErrorsToShowErrs, buildAuditSourceLines };
}
