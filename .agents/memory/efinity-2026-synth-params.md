---
name: Efinity 2026.1 illegal synthesis parameters
description: efx_map 2026.1 rejects options that were valid in earlier versions — must be stripped from church_soc.xml before every compile
---

**Illegal options in Efinity 2026.1 efx_map** (cause EFX-0002 and abort):
- `--infer_set_reset` (was `infer_set_reset`) — use `--infer-sync-set-reset` instead
- `--infer_clk_enable` (was `infer_clk_enable`) — use `--infer-clk-enable` instead  
- `--logic_opting`
- `--fanout_limit`

**Problem:** Efinity rewrites `church_soc.xml` with these options on every project open/save, so they come back even after manual removal.

**Fix:** Strip them with sed before every Efinity compile:
```bash
sed -i '/<efx:param name="infer_clk_enable"/d' church_soc.xml
sed -i '/<efx:param name="infer_set_reset"/d'  church_soc.xml
```

Also close+reopen the project in Efinity after editing the XML — Efinity caches project params at open time.

**Why:** These parameter names changed between Efinity versions. The project XML carries the old names from an earlier version and must be sanitised each time.
