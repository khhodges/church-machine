# Disposable Save-to-Run acceptance — 2026-10-28

## Scope and result

The approved disposable-clone browser journey passed: Save → Bind → Prepare →
Run → Reset → fresh-session Prepare. The pending-Prepare/Bind race was exercised
with a genuine delayed service response. This is simulator acceptance, **not**
hardware acceptance or proof of all SelfTest assertions.

The binding-freshness correction was fast-forwarded from the merged project
branch before verification. The application used
`tests/server/new_layout_call_browser_server.py` on port 5127, with isolated
LUMP, boot configuration, database, hierarchy and build-snapshot storage.
Hardware paths were denied by the server. Neither the live application workflow
nor live Namespace storage was used. No application implementation was changed
by this verification.

## Actual browser/service evidence

| Check | Observation |
|---|---|
| Save and review | Opened selected NS21 AmoebaStartup revision 4; editor source was left unchanged. An initial protected Save returned 409 and “No data was changed.” The matching review subsequently saved revision 5. |
| Selection safety | Only the existing NS21 selected revision advanced. All 21 assigned members remained; no member, policy, or source repair was introduced. |
| Bind and review | The actual Bind control and protected-change dialog produced a Namespace PUT 428 followed by 200 on confirmation. |
| Before execution | Prepare, approve and activate returned 200. The in-browser machine-memory SHA-256 matched the prepared image hash before execution. |
| Complete resident bindings | All nine resident C-lists matched the Bind results, including symbolic and legacy portable contracts; details below. |
| Run | The existing B:00 breakpoint initially paused before boot. It was disabled through Step Settings, Run resumed, and the breakpoint was restored afterward. Boot completed; the observed run reached 659 steps with no recorded machine fault. |
| Reset | Returned to PC 0, step 0, boot incomplete, stopped, with an empty fault log and the same image/configuration hashes. |
| Fresh session | A new browser context prepared, approved and activated the same selected graph and obtained the same image hash. It did not rely on an old in-browser machine. |
| Declared entry | Bounded stepping stopped before CapabilityTest.Run's first instruction: slot 10, physical PC `0x0702`, relative PC `1`, word `0x07030010`. The disassembly showed the method table targeting word offset 2 and named the entry Run. |

The binding summary was “unresolved / not installed / not activated,” because
Lazy NS9 Mint and NS15 MintCleaner retain missing references. This did **not**
block actual private simulation preparation. Those references were neither
repaired nor ignored by changing the graph. Nonresident bodies were not claimed
as loaded resident evidence.

### Exact selections and pre-execution provenance

- Saved caller: revision 5, file `ide.AmoebaStartup.1.07526ea8.lump`,
  selected token `ac944e43`, binary SHA-256
  `bf0810dc15fa2feeabab6529ecef8c929a490e355da8132666961ce410f62c26`.
  The token and filename suffix are reported separately, as captured.
- Selected target: CapabilityTest revision 9,
  `ide.CapabilityTest.1.5b91e58e.lump`, binary SHA-256
  `b422e3525a54e7dd58c0f7fb027a3bf1d719b9bc98c490e03535f83da7a61ee0`.
- Saved graph fingerprint:
  `ad8a9eae2db5499554af1a09732bdfc1dc51eee8dfec4e9277f9f632cfeb9dae`.
- Prepared/activated image and pre-execution memory SHA-256:
  `6ceacb900d2170614bda53102a2f5fa6b8fc68b660d7bef5a11dd1e2e7020ecd`.
- Initial admitted configuration hash:
  `fec00d0cb79be280e465164f9b8300a1092bc25b1fdb73410aa6dfbca9ed3cd6`.
- Initial approved revision:
  `be1bdd21a2cf0b5fc504aacf61cd5e1064a280e43380e53d22cd9c465858fbfa`.
- Caller base 3648, C-list address 3900, rows 0–3 before execution:
  `4A000015`, `4A00000A`, `4A000014`, `0200000B`.

Resident comparison covered slots 7, 10, 6, 16, 17, 18, 19, 20, 21.
SelfTest (6) and MalloryDriver (19) used
`church.portable-lump-binding/v1`; the other seven used
`church.symbolic-lump-binding/v1`. Legacy SELF words were respectively
`4A000006` and `4A000013`, not zero. This was a service-generated image,
not the manually localized diagnostic replay described in the earlier incident.

### Pending preparation, Bind, and stale response

Network instrumentation held a real successful Prepare response while the
unchanged graph was rebound through the actual review dialog. The original
response was then released unchanged; no synthetic success response or direct
acceptance-function call replaced the UI.

- Old preparation `2173e69ed4774c6483c3f5e52200357a` had configuration
  `536c39f2e29e8cc524a13d3ecbd61a0f4a348c5fb0f7c24d4c2bcab05bab1883`.
- After Bind, release of that response produced **zero Approve or Activate
  requests for that old preparation**. The machine remained unprepared.
- Fresh preparation `9a82d05e95024315a445b133e0fdad22` alone proceeded through
  approve/activate, with configuration
  `1120584131d5d020d457e0eb832c681fba39483a26547e10e721464dc1ba0628`.
- The graph fingerprint and all 21 row selections stayed identical.

Both old and new responses had the same image hash because this race deliberately
rebound an unchanged graph. Thus the browser evidence proves revocation of an
old preparation, not a byte-different race. Separate frontend tests cover
stale ownership and pending callbacks; these are not misrepresented as additional
browser/service executions.

## Evidence locations and limits

Local raw captures (excluded from Git) are under
`generated-artifacts/save-bind-run/`:
`binding-ui-evidence.json`, `prepare-evidence.json`, and
`task-3892-continuation-evidence.json`. The early `report.md` stopped at a
suspected Lazy-binding blocker; this final report supersedes that interpretation.
The retained `reproduce-blocked-state.spec.js` is a read-only capture helper,
**not** an automated replay of the complete journey.

Browser screenshot references: Save rejection `tlmuvt`, successful Save `uev8vc`,
Bind `cvwnd8`, initial breakpoint `e8wqdr`, Reset `dbld19`, fresh context
`qju92h`, race review `5hpzff`, race Bind `nzh8f1`, Run entry `ju862c`.

Separately executed frontend checks passed:

```sh
node simulator/test_design_simulation.js
node simulator/test_lump_save_realignment.js
```

No later program fault was observed within the bounded run. This does not prove
termination, all SelfTest branches/assertions, or hardware behavior.
`hardwareCertified` remained false. Fresh UI status sometimes said “running”
while the machine was stopped; a fault indicator also remained visible with an
empty current fault log. These are separate display observations, not recorded
program faults. Repeated 403s from hardware polling were expected from the
disposable server's deny guard.
