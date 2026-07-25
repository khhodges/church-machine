---
name: Wukong droplet SSH key
description: SSH key setup for 165.227.190.84 droplet — how to connect from Replit
---

## Droplet: 165.227.190.84 (root)

Auth: publickey only. The current authorized key on the droplet is:
- Comment: `replit-agent@church-machine`
- Fingerprint: `SHA256:+dGM2ID4s4MSVIrr8d6ZPfVPSrSFuB31tm0KrnIn420`
- Public key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHn9fctYGX7jLXz90vzP7pZDuRhNLm9GFRBYUNVQkqls replit-agent@church-machine`

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

Generate a new key, add the public key to the droplet via DigitalOcean web console:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/replit_droplet -N "" -C "replit-agent@church-machine"
cat ~/.ssh/replit_droplet.pub
# User: paste into droplet's ~/.ssh/authorized_keys via DO console
```
Then store the private key (full PEM, multiline) as `DropletPrivateKey` Replit secret.

## Build workflow

```bash
# Generate Verilog (Replit)
python -m hardware.gen_rtlil --wukong

# Transfer (Replit)
scp -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no \
  build/church_wukong_xc7a100t.v hardware/wukong_xc7a100t.xdc hardware/wukong_xc7a100t.tcl \
  root@165.227.190.84:~/wukong_build/

# Build on droplet (in tmux) — takes ~25-30 min on 4-vCPU droplet
ssh -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no root@165.227.190.84 \
  "cd ~/wukong_build && rm -rf vivado_wukong && tmux new-session -d -s vivado_cm \
  'source /opt/Xilinx/2026.1/Vivado/settings64.sh && vivado -mode batch -source wukong_xc7a100t.tcl > vivado_cm.log 2>&1; echo EXIT_\$? >> vivado_cm.log'"

# Poll until done
ssh -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no root@165.227.190.84 \
  "tail -5 ~/wukong_build/vivado_cm.log; tmux list-sessions | grep vivado_cm || echo DONE"

# Fetch bitstream (Replit)
scp -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no \
  root@165.227.190.84:~/wukong_build/church_wukong_xc7a100t.bit build/

# Expected: EXIT_0, WNS ≥ 0 ns, bitstream ~3.8 MB
```

**Why:** The container filesystem resets between sessions; the private key must
come from a Replit secret or be regenerated and re-added each time.
The single-line collapsing trap has bitten twice — always use the Python formatter.
