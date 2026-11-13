import { useEffect, useRef, useState } from "react";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  loading: boolean;
  options: {value: string; label: string}[];
};

// Render the popup in the document rather than the browser's native select UI.
// This keeps the list visible inside the IDE's nested preview frames.
export default function NamespacePicker({id, label, value, onChange, loading, options}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = [{value: "", label: "Unassigned"}, ...options];
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open) root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[active]?.focus();
  }, [open, active]);
  function show() {
    setActive(Math.max(0, items.findIndex(item => item.value === value)));
    setOpen(true);
  }
  return <div ref={root} className="nb-picker" onBlur={event => {
    // Safari and nested frames can report a null relatedTarget during pointer
    // focus changes. Do not unmount options before their click can arrive.
    // Pointer dismissal is owned by the document pointerdown listener.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" id={id} aria-label={label} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} disabled={loading}
      className="nb-picker-trigger" onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
      }}>
      <span>{loading ? "Loading Namespaces…" : options.find(option => option.value === value)?.label || "Unassigned"}</span>
      <span aria-hidden="true">▾</span>
    </button>
    {open && <div id={`${id}-list`} role="listbox" aria-label={label} className="nb-picker-list"
      onKeyDown={event => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setActive(index => event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
            (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
        }
      }}>
      {items.map((option, index) => <button type="button" role="option" key={option.value}
        aria-selected={option.value === value} tabIndex={index === active ? 0 : -1}
        className="nb-picker-option" onClick={() => {
          onChange(option.value); setOpen(false); trigger.current?.focus();
        }}>
        <span>{option.label}</span>{option.value === value && <span aria-hidden="true">✓</span>}
      </button>)}
    </div>}
  </div>;
}
