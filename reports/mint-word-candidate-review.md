# Mint CREATE word-address candidate

## Result

Prepared a separate, unbound software candidate for the frozen Amoeba retry
boot bitstream. No catalog publication, Namespace modification, boot image,
RTL replay, hardware command, installation, or flash write occurred.

- Frozen BIT: `a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`
- Original Mint: `d83a4f45f9916a1911881461adab3405839f2316aa0b0215bcab12f67e8be797`
- Original source: `c32e5b555453b0ea2b6c7b8a749d81285a923758f9181fcffa6f9ad941c4ee01`
- Candidate source: `1d1afe71794e32f0b13846d471c29716c705d82a4b48f26bd91c470eaa98972c`
- Candidate LUMP: `683d9dfd8ed57a78be05df17bc7bb241b0aa3d5366536f32ec4d007250eb4bfe`

Files are under `generated-artifacts/mint-word-candidate-1d1afe71794e/`:
`candidate.cloomc`, `candidate-UNBOUND.lump`, and `receipt.json`.
The LUMP is a big-endian portable artifact, not a little-endian UART image.

## Bounded change

CREATE still receives Cleaner's physical byte address. After alignment,
allocation-extent and sequence checks succeed, it converts that base to a
resident word address before calculating descriptor integrity. RAM extents
must fit the frozen BIT's 16,384 words. Rejection and retirement do not convert
the address or report descriptor readiness.

The public API is unchanged. The passkey remains present and ignored.
All source outside the descriptor block is unchanged. No verifier or approval
load was added. All eight C-list rows remain NULL pending explicit binding.

## Verification

`node simulator/test_mint_saved_word_candidate.js` passed:

- Verified the pinned source companion and its executable/C-list correspondence
  to the original primary LUMP.
- Recompiled the original source to exactly the original executable words
  before adapting it.
- Compiled the complete candidate, preserving its API and binding declaration.
- Executed the candidate's extracted descriptor block in the software simulator:
  six valid cases, nine rejection cases, and two retirement cases.
- Checked exact output base, limit/version, integrity, and issued token,
  including nonzero versions and the final RAM word.
- Checked no capability changes or memory writes outside simulator DR homes.
- Confirmed the original saved LUMP remained byte-for-byte unchanged.

These are component checks, not a complete CREATE call or frozen-RTL execution.

## Remaining boundaries

The candidate is not installable. MintState, Cleaner and its state/pool, the
Namespace RW alias, scratch, caller entry, and slot history still require
reviewed binding and placement.

DESTROY is unchanged and retains the original byte-address contract. It is
not qualified for objects issued by this word-address CREATE candidate.
MakeOutform/MakeInform are also not qualified by this work.

Next review: specify the exact private bindings and allocation layout for a
CREATE-only demonstration, including the proposed slot-22 Namespace-table
alias and its verified sequence. Do not infer fresh issuance history from
empty descriptor words.
