import type { CSSProperties } from "react";
import { sideOf } from "./nb-association";
import type { GlassLump } from "./nb-association";
import { SIDE_COLORS } from "./NbNamespaceTabs";

type Props = {items: GlassLump[]; top: number; height: number; selectedKey: string | null; onSelect: (item: GlassLump) => void};

// Schematic only: equal bands in A-then-B entry order. Saved Namespaces have
// independent address spaces, so no band height or position is an address.
export default function NbGlassLumps({items, top, height, selectedKey, onSelect}: Props) {
  if (!items.length || height <= 0) return null;
  const band = height / items.length;
  return <g aria-label="Schematic shared LUMP zone, not addresses">
    {items.map((item, index) => {
      const y = top + index * band;
      const side = sideOf(item);
      const active = selectedKey === item.key;
      const words = item.members.map(m => m.words === null ? `${m.side} size unknown` : `${m.side} ${m.words} words`).join(", ");
      const select = () => onSelect(item);
      return <g key={item.key} role="button" tabIndex={0} aria-pressed={active}
        aria-label={`Select LUMP ${item.name}, ${side === "AB" ? "shared by A and B (exact identity)" : `Namespace ${side} only`}, ${words}, schematic position`}
        onClick={select} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } }}
        className={`kiss-region nb-lump${active ? " is-selected" : ""}`} style={{"--kiss-lump-color": SIDE_COLORS[side]} as CSSProperties}>
        <rect x="64" y={y + .6} width="112" height={Math.max(1, band - 1.2)} rx="1.5" strokeDasharray="3 2" style={{opacity: active || !selectedKey ? .82 : .28}} />
        {band >= 9 && <text x="70" y={y + Math.min(band - 2, 9)} textAnchor="start">{side === "AB" ? "A+B" : side} · {item.name.length > 18 ? item.name.slice(0, 17) + "…" : item.name}</text>}
      </g>;
    })}
  </g>;
}
