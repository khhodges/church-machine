---
name: Wukong droplet SSH key
description: SSH key setup for 165.227.190.84 droplet — how to connect from Replit, and the complete build workflow
---

## Droplet: 165.227.190.84 (root)

Auth: publickey only. The current authorized key on the droplet is:
- Comment: `replit-agent@church-machine`
- Fingerprint: `SHA256:VfKNv+5S2PuSHMmcPa9XgQnx1KuB+E21vdlSvlfbnrU`
- Public key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO+cHlp9exdM1JSwK4F0b8380375q2LMt8Bq1mMdNovX replit-agent@church-machine`

## Setup in a new Replit session

The private key is stored as the `DropletPrivateKey` Replit secret.

**CRITICAL:** The secret value must be pasted as the full multiline PEM block
(`-----BEGIN OPENSSH PRIVATE KEY-----` … `-----END OPENSSH PRIVATE KEY-----`).
If it arrives as a single line (Replit collapses newlines), reformat with Python
before writing to disk — `echo "$DropletPrivateKey" > ~/.ssh/replit_droplet`
will produce a one-line file that OpenSSH rejects with "error in libcrypto".

```bash
mkdir -p ~/.ssh
python3 - <<'PYEOF'
import os
key = os.environ['DropletPrivateKey']
lines = key.strip().split('\n')
if len(lines) > 2:
    pem = key.strip() + '\n'
else:
    tokens = key.strip().split()
    header = ' '.join(tokens[:4])
    footer = ' '.join(tokens[-4:])
    body = ''.join(tokens[4:-4])
    chunks = [body[i:i+64] for i in range(0, len(body), 64)]
    pem = header + '\n' + '\n'.join(chunks) + '\n' + footer + '\n'
with open('/home/runner/.ssh/replit_droplet', 'w') as f:
    f.write(pem)
PYEOF
chmod 600 ~/.ssh/replit_droplet
ssh-keygen -l -f ~/.ssh/replit_droplet   # verify parses OK
ssh -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no root@165.227.190.84 echo OK
```

## If DropletPrivateKey secret is missing / key is rejected

Generate a new key, add the public key to the droplet's authorized_keys:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/replit_droplet -N "" -C "replit-agent@church-machine"
cat ~/.ssh/replit_droplet.pub
# Paste into droplet's ~/.ssh/authorized_keys via DO console:
#   echo "<pubkey>" >> ~/.ssh/authorized_keys
```
Then store the private key (full PEM, multiline) as `DropletPrivateKey` Replit secret.

**Trap:** `ReplitDropletKey` and `id25519kas` and `KenCB2SSH` in Replit secrets are NOT
the private key — they are a malformed stub, a fingerprint, and a public key respectively.
Only `DropletPrivateKey` holds the actual private key.

## Full build workflow (Replit → droplet → Replit)

```bash
# 1. Regenerate Verilog (Replit)
python3 -m hardware.gen_rtlil

# 2. Transfer sources (Replit)
scp -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no \
  build/church_wukong_xc7a100t.v \
  hardware/wukong_xc7a100t.xdc \
  hardware/wukong_xc7a100t.tcl \
  root@165.227.190.84:~/wukong_build/

# 3. Build on droplet in tmux (~20-25 min)
ssh -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no root@165.227.190.84 \
  "cd ~/wukong_build && rm -rf vivado_wukong && \
   tmux kill-session -t vivado_cm 2>/dev/null; \
   tmux new-session -d -s vivado_cm \
   'source /opt/Xilinx/2026.1/Vivado/settings64.sh && \
    vivado -mode batch -source wukong_xc7a100t.tcl > vivado_cm.log 2>&1; \
    echo EXIT_\$? >> vivado_cm.log'"

# 4. Poll (run repeatedly until done)
ssh -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no root@165.227.190.84 \
  "grep -E 'EXIT_|route_design completed|place_design completed|write_bitstream|WNS' \
   ~/wukong_build/vivado_cm.log 2>/dev/null | tail -5; \
   tmux list-sessions | grep vivado_cm || echo SESSION_DONE"

# 5. Fetch bitstream + MCS (Replit)
scp -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no \
  root@165.227.190.84:~/wukong_build/church_wukong_xc7a100t.bit \
  root@165.227.190.84:~/wukong_build/church_wukong_xc7a100t.mcs \
  build/

# Expected: EXIT_0, WNS ≥ 0 ns, .bit ~3.7 MB, .mcs ~11 MB
```

## Typical build timings (4-vCPU droplet, Vivado 2026.1)

| Phase | Elapsed |
|---|---|
| synth_design | ~13 min |
| opt_design | ~1 min |
| place_design | ~5 min |
| route_design | ~2 min |
| write_bitstream | ~1 min |
| **Total** | **~22 min** |

## Known build pitfalls (all fixed in current TCL/XDC)

| Problem | Root cause | Fix |
|---|---|---|
| `create_debug_core` fails EXIT_1 | BASIC license — ILA needs Standard/Enterprise | `INSERT_ILA 0` flag in TCL; pass `--insert-ila` when licensed |
| DRC NSTD-1/UCIO-1 blocks bitstream | dbg_* ports have no LOC/IOSTANDARD (they're ILA-only, not board pins) | `set_property SEVERITY {Warning}` for both checks in XDC |
| `write_cfgmem -interface SPIx4` fails | Bitstream built without `SPI_BUSWIDTH=4` set | `set_property BITSTREAM.CONFIG.SPI_BUSWIDTH 4` in XDC |
| Reusing synth checkpoint for resume | `launch_runs impl_1 -to_step write_bitstream` can fail if run already at 100% | Use `open_checkpoint *_routed.dcp` + `write_bitstream` directly |
| Tcl readiness check cannot import Amaranth | Vivado's settings script can replace `PATH`, hiding the isolated build Python | Set `CM_PYTHON` to the virtualenv interpreter; the TCL gate uses it explicitly |

## Build-host serialization

Run only one Vivado synthesis/implementation job at a time on the 8 GB droplet.
Before launching, inspect active Vivado process trees and wait for any unrelated
build to finish rather than starting another one or killing a build you do not
own.

**Why:** Concurrent Wukong builds exhausted available memory, triggered Vivado's
thrashing detector, and left synthesis in Cross Boundary and Area Optimization
without log progress for more than an hour.

**How to apply:** Check for active vendor jobs before staging or launching. Use a
no-hangup wrapper that writes an explicit exit-status file, and accept artifacts
only after `EXIT_0`, clean timing evidence, and fresh output timestamps.

**Why:** The container filesystem resets between sessions; the private key must
come from a Replit secret or be regenerated and re-added each time.
The single-line collapsing trap has bitten twice — always use the Python formatter.
