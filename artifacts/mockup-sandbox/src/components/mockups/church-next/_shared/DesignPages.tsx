import { useState } from 'react';
import { AlertTriangle, Check, LockKeyhole, Plus, Save, Trash2 } from 'lucide-react';
import { type NamespaceDraft, type NamespaceEntry, type ThreadDraft } from './model';

const supportedBodies = [256, 512, 1024, 2048, 4096, 8192];

function SaveState({ saved }: { saved: boolean }) {
  return <span className={`cn-status ${saved ? '' : 'warn'}`}>{saved ? 'Saved · session only' : 'Unsaved design'}</span>;
}

export function ThreadDesignPage({ draft, setDraft, saved, onSave }: {
  draft: ThreadDraft; setDraft: (draft: ThreadDraft) => void; saved: boolean; onSave: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const usedRegisters = new Set(draft.registers.map(x=>x.register));
  const nextRegister = Array.from({length:16},(_,i)=>i).find(i=>!usedRegisters.has(i));
  const usedCapabilityHomes = new Set(draft.capabilities.map(x=>x.register));
  const nextCapabilityHome = Array.from({length:12},(_,i)=>i).find(i=>!usedCapabilityHomes.has(i));
  const issues = [
    !draft.name.trim() ? 'Give this Thread a name.' : '',
    !supportedBodies.includes(Number(draft.bodyWords)) ? 'Choose a supported body size.' : '',
    ...draft.registers.flatMap(x => x.register < 0 || x.register > 15 ? [`Data register r${x.register} is outside r0–r15.`] : []),
    ...draft.capabilities.flatMap(x => x.register < 0 || x.register > 11 ? [`Capability home c${x.register} is outside the tail-home range c0–c11.`] : []),
    ...draft.capabilities.filter(x=>!x.target.trim()).map(x=>`Assign a target to capability home c${x.register}.`),
    ...draft.registers.filter((x,i,a)=>a.findIndex(y=>y.register===x.register)!==i).map(x=>`Data register r${x.register} is assigned more than once.`),
    ...draft.capabilities.filter((x,i,a)=>a.findIndex(y=>y.register===x.register)!==i).map(x=>`Capability home c${x.register} is assigned more than once.`),
  ].filter(Boolean);
  const change = (update: Partial<ThreadDraft>) => { setDraft({...draft,...update}); setChecked(false); };
  return <>
    <div className="cn-heading"><div><div className="cn-eyebrow">Workspace / Authoring / session design</div><h1>Thread Design</h1><p>Describe a Thread layout. This draft is not a runnable artifact or installed state.</p></div><div className="cn-actions"><SaveState saved={saved}/><button className="cn-btn primary" onClick={()=>{setChecked(true);if(!issues.length)onSave();}}><Save size={14}/>Save design · session</button></div></div>
    <div className="cn-note"><strong>Design tool · local demo only.</strong> No API, assembler, storage service, or hardware is connected. Save keeps this design in the current browser session only.</div>
    <div className="cn-split cn-design-split">
      <section className="cn-panel"><div className="cn-panel-head"><h2>Thread definition</h2><span className="cn-mono cn-muted">Draft / {draft.name || 'unnamed'}</span></div>
        <div className="cn-pad">
          <label className="cn-field">Thread name<input value={draft.name} onChange={e=>change({name:e.target.value})} placeholder="e.g. Boot.Thread"/></label>
          <label className="cn-field">Body size · words<select value={draft.bodyWords} onChange={e=>change({bodyWords:Number(e.target.value)})}>{supportedBodies.map(n=><option key={n} value={n}>{n.toLocaleString()} words</option>)}</select></label>
          <div className="cn-rule"/>
          <div className="cn-design-subhead"><div><h3>Initial data registers</h3><p>Data registers r0–r15 occupy words +1 through +16.</p></div><button className="cn-btn" disabled={nextRegister===undefined} onClick={()=>{if(nextRegister!==undefined)change({registers:[...draft.registers,{register:nextRegister,value:''}]});}}><Plus size={13}/>Add assignment</button></div>
          {draft.registers.map((x,i)=><div className="cn-assignment" key={`reg-${i}`}><label>Register<select aria-label={`Data register assignment ${i+1}`} value={x.register} onChange={e=>change({registers:draft.registers.map((a,j)=>j===i?{...a,register:Number(e.target.value)}:a)})}>{Array.from({length:16},(_,n)=>n).filter(n=>n===x.register||!usedRegisters.has(n)).map(n=><option key={n} value={n}>r{n}</option>)}</select></label><label>Initial value<input aria-label={`Initial value for register r${x.register}`} value={x.value} onChange={e=>change({registers:draft.registers.map((a,j)=>j===i?{...a,value:e.target.value}:a)})} placeholder="symbolic value"/></label><button className="cn-icon-btn" aria-label={`Remove r${x.register} assignment`} onClick={()=>change({registers:draft.registers.filter((_,j)=>j!==i)})}><Trash2 size={14}/></button></div>)}
          <div className="cn-rule"/>
          <div className="cn-design-subhead"><div><h3>Initial capability assignments</h3><p>Capability homes occupy the tail: c0–c11.</p></div><button className="cn-btn" disabled={nextCapabilityHome===undefined} onClick={()=>{if(nextCapabilityHome!==undefined)change({capabilities:[...draft.capabilities,{register:nextCapabilityHome,target:'',policy:'read'}]});}}><Plus size={13}/>Add capability</button></div>
          {draft.capabilities.map((x,i)=><div className="cn-assignment" key={`cap-${i}`}><label>Tail home<select aria-label={`Capability home assignment ${i+1}`} value={x.register} onChange={e=>change({capabilities:draft.capabilities.map((a,j)=>j===i?{...a,register:Number(e.target.value)}:a)})}>{Array.from({length:12},(_,n)=>n).filter(n=>n===x.register||!usedCapabilityHomes.has(n)).map(n=><option key={n} value={n}>c{n}</option>)}</select></label><label>Target<input aria-label={`Target for capability c${x.register}`} value={x.target} onChange={e=>change({capabilities:draft.capabilities.map((a,j)=>j===i?{...a,target:e.target.value}:a)})} placeholder="design reference"/></label><label>Policy<select value={x.policy} onChange={e=>change({capabilities:draft.capabilities.map((a,j)=>j===i?{...a,policy:e.target.value}:a)})}><option>read</option><option>write</option><option>read / write</option><option>execute</option></select></label><button className="cn-icon-btn" aria-label={`Remove capability c${x.register}`} onClick={()=>change({capabilities:draft.capabilities.filter((_,j)=>j!==i)})}><Trash2 size={14}/></button></div>)}
          {checked && <div className={`cn-validation ${issues.length?'invalid':'valid'}`} role="status">{issues.length?<><AlertTriangle size={15}/><div><strong>Needs attention</strong>{issues.map((x,i)=><div key={i}>{x}</div>)}</div></>:<><Check size={15}/>{saved?'Thread design validated and saved in this session only.':'Thread design checks passed. Select Save design to retain it in session memory.'}</>}</div>}
        </div>
      </section>
      <aside className="cn-panel"><div className="cn-panel-head"><h2>Layout preview</h2><span className="cn-status">Word offsets · design reference</span></div><div className="cn-pad">
        <div className="cn-thread-layout">
          <div className="cn-layout-zone header"><span>Header</span><strong>word 0</strong><small>typ 2 · cw / sw · cc</small></div>
          <div className="cn-layout-zone data"><span>Data registers</span><strong>words +1 → +16</strong><small>r0–r15 · 16 words</small></div>
          <div className="cn-layout-zone protected"><span><LockKeyhole size={13}/>Protected STO</span><strong>word +17</strong><small>protected</small></div>
          <div className="cn-layout-zone heap"><span>Heap</span><strong>word +18 onward</strong><small>design region</small></div>
          <div className="cn-layout-zone stack"><span>LIFO stack</span><strong>shared body region</strong><small>allocation shared with heap; no partition inferred</small></div>
          <div className="cn-layout-zone capabilities"><span>Capabilities · tail homes</span><strong>c0–c11</strong><small>12 words at tail</small></div>
        </div>
        <div className="cn-body-size">Selected body size <strong>{Number(draft.bodyWords).toLocaleString()} words</strong></div>
        <p className="cn-layout-caption">Zone order and word offsets follow the shared Thread design. This preview does not specify byte encodings, allocation addresses, or executable contents.</p>
        <div className="cn-rule"/><h3>Validation boundary</h3><p>Supported body sizes are 256, 512, 1,024, 2,048, 4,096, and 8,192 words. Runtime capability registers CR12–CR15 are reserved and are not exposed as initial capability homes.</p>
      </div></aside>
    </div>
  </>;
}

export function NamespaceDesignPage({ draft, setDraft, saved, onSave }: {
  draft: NamespaceDraft; setDraft: (draft: NamespaceDraft) => void; saved: boolean; onSave: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const issues = [
    !draft.name.trim() ? 'Give this Namespace design a name.' : '',
    !draft.ideNode.trim() ? 'Choose an IDE node.' : '',
    !draft.entries.some(e=>e.name===draft.bootChoice) ? 'Boot choice must refer to a design entry.' : '',
    ...draft.entries.filter(e=>e.name===draft.bootChoice && e.policy!=='Resident').map(e=>`Boot choice “${e.name}” must use the Resident policy.`),
    ...draft.entries.filter(e=>!e.name.trim()).map((_,i)=>`Design entry ${i+1} needs a name.`),
    ...draft.entries.filter(e=>!e.node.trim()).map(e=>`${e.name || 'Entry'} needs an IDE node.`),
    ...draft.entries.filter(e=>!e.slot.trim()).map(e=>`${e.name || 'Entry'} needs a slot placement.`),
    ...draft.entries.filter(e=>e.slot.trim() && (!/^\d+$/.test(e.slot.trim()) || !Number.isInteger(Number(e.slot)) || Number(e.slot)<2)).map(e=>`${e.name || 'Entry'} slot must be an integer of 2 or greater.`),
    ...draft.entries.filter(e=>/^\d+$/.test(e.slot.trim()) && Number(e.slot)>=2 && draft.entries.some(x=>x.id!==e.id && /^\d+$/.test(x.slot.trim()) && Number(x.slot)>=2 && Number(x.slot)===Number(e.slot))).map(e=>`Slot ${Number(e.slot)} is assigned more than once.`),
    ...draft.entries.filter((e,i,a)=>e.name.trim() && a.findIndex(x=>x.name===e.name)!==i).map(e=>`Design entry name “${e.name}” is duplicated.`),
  ].filter(Boolean);
  const change = (update: Partial<NamespaceDraft>) => { setDraft({...draft,...update}); setChecked(false); };
  const updateEntry = (id:number, updates:Partial<NamespaceEntry>) => change({entries:draft.entries.map(e=>e.id===id?{...e,...updates}:e)});
  const addEntry = () => {
    const id = Math.max(0,...draft.entries.map(e=>e.id))+1;
    change({entries:[...draft.entries,{id,name:'New design entry',node:draft.ideNode,slot:'',policy:'Design only',boot:false}]});
  };
  return <>
    <div className="cn-heading"><div><div className="cn-eyebrow">Workspace / Authoring / session design</div><h1>Namespace Design</h1><p>Arrange a proposed Namespace without changing runnable sample revisions.</p></div><div className="cn-actions"><SaveState saved={saved}/><button className="cn-btn primary" onClick={()=>{setChecked(true);if(!issues.length)onSave();}}><Save size={14}/>Save design · session</button></div></div>
    <div className="cn-note"><strong>Design tool · local demo only.</strong> Entries below are unfinished design notes, separate from saved LUMP revisions and live Namespace placement. Nothing is installed.</div>
    <div className="cn-split cn-design-split">
      <section className="cn-panel"><div className="cn-panel-head"><h2>Namespace proposal</h2><SaveState saved={saved}/></div><div className="cn-pad">
        <label className="cn-field">Design name<input value={draft.name} onChange={e=>change({name:e.target.value})}/></label>
        <label className="cn-field">IDE node<input value={draft.ideNode} onChange={e=>change({ideNode:e.target.value})} placeholder="Node identifier"/></label>
        <label className="cn-field">Boot choice<select value={draft.bootChoice} onChange={e=>change({bootChoice:e.target.value})}><option value="">Choose a design entry</option>{draft.entries.map(e=><option key={e.id} value={e.name}>{e.name || '(unnamed entry)'}</option>)}</select></label>
        <div className="cn-rule"/>
        <div className="cn-design-subhead"><div><h3>Design entries</h3><p>Editable proposal only; not a runnable revision list.</p></div><button className="cn-btn" onClick={addEntry}><Plus size={13}/>Add entry</button></div>
        {draft.entries.length===0 && <div className="cn-empty"><strong>No design entries yet</strong><p>Add a proposed entry to begin arranging this Namespace.</p></div>}
        {draft.entries.map(entry=><article className="cn-entry-edit" key={entry.id}>
          <div className="cn-entry-title"><strong>{entry.name || 'Unnamed entry'}</strong><button className="cn-icon-btn danger" aria-label={`Remove ${entry.name || 'unnamed'} design entry`} onClick={()=>change({entries:draft.entries.filter(e=>e.id!==entry.id)})}><Trash2 size={14}/></button></div>
          <div className="cn-entry-fields"><label>Name<input value={entry.name} onChange={e=>updateEntry(entry.id,{name:e.target.value})}/></label><label>IDE node<input value={entry.node} onChange={e=>updateEntry(entry.id,{node:e.target.value})}/></label><label>Slot placement<input inputMode="numeric" value={entry.slot} onChange={e=>updateEntry(entry.id,{slot:e.target.value})} placeholder="Integer slot ≥ 2"/></label><label>Residency policy<select value={entry.policy} onChange={e=>updateEntry(entry.id,{policy:e.target.value})}><option>Resident</option><option>Lazy</option><option>Design only</option></select></label></div>
          <label className="cn-check"><input type="checkbox" checked={entry.boot} onChange={e=>updateEntry(entry.id,{boot:e.target.checked})}/>Mark as boot candidate · design note</label>
        </article>)}
        {checked && <div className={`cn-validation ${issues.length?'invalid':'valid'}`} role="status">{issues.length?<><AlertTriangle size={15}/><div><strong>Needs attention</strong>{issues.map((x,i)=><div key={i}>{x}</div>)}</div></>:<><Check size={15}/>{saved?'Namespace design validated and saved in this session only.':'Namespace design checks passed. Select Save design to retain it in session memory.'}</>}</div>}
      </div></section>
      <aside className="cn-panel"><div className="cn-panel-head"><h2>Placement preview</h2><span className="cn-status">Proposal only</span></div><div className="cn-pad">
        <div className="cn-preview-root"><div className="cn-preview-root-head"><span className="cn-eyebrow">DESIGN NAMESPACE</span><strong>{draft.name || 'Unnamed Namespace'}</strong><small>IDE node · {draft.ideNode || 'not assigned'}</small></div>
          <div className="cn-foundation-label"><LockKeyhole size={13}/>Protected foundation slots · reserved</div>
          <div className="cn-foundation"><span><span className="cn-mono">slot 0</span> · Boot.NS</span><strong>Protected</strong></div>
          <div className="cn-foundation"><span><span className="cn-mono">slot 1</span> · Boot.Thread</span><strong>Protected</strong></div>
          <div className="cn-foundation-label">Editable design placements</div>
          {draft.entries.map(e=><div className="cn-preview-entry" key={e.id}><div><strong>{e.name || 'Unnamed entry'}</strong><small>{e.node} · policy: {e.policy}{e.boot || draft.bootChoice===e.name ? ' · boot candidate' : ''}</small></div><span className="cn-mono">{e.slot ? `slot ${e.slot}` : 'unplaced'}</span></div>)}
          {!draft.entries.length && <div className="cn-empty compact">No proposed entries to preview.</div>}
        </div>
        <div className="cn-note green" style={{marginTop:16,marginBottom:0}}>Preview is descriptive. It does not modify the runnable sample Namespace, create a revision, or install anything.</div>
        <div className="cn-rule"/><h3>Separate by design</h3><p>Saved revisions and installed placement remain on the Namespace page. These draft entries stay here as session-only authoring state until explicitly saved.</p>
      </div></aside>
    </div>
  </>;
}
