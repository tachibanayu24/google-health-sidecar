import { House, PersonStanding, Plus, Settings, TrendingUp } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { HistoryScreen } from './screens/History';
import { MuscleScreen } from './screens/Muscle';
import { RecordScreen } from './screens/Record';
import { SettingsScreen } from './screens/Settings';
import { TodayScreen } from './screens/Today';

type Tab = 'today' | 'history' | 'record' | 'muscle' | 'settings';

const TITLES: Record<Tab, string> = {
  today: 'Today',
  history: 'Trends',
  record: 'Log Workout',
  muscle: 'Muscle Map',
  settings: 'Settings',
};

export function App() {
  const [tab, setTab] = useState<Tab>('today');

  return (
    <div className="flex h-full flex-col">
      <Header title={TITLES[tab]} />
      <main className="flex-1 overflow-y-auto px-5 pb-28 pt-3">
        <div key={tab} className="rise">
          {tab === 'today' && <TodayScreen onGoRecord={() => setTab('record')} />}
          {tab === 'history' && <HistoryScreen />}
          {tab === 'record' && <RecordScreen onSaved={() => setTab('today')} />}
          {tab === 'muscle' && <MuscleScreen />}
          {tab === 'settings' && <SettingsScreen />}
        </div>
      </main>
      <BottomNav tab={tab} onChange={setTab} />
    </div>
  );
}

function Header({ title }: { title: string }) {
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-md items-center justify-between px-5 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-card">
            <span className="font-display text-sm font-black leading-none">G</span>
          </span>
          <span className="font-display text-[13px] font-bold uppercase tracking-[0.18em] text-muted">
            GH Sidecar
          </span>
        </div>
        <h1 className="font-display text-[15px] font-bold tracking-tight">{title}</h1>
      </div>
    </header>
  );
}

const NAV: Array<{ id: Tab; label: string; Icon: typeof House }> = [
  { id: 'today', label: 'Today', Icon: House },
  { id: 'history', label: 'Trends', Icon: TrendingUp },
  { id: 'record', label: 'Log', Icon: Plus },
  { id: 'muscle', label: 'Muscles', Icon: PersonStanding },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
        {NAV.map(({ id, label, Icon }) => {
          const active = tab === id;
          if (id === 'record') {
            return (
              <NavSlot key={id}>
                <button
                  type="button"
                  aria-label="Log workout"
                  onClick={() => onChange(id)}
                  className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-card shadow-[0_8px_24px_-6px] shadow-accent/60 transition-transform active:scale-95"
                >
                  <Icon strokeWidth={2.5} className="h-7 w-7" />
                </button>
              </NavSlot>
            );
          }
          return (
            <NavSlot key={id}>
              <button
                type="button"
                onClick={() => onChange(id)}
                className={`flex w-full flex-col items-center gap-1 py-2.5 text-[10px] font-semibold tracking-wide transition-colors ${
                  active ? 'text-accent' : 'text-faint'
                }`}
              >
                <Icon strokeWidth={active ? 2.4 : 2} className="h-[22px] w-[22px]" />
                {label}
              </button>
            </NavSlot>
          );
        })}
      </div>
    </nav>
  );
}

function NavSlot({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center">{children}</div>;
}
