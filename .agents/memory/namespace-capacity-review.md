---
name: Namespace capacity in ISA review
description: Distinguish configured Namespace capacity from an architectural restriction.
---

The user clarified that Namespace slot count is configurable. Do not present
64 slots or limit 63 as an ISA requirement. For N slots, the inclusive slot
limit is N−1.

**Why:** The review's fixed 64-slot wording incorrectly suggested an
architectural restriction, confusing a particular boot configuration with
the general rule.

**How to apply:** Use N and N−1 in architectural review wording. Keep exact
configured values when describing retained boot inputs or hardware evidence;
this clarification does not authorize changing those inputs.

The Namespace LUMP header must define total RAM memory, not merely Namespace
slot count. Total RAM extent, table address range, and slot-index limit are
distinct architectural quantities.

**Why:** The user explicitly corrected the header's description as only
Namespace structure, slot capacity and table bounds.

**How to apply:** Include total RAM extent in the Namespace header's ISA
definition. Do not equate the slot limit N−1 with the RAM address limit or
invent field encodings without review.

The user clarified active Namespace placement: its base is the first free
memory address, starting at zero for Boot.Namespace. System.Namespace starts
at the next free address and follows the header rules. The header defines
memory size; the table starts with metadata at the high end of that Namespace
allocation and counts downward.

**Why:** A raw table-base interpretation of CR15 cannot represent the user's
whole-allocation geometry, and ascending hardware descriptors conflict with
the requested ordering.

**How to apply:** Derive each active table from its own allocation base and
header-defined capacity, not host configuration or the inspected Namespace.
Do not treat zero as a missing Namespace base. Preserve existing saved artifacts
and approval boundaries; this clarification alone does not settle migration
of their GT slot numbering.

The user subsequently approved a whole-allocation word limit (size minus one)
for CR15, then reopened that choice for design review: consider a low-end,
ascending NST with CR15 covering only the table and the full memory range
described by slot-0 metadata. This is a proposal for comment, not authorization
to migrate artifacts or implement the ascending alternative.

**Why:** The user wants to evaluate FPGA and testing simplicity before
continuing implementation. Treat neither the earlier descending direction
nor the proposed ascending replacement as permission to bypass this review.

**How to apply:** Pause geometry-dependent runtime integration during this
review. Distinguish table capability bounds, full memory-range metadata,
and the enforcement that keeps member descriptors inside that range.

In the subsequent table-only bounds review, the user answered “OK?? Next”
after the recommendation to use a word extent. The working interpretation,
stated back to the user, is CR15.limit = 4*N - 1 for N four-word slots,
including metadata slot 0, rather than N - 1 as a slot-index limit.

**Why:** Table bounds must not be confused with the full memory allocation
described by Namespace metadata. This replaces the earlier whole-allocation
limit in the proposed table-only design.

**How to apply:** Check the complete four-word entry against the word extent,
and keep metadata slot 0 separate from capability targets. This bounds
decision does not by itself authorize migration of saved artifacts or
complete the combined SWITCH/CHANGE and fault-management specification.

The user requires the IDE Namespace design page to support several Namespace
LUMPs. Each LUMP's size and header determine its metadata; metadata placement
is not an independently configurable design input.

**Why:** The user rejected treating header discovery and table geometry as
unrelated configuration choices when the Namespace LUMP is deterministic.

**How to apply:** Model named Namespace designs separately, derive allocation
and metadata locations from their headers and sizes, and keep the IDE's
selected design separate from execution's active CR15. Do not ask the user to
manually supply derived metadata addresses.

The user's latest proposal reserves top-of-memory slot 0 for Namespace
metadata: W0 header, W1 base address always present, W2 following-member count,
and W3 reserved, with no cold-boot seal for now. The Namespace self-entry moves
to slot 1 and the initial Thread to slot 2. This supersedes the earlier
optional-base-word proposal, but is not an approved implementation migration.

**Why:** The user wants to avoid redundant table offsets and speculative
version/seal fields in the ISA.

**How to apply:** Derive table bounds from capacity, slot count and base.
Keep metadata separate from capability-resolvable entries. Four-word slots
are numbered W0–W3. Do not invent seal semantics or change retained boot
inputs. The user directs bootstrap to trust the IDE builder and the seals;
this does not introduce a W3 seal or waive applicable mLoad checks.

In the later ascending-table review, the user explicitly chose slot 0 as the
physical Namespace header, replacing the old separate sixteen-word physical
header. For the new layout, metadata occupies base+0..3, Namespace self occupies
base+4..7, and the entry Thread descriptor occupies base+8..11.

**Why:** A low-end ascending NST must not overlap a second physical header.
Header-first transfer does not require a duplicate header allocation in RAM.

**How to apply:** Use one four-word metadata/header slot in the new in-memory
layout. The earlier top-of-memory placement above is superseded by low-end
ascending placement. Do not retain a sixteen-word prefix, add padding for it,
or reinterpret metadata as an ordinary capability. Preserve retained images;
this design approval is not authority to rewrite their bytes in place.

The user authorized preparation of a new-format boot Namespace revision for
approval before runtime cutover, including an explicit non-conflicting UART
assignment. This does not authorize installation or changing the selected
resident artifacts.

**Why:** Metadata/self/Thread slots 0/1/2 conflict with the historical
Namespace/Thread/UART assignments. A staged, reviewed replacement preserves
the existing artifacts and approval boundaries.

**How to apply:** Freeze exact inputs, preserve the three selected residents,
and expose affected bindings and relocation decisions for review. Never
present a layout-only proposal as an execution-approved image or silently
patch concrete GTs inside immutable resident LUMPs.

The user assumes LUMPs arrive in order, header first. Under that proposed
arrival contract, an incoming Namespace's header is available before its
in-memory top-of-range metadata slot must be located.

**Why:** Treating arrival layout as identical to final RAM placement creates
an unnecessary circular-discovery objection.

**How to apply:** Distinguish header-first transfer from final placement.
The header supplies declared geometry, not permission to write the declared
range. Do not claim existing transfer implementations already follow this
proposed contract without checking.

The user confirms that header-first arrival also applies to Abstraction and
Thread LUMPs being loaded into a Namespace.

**Why:** This is intended as one common loading principle, not a special
Namespace-only mechanism.

**How to apply:** Interpret each type's existing header to obtain allocation
size and geometry. Keep destination placement and Namespace registration
authorized separately; do not invent base-address words for Abstractions or
Threads or treat loading a Thread as activating it.

The user confirmed the review direction: all resident LUMPs and I/O-definition
LUMPs follow their Namespace, with W2 holding following-member count M.
This supersedes the earlier resident-only count R. M excludes the enclosing
Namespace and unsupplied nonresident entries. Readiness requires all M members to
arrive and validate; a missing or invalid member leaves loading incomplete.

**Why:** An explicit completion boundary makes it possible to determine
whether the Namespace's required resident contents have arrived.

**How to apply:** This is agreed review direction, not an implemented format
or authorization to change hardware. Distinguish member count from table
capacity. Member-to-slot association needs a proposal. The user explicitly
says nested Namespaces follow the already-agreed loading rule; do not reopen
that principle as undecided. Distinguish that principle from any new proposal
for exact stream order or count scope.

The user requires the architectural loading and placement rules at the
Church/top level of the ISA review, without IDE or loader implementation
details. A prepared Namespace determines resident locations and slots;
the association's exact encoding remains unresolved.

**Why:** Deterministic placement is architectural, while which tool prepares
it is not. The user explicitly requested consolidation of the architecture.

**How to apply:** State the prepared-layout contract independently of the IDE.
Do not silently preserve obsolete slot-0 self-entry or slot-1 Thread wording
in the review's bootstrap sections.

The user identifies an IDE requirement for the proposed format: show
Namespace metadata as slot 0, distinct from ordinary capability entries.

**Why:** The table display must make the metadata reservation explicit rather
than presenting it as an ordinary Namespace object slot.

**How to apply:** Show W0 header, W1 base, W2 member count and W3 reserved for
the new format. Do not merely relabel legacy images whose actual slot 0
still represents the Namespace self-entry. This discussion does not itself
authorize migrating retained images or moving device bindings.

The user agreed to define an I/O-definition LUMP in the architectural review
to represent I/O in the common arrival sequence. Type `11` deliberately replaces the historical Outform header
meaning; GT type encodings and nonresident entries remain unchanged.

**Why:** It eliminates the special omission of I/O from an ordered
sequence of Namespace member definitions.

**How to apply:** Distinguish a device-description record from device register
contents; loading it must not copy a LUMP body into MMIO or perform device
I/O. Its mapping and rights remain bounded by existing loading authority.
Count the following definition once in M, not the device as a resident body.
The user approved the unbiased power-of-two exponent after
clarifying that n=0 means one word, n=1 two words, n=2 four words, and n=3
eight words. They subsequently approved two distinct I/O LUMP types, simple
UART-style I/O and large framebuffers, explicitly saying not to mix them.
Do not treat the earlier common exponent proposal as a standing requirement
to give both classes the same size representation.
Do not treat type 11 as unused, preserve
its old header interpretation in the new format, or invent a persistent RAM
allocation. Adoption is review-only, not implementation migration authority.

The user rejected the direct-slot alternatives and agreed instead to separate
arrival format from slot format: header-first, size-based I/O arrival converts
to Namespace entry word order, retaining the base in W0. They subsequently
approved repurposing the capability entry's W3 from cached token to
authoritative kind, including the illustrative 1080p example.

**Why:** Both LUMP arrival and Namespace entries should remain internally
consistent; their word orders need not be identical.

**How to apply:** Keep simple register windows with exact counts and existing
bounds separate from large framebuffer allocations with power-of-two sizes.
Do not change every ordinary Namespace entry solely to accommodate a screen.
The arrival subtype encoding and protected register/context packing
remain to be agreed. Where the direct exponent
is used, it has no +6 bias. Preserve existing biases for other header types. The whole declared
device window must be authorized; never round up and thereby broaden access.
Large framebuffer support requires resolving capability-bound representation,
not merely changing the arrival header.
Preserve generation and flags, bind the new kind in integrity, and account
explicitly for displaced token-cache consumers, including nonresident paths.
Do not reinterpret retained entries or metadata slot 0's reserved W3.

**Why separate I/O classes:** The user wants large framebuffer requirements
handled independently rather than forcing a new general bounds format on
simple UART-style devices. Distinct arrival types alone do not solve the
runtime extent limit; preserve the distinction through capability resolution.

**Why the W3 change:** The user approved an explicit authoritative entry kind
instead of stealing exact-limit or generation bits. The framebuffer's
exponent interpretation must not be selectable through an untrusted label.

**How to apply:** Keep ordinary/simple exact bounds and framebuffer exponent
bounds distinct through resolution and protected save/restore. The revised
integrity calculation and cache-token migration remain prerequisites, not
completed work. The 1080p example's addresses are illustrative only.

The user reiterates that authority for Namespace objects always comes from
their GTs. Entry kind is validated target-description data, not an independent
source of permission.

**Why:** Calling W3 "authority" blurred the distinction between the GT's
authorization and the Namespace data used to resolve its target.

**How to apply:** Describe GT permission and generation validation separately
from target location, extent, kind and integrity. Binding the kind protects
the interpretation of the target; it does not mint or grant authority.

Historical W3 naming is misleading: its former "Abstract GT" annotation was
a slot permission-intent hint, not a complete object-access GT. Historical
construction left slot, sequence and type zero. It was later replaced with
a non-authoritative content cache tag.

**Why:** The user recalled the old annotation while evaluating W3 reuse.
Non-authoritative does not mean unused: content lookup and restoration can
depend on a cache tag without treating it as access authority.

**How to apply:** Explain the historical distinction rather than interpreting
legacy names as current GT semantics. Before repurposing W3, account for
lookup, nonresident identity serialization and protected inspection/copy
paths; a new kind value must never enter those paths as a cache token.

The user clarified that T is the LUMP ID used by the IDE. During bootstrap,
T === GT for simplicity; that equality will change when multiple
Church-Machines are networked. Treat this as product intent, not evidence
that every current implementation path already enforces the equality.

**Why:** The current "cache token" terminology understates T's intended
identity role. Equality of bootstrap values does not make LUMP identification
and capability authority interchangeable.

**How to apply:** Keep IDE LUMP identity separate from GT access authority.
Do not derive T permanently from a local GT or discard T when repurposing W3.
The user explicitly requires the replacement proposal to retain W3 as T for
the networked IDE. This supersedes the earlier approval to repurpose W3;
do not move or discard T in the next design.

The user agreed to a vendor-neutral display interface separating control
registers from framebuffer access, with a simple display controller first
and NVIDIA/other GPU support left to a later driver.

**Why:** A framebuffer mapping is not a GPU driver; modern GPU initialization,
command submission and DMA require additional device-specific authority and
isolation.

**How to apply:** Keep the architectural framebuffer vendor-neutral. Do not
claim a pixel-buffer capability authorizes GPU control or DMA, or that CPU
capability checks constrain device bus-master accesses. Hardware integration
and release remain separately authorized work.
