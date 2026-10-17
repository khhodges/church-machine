# Authority and supersessions

[Entry point](README.md) · [Verbatim decisions](decisions.md)

The supplied guided Q&A is the authority for the new software selections. The
[active Master ISA](../../phase-1/01-isa/instruction-set.md) governs hardware.
Later explicit software approvals close older software TBDs; they do not silently
change ISA encodings or approve new hardware mechanisms. A material conflict
not resolved by that rule is G1/G7 in the [gate register](open-issues.md).

## Decision dependencies

| Earlier position / alternative | Effective rule and superseding decisions |
|---|---|
| Owner field proposed, no values assigned | Q01 approves layout; Q02–Q05 establish Genesis/configuration-wide lifetime mapping of all 16 values; Q06 classifies assigned-Owner Abstracts |
| All Abstracts historically usable as other encodings | Q06 is scoped to assigned Owner hierarchies; compatibility review required, not blanket reinterpretation |
| Independent operation/type lists might cross-multiply rights | Q07–Q11 require per-operation/type authorization plus exact targets or one Create Namespace |
| Permissions edited in place / credential GT reused | Q12–Q13 require revoke/new GT/new proof; Q32 gives Mint's persistent sequential ID |
| Fresh random pool on reset | Q17 rejects it; preserve pool/consumption |
| Consume entry before issuing, tolerate loss | Q18.1 rejects it: “Phase 1 only no lost entries” |
| Recover/resume pending issuance | Q18.2 rejects it: “Hard boot forgets the past” |
| Forget all credentials / discard old pool on hard boot | Q18.3 rejects it: “Prior pass codes still work after boot at lease for Phase 1” |
| No positive persistence rule yet | **Q54** commits complete issued record + pool consumption + counter atomically; restore committed authority, never interrupted execution |
| Q23/Q25/Q26 might authorize broad Replace/Destroy | Q28 “None, period” and Q29 “none period” make both target grants empty. Q26 “As long as NOT RESIDENT” also remains |
| Generic `pkverify` / `nstab` names | Q36 `ide.PkVerify`, Q37 `ide.NSTab`; slots 15/14 unchanged |
| First credential sharing, revocation or self-issuance inferred from possession | Q33 prohibits sharing; Q34–Q35 restrict administration to Genesis through IDE; Q40 B=0; Q41 setup is separately authorized |
| Verifier compares a token only or returns blanket approval | Q38 exact request authorization, Q39 protected proof snapshot, Q42 read-only registry, Q52 original requester, Q53 Mint-only E |
| Draft method/descriptor names or CR10 treated as approved ABI | Q43 selects five method names, Q44 descriptor direction only; exact ABI here remains proposed |
| Caller chooses slot/base | Q45 Mint selects eligible free placement |
| Direct Replace version TBD / in-place fallback | Q46 same slot +1, refuse at 510; Q47 separate free block only |
| Zero at allocation or reclamation TBD | Q48 zero during reclamation before free, no second version increment |
| Active checks limited to current CRs | Q49 includes live return-frame dependencies |
| Sequential writes or a service mutex called atomic | Q50 admission across all five methods; Q51 actual four-word readback; neither supplies external exclusion |
| Planning request authorizes operational service or hardware work | Q55 authorizes this package only |

## Historical sources (preserved, not current prescriptions)

- [Existing Mint contract](../../ide-mint-forge-contract.md): the added current
  notice points here; its dated draft remains evidence, including superseded
  ordinary rejection returns, recovery wording, bootstrap-only T and TBDs.
- [First service draft](../../archive/phase-1-expanded-collection/MINT-FIRST-DRAFT.md)
  and [code draft](../../archive/phase-1-expanded-collection/MINT-CODE-DRAFT.md):
  earlier decisions/proposals, including withdrawn GC and unapproved headroom.
- [Earlier guided resolution log](../../archive/phase-1-expanded-collection/REVIEW-2026-10-14.md):
  preserves historical context; its old “pending” statements are not renewed vetoes.
- [Review-only CLOOMC sources](../../archive/phase-1-expanded-collection/source-drafts/README.md):
  intentionally undefined labels remain blockers. Newly approved names do not
  make the files complete or executable.
- [Hardware atomicity investigation](../../ide-mint-hardware-atomicity-review.md):
  dated source observations and a historical narrow test result, not current
  integrated Mint evidence.

## Active-source/document reconciliation

The Master still labels the PassKey format unapproved at lines 772–781 and
direct replacement TBD in the software section. For this software service,
Q01–Q06/Q31–Q32 and Q46 now supply those selections. Its hardware rules remain
unchanged; this package does not rewrite the compact hardware collection.
Q48 closes clearing timing, not the clearing implementation. Q49 expands
protected dependencies, not the rights to inspect protected Thread memory.

“Boot” maps to the Namespace self-entry at slot 1 in the approved ascending
geometry, not the metadata slot 0 or the Thread at slot 2. The Master uses
“Boot.Namespace”; the design seed uses `Boot.NS`. These identify the intended
role, but are **not two newly invented canonical identities**. Setup must bind
the selected Boot configuration to its exact Namespace authority (G7), not match
a string or read a browser selection. No live saved state was consulted.

The design seed still names slot 14 `nstab` and slot 15 `pkverify` and describes
them generically as LUMPs. Q37 selects a table RW view, not another executable
body. Reconciliation is future implementation work; no saved rows were changed.
Existing Phase 1 Resident intent is retained; positive Replace/Destroy fixtures
must explicitly use synthetic non-resident objects.

The current bridge's `main` now sets `verify_tls = not args.insecure`
([S09](sources.md)). Thus the statement in `replit.md` that HTTPS always disables
verification is stale at this revision. HTTP remains the default and UART FW=2
is still not protected secret transport. This finding does not claim FW=3 exists.
