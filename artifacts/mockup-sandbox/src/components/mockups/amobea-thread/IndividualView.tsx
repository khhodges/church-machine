import { useState, type FormEvent } from 'react';
import {
  ArrowRight, CalendarDays, Check, ChevronRight, CircleHelp, Clock3, LockKeyhole,
  MessageCircle, Phone, Plus, ShoppingBasket, Sparkles, Utensils, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './IndividualView.css';

type Task = {
  id: string;
  title: string;
  category: string;
  summary: string;
  fields: { label: string; value: string }[];
  icon: LucideIcon;
  result: string;
};

const examples: Task[] = [
  {
    id: 'phone',
    title: 'Phone Mum',
    category: 'People',
    summary: 'Get ready to call someone important.',
    fields: [{ label: 'Who would you like to call?', value: 'Mum' }, { label: 'Number to use', value: '+44 0000 010127' }],
    icon: Phone,
    result: 'Your call details are ready to review. No call was placed.',
  },
  {
    id: 'supper',
    title: 'Make supper',
    category: 'Home',
    summary: 'Plan an easy supper for tonight.',
    fields: [{ label: 'What are you making?', value: 'Lentils, tomato and rice' }, { label: 'How many people?', value: '2' }],
    icon: Utensils,
    result: 'A simple supper plan is ready. No appliance or timer was started.',
  },
  {
    id: 'question',
    title: 'Ask a question',
    category: 'Learning',
    summary: 'Prepare a question and choose what context to include.',
    fields: [{ label: 'What would you like to ask?', value: 'How do capabilities control access?' }, { label: 'Notes to include (optional)', value: 'A short synthetic note' }],
    icon: Sparkles,
    result: 'Your question is prepared for review. It was not sent to an assistant.',
  },
  {
    id: 'groceries',
    title: 'Buy groceries',
    category: 'Home',
    summary: 'Make a short shopping list and set a limit.',
    fields: [{ label: 'What do you need?', value: 'Oats, apples' }, { label: 'Spending limit (example)', value: '£32.40' }],
    icon: ShoppingBasket,
    result: 'A shopping list is ready to review. No shop or payment was contacted.',
  },
  {
    id: 'appointment',
    title: 'Arrange an appointment',
    category: 'People',
    summary: 'Prepare a few possible times to share.',
    fields: [{ label: 'What is the appointment for?', value: 'Routine check-up' }, { label: 'Times that could work', value: 'Tuesday 10:30 or Wednesday 14:15' }],
    icon: CalendarDays,
    result: 'Your preferred times are ready to review. No calendar was contacted or changed.',
  },
];

export function IndividualView() {
  const [tasks, setTasks] = useState<Task[]>(examples);
  const [activeId, setActiveId] = useState('phone');
  const [reviewing, setReviewing] = useState(false);
  const [outcome, setOutcome] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDetails, setNewDetails] = useState('');
  const [message, setMessage] = useState('');
  const task = tasks.find(item => item.id === activeId) ?? tasks[0];

  const updateField = (index: number, value: string) => {
    setTasks(current => current.map(item => item.id === task.id
      ? { ...item, fields: item.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, value } : field) }
      : item));
    setReviewing(false);
    setOutcome(false);
    setMessage('');
  };

  const chooseTask = (id: string) => {
    setActiveId(id);
    setReviewing(false);
    setOutcome(false);
    setMessage('');
  };

  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newTitle.trim();
    const detail = newDetails.trim();
    if (!title || !detail) {
      setMessage('Add a task name and one useful detail to get started.');
      return;
    }
    if (tasks.some(item => item.title.toLocaleLowerCase() === title.toLocaleLowerCase())) {
      setMessage('That task is already on your list. Choose a different name.');
      return;
    }
    const created: Task = {
      id: `personal-${Date.now()}`,
      title,
      category: 'Your task',
      summary: 'A task you added to this demo.',
      fields: [{ label: 'What should we keep in mind?', value: detail }],
      icon: CircleHelp,
      result: 'Your task details are ready to review. Nothing was sent or changed outside this preview.',
    };
    setTasks(current => [...current, created]);
    setActiveId(created.id);
    setAdding(false);
    setNewTitle('');
    setNewDetails('');
    setReviewing(false);
    setOutcome(false);
    setMessage('Added to this preview. It will be gone when you reload.');
  };

  const ActiveIcon = task.icon;

  return <div className="am-individual">
    <header className="am-ind-header">
      <div className="am-ind-brand"><span className="am-ind-lambda">λ</span><span>CHURCH MACHINE</span><i/><span className="am-ind-product">AMOBEA</span></div>
      <div className="am-ind-top-right"><span>INDIVIDUAL WORKSPACE</span><span className="am-ind-badge"><span/>DESIGN PREVIEW</span></div>
    </header>

    <div className="am-ind-layout">
      <aside className="am-ind-rail">
        <div className="am-ind-rail-kicker">YOUR EXAMPLES</div>
        <div className="am-ind-task-list" role="list" aria-label="Choose an example task">
          {tasks.map(item => {
            const Icon = item.icon;
            return <button className={`am-ind-task ${item.id === activeId ? 'is-active' : ''}`} key={item.id} onClick={() => chooseTask(item.id)} aria-pressed={item.id === activeId}>
              <Icon size={17}/><span><strong>{item.title}</strong><small>{item.category}</small></span>{item.id === activeId && <ChevronRight size={14} className="am-ind-chevron"/>}
            </button>;
          })}
        </div>
        <button className="am-ind-add" onClick={() => { setAdding(value => !value); setMessage(''); }}>
          {adding ? <X size={15}/> : <Plus size={15}/>} {adding ? 'Close' : 'Add your own task'}
        </button>
        {adding && <form className="am-ind-add-form" onSubmit={addTask}>
          <label>What do you want to do?<input autoFocus maxLength={48} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="e.g. Plan a day out" /></label>
          <label>One detail to remember<input maxLength={96} value={newDetails} onChange={event => setNewDetails(event.target.value)} placeholder="e.g. Saturday, if it is sunny" /></label>
          <button className="am-ind-button am-ind-button-primary" type="submit">Add task</button>
        </form>}
        <div className="am-ind-privacy">
          <LockKeyhole size={16}/>
          <strong>Your private space</strong>
          <p>Your personal notes stay in your Namespace. A task preview shares nothing with another service.</p>
        </div>
      </aside>

      <main className="am-ind-main">
        <div className="am-ind-toolbar">
          <div><span className="am-ind-eyebrow">MY TASKS <b>/</b> {task.category.toUpperCase()}</span><h1>What would you like to do?</h1><p>Choose an example, make it yours, then review it before anything happens.</p></div>
          <a className="am-ind-switch" href="/__mockup/preview/amobea-thread/ThreadStudio">Open Thread designer <ArrowRight size={14}/></a>
        </div>

        {message && <div className="am-ind-notice" role="status"><Check size={15}/>{message}<button aria-label="Dismiss message" onClick={() => setMessage('')}><X size={14}/></button></div>}

        <section className="am-ind-card" aria-labelledby="am-ind-task-title">
          <div className="am-ind-card-top">
            <div className="am-ind-task-icon"><ActiveIcon size={20}/></div>
            <div className="am-ind-card-heading"><span className="am-ind-eyebrow">{task.category.toUpperCase()} · EXAMPLE TASK</span><h2 id="am-ind-task-title">{task.title}</h2><p>{task.summary}</p></div>
            <span className="am-ind-state"><span/>YOUR DRAFT</span>
          </div>

          <div className="am-ind-fields">
            {task.fields.map((field, index) => <label className="am-ind-field" key={`${task.id}-${index}`}>
              <span>{field.label}</span><input value={field.value} onChange={event => updateField(index, event.target.value)} aria-label={field.label}/>
            </label>)}
          </div>

          <div className="am-ind-action">
            <div className="am-ind-action-copy"><MessageCircle size={17}/><span><strong>Nothing happens without your say-so.</strong><small>Review the details first. This preview never contacts people or services.</small></span></div>
            <button className="am-ind-button am-ind-button-primary" onClick={() => { setReviewing(true); setOutcome(false); }}>Review this task <ArrowRight size={15}/></button>
          </div>
        </section>

        {reviewing && <section className="am-ind-review" aria-live="polite">
          <div className="am-ind-review-head"><div><span className="am-ind-eyebrow">YOUR REVIEW</span><h2>Check before continuing</h2></div><button aria-label="Close review" onClick={() => { setReviewing(false); setOutcome(false); }}><X size={16}/></button></div>
          <p>Here is what this task would use:</p>
          <dl>{task.fields.map((field, index) => <div key={`review-${index}`}><dt>{field.label}</dt><dd>{field.value || 'Nothing entered'}</dd></div>)}</dl>
          <div className="am-ind-share"><LockKeyhole size={16}/><span><strong>Private by default</strong><small>This design preview sends none of these details anywhere.</small></span></div>
          {!outcome
            ? <button className="am-ind-button am-ind-button-primary" onClick={() => setOutcome(true)}>Show me the demo result <ArrowRight size={15}/></button>
            : <div className="am-ind-result" role="status"><span><Check size={16}/></span><div><strong>Preview only · no outside action taken</strong><p>{task.result}</p></div></div>}
        </section>}

        <footer className="am-ind-footer"><span><Clock3 size={13}/> Changes are temporary in this design preview.</span><span>Adding this view does not replace Thread designer.</span></footer>
      </main>
    </div>
  </div>;
}
