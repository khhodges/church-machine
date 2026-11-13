import type { CSSProperties } from "react";
import { extentToY } from "./nb-geometry";
import type { LumpPick } from "./nb-association";
import type { PlanItem } from "./nb-plan";

type Props = {
  items: PlanItem[]; scaleWords: number; capacityWords: number | null; top: number; height: number;
  colorFor: (item: PlanItem) => string; pick: LumpPick | null;
  related: (item: PlanItem) => boolean; onSelect: (item: PlanItem) => void;
};

// One full-width pool: each placed object at its proposed, disjoint interval.
export default function NbPlanGlass({items, scaleWords, capacityWords, top, height, colorFor, pick, related, onSelect}: Props) {
  return <g>
    {items.filter(i => i.start !== null && i.words).map(item => {
      const {y, h} = extentToY(item.start!, item.words!, scaleWords, top, height);
      const active = pick?.side === item.side && pick.slot === item.slot;
      const rel = !active && related(item);
      const select = () => onSelect(item);
      const tag = item.kind === "lump" ? item.side : `${item.side} ${item.kind === "namespace" ? "TABLE" : item.kind.toUpperCase()}`;
      return <g key={`${item.side}:${item.slot}`} role="button" tabIndex={0} aria-pressed={active}
        aria-label={`Select ${item.name}, Namespace ${item.side} ${item.kind}, proposed words ${item.start} to ${item.start! + item.words! - 1}`}
        onClick={select} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } }}
        className={`kiss-region nb-plan-block nb-kind-${item.kind}${active || rel ? " is-selected" : ""}`} style={{"--kiss-lump-color": colorFor(item)} as CSSProperties}>
        <rect x="60" y={y} width="120" height={Math.max(h, .8)} rx="1" style={{opacity: active ? 1 : rel ? .85 : pick ? .3 : .72}} />
        {h >= 10 && <text x="64" y={y + Math.min(h - 2, 9)}>{tag} · {item.name.length > 20 ? item.name.slice(0, 19) + "…" : item.name}</text>}
      </g>;
    })}
    {capacityWords !== null && capacityWords < scaleWords && (() => {
      const y = top + (scaleWords - capacityWords) / scaleWords * height;
      return <g aria-label="Proposed total capacity line"><line x1="52" x2="188" y1={y} y2={y} stroke="#ee9b70" strokeWidth="1.5" strokeDasharray="4 2" />
        <text x="186" y={y - 3} textAnchor="end" className="kiss-glass-tick" style={{fill: "#ee9b70"}}>proposed total</text></g>;
    })()}
  </g>;
}
