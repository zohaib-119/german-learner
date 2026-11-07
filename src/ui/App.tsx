import { useState } from 'react';
import { ImportPage } from './ImportPage';
import { LessonsPage } from './LessonsPage';
import { SettingsPage } from './SettingsPage';

type Tab = 'lessons' | 'import' | 'settings';

export function App() {
  const [tab, setTab] = useState<Tab>('lessons');
  // Bumped after an import so the lessons list reloads.
  const [version, setVersion] = useState(0);

  return (
    <div className="app">
      <header>
        <h1>German Learner</h1>
        <nav>
          <button className={tab === 'lessons' ? 'active' : ''} onClick={() => setTab('lessons')}>
            Lessons
          </button>
          <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
            Import
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            Settings
          </button>
        </nav>
      </header>
      <main>
        {tab === 'lessons' && <LessonsPage version={version} />}
        {tab === 'import' && <ImportPage onImported={() => setVersion((v) => v + 1)} />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
