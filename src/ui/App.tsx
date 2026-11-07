import { FileUp, Languages, LayoutDashboard, Library, SlidersHorizontal } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Stage } from '../core/session';
import { HomePage } from './HomePage';
import { href, useRoute } from './hooks';
import { ImportPage } from './ImportPage';
import { LessonDetail } from './LessonDetail';
import { LessonsPage } from './LessonsPage';
import { SettingsPage } from './SettingsPage';
import { StudyRoute } from './study/StudyRoute';

const NAV: { id: string; label: string; to: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: '', label: 'Home', to: href(''), icon: LayoutDashboard },
  { id: 'lessons', label: 'Lessons', to: href('lessons'), icon: Library },
  { id: 'import', label: 'Import', to: href('import'), icon: FileUp },
  { id: 'settings', label: 'Settings', to: href('settings'), icon: SlidersHorizontal },
];

export function App() {
  const route = useRoute();
  const [section = '', arg] = route.path;

  // Study sessions are full screen, without the app chrome.
  if (section === 'study') {
    const stage = (['words', 'sentences', 'review'].includes(arg ?? '') ? arg : 'review') as Stage;
    const lessonId = route.query.get('lesson');
    // Keyed so moving between sessions (e.g. words → sentences) always starts fresh.
    return <StudyRoute key={`${stage}:${lessonId}`} stage={stage} lessonId={lessonId} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href={href('')}>
          <Languages size={24} />
          <span>Deutsch</span>
        </a>
        <nav>
          {NAV.map(({ id, label, to, icon: Icon }) => (
            <a key={id} href={to} className={`nav-link ${section === id ? 'active' : ''}`} aria-current={section === id ? 'page' : undefined}>
              <Icon size={20} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </aside>
      <main className="content">
        {section === '' && <HomePage />}
        {section === 'lessons' && (arg ? <LessonDetail key={arg} lessonId={arg} /> : <LessonsPage />)}
        {section === 'import' && <ImportPage />}
        {section === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
