'use strict';

// Explicitly approved isolated-profile rule, not a global ISA/GT change.
// Keep normal encoding, domain purity and every non-LS permission combination.
const combinedLS = (type, p) => type === 1 && p.L === 1 && p.S === 1 &&
    !p.E && !p.R && !p.W && !p.X;

module.exports = Base => class CombinedLSProfile extends Base {
    parseGT(word) {
        const parsed = super.parseGT(word);
        if (combinedLS(parsed.type, parsed.permissions)) {
            parsed.malformed = false;
            parsed.malformedReason = null;
        }
        return parsed;
    }

    createGT(seq, slot, permissions, type) {
        if (!combinedLS(type, permissions)) {
            return super.createGT(seq, slot, permissions, type);
        }
        // Combine two normally encoded single-permission views of the SAME
        // identity. No new bits, Abstract credentials or E combinations.
        return (super.createGT(seq, slot, {...permissions, S: 0}, type) |
            super.createGT(seq, slot, {...permissions, L: 0}, type)) >>> 0;
    }
};
