import { useState } from 'react';
import { HistoryScreen } from './screens/History';
import { MuscleScreen } from './screens/Muscle';
import { RecordScreen } from './screens/Record';
import { SettingsScreen } from './screens/Settings';
import { TodayScreen } from './screens/Today';

type Tab = 'today' | 'history' | 'record' | 'muscle' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'today', label: '今日', icon: '☀️' },
  { id: 'history', label: '履歴', icon: '📈' },
  { id: 'record', label: '記録', icon: '＋' },
  { id: 'muscle', label: '図鑑', icon: '🫀' },
  { id: 'settings', label: '設定', icon: '⚙️' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('today');
  return (
    <div className="flex h-full flex-col">
      <main className="safe-top flex-1 overflow-y-auto px-4 pb-24 pt-4">
        {tab === 'today' && <TodayScreen onGoRecord={() => setTab('record')} />}
        {tab === 'history' && <HistoryScreen />}
        {tab === 'record' && <RecordScreen onSaved={() => setTab('today')} />}
        {tab === 'muscle' && <MuscleScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#0d1320]/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {TABS.map((t) => {
            const active = tab === t.id;
            const isFab = t.id === 'record';
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                  active ? 'text-emerald-400' : 'text-gray-400'
                }`}
              >
                <span
                  className={
                    isFab
                      ? `-mt-5 flex h-12 w-12 items-center justify-center rounded-full text-2xl shadow-lg ${
                          active ? 'bg-emerald-500 text-white' : 'bg-emerald-600 text-white'
                        }`
                      : 'text-xl'
                  }
                >
                  {t.icon}
                </span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
