'use strict';

// Read-only installed executable ranges. This wraps a COPY, so buffers/views
// handed out before installation cannot mutate the accepted executable bytes.
// No Thread context, PC or capability authority is stored here.
(function expose(root) {
    const owners = new WeakMap();
    function protectMemory(input) {
        if (owners.has(input)) return owners.get(input);
        if (!(input instanceof Uint32Array)) throw new TypeError('IDX1 memory must be Uint32Array');
        const storage = new Uint32Array(input), ranges = [];
        function check(start, end, value) {
            if (ranges.some(range => start < range.end && end > range.start &&
                    !(end === start + 1 && value !== undefined &&
                    (((storage[start] ^ (value >>> 0)) & ~range.mutableMask) === 0)))) {
                const error = new Error('Write overlaps an installed IDX1 executable binding');
                error.code = 'IDX1_READ_ONLY';
                throw error;
            }
        }
        const numeric = key => typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key);
        function applyChanges(changed) {
            // Complete preflight before committing any element, even when a
            // mutator crosses a protected range midway through the operation.
            for (let i = 0; i < changed.length; i++)
                if (changed[i] !== storage[i]) check(i, i + 1, changed[i]);
            storage.set(changed);
        }
        const proxy = new Proxy(storage, {
            get(target, key) {
                if (key === 'buffer') return target.buffer.slice(0);
                if (key === 'constructor') return Uint32Array;
                if (key === 'set') return (source, offset = 0) => {
                    const copy = new Uint32Array(target);
                    copy.set(source, offset);
                    applyChanges(copy);
                };
                if (['fill', 'copyWithin', 'reverse', 'sort'].includes(key)) return (...args) => {
                    const copy = new Uint32Array(target);
                    copy[key](...args);
                    applyChanges(copy);
                    return proxy;
                };
                const value = Reflect.get(target, key, target);
                // Native typed-array callbacks receive their array as an
                // argument. Run on a copy: callbacks must never see storage.
                if (typeof value === 'function') return (...args) => {
                    const copy = new Uint32Array(target);
                    return Reflect.apply(value, copy, args);
                };
                return value;
            },
            set(target, key, value) {
                if (!numeric(key)) throw new TypeError('Cannot change installed memory properties');
                const at = Number(key);
                if (at >= target.length) throw new RangeError('Memory address out of range');
                const word = value >>> 0;
                check(at, at + 1, word);
                target[at] = word;
                return true;
            },
            defineProperty() { throw new TypeError('Cannot redefine installed memory'); },
            deleteProperty() { throw new TypeError('Cannot delete installed memory'); },
            setPrototypeOf() { throw new TypeError('Cannot replace installed memory prototype'); },
        });
        const owner = Object.freeze({
            memory: proxy,
            protect(start, end, mutableMask = 0) {
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
                        start < 0 || end <= start || end > storage.length)
                    throw new RangeError('Invalid IDX1 protected range');
                ranges.push(Object.freeze({ start, end, mutableMask: mutableMask >>> 0 }));
            },
            requireWritable(start, end) { check(start, end); },
        });
        owners.set(proxy, owner);
        return owner;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { protectMemory };
    else root.ChurchIDX1Memory = Object.freeze({ protectMemory });
})(typeof globalThis !== 'undefined' ? globalThis : this);