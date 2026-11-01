'use strict';

// Thread design tuple definitions (design intent only).
//
// Tuples are named, typed regions laid out at heap-relative word offsets in
// the CR5 Heap zone of the normative Thread design.  They are saved with the
// browser's independently keyed Thread designs (localStorage 'lump_editor_state') and can be
// exported/imported as portable JSON.  They are NOT written into the boot
// config, the Thread header, the built .lump binary, simulator memory or
// hardware.  Tuples introduce no capability, ACL or privacy boundary: every
// abstraction running on the Thread can reach the whole CR5 heap.
(function (root) {
    var SCHEMA = 'church.thread-design.tuples';
    var VERSION = 1;
    var MAX_TUPLES = 64;
    var MAX_FIELDS = 64;
    var MAX_UTF8 = 1024;
    var MAX_WORDS = 4096;
    var NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
    var TYPES = {
        uint32: 'Unsigned 32-bit word',
        int32: 'Signed 32-bit word',
        utf8: 'UTF-8 text (length word + packed bytes)',
        words: 'Raw word array (zero-initialized)'
    };
    var POLICIES = {
        initialize: 'Initialize from design values (intent)',
        preserve: 'Preserve existing heap contents (intent)'
    };

    function fieldWords(f) {
        if (f.type === 'utf8') return 1 + Math.ceil(f.size / 4);
        if (f.type === 'words') return f.size;
        return 1;
    }
    function layout(t) {
        var off = 0;
        return (t.fields || []).map(function (f) {
            var w = fieldWords(f), r = { name: f.name, type: f.type, offset: off, words: w };
            off += w;
            return r;
        });
    }
    function tupleWords(t) {
        return layout(t).reduce(function (s, f) { return s + f.words; }, 0);
    }
    function utf8Len(s) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
        return unescape(encodeURIComponent(s)).length;
    }
    function wellFormed(s) {
        return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
    }

    function fieldDefault(type) {
        if (type === 'utf8') return { type: 'utf8', size: 32, initial: '' };
        if (type === 'words') return { type: 'words', size: 4, initial: 0 };
        return { type: type, size: 1, initial: 0 };
    }

    // Validate one field; returns array of messages.
    function fieldErrors(f, label) {
        var e = [];
        if (!f || typeof f !== 'object') return [label + ': invalid field.'];
        if (typeof f.name !== 'string' || !NAME_RE.test(f.name))
            e.push(label + ': name must start with a letter or _ and use letters, digits or _ (max 32).');
        if (!Object.prototype.hasOwnProperty.call(TYPES, f.type)) { e.push(label + ': unknown type.'); return e; }
        if (f.type === 'uint32' || f.type === 'int32') {
            if (f.size !== 1) e.push(label + ': 32-bit fields occupy exactly 1 word.');
            var lo = f.type === 'uint32' ? 0 : -2147483648, hi = f.type === 'uint32' ? 4294967295 : 2147483647;
            if (!Number.isInteger(f.initial) || f.initial < lo || f.initial > hi)
                e.push(label + ': initial value must be an integer in ' + lo + '..' + hi + '.');
        } else if (f.type === 'utf8') {
            if (!Number.isInteger(f.size) || f.size < 1 || f.size > MAX_UTF8)
                e.push(label + ': UTF-8 capacity must be 1..' + MAX_UTF8 + ' bytes.');
            else if (typeof f.initial !== 'string' || !wellFormed(f.initial))
                e.push(label + ': initial value must be valid text.');
            else if (utf8Len(f.initial) > f.size)
                e.push(label + ': initial text is ' + utf8Len(f.initial) + ' UTF-8 bytes; capacity is ' + f.size + '.');
        } else if (f.type === 'words') {
            if (!Number.isInteger(f.size) || f.size < 1 || f.size > MAX_WORDS)
                e.push(label + ': word array size must be 1..' + MAX_WORDS + '.');
            if (f.initial !== 0) e.push(label + ': word arrays are zero-initialized.');
        }
        return e;
    }

    // Full validation of a tuple list against a heap size in words.
    function validate(tuples, heapWords) {
        var e = [];
        if (!Array.isArray(tuples)) return ['Tuple list must be an array.'];
        if (tuples.length > MAX_TUPLES) e.push('At most ' + MAX_TUPLES + ' tuples.');
        var names = {}, spans = [];
        tuples.forEach(function (t, i) {
            var tl = 'Tuple ' + (t && typeof t.name === 'string' && t.name ? t.name : '#' + (i + 1));
            if (!t || typeof t !== 'object') { e.push(tl + ': invalid.'); return; }
            if (typeof t.name !== 'string' || !NAME_RE.test(t.name))
                e.push(tl + ': name must start with a letter or _ and use letters, digits or _ (max 32).');
            else if (names[t.name.toLowerCase()]) e.push(tl + ': duplicate tuple name.');
            else names[t.name.toLowerCase()] = true;
            if (!Object.prototype.hasOwnProperty.call(POLICIES, t.policy)) e.push(tl + ': policy must be initialize or preserve.');
            if (!Array.isArray(t.fields) || !t.fields.length) { e.push(tl + ': needs at least one field.'); return; }
            if (t.fields.length > MAX_FIELDS) e.push(tl + ': at most ' + MAX_FIELDS + ' fields.');
            var fn = {};
            t.fields.forEach(function (f, j) {
                var fl = tl + '.' + (f && typeof f.name === 'string' && f.name ? f.name : 'field' + (j + 1));
                e.push.apply(e, fieldErrors(f, fl));
                if (f && typeof f.name === 'string') {
                    if (fn[f.name.toLowerCase()]) e.push(fl + ': duplicate field name.');
                    fn[f.name.toLowerCase()] = true;
                }
            });
            if (!Number.isInteger(t.offset) || t.offset < 0) { e.push(tl + ': heap offset must be a non-negative integer.'); return; }
            var w = tupleWords(t);
            if (!Number.isInteger(heapWords) || t.offset + w > heapWords)
                e.push(tl + ': heap words ' + t.offset + '..' + (t.offset + w - 1) + ' exceed the ' + heapWords + '-word Heap.');
            spans.forEach(function (s) {
                if (t.offset < s.end && t.offset + w > s.start)
                    e.push(tl + ': overlaps ' + s.name + ' (heap ' + s.start + '..' + (s.end - 1) + ').');
            });
            spans.push({ name: 'Tuple ' + t.name, start: t.offset, end: t.offset + w });
        });
        return e;
    }

    function clone(v) { return JSON.parse(JSON.stringify(v)); }

    // Stable design ownership, not artifact revision identity: recompiling a
    // Thread must not discard its draft; another occupant must not inherit it.
    function bindingKey(namespace, row, namespaceSequence) {
        return JSON.stringify([String(namespace), Number(namespaceSequence || 0),
            Number(row.slot), String(row.name), Number(row.seq || 0)]);
    }
    function newDesign(row) {
        var words = Number(row && row.limit) + 1;
        var exp = Math.log2(words);
        return { thread: { lumpPow2: Number.isInteger(exp) && exp >= 8 && exp <= 13 ? exp : 8,
            stackFrames: 16, count: 1 }, tuples: [] };
    }

    // Telephone template: exact copy of ThreadHeapRecord's 58-word call record.
    function telephone(offset) {
        var R = root.ThreadHeapRecord || null;
        var s = R ? R.schema : { magic: 137, words: 58, fields: [
            { name: 'callState', type: 'enum' }, { name: 'conditions', type: 'uint32' },
            { name: 'callerName', type: 'utf8', capacity: 64 }, { name: 'telephoneNumber', type: 'utf8', capacity: 32 },
            { name: 'routingSelection', type: 'utf8', capacity: 32 }, { name: 'endpoint', type: 'utf8', capacity: 64 }] };
        var fields = [
            { name: 'magic', type: 'uint32', size: 1, initial: s.magic },
            { name: 'abiVersion', type: 'uint32', size: 1, initial: 1 },
            { name: 'extent', type: 'uint32', size: 1, initial: s.words },
            { name: 'revision', type: 'uint32', size: 1, initial: 1 }
        ];
        s.fields.forEach(function (f) {
            if (f.type === 'utf8') fields.push({ name: f.name, type: 'utf8', size: f.capacity, initial: '' });
            else fields.push({ name: f.name, type: 'uint32', size: 1, initial: 0 });
        });
        return { name: 'CallRecord', template: 'telephone', offset: offset || 0, policy: 'initialize', fields: fields };
    }
    function counter(offset) {
        return { name: 'Counter', template: 'counter', offset: offset || 0, policy: 'preserve', fields: [
            { name: 'count', type: 'uint32', size: 1, initial: 0 },
            { name: 'step', type: 'uint32', size: 1, initial: 1 },
            { name: 'limit', type: 'uint32', size: 1, initial: 4294967295 }
        ] };
    }
    function custom(offset) {
        return { name: 'Tuple', template: 'custom', offset: offset || 0, policy: 'initialize', fields: [
            { name: 'value', type: 'uint32', size: 1, initial: 0 }
        ] };
    }
    var TEMPLATES = {
        telephone: { label: 'Telephone call record (58 words)', make: telephone },
        counter: { label: 'Counter (3 words)', make: counter },
        custom: { label: 'Custom (start with one word)', make: custom }
    };

    // First offset >= 0 where `words` fit without overlap, or -1.
    function firstFit(tuples, words, heapWords) {
        var spans = tuples.map(function (t) { return [t.offset, t.offset + tupleWords(t)]; })
            .sort(function (a, b) { return a[0] - b[0]; });
        var at = 0;
        for (var i = 0; i < spans.length; i++) {
            if (at + words <= spans[i][0]) break;
            at = Math.max(at, spans[i][1]);
        }
        return at + words <= heapWords ? at : -1;
    }
    function uniqueName(tuples, base) {
        var taken = {}; tuples.forEach(function (t) { taken[String(t.name).toLowerCase()] = 1; });
        if (!taken[base.toLowerCase()]) return base;
        for (var n = 2; ; n++) if (!taken[(base + n).toLowerCase()]) return base + n;
    }

    // Returns {tuples, error}; never mutates input.  On error tuples is unchanged.
    function attempt(tuples, heapWords, mutate) {
        var next = clone(tuples || []);
        try { mutate(next); } catch (err) { return { tuples: tuples, error: String(err.message || err) }; }
        var e = validate(next, heapWords);
        return e.length ? { tuples: tuples, error: e[0], errors: e } : { tuples: next, error: null };
    }
    function addFromTemplate(tuples, key, heapWords) {
        var tpl = TEMPLATES[key];
        if (!tpl) return { tuples: tuples, error: 'Unknown template.' };
        return attempt(tuples, heapWords, function (list) {
            var t = tpl.make(0);
            t.name = uniqueName(list, t.name);
            var at = firstFit(list, tupleWords(t), heapWords);
            if (at < 0) throw new Error('No free heap range of ' + tupleWords(t) + ' words for ' + tpl.label + '.');
            t.offset = at;
            list.push(t);
        });
    }
    function updateTuple(tuples, i, patch, heapWords) {
        return attempt(tuples, heapWords, function (list) {
            if (!list[i]) throw new Error('No such tuple.');
            ['name', 'offset', 'policy'].forEach(function (k) {
                if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k];
            });
        });
    }
    function removeTuple(tuples, i) {
        var next = clone(tuples || []); next.splice(i, 1); return { tuples: next, error: null };
    }
    function markCustom(t) { t.template = 'custom'; }
    function addField(tuples, i, heapWords) {
        return attempt(tuples, heapWords, function (list) {
            var t = list[i]; if (!t) throw new Error('No such tuple.');
            var used = {}; t.fields.forEach(function (f) { used[f.name.toLowerCase()] = 1; });
            var n = t.fields.length + 1; while (used[('field' + n).toLowerCase()]) n++;
            var f = fieldDefault('uint32'); f.name = 'field' + n;
            t.fields.push(f); markCustom(t);
        });
    }
    function updateField(tuples, i, j, patch, heapWords) {
        return attempt(tuples, heapWords, function (list) {
            var t = list[i]; if (!t || !t.fields[j]) throw new Error('No such field.');
            var f = t.fields[j];
            if (Object.prototype.hasOwnProperty.call(patch, 'type') && patch.type !== f.type) {
                if (!Object.prototype.hasOwnProperty.call(TYPES, patch.type)) throw new Error('Unknown type.');
                var d = fieldDefault(patch.type); f.type = d.type; f.size = d.size; f.initial = d.initial;
            }
            if (Object.prototype.hasOwnProperty.call(patch, 'name')) f.name = patch.name;
            if (Object.prototype.hasOwnProperty.call(patch, 'size')) f.size = patch.size;
            if (Object.prototype.hasOwnProperty.call(patch, 'initial')) f.initial = patch.initial;
            markCustom(t);
        });
    }
    function removeField(tuples, i, j, heapWords) {
        return attempt(tuples, heapWords, function (list) {
            var t = list[i]; if (!t || !t.fields[j]) throw new Error('No such field.');
            if (t.fields.length === 1) throw new Error('A tuple needs at least one field; delete the tuple instead.');
            t.fields.splice(j, 1); markCustom(t);
        });
    }

    // Strict structural normalization of untrusted data (import or saved state).
    function normalize(list) {
        if (!Array.isArray(list)) throw new Error('Expected a list of tuples.');
        return list.map(function (t) {
            if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Each tuple must be an object.');
            if (!Array.isArray(t.fields)) throw new Error('Each tuple needs a fields list.');
            return {
                name: t.name, offset: t.offset, policy: t.policy,
                template: TEMPLATES[t.template] ? t.template : 'custom',
                fields: t.fields.map(function (f) {
                    if (!f || typeof f !== 'object' || Array.isArray(f)) throw new Error('Each field must be an object.');
                    return { name: f.name, type: f.type, size: f.size, initial: f.initial };
                })
            };
        });
    }
    function exportJson(tuples, heapWords) {
        return JSON.stringify({ schema: SCHEMA, version: VERSION, scope: 'thread-design',
            note: 'Design intent only; not part of the boot config, LUMP binary or hardware state.',
            heapWords: heapWords, tuples: normalize(tuples).map(function (t) {
                var o = clone(t); o.words = tupleWords(t); return o;
            }) }, null, 2);
    }
    // Validates fully before returning; caller replaces only on success.
    function importJson(text, heapWords) {
        var doc;
        try { doc = JSON.parse(text); } catch (e) { throw new Error('Not valid JSON.'); }
        if (!doc || typeof doc !== 'object' || doc.schema !== SCHEMA || doc.version !== VERSION)
            throw new Error('Expected schema ' + SCHEMA + ' version ' + VERSION + '.');
        var list = normalize(doc.tuples);
        var e = validate(list, heapWords);
        if (e.length) throw new Error(e[0] + (e.length > 1 ? ' (+' + (e.length - 1) + ' more)' : ''));
        return list;
    }

    var api = { SCHEMA: SCHEMA, VERSION: VERSION, TYPES: TYPES, POLICIES: POLICIES, TEMPLATES: TEMPLATES,
        fieldWords: fieldWords, layout: layout, tupleWords: tupleWords, validate: validate, normalize: normalize,
        addFromTemplate: addFromTemplate, updateTuple: updateTuple, removeTuple: removeTuple,
        addField: addField, updateField: updateField, removeField: removeField,
        exportJson: exportJson, importJson: importJson, utf8Len: utf8Len,
        bindingKey: bindingKey, newDesign: newDesign };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ThreadTupleDesign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
