import {
  Dumbbell,
  House,
  PersonStanding,
  Plus,
  Settings,
  TrendingUp,
  Utensils,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { HistoryScreen } from './screens/History';
import { HomeScreen } from './screens/Home';
import { MealScreen } from './screens/Meal';
import { MuscleScreen } from './screens/Muscle';
import { RecordScreen } from './screens/Record';
import { SettingsScreen } from './screens/Settings';

type View = 'home' | 'history' | 'record' | 'meal' | 'muscle' | 'settings';

export function App() {
  const [view, setView] = useState<View>('home');
  const [chooser, setChooser] = useState(false);
  const [editMealId, setEditMealId] = useState<string | null>(null);
  const [editWorkoutId, setEditWorkoutId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="flex-1 overflow-y-auto px-5 pb-28 pt-3">
        <div key={view} className="rise">
          {view === 'home' && (
            <HomeScreen
              onGoRecord={() => setView('record')}
              onEditMeal={(id) => {
                setEditMealId(id);
                setView('meal');
              }}
            />
          )}
          {view === 'history' && (
            <HistoryScreen
              onEditWorkout={(id) => {
                setEditWorkoutId(id);
                setView('record');
              }}
            />
          )}
          {view === 'record' && (
            <RecordScreen
              editWorkoutId={editWorkoutId}
              onSaved={() => {
                setEditWorkoutId(null);
                setView('home');
              }}
            />
          )}
          {view === 'meal' && (
            <MealScreen
              editMealId={editMealId}
              onSaved={() => {
                setEditMealId(null);
                setView('home');
              }}
            />
          )}
          {view === 'muscle' && <MuscleScreen />}
          {view === 'settings' && <SettingsScreen />}
        </div>
      </main>

      {chooser && (
        <LogChooser
          onClose={() => setChooser(false)}
          onPick={(v) => {
            setChooser(false);
            if (v === 'meal') setEditMealId(null); // 新規記録なので編集状態をクリア
            if (v === 'record') setEditWorkoutId(null);
            setView(v);
          }}
        />
      )}

      <BottomNav view={view} onTab={setView} onPlus={() => setChooser(true)} />
    </div>
  );
}

function Header() {
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-md items-center justify-center gap-2 px-5 pb-3 pt-4">
        <Dumbbell className="h-[18px] w-[18px] text-accent" strokeWidth={2.5} />
        <span className="font-mono text-base font-bold tracking-tight">Logbook</span>
      </div>
    </header>
  );
}

function BottomNav({
  view,
  onTab,
  onPlus,
}: {
  view: View;
  onTab: (v: View) => void;
  onPlus: () => void;
}) {
  const plusActive = view === 'record' || view === 'meal';
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur-md">
      <div className="mx-auto grid max-w-md grid-cols-5 items-stretch px-2">
        <NavTab
          Icon={House}
          label="ホーム"
          active={view === 'home'}
          onClick={() => onTab('home')}
        />
        <NavTab
          Icon={TrendingUp}
          label="推移"
          active={view === 'history'}
          onClick={() => onTab('history')}
        />
        <div className="flex items-center justify-center">
          <button
            type="button"
            aria-label="記録する"
            onClick={onPlus}
            className={`-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl text-card shadow-[0_8px_24px_-6px] shadow-accent/60 transition-transform active:scale-95 ${
              plusActive ? 'bg-accent-ink' : 'bg-accent'
            }`}
          >
            <Plus strokeWidth={2.5} className="h-7 w-7" />
          </button>
        </div>
        <NavTab
          Icon={PersonStanding}
          label="部位"
          active={view === 'muscle'}
          onClick={() => onTab('muscle')}
        />
        <NavTab
          Icon={Settings}
          label="設定"
          active={view === 'settings'}
          onClick={() => onTab('settings')}
        />
      </div>
    </nav>
  );
}

function NavTab({
  Icon,
  label,
  active,
  onClick,
}: {
  Icon: typeof House;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold tracking-wide transition-colors ${
        active ? 'text-accent' : 'text-faint'
      }`}
    >
      <Icon strokeWidth={active ? 2.4 : 2} className="h-[22px] w-[22px]" />
      {label}
    </button>
  );
}

function LogChooser({ onClose, onPick }: { onClose: () => void; onPick: (v: View) => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div className="safe-bottom rise relative mx-auto w-full max-w-md rounded-t-3xl border border-line bg-paper p-5 pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">何を記録する?</h2>
          <button type="button" aria-label="閉じる" onClick={onClose} className="p-1 text-faint">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ChooserButton Icon={Dumbbell} label="ワークアウト" onClick={() => onPick('record')} />
          <ChooserButton Icon={Utensils} label="食事" onClick={() => onPick('meal')} />
        </div>
      </div>
    </div>
  );
}

function ChooserButton({
  Icon,
  label,
  onClick,
}: {
  Icon: typeof House;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-card py-6 font-semibold transition active:scale-[0.98]"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="h-6 w-6" strokeWidth={2.2} />
      </span>
      {label}
    </button>
  );
}
