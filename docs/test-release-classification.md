# Test purpose and FPGA release classification

This classifies the checks reviewed during FPGA release preparation. It is not
an exhaustive inventory, a release approval, or permission to skip failing tests.
Suite exit codes and registration remain unchanged. A mixed suite must be
triaged by its failed assertion, not labelled entirely obsolete or safe.

## Decision rules

- **Keep / release-critical:** protects selected input identity, authority,
  execution, or reproducible hardware. A demonstrated violation blocks release.
- **Correct:** the requirement is useful but the assertion, fixture, decoder,
  or choice of authoritative input is wrong. Keep it active until corrected.
- **Retire an expectation:** the asserted behavior was explicitly superseded.
  Replace it with the current requirement; do not remove the surrounding suite.
- **Product quality / conditional release impact:** matters to the IDE or
  library, but blocks this hardware image only if its inputs or preparation,
  delivery, or verification path are affected.
- **Unresolved:** no automatic waiver. Establish the actual requirement and
  evidence before calling a failure obsolete or changing the program.

The selected approved immutable artifact, saved Namespace, and explicitly
prepared Thread context define this release's inputs. A newer example or builder
does not automatically supersede them. Release intent remains subject to
identity, permission, structural, and actual-target compatibility checks.

## Keep: release-critical checks

| Suites / checks | Why needed | Release-blocking evidence |
| --- | --- | --- |
| `bootstrap-resident-identity-tests`, `attested-compiler-admission-tests`, selected-artifact checks within `lump-consistency` | Prevent missing, substituted, unapproved, or incorrectly bound executable artifacts. | Identity/approval disagreement affecting selected inputs. |
| `boot-image-matches-sim`, `boot-image-loads-and-boots`, `boot-layout-regression` | Verify image layout, descriptors, and agreement about loaded bytes. | Invalid layout or wrong selected bytes/authority. These do not alone prove the application loop works. |
| `boot-entry-sync-tests`, `install-boot-entry-cr0-tests`, `three-instruction-boot-tests` | Preserve explicitly prepared startup authority. | Regeneration or boot silently changes the intended entry. Also verify the selected Thread.2 continuation, not just a generic boot fixture. |
| `call-cr6-l-perm-tests`, `return-cr6-l-perm-tests`, `return-fetch-lump-tests`, `return-cr14-trace-tests`, relevant CHANGE/method-dispatch checks | Protect calls, returns, thread switching, and protected state. | Wrong target, corrupted return state, stack fault, or an encoding the target cannot execute. |
| Exact-image CapabilityTest/SelfTest/WukongCallHome loop replay | Prove the intended program using the exact candidate inputs. | Unexpected fault or wrong flow. Historical probe results are not evidence for a changed image. |
| `wukong-boot-rom-guard`, `method-dispatch-rtl-release`, `wukong-release-bundle` | Bind generated hardware and release products to verified inputs. | Unexplained ROM/source/build divergence or failed actual-target compatibility. Regenerate only after agreeing on inputs. |
| `wukong-command-delivery-tests`, `wukong-fault-sentinel`, `boot-rom-no-false-halt` | Ensure board operations and observations are trustworthy. | Lost/misattributed command or fault evidence in the release test path. |
| `check-lumps-guard`, `sync-guard-tests` | Prevent tests from modifying live artifacts or silently dropping registered validation. | Unintended live mutation, missing suites, or invalid registry configuration. |

## Correct: useful checks with faulty assumptions

| Check | Correction / current treatment | Why retain it |
| --- | --- | --- |
| `check-capabilities-blocks` → embedded-content checker | Decode raw-DEFLATE source when frame flag `0x04` is set. Corruption and bounds errors remain failures. | Distinguish real damaged content from compressed bytes mistaken for text. |
| Same checker: equality with repository examples | Classify equality failures as **example freshness**, not proof that the selected executable is defective. Strict comparison still fails; no exemption added. Reconcile exact selected source and intended example deliberately. | Finds source packaging drift without granting old examples authority over approved artifacts. |
| `check-selftest-lump-stale` and the freshness prerequisite in `selftest-lump-runs` | Separate source text, instruction body, method-entry encoding, and identity. The existing prerequisite remains active pending a properly separated execution fixture. | Freshness is useful evidence, but a setup error is not an observed execution fault. |
| SelfTest method-entry equality | Treat builder-format mismatch as compatibility requiring actual-target evidence, not automatically as invalid execution. No format allowance is added by this classification. | Prevent unsupported dispatch without requiring unsupported claims about older formats. |
| Bootstrap migration approval retention | Accept exact completed deletion evidence for unselected history; reject pending/mismatched evidence and missing live selections. Implemented and regression-tested. | Keep audit evidence after authorized cleanup without weakening live identity checks. |
| `boot-image-upload-endpoint`, config-write case in `boot-image-serve-endpoints` | Exercise protected-change preview/confirmation before asserting downstream behavior; independently test rejection without confirmation. **Still pending; do not bypass the guard.** | Protect user consent and image validation as separate requirements. |

## Retire obsolete assertions, preserve their purpose

| Old expectation | Replacement / status | Why |
| --- | --- | --- |
| Compiler and worker output for SelfTest must contain `Next` | Assert exactly compiler-owned `SELF`, including worker row zero. Updated. | SelfTest returns to its caller; CapabilityTest owns the loop. |
| CapabilityTest must avoid calling SelfTest because SelfTest ran earlier | Reject this as authority for the selected program; do not rebuild selected artifacts from that older example. Example/builder reconciliation remains pending. | Intended flow is CHANGE to Thread.2, CALL SelfTest, CALL WukongCallHome, repeat. |
| Old download controls/endpoints must remain forever | **Conditional retirement only:** inspect `bitstream-version-labeling-tests`, confirm the supported replacement delivery contract, then update exact-route/UI assertions. | Retired controls are not requirements, but correct artifact identity and delivery remain mandatory. |

Never rewrite immutable historical binaries to remove old syntax or capabilities.
An explicit historical compatibility fixture may still describe an old format;
it must not assert that today's selected program needs that old behavior.

## Product quality and unresolved failures

| Suite / area | Why needed | Release relevance |
| --- | --- | --- |
| `ns-slot-modal-persist-tests` | Preserve the user's saved placement choices. | Failure remains unresolved. Blocks release if the affected path prepares its configuration. |
| Unselected Mallory/Ethernet checks in `lump-consistency` | Keep library capability declarations usable. | Conditional on selection or dependency; not a reason to alter unrelated selected LUMPs. |
| Editor, search, tooltip, documentation tests | Prevent IDE regressions and misleading information. | Usually product quality; relevant if an error changes or conceals release inputs. |
| `e2e-tests` | Exercise integrated user journeys. | Classify each failure. A suite-wide red result does not identify a hardware defect, and a green result does not replace exact-image execution. |
| `bitstream-version-labeling-tests` | Ensure users receive and identify the intended hardware artifact. | Route/UI expectations need review; wrong-byte delivery is always critical. HTTP 410 alone does not settle whether the replacement path works. |

## Handling a failed check

Record: the exact assertion, requirement, authoritative input, observed failure,
whether execution was reached, and whether the selected release is affected.
Then correct the implementation, correct the test, or document the still-open
question. Do not turn a known failure green by skipping it, changing the selected
program to an obsolete example, or treating this document as a waiver.
