import { Component, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { IndividualView } from './IndividualView';
import { ThreadStudio } from './ThreadStudio';
import './shell.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p role="alert">This design view could not render. Reload to restart the demo; unsaved demo edits will be lost. Your IDE editor and machine state were not changed.</p>
      : this.props.children;
  }
}

function App() {
  const [view, setView] = useState(location.hash === '#thread' ? 'thread' : 'individual');
  function navigate(next: string) {
    setView(next);
    history.replaceState(null, '', `#${next}`);
  }
  return <ErrorBoundary>
    <nav className="am-ide-nav" aria-label="Amobea workspace">
      <a href="/simulator/" target="_blank" rel="noopener noreferrer">Open main IDE ↗</a>
      <button onClick={() => navigate('individual')} aria-pressed={view === 'individual'}>Individual view</button>
      <button onClick={() => navigate('thread')} aria-pressed={view === 'thread'}>Thread Studio</button>
      <span>Phase 1 demo · temporary data · no live operations</span>
    </nav>
    <div onClick={event => {
      const anchor = (event.target as HTMLElement).closest('a[data-amobea-view]');
      if (anchor && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        navigate(anchor.getAttribute('data-amobea-view')!);
      }
    }}>
      {/* Keep both mounted so switching views never discards editing drafts. */}
      <div hidden={view !== 'individual'}><IndividualView /></div>
      <div hidden={view !== 'thread'}><ThreadStudio /></div>
    </div>
  </ErrorBoundary>;
}

createRoot(document.getElementById('root')!).render(<App />);
