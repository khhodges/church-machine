'use strict';

// UI-only decoder for the persistent CHURCH stack.  This deliberately does
// not consult simulator.callStack or simulator.sto: a Thread detail can be
// opened for a dormant Thread, and the protected indicator in that Thread is
// the only authoritative stack cursor.
(function (root, factory) {
    var decoder = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = decoder;
    if (root) root.ThreadFrameDecoder = decoder;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var SENTINEL_NIA = 0x7FFF;

    function wordAt(memory, address) {
        if (!memory || !Number.isInteger(address) || address < 0 ||
                address >= memory.length) return null;
        var value = memory[address];
        return value == null ? 0 : (value >>> 0);
    }

    function error(code, message, offset, extra) {
        return Object.assign({
            code: code,
            message: message,
            offset: Number.isInteger(offset) ? offset : null,
        }, extra || {});
    }

    function decode(options) {
        options = options || {};
        var memory = options.memory;
        var base = Number(options.base);
        var layout = options.layout || {};
        var parseGT = typeof options.parseGT === 'function' ? options.parseGT : null;
        var validateGT = typeof options.validateGT === 'function' ? options.validateGT : null;
        var errors = [];
        var frames = [];
        var rawWords = [];
        var stackStart = Number(layout.stackStart);
        var stackEnd = Number(layout.stackEnd);
        var protectedOffset = Number(layout.protectedStoOffset);

        function add(code, message, offset, extra) {
            errors.push(error(code, message, offset, extra));
        }

        var geometryOK = Number.isInteger(base) && Number.isInteger(stackStart) &&
            Number.isInteger(stackEnd) && stackStart <= stackEnd &&
            Number.isInteger(protectedOffset) && protectedOffset >= 0;
        if (!geometryOK) {
            add('GEOMETRY', 'Thread stack geometry is unavailable or invalid.');
            return {
                ok: false, status: 'malformed', classification: 'malformed',
                protected: null, frames: frames, errors: errors, rawWords: rawWords,
            };
        }

        // Keep an un-decoded copy of every stack word.  Diagnostics must never
        // replace raw inspection with a friendly interpretation.
        for (var rawOffset = stackStart; rawOffset <= stackEnd; rawOffset++) {
            var raw = wordAt(memory, base + rawOffset);
            rawWords.push({ offset: rawOffset, word: raw === null ? 0 : raw });
        }

        var indicatorWord = wordAt(memory, base + protectedOffset);
        if (indicatorWord === null) {
            add('OOB', 'Protected STO address is outside the supplied memory image.',
                protectedOffset);
            return {
                ok: false, status: 'malformed', classification: 'malformed',
                protected: null, frames: frames, errors: errors, rawWords: rawWords,
            };
        }
        var protectedState = {
            offset: protectedOffset,
            address: base + protectedOffset,
            word: indicatorWord >>> 0,
            sto: indicatorWord & 0xFFF,
            sz: (indicatorWord >>> 12) & 1,
            flags: (indicatorWord >>> 28) & 0xF,
        };

        // A two-word frame has its E-GT at STO+1 and packed frame word at
        // STO+2.  This is why using the selected Thread's protected STO is
        // materially different from scanning for the highest non-zero word.
        var cursor = protectedState.sto;
        var minCursor = stackStart - 1; // frameBase may be the word before stack
        var maxCursor = stackEnd - 2;
        if (cursor < minCursor || cursor > maxCursor) {
            add('OOB',
                'Protected STO ' + cursor + ' cannot address a complete two-word frame ' +
                'inside Thread stack +' + stackStart + '…+' + stackEnd + '.',
                protectedOffset, { sto: cursor });
        }

        var seenCursors = Object.create(null);
        var maxFrames = Number.isInteger(options.maxFrames) && options.maxFrames > 0
            ? options.maxFrames : Math.max(1, Math.ceil((stackEnd - stackStart + 1) / 2) + 1);
        var rootSeen = false;
        while (errors.length === 0 && frames.length < maxFrames) {
            if (seenCursors[cursor]) {
                add('LOOP', 'Frame-chain cursor ' + cursor + ' repeats; the chain loops.',
                    cursor, { sto: cursor });
                break;
            }
            seenCursors[cursor] = true;

            var frameOffset = cursor + 2;
            var companionOffset = frameOffset - 1;
            if (frameOffset < stackStart || frameOffset > stackEnd ||
                    companionOffset < stackStart) {
                add('OOB',
                    'Frame at +' + frameOffset +
                    ' (companion +' + companionOffset + ') is outside Thread stack bounds.',
                    frameOffset, { sto: cursor });
                break;
            }
            var frameWord = wordAt(memory, base + frameOffset);
            var companion = wordAt(memory, base + companionOffset);
            if (frameWord === null || companion === null) {
                add('OOB', 'Frame or E-GT companion address is outside the memory image.',
                    frameOffset, { companionOffset: companionOffset });
                break;
            }
            rawWords[frameOffset - stackStart].frame = true;
            rawWords[companionOffset - stackStart].companion = true;
            if (!frameWord) {
                add('ZERO_FRAME',
                    'Protected STO points at an empty frame word; no frame can be decoded.',
                    frameOffset, { sto: cursor });
                break;
            }

            var nia = (frameWord >>> 13) & 0x7FFF;
            var sz = (frameWord >>> 12) & 1;
            var prevSTO = frameWord & 0xFFF;
            var frame = {
                index: frames.length,
                kind: nia === SENTINEL_NIA && prevSTO === frameOffset ? 'root' : 'ordinary',
                cursor: cursor,
                offset: frameOffset,
                companionOffset: companionOffset,
                frameWord: frameWord >>> 0,
                egt: companion >>> 0,
                nia: nia,
                sz: sz,
                prevSTO: prevSTO,
                raw: {
                    frameWord: frameWord >>> 0,
                    companion: companion >>> 0,
                },
                errors: [],
            };
            frames.push(frame);

            if (sz !== 1) {
                frame.kind = 'malformed';
                frame.errors.push(error('ZERO_COMPANION',
                    'Frame SZ=0 is not a two-word CHURCH frame; its companion is not valid.',
                    companionOffset, { frameOffset: frameOffset, sz: sz }));
                add('ZERO_COMPANION',
                    'Frame at +' + frameOffset + ' has SZ=0; expected a two-word frame with an E-GT companion.',
                    frameOffset, { companionOffset: companionOffset });
                break;
            }
            if (!companion) {
                frame.kind = 'malformed';
                frame.errors.push(error('ZERO_COMPANION',
                    'Two-word frame has a zero E-GT companion.',
                    companionOffset, { frameOffset: frameOffset }));
                add('ZERO_COMPANION',
                    'Two-word frame at +' + frameOffset + ' has zero E-GT at +' + companionOffset + '.',
                    companionOffset, { frameOffset: frameOffset });
                break;
            }

            // A raw non-zero companion is still only an inspection value.  It
            // becomes an executable frame identity only after every gate below
            // passes: parse, Inform type, E permission, and live validation.
            var gtFailure = null;
            if (!parseGT) {
                gtFailure = {
                    code: 'GT_PARSE',
                    message: 'E-GT parser is unavailable; companion remains inspection-only.',
                };
            } else {
                try {
                    frame.gt = parseGT(companion >>> 0) || null;
                } catch (e) {
                    frame.gt = null;
                    gtFailure = {
                        code: 'GT_PARSE',
                        message: 'E-GT could not be decoded: ' + (e && e.message || e),
                    };
                }
                if (!gtFailure && (!frame.gt || frame.gt.malformed)) {
                    gtFailure = {
                        code: 'MALFORMED_EGT',
                        message: (frame.gt && frame.gt.malformedReason) ||
                            'E-GT is malformed.',
                    };
                } else if (!gtFailure && frame.gt.type !== 1) {
                    gtFailure = {
                        code: 'INVALID_EGT',
                        message: 'E-GT must be an Inform GT; decoded type is ' +
                            (frame.gt.typeName || frame.gt.type) + '.',
                    };
                } else if (!gtFailure &&
                        (!frame.gt.permissions || frame.gt.permissions.E !== 1)) {
                    gtFailure = {
                        code: 'INVALID_EGT',
                        message: 'Inform E-GT is missing E (Enter) permission.',
                    };
                }
            }
            if (!gtFailure && !validateGT) {
                gtFailure = {
                    code: 'UNAVAILABLE_EGT',
                    message: 'E-GT live Namespace validation is unavailable.',
                };
            }
            if (!gtFailure) {
                try {
                    var validation = validateGT(companion >>> 0, frame.gt, frame);
                    frame.gtValidation = validation || null;
                    var validationStatus = validation && String(validation.status || '').toLowerCase();
                    if (validationStatus !== 'valid') {
                        var validationCodes = {
                            stale: 'STALE_EGT',
                            missing: 'MISSING_EGT',
                            malformed: 'MALFORMED_EGT',
                            invalid: 'INVALID_EGT',
                            unavailable: 'UNAVAILABLE_EGT',
                            null: 'INVALID_EGT',
                        };
                        gtFailure = {
                            code: validationCodes[validationStatus] || 'INVALID_EGT',
                            message: (validation && validation.message) ||
                                'E-GT validation did not return valid status.',
                        };
                    }
                } catch (e) {
                    frame.gtValidation = {
                        status: 'unavailable',
                        message: 'E-GT freshness could not be checked.',
                    };
                    gtFailure = {
                        code: 'UNAVAILABLE_EGT',
                        message: frame.gtValidation.message,
                    };
                }
            }
            if (gtFailure) {
                frame.kind = 'malformed';
                frame.errors.push(error(gtFailure.code, gtFailure.message,
                    companionOffset, { frameOffset: frameOffset }));
                add(gtFailure.code, gtFailure.message, companionOffset,
                    { frameOffset: frameOffset });
                break;
            }

            if (nia === SENTINEL_NIA) {
                if (prevSTO !== frameOffset) {
                    frame.kind = 'malformed';
                    frame.errors.push(error('ROOT_POINTER',
                        'Sentinel NIA is not self-rooted at its own frame offset.',
                        frameOffset, { prevSTO: prevSTO }));
                    add('ROOT_POINTER',
                        'Sentinel frame at +' + frameOffset +
                        ' points to +' + prevSTO + ' instead of itself.',
                        frameOffset, { prevSTO: prevSTO });
                } else {
                    rootSeen = true;
                }
                break;
            }

            // prev_STO is the older (higher) protected cursor.  It must advance
            // toward the sentinel and cannot point at the current cursor.
            if (prevSTO === cursor) {
                frame.kind = 'malformed';
                frame.errors.push(error('LOOP',
                    'prev_STO ' + prevSTO + ' points back to the current frame cursor.',
                    frameOffset, { prevSTO: prevSTO, sto: cursor }));
                add('LOOP',
                    'Frame at +' + frameOffset + ' loops back to STO ' + cursor + '.',
                    frameOffset, { prevSTO: prevSTO, sto: cursor });
                break;
            }
            if (prevSTO < cursor) {
                frame.kind = 'malformed';
                frame.errors.push(error('NON_DESCENDING',
                    'prev_STO ' + prevSTO + ' does not advance toward the root from ' +
                    'STO ' + cursor + '.',
                    frameOffset, { prevSTO: prevSTO, sto: cursor }));
                add('NON_DESCENDING',
                    'Frame at +' + frameOffset + ' has non-descending prev_STO ' +
                    prevSTO + '; expected a value greater than ' + cursor + '.',
                    frameOffset, { prevSTO: prevSTO, sto: cursor });
                break;
            }
            if (prevSTO < minCursor || prevSTO > maxCursor) {
                frame.kind = 'malformed';
                frame.errors.push(error('OOB',
                    'prev_STO ' + prevSTO + ' cannot address another frame in Thread stack.',
                    frameOffset, { prevSTO: prevSTO }));
                add('OOB',
                    'Frame at +' + frameOffset + ' points outside the Thread stack via prev_STO=' +
                    prevSTO + '.',
                    frameOffset, { prevSTO: prevSTO });
                break;
            }
            if (seenCursors[prevSTO]) {
                frame.kind = 'malformed';
                frame.errors.push(error('LOOP',
                    'prev_STO ' + prevSTO + ' points to an already visited frame cursor.',
                    frameOffset, { prevSTO: prevSTO }));
                add('LOOP',
                    'Frame at +' + frameOffset + ' loops to previously visited STO ' + prevSTO + '.',
                    frameOffset, { prevSTO: prevSTO });
                break;
            }
            cursor = prevSTO;
        }
        if (errors.length === 0 && frames.length >= maxFrames) {
            add('LOOP', 'Frame chain exceeded the safe geometry-derived walk limit.',
                cursor);
        }

        // A sentinel is terminal.  A second sentinel anywhere below it is
        // almost always stale frame data and must not be silently presented as
        // another root.  Likewise, a non-zero complete frame below the root
        // is actionable raw corruption rather than an inferred call.
        if (rootSeen) {
            var rootOffset = frames[frames.length - 1].offset;
            var duplicateRoots = [];
            var visitedFrameOffsets = Object.create(null);
            for (var visited = 0; visited < frames.length; visited++) {
                visitedFrameOffsets[frames[visited].offset] = true;
            }
            var unchainedFrames = [];
            for (var scan = stackStart; scan < rootOffset; scan++) {
                var scanWord = wordAt(memory, base + scan);
                if (scanWord === null) continue;
                if (((scanWord >>> 13) & 0x7FFF) === SENTINEL_NIA) {
                    duplicateRoots.push(scan);
                } else if (!visitedFrameOffsets[scan] &&
                        ((scanWord >>> 12) & 1) === 1 &&
                        scan - 1 >= stackStart &&
                        wordAt(memory, base + scan - 1)) {
                    // Do not reject arbitrary heap-like values in the raw
                    // stack.  This branch requires a complete-looking
                    // two-word frame that the protected-STO chain did not
                    // reach, which is actionable stale/corrupt frame data.
                    unchainedFrames.push(scan);
                }
            }
            if (duplicateRoots.length) {
                add('DUPLICATE_ROOT',
                    'Sentinel/root-like frame exists below root +' + rootOffset +
                    ' at +' + duplicateRoots.join(', +') + '.',
                    duplicateRoots[0], { rootOffset: rootOffset, duplicates: duplicateRoots });
            }
            if (unchainedFrames.length) {
                add('FRAME_BELOW_ROOT',
                    'Complete frame data exists below root +' + rootOffset +
                    ' but is not linked by prev_STO (offsets +' + unchainedFrames.join(', +') + ').',
                    unchainedFrames[0], { rootOffset: rootOffset, frames: unchainedFrames });
            }
        }

        var classification = errors.length
            ? 'malformed'
            : (rootSeen ? (frames.length === 1 ? 'root' : 'ordinary') : 'malformed');
        return {
            ok: errors.length === 0 && rootSeen,
            status: classification,
            classification: classification,
            protected: protectedState,
            frames: frames,
            root: rootSeen ? frames[frames.length - 1] : null,
            errors: errors,
            rawWords: rawWords,
            geometry: {
                stackStart: stackStart,
                stackEnd: stackEnd,
                protectedStoOffset: protectedOffset,
                minCursor: minCursor,
                maxCursor: maxCursor,
            },
        };
    }

    return Object.freeze({
        SENTINEL_NIA: SENTINEL_NIA,
        decode: decode,
    });
});