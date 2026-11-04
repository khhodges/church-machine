import {useEffect, useRef, useState} from "react";
import "./ide-menu.css";

// These destinations use the IDE's existing view and subtab URL routing.
const groups: {title: string; links: [string, string][]}[] = [
  {title: "Home", links: [["Landing page", "/"]]},
  {title: "Amobea — Phase 1", links: [
    ["Individual view", "/simulator/amobea/index.html#individual"],
    ["Thread Studio", "/simulator/amobea/index.html#thread"],
  ]},
  {title: "Code", links: [
    ["Programs / Editor", "/simulator/#editor"],
    ["Math / REPL", "/simulator/#repl"],
    ["Source Library", "/simulator/#abstractions"],
  ]},
  {title: "Builder", links: [
    ["Builder", "/simulator/#builder"],
    ["Connect Wukong", "/simulator/#builder?tab=ti60-connect"],
    ["Build", "/simulator/#builder?tab=build"],
    ["Testing", "/simulator/#builder?tab=testing"],
    ["Build Log", "/simulator/#builder?tab=buildlog"],
  ]},
  {title: "Tutorial", links: [
    ["Get Started", "/simulator/#start"],
    ["Tutorials", "/simulator/#tutorial"],
  ]},
  {title: "Namespace", links: [
    ["Namespace Table", "/simulator/#namespace"],
    ["Development image", "/development-image/"],
    ["GT Inspector", "/simulator/#gt-view"],
    ["Memory Dump", "/simulator/#memory"],
  ]},
  {title: "Simulator", links: [
    ["Dashboard", "/simulator/#dashboard"],
    ["Pipeline", "/simulator/#pipeline"],
    ["Trace", "/simulator/#trace"],
  ]},
  {title: "Abstractions", links: [
    ["LUMP Repository", "/simulator/#lumps"],
    ["Mum Tunnel", "/simulator/#hello-mum"],
    ["GitHub / Community", "/simulator/#github"],
  ]},
  {title: "Architecture", links: [
    ["Instruction Reference", "/simulator/#reference?tab=isa"],
    ["Hardware Architecture", "/simulator/#reference?tab=hardware"],
    ["Site Map", "/simulator/#sitemap"],
  ]},
  {title: "Docs", links: [
    ["ISA Reference", "/simulator/#docs?doc=instruction-set.md"],
    ["Hardware Guide", "/simulator/#docs?doc=HARDWARE.md"],
    ["CLOOMC++ Guide", "/simulator/#docs?doc=cloomc-foundation.md"],
    ["API Reference", "/simulator/#docs?doc=api-reference.md"],
    ["Quick Start & Guides", "/simulator/#docs?doc=quick-start.md"],
  ]},
];

export default function IdeMenu() {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div className="kiss-ide-menu" ref={wrapper} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" ref={trigger} className="kiss-ide-menu-button"
      aria-label="IDE menu" title="Menu — Browse all views"
      aria-expanded={open} aria-controls="development-ide-navigation"
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => wrapper.current?.querySelector("a")?.focus());
        }
      }}>
      <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
    {open && <nav id="development-ide-navigation" className="kiss-ide-navigation" aria-label="IDE navigation">
      {groups.map(group => <section key={group.title}>
        <h2>{group.title}</h2>
        {group.links.map(([label, href]) => <a key={href} href={href}
          aria-current={href === "/development-image/" ? "page" : undefined}
          onClick={event => {
            if (href === "/development-image/") event.preventDefault();
            setOpen(false);
          }}>{label}</a>)}
      </section>)}
    </nav>}
  </div>;
}
