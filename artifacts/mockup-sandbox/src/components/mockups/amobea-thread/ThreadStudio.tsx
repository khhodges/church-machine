import { useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Boxes, Check, ChevronRight, CircleHelp, Code2, Database, FileCode2, Layers3, LockKeyhole, MessageSquare, Phone, Plus, RotateCcw, Save, ShieldCheck, ShoppingBasket, SlidersHorizontal, Sparkles, Utensils, CalendarDays, Trash2 } from 'lucide-react';
import { ThreadDesignPage } from './_shared/DesignPages';
import { initialThreadDraft, type ThreadDraft } from './_shared/model';
import { initialTuples, nextOffset, RECORD_WORDS, statuses, transactions, type DemoTuple, type Field, type Values } from './_shared/tuples';
import './_group.css';
import './_studio.css';
import './ThreadStudio.css';

type Tab = 'tuples' | 'thread' | 'messages' | 'checkpoint' | 'diagnostic';
type Edit = { fields: Values; json: string };
type StudioTransaction = {
  name: string; purpose: string; schema: string; methods: string; peer: string;
  authority: string; fields: Field[]; values: Values; payload: string[];
  excluded: string; result: string;
};
const icons = [Phone, Utensils, Sparkles, ShoppingBasket, CalendarDays];
const tabs: { id: Tab; label: string; icon: typeof Database }[] = [
  { id: 'tuples', label: 'Tuple storage', icon: Database },
  { id: 'thread', label: 'Thread definition', icon: SlidersHorizontal },
  { id: 'messages', label: 'Authority & payload', icon: MessageSquare },
  { id: 'checkpoint', label: 'Continuation scope', icon: Layers3 },
  { id: 'diagnostic', label: 'Source diagnostic', icon: Code2 },
];

function validateRecord(transaction: StudioTransaction, value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Use a JSON object with named schema fields, not an array or null.'];
  const record = value as Values;
  const errors = Object.keys(record).filter(key => !transaction.fields.some(field => field.key === key))
    .map(key => `Unknown field “${key}”. Use the keys shown in the schema.`);
  for (const field of transaction.fields) {
    const entry = record[field.key];
    if (field.type === 'text' && (typeof entry !== 'string' || !entry.trim() || new TextEncoder().encode(entry).length > 32)) {
      errors.push(`${field.label}: enter 1–32 UTF-8 bytes to fit its 8-word illustrative slot.`);
    }
    if (field.type === 'number' && (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 2147483647)) {
      errors.push(`${field.label}: use a whole number from 0 to 2,147,483,647.`);
    }
    if (field.type === 'status' && !statuses.includes(String(entry))) errors.push(`${field.label}: choose a listed application status.`);
  }
  return errors;
}

export function ThreadStudio() {
  const [draft, setDraft] = useState(initialThreadDraft);
  const [tuples, setTuples] = useState(initialTuples);
  const [transactionList, setTransactionList] = useState<StudioTransaction[]>(() => transactions.map(item => ({
    ...item, fields: [...item.fields], values: { ...item.values }, payload: [...item.payload],
  })));
  const [tx, setTx] = useState(0);
  const [selectedId, setSelectedId] = useState(1);
  const [tab, setTab] = useState<Tab>('tuples');
  const [saved, setSaved] = useState(false);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [mode, setMode] = useState<'fields' | 'json'>('fields');
  const [review, setReview] = useState<{ id: number; values: Values } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [allocation, setAllocation] = useState(false);
  const [release, setRelease] = useState<number | null>(null);
  const [reset, setReset] = useState(false);
  const [payloadKeys, setPayloadKeys] = useState<Record<number, string[]>>({});
  const [payloadReview, setPayloadReview] = useState(false);
  const [scope, setScope] = useState({ tuples: true, frame: true, authority: true });
  const [scopeReview, setScopeReview] = useState(false);
  const [newTransactionOpen, setNewTransactionOpen] = useState(false);
  const [newTransactionName, setNewTransactionName] = useState('');
  const [newTransactionPurpose, setNewTransactionPurpose] = useState('');
  const [deleteTransactionConfirm, setDeleteTransactionConfirm] = useState(false);
  const serial = useRef(6);
  const savedDesign = useRef<unknown>(null);
  const transaction = transactionList[tx];
  const visibleTuples = tuples.filter(t => t.tx === tx);
  const selected = visibleTuples.find(t => t.id === selectedId);
  const edit = selected ? edits[selected.id] || { fields: selected.values, json: '{\n  "status": "active"\n}' } : null;
  const used = tuples.length * RECORD_WORDS;
  const budget = draft.bodyWords - 30;
  const freeOffset = nextOffset(tuples, draft.bodyWords);
  const keys = payloadKeys[tx] ?? [...transaction.payload];
  const dirty = () => { setSaved(false); setNotice(''); };
  const navigateTx = (index: number) => {
    setTx(index); setSelectedId(tuples.find(t => t.tx === index)?.id ?? -1);
    setReview(null); setRelease(null); setAllocation(false); setErrors([]); setPayloadReview(false);
  };
  const updateDraft = (next: ThreadDraft) => {
    dirty();
    if (tuples.some(t => t.offset + RECORD_WORDS > next.bodyWords - 12)) {
      setNotice('Body size not changed: allocated fixture records would overlap the tail homes. Release records first. Your other drafts are preserved.');
      return;
    }
    setDraft(next);
  };
  const save = () => {
    const issues = [
      !draft.name.trim() ? 'Give the Thread a name in Thread definition.' : '',
      ...draft.capabilities.filter(c => !c.target.trim()).map(c => `Assign a target to c${c.register} in Thread definition.`),
      ...tuples.flatMap(t => transactionList[t.tx] ? validateRecord(transactionList[t.tx], t.values) : ['A tuple refers to a missing Transaction.']),
    ].filter(Boolean);
    if (issues.length) { setErrors(issues); setNotice('Design not saved. Resolve the validation below.'); return; }
    savedDesign.current = structuredClone({ draft, transactionList, tuples, edits, payloadKeys, scope });
    setSaved(true); setErrors([]); setNotice('Design retained in session memory, including editing drafts. Unapplied record edits remain unapplied. Reloading discards this session.');
  };
  const changeEdit = (patch: Partial<Edit>) => {
    if (!selected || !edit) return;
    dirty(); setReview(null); setErrors([]);
    setEdits(prev => ({ ...prev, [selected.id]: { ...edit, ...patch } }));
  };
  const reviewEdit = () => {
    if (!selected || !edit) return;
    let values: Values;
    try {
      if (mode === 'json') {
        const patch: unknown = JSON.parse(edit.json);
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Use a JSON object, for example {"status":"active"}.');
        values = { ...selected.values, ...patch };
      } else values = { ...edit.fields };
      const issues = validateRecord(transaction, values);
      if (issues.length) { setErrors(issues); setReview(null); return; }
      setErrors([]); setReview({ id: selected.id, values });
    } catch (error) { setReview(null); setErrors([error instanceof SyntaxError ? 'JSON could not be read. Use double-quoted keys and values; remove trailing commas. No record was changed.' : String((error as Error).message)]); }
  };
  const apply = () => {
    if (!review || !tuples.some(t => t.id === review.id)) { setErrors(['This allocation is no longer available. Select a current record.']); return; }
    setTuples(prev => prev.map(t => t.id === review.id ? { ...t, values: review.values } : t));
    setEdits(prev => ({ ...prev, [review.id]: { fields: review.values, json: '{}' } }));
    dirty(); setReview(null); setNotice(`Tuple #${review.id} updated as a complete validated record. Other allocations were not changed.`);
  };
  const reserve = () => {
    const offset = nextOffset(tuples, draft.bodyWords);
    if (offset === undefined) { setErrors(['No complete 18-word slot remains. Release a disposable allocation or increase the body size.']); return; }
    const id = serial.current++;
    setTuples(prev => [...prev, { id, tx, offset, values: { ...transaction.values, status: 'prepared' } }]);
    setSelectedId(id); setAllocation(false); setReview(null); setErrors([]); dirty();
    setNotice(`Reserved #${id} at illustrative +${offset}. Fresh handle; released IDs are never reused in this demo.`);
  };
  const releaseTuple = (id: number) => {
    const remaining = tuples.filter(t => t.id !== id);
    setTuples(remaining); setRelease(null); setReview(null);
    setSelectedId(remaining.find(t => t.tx === tx)?.id ?? -1);
    setEdits(prev => { const next = { ...prev }; delete next[id]; return next; });
    dirty(); setNotice(`Released disposable tuple #${id}. Its handle is retired; no capability revocation is implied.`);
  };
  const resetDemo = () => {
    setDraft(initialThreadDraft()); setTuples(initialTuples()); setTransactionList(transactions.map(item => ({ ...item, fields: [...item.fields], values: { ...item.values }, payload: [...item.payload] }))); setTx(0); setSelectedId(1); setEdits({}); setReview(null);
    setErrors([]); setRelease(null); setAllocation(false); setReset(false); setPayloadKeys({}); setPayloadReview(false);
    setScope({ tuples: true, frame: true, authority: true }); setScopeReview(false); setNewTransactionOpen(false); setDeleteTransactionConfirm(false); setNewTransactionName(''); setNewTransactionPurpose(''); savedDesign.current = null;
    dirty(); setNotice('Synthetic demo reset. All session edits and the saved design were discarded.');
  };
  const addTransaction = () => {
    const name = newTransactionName.trim();
    const purpose = newTransactionPurpose.trim();
    if (!name || !purpose) { setNotice('Enter a Transaction name and purpose before creating it.'); return; }
    if (transactionList.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setNotice('Transaction names must be unique. Choose a different name.');
      return;
    }
    const created: StudioTransaction = {
      name, purpose, schema: `${name.replace(/[^a-zA-Z0-9]/g, '') || 'Task'}Record`,
      methods: 'Task.prepare → Task.review', peer: 'Peer.Thread',
      authority: 'Existing capability grant required',
      fields: [
        { key: 'task', label: 'Task', type: 'text', words: 8 },
        { key: 'details', label: 'Details', type: 'text', words: 8 },
        { key: 'attempts', label: 'Attempts', type: 'number', words: 1 },
        { key: 'status', label: 'Task state', type: 'status', words: 1 },
      ],
      values: { task: 'New task', details: 'Synthetic details', attempts: 0, status: 'prepared' },
      payload: ['task'], excluded: 'Unselected context and all other Transactions',
      result: 'A reviewed result only; no external action is executed.',
    };
    const index = transactionList.length;
    setTransactionList(prev => [...prev, created]);
    setTx(index); setSelectedId(-1); setTab('tuples'); setNewTransactionOpen(false);
    setNewTransactionName(''); setNewTransactionPurpose(''); setDeleteTransactionConfirm(false);
    setErrors([]); dirty(); setNotice(`Added “${name}” as a synthetic Transaction. Reserve its first tuple when ready.`);
  };
  const deleteTransaction = () => {
    if (transactionList.length <= 1) { setNotice('Keep at least one Transaction in the workspace.'); setDeleteTransactionConfirm(false); return; }
    const retired = tuples.filter(tuple => tuple.tx === tx);
    const nextTuples = tuples.filter(tuple => tuple.tx !== tx).map(tuple => tuple.tx > tx ? { ...tuple, tx: tuple.tx - 1 } : tuple);
    const nextIndex = Math.max(0, tx - 1);
    const nextSelected = nextTuples.find(tuple => tuple.tx === nextIndex)?.id ?? -1;
    setTransactionList(prev => prev.filter((_, index) => index !== tx));
    setTuples(nextTuples); setTx(nextIndex); setSelectedId(nextSelected);
    setEdits(prev => { const next = { ...prev }; retired.forEach(tuple => delete next[tuple.id]); return next; });
    setPayloadKeys(prev => {
      const next: Record<number, string[]> = {};
      Object.entries(prev).forEach(([index, fields]) => {
        const numericIndex = Number(index);
        if (numericIndex < tx) next[numericIndex] = fields;
        if (numericIndex > tx) next[numericIndex - 1] = fields;
      });
      return next;
    });
    setDeleteTransactionConfirm(false); setReview(null); setErrors([]); dirty();
    setNotice(`Deleted “${transaction.name}” and its ${retired.length} synthetic allocation${retired.length === 1 ? '' : 's'}. Other Transactions were retained.`);
  };
  return <div className="church-next cm-studio">
    <header className="cm-top"><div className="cm-brand"><span className="cm-logo">λ</span><span className="cm-brand-name">CHURCH MACHINE</span></div><span className="cm-top-divider"/><span className="cm-product">AMOBEA / THREAD STUDIO</span><div className="cm-top-meta"><span>PERSONAL WORKBENCH</span><span className="cm-build-badge"><span/>PHASE 1 · DESIGN ONLY</span></div></header>
    <div className="cm-workspace">
      <aside className="cm-rail" aria-label="Transaction examples"><div className="cn-eyebrow">Personal Transactions</div>
        {transactionList.map((item, index) => { const Icon = icons[index] ?? Database; return <div className="cm-transaction-row" key={`${item.name}-${index}`}><button key={item.name} className={`cm-transaction ${tx === index ? 'active' : ''}`} aria-pressed={tx === index} onClick={() => navigateTx(index)}><Icon size={17}/><span><strong>{item.name}</strong><small>TX-{index + 1} · {tuples.filter(t=>t.tx===index).length} allocation{tuples.filter(t=>t.tx===index).length!==1?'s':''}</small></span>{tx===index && <ChevronRight size={13} style={{marginLeft:'auto'}}/>}</button>{tx===index && <button className="cm-delete-transaction" aria-label={`Delete ${item.name}`} title={`Delete ${item.name}`} onClick={()=>{setDeleteTransactionConfirm(true);setNewTransactionOpen(false);}}><Trash2 size={13}/></button>}</div>; })}
        <button className="cm-new-transaction" onClick={()=>{setNewTransactionOpen(value=>!value);setDeleteTransactionConfirm(false);}}><Plus size={14}/> New Transaction</button>
        {newTransactionOpen && <form className="cm-transaction-form" onSubmit={event=>{event.preventDefault();addTransaction();}}><label>Transaction name<input autoFocus maxLength={36} value={newTransactionName} onChange={event=>setNewTransactionName(event.target.value)} placeholder="e.g. Plan a trip"/></label><label>Purpose<input maxLength={96} value={newTransactionPurpose} onChange={event=>setNewTransactionPurpose(event.target.value)} placeholder="What should this help with?"/></label><button type="submit" className="cn-btn primary">Create Transaction</button></form>}
        {deleteTransactionConfirm && <div className="cm-delete-confirm" role="alert"><strong>Delete {transaction.name}?</strong><p>This removes its synthetic tuple data and local edit drafts. Other Transactions stay intact.</p><div><button onClick={deleteTransaction}>Delete</button><button onClick={()=>setDeleteTransactionConfirm(false)}>Keep</button></div></div>}
        <div className="cm-rail-note"><LockKeyhole size={17}/><strong>Your Namespace is the enclosing private environment.</strong>It is not a blanket grant to external services. Capabilities are the foundation of access authority.<div className="cn-rule"/><span className="cn-mono" style={{fontSize:10}}>ALL DATA IS SYNTHETIC</span><br/>No simulator or live services.</div>
      </aside>
      <main className="cm-main">
        <div className="cm-title"><div><div className="cn-eyebrow">Workspace / Amobea / TX-{tx+1}</div><h1>{transaction.name}</h1></div><div className="cn-actions"><span className={`cn-status ${saved?'':'warn'}`}>{saved?'Saved · session only':'Unsaved design'}</span><button className="cn-btn primary" onClick={save}><Save size={14}/>Save design</button></div></div>
        <p className="cm-subtitle">{transaction.purpose} <span className="cn-muted">One Thread, shared working state.</span></p>
        <div className="cm-authority"><ShieldCheck size={18}/><div><strong>Shared does not mean private.</strong> Cooperating methods use the same Thread tuples. A schema, name or Transaction ID grants no authority.<br/><span>For isolation: a separate Thread + existing capability grants + Dijkstra messages. No tuple ACLs.</span></div></div>
        <section className="cm-summary" aria-label="Storage summary"><div><span className="cn-eyebrow">Owning Thread</span><strong>{draft.name || 'Unnamed Thread'}</strong><small>{transaction.methods} · proposed cooperation, not executed</small></div><div><span className="cn-eyebrow">Fixture allocation</span><strong>{used} <span style={{fontSize:11,color:'var(--muted)'}}>/ {budget} words</span></strong><div className="cm-meter"><span style={{width:`${used/budget*100}%`}}/></div><small>{tuples.length} records · {budget-used} words unallocated</small></div><div><span className="cn-eyebrow">Task progress</span><strong style={{fontSize:13}}>{visibleTuples[0]?.values.status || 'No working records'}</strong><small>Application status ≠ running ownership</small></div></section>
        <nav className="cm-tabs" aria-label="Design views">{tabs.map(t => <button key={t.id} className={tab===t.id?'active':''} aria-current={tab===t.id?'page':undefined} onClick={()=>{setTab(t.id);setErrors([]);setReview(null);}}><t.icon size={14}/>{t.label}{t.id==='diagnostic' && <span className="cn-status warn">1</span>}</button>)}</nav>
        {notice && <div className="cn-toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={()=>setNotice('')}>Dismiss</button></div>}
        {errors.length>0 && <div className="cm-error" role="alert"><strong>No changes applied.</strong>{errors.map((e,i)=><div key={i}>{e}</div>)}</div>}
        <div className="cm-content" key={tab}>
        {tab==='tuples' && <div className="cm-grid">
          <div className="cm-stack">
            <section className="cn-panel"><div className="cn-panel-head"><h2 className="cm-panel-title"><Database size={16}/>Allocated records <small>TX-{tx+1}</small></h2><button className="cn-btn" onClick={()=>{setAllocation(true);setRelease(null);}}><Plus size={13}/>Reserve tuple</button></div>
              {visibleTuples.length ? <div className="cn-table-wrap"><table className="cm-records"><thead><tr><th>Record / handle</th><th>Fixture span</th><th>Words</th><th>Task state</th></tr></thead><tbody>{visibleTuples.map(t=><tr key={t.id} className={selectedId===t.id?'selected':''}><td><button className="cm-select-record" aria-pressed={selectedId===t.id} onClick={()=>{setSelectedId(t.id);setReview(null);setErrors([]);setRelease(null);}}><span className="cm-record-name">{transaction.schema}</span><span className="cm-record-id">tuple #{t.id} · TX-{tx+1}</span></button></td><td className="cn-mono">+{t.offset}–{t.offset+17}</td><td className="cn-mono">18</td><td><span className="cn-status">{t.values.status}</span></td></tr>)}</tbody></table></div> : <div className="cn-pad cn-empty"><Database size={22}/><h3>No working records</h3><p>This task has no allocated state. Reserve a synthetic tuple to start; other Transactions remain unchanged.</p></div>}
              <div className="cm-panel-foot"><span>Shared by cooperating methods · no private fields</span><span className="cm-tag">Illustrative, not ABI</span></div>
              {allocation && <div className="cn-pad" style={{borderTop:'1px solid var(--line)'}}><h3>Reserve one disposable {transaction.schema}?</h3><p className="cm-help">18 words, initialized with synthetic defaults. {freeOffset!==undefined ? `Proposed fixture span: +${freeOffset}–${freeOffset+17}.` : 'No complete slot fits. Release a record or enlarge the Thread body.'} No existing allocation is overwritten. Release is manual; task status never auto-releases.</p><div className="cn-actions" style={{marginTop:12}}><button className="cn-btn primary" disabled={freeOffset===undefined} onClick={reserve}>Confirm reservation</button><button className="cn-btn" onClick={()=>setAllocation(false)}>Keep current allocations</button></div></div>}
            </section>
            {selected && edit && <section className="cn-panel"><div className="cn-panel-head"><h2 className="cm-panel-title"><FileCode2 size={16}/>Inspect & update <small>tuple #{selected.id}</small></h2><div className="cm-mode" aria-label="Editing mode">{(['fields','json'] as const).map(m=><button key={m} className={mode===m?'active':''} aria-pressed={mode===m} onClick={()=>{setMode(m);setReview(null);setErrors([]);}}>{m==='fields'?'Fields':'JSON patch'}</button>)}</div></div><div className="cn-pad">
              {mode==='fields' ? <div className="cm-form-grid">{transaction.fields.map(f=><label key={f.key} className="cn-field">{f.label}{f.type==='status'?<select value={edit.fields[f.key]} onChange={e=>changeEdit({fields:{...edit.fields,[f.key]:e.target.value}})}>{statuses.map(s=><option key={s}>{s}</option>)}</select>:<input type={f.type==='number'?'number':'text'} value={edit.fields[f.key]??''} min={f.type==='number'?0:undefined} onChange={e=>changeEdit({fields:{...edit.fields,[f.key]:f.type==='number'?(e.target.value===''?'':Number(e.target.value)):e.target.value}})}/>}</label>)}</div> : <label className="cn-field" style={{marginTop:0}}>Partial JSON update<textarea spellCheck={false} value={edit.json} onChange={e=>changeEdit({json:e.target.value})}/></label>}
              <p className="cm-help" style={{marginTop:0}}>{mode==='json'?'Omitted fields keep their current allocated values. Unknown keys and invalid values reject the entire update.':'Field edits are drafts until reviewed and applied. Text slots accept 1–32 UTF-8 bytes.'} Switching modes or Transactions preserves both editing drafts.</p>
              {review && review.id===selected.id && <div className="cm-review" role="status"><strong>Review the complete next record</strong><pre>{JSON.stringify(review.values,null,2)}</pre><p className="cm-help">Changed keys: {Object.keys(review.values).filter(k=>review.values[k]!==selected.values[k]).join(', ') || 'none'}. All other keys are retained. No unrelated tuple is written.</p><div className="cn-actions" style={{marginTop:10}}><button className="cn-btn primary" onClick={apply}><Check size={13}/>Apply validated update</button><button className="cn-btn" onClick={()=>setReview(null)}>Back to editing</button></div></div>}
              <div className="cn-actions" style={{marginTop:15,justifyContent:'space-between'}}><button className="cn-btn primary" onClick={reviewEdit}>Review update<ArrowRight size={13}/></button><button className="cn-btn" onClick={()=>{setRelease(selected.id);setAllocation(false);}}>Release tuple…</button></div>
              {release===selected.id && <div className="cm-error"><strong>Release tuple #{selected.id} and its data?</strong><p className="cm-help">This disposable fixture record and its editing drafts will be removed. The span can be reused with a fresh ID. Other records are retained; external effects are not undone.</p><div className="cn-actions" style={{marginTop:12}}><button className="cn-btn" onClick={()=>releaseTuple(selected.id)}>Confirm release #{selected.id}</button><button className="cn-btn" onClick={()=>setRelease(null)}>Keep tuple</button></div></div>}
            </div></section>}
          </div>
          <aside className="cm-stack"><section className="cn-panel"><div className="cn-panel-head"><h2 className="cm-panel-title"><Boxes size={16}/>Tuple schema</h2><span className="cm-tag">18 words</span></div><div className="cn-pad"><div className="cn-eyebrow">{transaction.schema} · proposed</div>{transaction.fields.map(f=><div key={f.key} className="cm-schema"><code>{f.key}</code><span>{f.words}w</span><small>{f.type==='text'?'Fixed UTF-8 slot · max 32 bytes':f.type==='number'?'Non-negative integer · demo range':'Application status enum · not ownership'}</small></div>)}<p className="cm-help">2 × 8-word text slots + 1 number + 1 status = 18 words. Illustrative 4-byte word packing only; not a machine ABI or executable layout.</p></div></section>
            <section className="cn-panel"><div className="cn-panel-head"><h2>Storage accounting</h2><CircleHelp size={15}/></div><div className="cn-pad"><dl className="cn-details" style={{marginTop:0}}><dt>Selected body</dt><dd>{draft.bodyWords}w</dd><dt>Leading geometry allowance</dt><dd>18w</dd><dt>Tail capability homes</dt><dd>12w</dd><dt>Fixture envelope</dt><dd>{budget}w</dd><dt>All TX allocations</dt><dd>{used}w</dd></dl><p className="cm-help">Conservative fixture arithmetic: {draft.bodyWords} − 18 − 12 = {budget}. Spans are illustrative offsets, not actual addresses. The unallocated remainder is shared heap/stack capacity, not a reserved heap partition.</p><p className="cm-help">First-fit fixed spans cannot overlap. Exhaustion rejects reservation. Released handles are retired locally; no GT revocation is claimed.</p><button className="cn-btn text" style={{marginTop:14}} onClick={()=>setTab('thread')}>Inspect protected geometry <ArrowRight size={12}/></button></div></section>
          </aside>
        </div>}
        {tab==='thread' && <ThreadDesignPage draft={draft} setDraft={updateDraft} saved={saved} onSave={save}/>}
        {tab==='messages' && <div className="cm-grid"><section className="cn-panel"><div className="cn-panel-head"><h2>Review what crosses the boundary</h2><span className="cn-status warn">No real delivery</span></div><div className="cn-pad"><p>A separate peer Thread receives only explicitly selected payload fields, under existing authority. The Transaction ID correlates replies; it never authorizes access.</p><div className="cm-flow-node"><span className="cn-eyebrow">Shared working state</span><strong>{draft.name} / {transaction.schema}</strong><p className="cm-help">{transaction.methods}</p></div><div className="cm-flow-arrow"><ArrowDown size={16}/>Dijkstra message intent · exact ABI unresolved</div><div className="cm-flow-node"><span className="cn-eyebrow">Isolated peer · synthetic test double</span><strong>{transaction.peer}</strong><p className="cm-help">Existing authority requirement: {transaction.authority}</p></div>
          <h3 style={{marginTop:20}}>Declared disclosure</h3>{transaction.fields.filter(f=>f.key!=='status').map(f=><label className="cn-check" key={f.key}><input type="checkbox" checked={keys.includes(f.key)} onChange={e=>{dirty();setPayloadReview(false);setPayloadKeys(prev=>({...prev,[tx]:e.target.checked?[...keys,f.key]:keys.filter(k=>k!==f.key)}));}}/>{f.label} <code>{f.key}</code></label>)}<p className="cm-help">Normally excluded: {transaction.excluded}. Selections are design intent only. Shared tuple fields are not private compartments.</p><button className="cn-btn primary" style={{marginTop:15}} disabled={!selected} onClick={()=>setPayloadReview(true)}>Review conceptual payload <ArrowRight size={13}/></button>{!selected && <p className="cm-help">Reserve and select a tuple before reviewing a payload.</p>}
          {payloadReview && selected && <div className="cm-review"><strong>DESIGN ONLY · no message sent</strong><pre>{JSON.stringify({correlation:`TX-${tx+1}`,peer:transaction.peer,payload:Object.fromEntries(keys.map(k=>[k,selected.values[k]]))},null,2)}</pre><p className="cm-help">{keys.length?'Only these selected values are disclosed in the conceptual request.':'Empty payload: no tuple fields selected.'} Namespace contents are never included implicitly. Shape is illustrative, not a protocol.</p></div>}
        </div></section><aside className="cm-stack"><section className="cn-panel"><div className="cn-panel-head"><h2>Capability gate</h2><ShieldCheck size={16}/></div><div className="cn-pad"><p className="cm-help" style={{marginTop:0}}>Initial capability assignments are design references, not acquired service grants.</p>{draft.capabilities.map(c=><div className="cm-schema" key={c.register}><code>c{c.register}</code><span>{c.policy}</span><small>{c.target || 'No target assigned'}</small></div>)}<div className="cm-warning" style={{marginTop:15}}>Required service authority is not resolved in this prototype. Denial must reject before any effect. A separate Thread name alone does not remove existing grants.</div><button className="cn-btn text" style={{marginTop:15}} onClick={()=>setTab('thread')}>Review existing capability homes <ArrowRight size={12}/></button></div></section><section className="cn-panel"><div className="cn-panel-head"><h2>Response boundary</h2></div><div className="cn-pad"><p>{transaction.result}</p><p className="cm-help">Execution is blocked until the messaging ABI, reply correlation, late/duplicate handling, denial, and fault/reset behavior have agreed contracts and runtime tests. This host UI is not isolation evidence.</p></div></section></aside></div>}
        {tab==='checkpoint' && <div className="cm-grid"><section className="cn-panel"><div className="cn-panel-head"><h2>Checkpoint / rollback intent</h2><span className="cn-status warn">Execution blocked</span></div><div className="cn-pad"><p>Review intended retained scope, not an executable saved image. Tuple storage acceptance does not establish continuation rollback.</p><div className="cm-checkpoint-list">{([{key:'tuples',title:'Selected Transaction working records',description:`${visibleTuples.length} records / ${visibleTuples.length*18} words currently allocated; retention contract not settled.`},{key:'frame',title:'Saved continuation frame',description:'Intended continuation context, distinct from the live protected indicator at +17. Capture format and validity unresolved.'},{key:'authority',title:'Existing authority references',description:'No new grants. Authority validity and one-shot consumption must be reviewed.'}] as const).map(s=><label key={s.key}><input type="checkbox" checked={scope[s.key]} onChange={e=>{dirty();setScopeReview(false);setScope(prev=>({...prev,[s.key]:e.target.checked}));}}/><span><strong>{s.title}</strong><p className="cm-help" style={{marginTop:4}}>{s.description}</p></span></label>)}</div><button className="cn-btn primary" onClick={()=>setScopeReview(true)}>Review intended scope</button>{scopeReview && <div className="cm-review"><strong>Scope review only</strong><p className="cm-help">Proposed retention: {Object.entries(scope).filter(([,v])=>v).map(([k])=>k).join(', ') || 'nothing selected'}. Not captured, stored, restored, or tested. External calls, cooking, purchases, and other effects are neither replayed nor undone.</p></div>}</div></section><aside className="cn-panel"><div className="cn-panel-head"><h2>Unresolved blockers</h2><LockKeyhole size={16}/></div><div className="cn-pad"><div className="cm-warning">Capture / resume contract<br/>One-shot consumption & duplicate restore<br/>Reset, faults & retained data scope<br/>Running-bit approval / lifecycle</div><p className="cm-help">No capture or restore action is executable. Waiting, pause, completed, and cancelled are application statuses, not Thread ownership transitions.</p><div className="cn-rule"/><h3>Protected context</h3><p className="cm-help">Live indicator: +17. STO bits 0–11; size bit 12; bits 13–27 remain reserved, including bit13. Flags occupy 28–31; no new running-bit assignment is proposed.</p><p className="cm-help">Checkpoint storage is not a security boundary. Existing capabilities remain the authority mechanism.</p></div></aside></div>}
        {tab==='diagnostic' && <div className="cm-grid"><section className="cn-panel cm-diagnostic"><div className="cn-panel-head"><h2>Alice / source placement review</h2><span className="cn-status warn">Illustrative diagnostic</span></div><div className="cn-pad"><p>Contextual example only — not Alice's original code, compiler syntax, or a reproduced compiler result.</p><pre className="cm-source"><span className="cn-muted">  17  task Alice.example</span>{'\n'}<span>  18    let privateNote = "personal"</span>{'\n'}<span className="cm-source-error">  19    place privateNote in sharedThread</span><span>  20    cooperate Contact.lookup</span></pre><div className="cm-error"><strong>PLACEMENT-01 · Privacy expectation conflicts with shared state</strong>This illustrative value is expected to be private, but cooperating code in the same Thread shares tuple state. Naming a tuple private would not isolate it.</div><h3 style={{marginTop:20}}>Choose a correction path</h3><div className="cm-flow-node"><strong>Inspect the intended shared tuple layout</strong><p className="cm-help">Make sharing explicit only if it matches the user's intent. Inspect schema, allocation, and cooperating methods first.</p><button className="cn-btn" style={{marginTop:12}} onClick={()=>setTab('tuples')}>Inspect tuple layout <ArrowRight size={13}/></button></div><div className="cm-flow-node"><strong>Keep the state isolated in a separate Thread</strong><p className="cm-help">Review existing capability grants, then select a minimal Dijkstra payload. Moving a name does not revoke authority.</p><button className="cn-btn" style={{marginTop:12}} onClick={()=>setTab('messages')}>Review separation & payload <ArrowRight size={13}/></button></div><p className="cm-help">Both paths preserve all current design and record-editing drafts. No automatic rewrite, compilation, original Alice repair, or saved LUMP change occurs.</p></div></section><aside className="cn-panel"><div className="cn-panel-head"><h2>Evidence boundary</h2></div><div className="cn-pad"><p>This is a design aid, not a regression-test pass.</p><p className="cm-help">Runtime acceptance still requires exact source/LUMP and simulator identities, expected and actual outcomes, and an agreed message boundary.</p><p className="cm-help">No machine artifacts are loaded or written. The prior saved LUMP is out of scope and untouched.</p></div></aside></div>}
        </div>
        <footer className="cm-bottom"><span><ShieldCheck size={11} style={{display:'inline',verticalAlign:'middle',marginRight:5}}/>Local memory only · no APIs, simulator, LUMPs or hardware writes</span><button className="cm-reset" onClick={()=>setReset(true)}><RotateCcw size={10} style={{display:'inline',marginRight:4}}/>Reset synthetic demo…</button></footer>
        {reset && <div className="cm-reset-review"><strong>Discard this session's design and editing drafts?</strong><p className="cm-help">Restores the five synthetic Transactions and original Thread assignments. Nothing outside this preview is affected.</p><div className="cn-actions" style={{marginTop:10}}><button className="cn-btn" onClick={resetDemo}>Confirm reset</button><button className="cn-btn" onClick={()=>setReset(false)}>Keep my drafts</button></div></div>}
      </main>
    </div>
  </div>;
}
