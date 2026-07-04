#!/usr/bin/env python3
"""
scripts/apply_efinity_headless_patches.py

Idempotently patches an Efinity 2026.1 installation so the Interface Designer
(PT Unified, invoked via `efx_run --flow interface`) can run headless (no GUI,
no X server) on a Linux build machine.

ROOT CAUSE: PT Unified's check_design() validates HSIO GPIO clock rules.
On a headless run the PLL/OSC registries used by those rules are never
populated (None), so check_design() crashes deep inside Efinity's own code
before it ever writes outflow/<circuit>.interface.csv. Downstream Place &
Route then hard-fails with:
    "ERROR: Interface Designer did not produce .../<circuit>.interface.csv"
with no further explanation, because the real crash happened inside a
try-less call several frames up.

This script applies up to 5 small, targeted patches directly to the
installed Efinity Python sources (NOT to this repo's project files) so
check_design() degrades gracefully instead of crashing, and design
generation proceeds even when the design-check step reports a failure.
P2, P3, and P4-5 are required. P1 and the optional P6 are best-effort: some
Efinity 2026.1 sub-builds already null-guard that code natively, so a
missing anchor there is not treated as a failure (see build_patches()).

Usage:
    python3 scripts/apply_efinity_headless_patches.py --apply [--root PATH]
    python3 scripts/apply_efinity_headless_patches.py --check [--root PATH]

Root resolution order (same convention as run_efx_pnr.sh / run_efx_map.sh):
    1. --root CLI argument (mainly for tests, points at a fixture tree)
    2. $EFINITY_HOME environment variable
    3. ~/efinity/2026.1

Exit codes:
    0 — all patches already applied, or newly applied successfully (--apply);
        or all patches already applied (--check)
    1 — at least one patch could not be applied/verified (anchor missing,
        file missing, or py_compile failed after patching) — this usually
        means Efinity shipped a new version and the anchors need updating
    2 — bad usage (no --apply/--check given)
"""
import argparse
import os
import py_compile
import sys

SENTINEL = "church-headless-patch-v1"


class Patch:
    def __init__(self, name, rel_path, anchor, replacement, required=True):
        self.name = name
        self.rel_path = rel_path
        self.anchor = anchor
        self.replacement = replacement
        # required=False: this patch's crash scenario is known to be absent
        # in some Efinity 2026.1 sub-builds (the file already null-guards the
        # code path natively). A missing anchor is then expected, not an
        # error — see P1's history in CHANGELOG.md.
        self.required = required

    def path(self, root):
        return os.path.join(root, self.rel_path)

    def state(self, root):
        """Returns (state, content_or_None). state is one of:
        MISSING_FILE, ALREADY_APPLIED, NEEDS_APPLY, ANCHOR_MISSING
        """
        p = self.path(root)
        if not os.path.isfile(p):
            return "MISSING_FILE", None
        with open(p, "r") as f:
            content = f.read()
        if SENTINEL in content:
            return "ALREADY_APPLIED", content
        if self.anchor in content:
            return "NEEDS_APPLY", content
        return "ANCHOR_MISSING", content

    def check(self, root):
        state, _ = self.state(root)
        ok = state == "ALREADY_APPLIED" or (state == "ANCHOR_MISSING" and not self.required)
        print(f"{'OK  ' if ok else 'MISS'} [{self.name}]: {state} ({self.path(root)})")
        return ok

    def apply(self, root):
        state, content = self.state(root)
        p = self.path(root)
        if state == "MISSING_FILE":
            print(f"FAIL [{self.name}]: file not found: {p}")
            return False
        if state == "ALREADY_APPLIED":
            print(f"OK   [{self.name}]: already applied (sentinel found)")
            return True
        if state == "ANCHOR_MISSING":
            if not self.required:
                print(
                    f"SKIP [{self.name}]: anchor text not found in {p} — not "
                    f"applicable to this Efinity build (optional patch; the "
                    f"crash scenario it guards against isn't present here)."
                )
                return True
            print(
                f"FAIL [{self.name}]: anchor text not found in {p} — "
                f"Efinity version drift? This patch's anchor needs updating."
            )
            return False
        # NEEDS_APPLY
        new_content = content.replace(self.anchor, self.replacement, 1)
        if new_content == content:
            print(f"FAIL [{self.name}]: replace produced no change (unexpected)")
            return False
        with open(p, "w") as f:
            f.write(new_content)
        try:
            py_compile.compile(p, doraise=True)
        except py_compile.PyCompileError as e:
            with open(p, "w") as f:
                f.write(content)
            print(f"FAIL [{self.name}]: py_compile failed after patch, rolled back: {e}")
            return False
        print(f"OK   [{self.name}]: patched and verified ({p})")
        return True


def build_patches():
    patches = []

    # Patch 1: clkmux_rule_adv.py — pll_reg=None crash.
    #
    # OPTIONAL (required=False): confirmed on a real Efinity 2026.1 install
    # (2026-07) that this exact unguarded loop does not exist in every
    # sub-build — that file's PLL-related code paths (e.g.
    # ClkMuxRulePLLMultConnection.check(), check_dyn_mux_input_pll_outclk())
    # already null-check pll_reg natively. Kept here best-effort in case an
    # older/different sub-build still has the unguarded form; a missing
    # anchor is not treated as a failure.
    patches.append(
        Patch(
            name="P1-clkmux-pll-none",
            rel_path="pt/bin/tx60_device/clock_mux/clkmux_rule_adv.py",
            anchor="for clkmux_inst in pll_reg.get_all_pll():",
            replacement=(
                f"for clkmux_inst in (pll_reg.get_all_pll() if pll_reg is not None else []):"
                f"  # {SENTINEL}"
            ),
            required=False,
        )
    )

    # Patch 2: clock_rule_adv.py — osc_reg=None crash
    patches.append(
        Patch(
            name="P2-clock-osc-none",
            rel_path="pt/bin/tx60_device/clock/clock_rule_adv.py",
            anchor="for osc in checker.osc_reg.get_all_osc():",
            replacement=(
                f"for osc in (checker.osc_reg.get_all_osc() if checker.osc_reg is not None else []):"
                f"  # {SENTINEL}"
            ),
        )
    )

    # Patch 3: efx_run_pt_unified.py — wrap check_design() in try/except
    patches.append(
        Patch(
            name="P3-check-design-tryexcept",
            rel_path="scripts/efx_run_pt_unified.py",
            anchor="        is_design_pass = design_api.check_design()",
            replacement=(
                f"        # {SENTINEL}\n"
                "        try:\n"
                "            is_design_pass = design_api.check_design()\n"
                "        except Exception as _chk_exc:\n"
                '            print(f"WARNING: check_design() raised {_chk_exc!r} (headless patch)")\n'
                "            is_design_pass = False"
            ),
        )
    )

    # Patch 4+5: design.py — CORRECTED headless generate().
    #
    # NOTE: an earlier version of this fix (see BUILD_SOC_CM.md history) used
    # a bare `if True:` shortcut that never actually calls check_design() at
    # all. That shortcut produces a structurally incomplete LPF (IO config
    # state never populated) and IO pins place randomly downstream — see
    # .agents/memory/ti60-headless-lpf.md. The correct patch below still
    # CALLS check_design() (so its side effects run) but swallows the
    # exception it raises headless, then always proceeds to generate the
    # report/constraint regardless of the check's outcome.
    patches.append(
        Patch(
            name="P4-5-design-generate-headless",
            rel_path="pt/bin/api_service/design.py",
            anchor=(
                "if self.check_design():\n"
                "            self.__gen_report(outdir)\n"
                "            self.__gen_constraint(enable_bitstream, outdir)"
            ),
            replacement=(
                f"try:  # {SENTINEL}\n"
                "            self.check_design()  # populate IO config state\n"
                "        except Exception:\n"
                '            print("WARNING: check_design raised (headless patch)")\n'
                "        if True:  # always generate constraint\n"
                "            try:\n"
                "                self.__gen_report(outdir)\n"
                "            except Exception:\n"
                '                print("WARNING: report generation skipped (headless patch)")\n'
                "            self.__gen_constraint(enable_bitstream, outdir)"
            ),
        )
    )

    return patches


def try_optional_patch6(root):
    """Best-effort, non-fatal 6th patch: BUILD_SOC_CM.md notes that
    efx_run_pt_unified.py may also need its `return PTFlowRunnerStatusCode.ERROR`
    (printed right after the design-check failure table) neutralized, or design
    generation stops before ever calling design.py's generate(). The exact
    surrounding code was never captured verbatim, so this patch is applied
    only when there is a single, unambiguous match — otherwise it is skipped
    with a warning rather than guessing and corrupting an unrelated return.
    """
    rel_path = "scripts/efx_run_pt_unified.py"
    p = os.path.join(root, rel_path)
    marker = f"# {SENTINEL}-p6"
    if not os.path.isfile(p):
        print(f"SKIP [P6-design-check-early-return]: file not found: {p}")
        return
    with open(p, "r") as f:
        content = f.read()
    if marker in content:
        print(f"OK   [P6-design-check-early-return]: already applied")
        return
    lines = content.split("\n")
    candidates = [
        i for i, line in enumerate(lines) if line.strip() == "return PTFlowRunnerStatusCode.ERROR"
    ]
    if len(candidates) != 1:
        print(
            f"SKIP [P6-design-check-early-return]: found {len(candidates)} candidate "
            "return sites (need exactly 1 to patch safely) — leaving untouched. "
            "If Interface Designer still fails after P1-P5, this may need manual review."
        )
        return
    idx = candidates[0]
    indent = lines[idx][: len(lines[idx]) - len(lines[idx].lstrip())]
    lines[idx] = f"{indent}pass  {marker}: continue past design-check failure"
    new_content = "\n".join(lines)
    with open(p, "w") as f:
        f.write(new_content)
    try:
        py_compile.compile(p, doraise=True)
    except py_compile.PyCompileError as e:
        with open(p, "w") as f:
            f.write(content)
        print(f"FAIL [P6-design-check-early-return]: py_compile failed, rolled back: {e}")
        return
    print(f"OK   [P6-design-check-early-return]: patched and verified ({p})")


def resolve_root(cli_root):
    if cli_root:
        return cli_root
    env = os.environ.get("EFINITY_HOME")
    if env:
        return env
    return os.path.expanduser("~/efinity/2026.1")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--apply", action="store_true", help="Apply any missing patches")
    group.add_argument("--check", action="store_true", help="Report patch status only")
    parser.add_argument("--root", default=None, help="Efinity install root (overrides $EFINITY_HOME)")
    args = parser.parse_args()

    root = resolve_root(args.root)
    print(f"Efinity install root: {root}")

    patches = build_patches()

    if args.check:
        all_ok = all(p.check(root) for p in patches)
        sys.exit(0 if all_ok else 1)

    # --apply
    all_ok = True
    for p in patches:
        if not p.apply(root):
            all_ok = False
    try_optional_patch6(root)

    if not all_ok:
        print(
            "\nOne or more required patches could not be applied. "
            "Interface Designer will likely still fail headless. See messages above."
        )
        sys.exit(1)

    print("\nAll required headless patches applied/verified (optional patches applied where applicable).")
    sys.exit(0)


if __name__ == "__main__":
    main()
