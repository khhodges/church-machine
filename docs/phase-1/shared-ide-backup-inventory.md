# Shared IDE handoff — backup inventory

Inspected 2026-11-03. This is an inventory, **not a completed backup or restore
qualification**. No GitHub writes, production writes, credential changes,
publishing or board commands were performed.

## Source repositories

- Workspace `origin`: `khhodges/church-machine`, public.
- Remote `main` inspected: `23647f91d03eb23d2a3e352ba1a4f6cee3b3ac5c`,
  dated 2026-11-01.
- Workspace revision at the start of inspection:
  `726a2bcea3c451f3bd8bbaaffc042a3a39750de9`, dated 2026-11-03.
  These differ; GitHub main is not an exact current-workspace backup.
- The default `gh repo view` selected another configured repository,
  `khhodges/cloomc-project`. All subsequent checks explicitly selected
  `khhodges/church-machine`.

## FPGA download preservation

Streamed and SHA-256 hashed the actual GitHub files at the pinned remote
revision, not merely filenames or release descriptions.

| File | Bytes | SHA-256 |
|---|---:|---|
| `build/church_wukong_xc7a100t.bit` | 3826002 | `ac103edc9b39a514bdcf6f381e57a92bd05d5c70d1db46a85307d6102f11373e` |
| `build/church_wukong_xc7a100t.mcs` | 10521876 | `443982087a43114b45e1f97823951cf139efc39ffd84df53e21ffa512d13a5e9` |

Both match the hashes reported by the published site's bitstream-status
endpoint. This establishes that GitHub holds the files advertised by the site;
it does not prove what is installed on the physical board.

Two GitHub recovery releases were found, both drafts with zero attached
assets. The repository files above exist independently of those empty releases.

## Live site

Read-only queries to `https://lab.cloomc.org` found:

- 80 entries from the LUMP catalog endpoint.
- Accessible committed Namespace state and boot-configuration responses.
- Version `f4ade76f`, classified by the server as `runtime`, not a Git commit.
  It cannot identify an exact production source checkout.
- History and version-word retrieval routes exist in workspace source.
  Full live history coverage and exact-byte reconstruction were not tested.

The catalog and configuration were inspected but not saved as a backup.
No complete production filesystem export or restore test has been performed.

## Remaining Step 1 gates

1. Capture a consistent, private live export: exact LUMP bytes, immutable
   history, metadata/manifest, Namespace, boot configuration and boot image.
2. Verify completeness, hashes and recovery procedure; API display responses
   alone must not be called a restorable filesystem backup.
3. Identify exact production source and dependencies for a credential-only
   release, without silently including unfinished workspace changes.
4. Preserve the required source/release baseline in a suitable backup.
   Do not push live user artifacts to the public GitHub repository without
   reviewing contents and obtaining appropriate authorization.

Never export credentials, session cookies, or environment-secret values.
Do not proceed to publication on the strength of this inventory alone.

## Read-only partial capture completed

Capture directory:
`generated-artifacts/live-backup/20261103T103737Z/`
(excluded from Git and deployment packaging).

- Catalog with archived records: 123 rows, versus the earlier default active
  catalog's 80 entries; this is not an increase inferred from different queries.
- 86 unique catalog tokens queried for history; 79 successful responses,
  seven 404 responses, 463 reported history records.
- 424 exact artifact locators requested; 423 verified, covering 116 unique
  binary hashes. Every saved binary matches the server SHA-256 and passed a
  local reread/hash check. No filename/hash conflicts were found.
- The one unavailable artifact locator is archived
  `SelfTest.1.fcf2c79d.lump`, token `bb1e4bed` (404).
- Start/end comparisons matched the complete catalog response, Namespace
  abstraction rows and boot config object. This is not an atomic snapshot.

The bulk ZIP endpoint returned 409 because IDX1 export is unsupported.
The boot-image endpoint returned 409 because the committed image is stale.
No preparation, regeneration, state repair or hardware command was attempted.
Raw manifest/approval stores, full sidecars, drafts, unlisted files, committed
boot bytes and exact production source are still not captured.

The partial export is useful evidence and artifact preservation, but **Step 1
remains incomplete**. Do not proceed to publishing or label it restore-ready.

## Remaining export-path investigation

Inspected the existing download, bundle and snapshot routes without changing
production. The hardware ZIP packages build inputs, not the live application
data store. Boot downloads use admission/freshness checks, and the available
artifact APIs do not constitute an export of the raw approval store, sidecars,
drafts and committed stale image.

Official documentation lookup distinguished workspace SSH/Shell from the
published deployment: access to the development workspace is not access to
the running production filesystem. No supported production filesystem access
method was established in this investigation. Do not tell an operator that
workspace SSH will capture the published application's files.

Adding an export endpoint to workspace code would require a release before it
can read production files. That would cross the very persistence boundary
the backup is intended to protect; it is not a safe substitute for capturing
the existing process's state first.

Step 1 is blocked on a complete existing production backup or a supported
way to capture that running deployment's files. Platform assistance may be
needed to establish whether such a capture is available; recovery is not
guaranteed. No ticket has been submitted and no release is authorized by this
finding. The existing verified partial export remains intact.
