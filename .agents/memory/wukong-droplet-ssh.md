---
name: Wukong droplet SSH key
description: SSH key setup for 165.227.190.84 droplet — how to connect from Replit
---

## Droplet: 165.227.190.84 (root)

Auth: publickey only. The authorized key on the droplet is:
- Comment: `replit-agent@church-machine`
- Fingerprint: `SHA256:mwmfF9eWsa1ILJMWp60x782U1KaBNknmYILenwwymk0`
- Public key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM1+jmYa0s8z90pRj7WVeYWU9WINsuLmurMuk7h9OO3/ replit-agent@church-machine`

## Setup in a new Replit session

The private key is stored as the `DropletPrivateKey` Replit secret.

```bash
mkdir -p ~/.ssh
echo "$DropletPrivateKey" > ~/.ssh/replit_droplet
chmod 600 ~/.ssh/replit_droplet
ssh -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no root@165.227.190.84 echo OK
```

## If DropletPrivateKey secret is missing / key is rejected

Generate a new key, add the public key to the droplet via DigitalOcean web console:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/replit_droplet -N "" -C "replit-agent@church-machine"
cat ~/.ssh/replit_droplet.pub
# User: paste into droplet's ~/.ssh/authorized_keys via DO console
```
Then ask user to add private key as `DropletPrivateKey` Replit secret.

## Build workflow

```bash
# Generate Verilog (Replit)
python -m hardware.gen_rtlil --wukong

# Transfer (Replit)
scp -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no \
  build/church_wukong_xc7a100t.v hardware/wukong_xc7a100t.xdc hardware/wukong_xc7a100t.tcl \
  root@165.227.190.84:~/wukong_build/

# Build on droplet (in tmux)
ssh -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no root@165.227.190.84 \
  "cd ~/wukong_build && rm -rf vivado_wukong && tmux new-session -d -s vivado_cm \
  'source /opt/Xilinx/2026.1/Vivado/settings64.sh && vivado -mode batch -source wukong_xc7a100t.tcl > vivado_cm.log 2>&1; echo EXIT_\$? >> vivado_cm.log'"

# Fetch bitstream (Replit)
scp -i ~/.ssh/replit_droplet -o StrictHostKeyChecking=no \
  root@165.227.190.84:~/wukong_build/church_wukong_xc7a100t.bit build/

# Expected: EXIT_0, WNS ≥ 0 ns, bitstream ~3.7 MB
```

**Why:** The container filesystem resets between sessions; the private key must come from a Replit secret or be regenerated and re-added each time.
