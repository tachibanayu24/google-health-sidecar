import { Dumbbell, HeartPulse, House, Plus, Settings, Utensils, X } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  createBrowserRouter,
  Outlet,
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { todayJst } from './lib/datetime';
import { HomeScreen } from './screens/Home';
import { MealScreen } from './screens/Meal';
import { MealCategoryDetail } from './screens/MealCategoryDetail';
import { NutritionScreen } from './screens/Nutrition';
import { RecordScreen } from './screens/Record';
import { RecoveryScreen } from './screens/Recovery';
import { SettingsScreen } from './screens/Settings';
import { TrainingScreen } from './screens/Training';

// ============ ルート定義(BrowserRouter / SPA fallback は wrangler assets で対応) ============
export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomeRoute /> },
      { path: '/training', element: <TrainingRoute /> },
      { path: '/body', element: <RecoveryScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
      { path: '/nutrition', element: <NutritionRoute /> },
      { path: '/nutrition/:mealType', element: <MealCategoryRoute /> },
      { path: '/record', element: <RecordRoute /> },
      { path: '/record/:id', element: <RecordRoute /> },
      { path: '/meal', element: <MealRoute /> },
      { path: '/meal/:id', element: <MealRoute /> },
      { path: '*', element: <HomeRoute /> },
    ],
  },
]);

// ============ ルート単位のラッパ(既存 screen を薄く包み、router hooks を供給) ============
function HomeRoute() {
  const navigate = useNavigate();
  return (
    <HomeScreen
      onOpenNutrition={(d) => navigate(`/nutrition?d=${d}`)}
      onOpenTraining={() => navigate('/training')}
      onOpenRecovery={() => navigate('/body')}
      onResume={() => navigate('/record')}
    />
  );
}

function TrainingRoute() {
  const navigate = useNavigate();
  return <TrainingScreen onEditWorkout={(id) => navigate(`/record/${id}`)} />;
}

function NutritionRoute() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const date = sp.get('d') ?? todayJst();
  return (
    <NutritionScreen
      date={date}
      onBack={() => navigate('/')}
      onDateChange={(d) => setSp({ d }, { replace: true })}
      onRecordMeal={() => navigate('/meal')}
      onOpenSettings={() => navigate('/settings')}
      onOpenCategory={(mealType, d) => navigate(`/nutrition/${mealType}?d=${d}`)}
    />
  );
}

function MealCategoryRoute() {
  const { mealType } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const date = sp.get('d') ?? todayJst();
  return (
    <MealCategoryDetail
      mealType={mealType ?? 'Anytime'}
      date={date}
      onBack={() => navigate(-1)}
      onEditMeal={(id) => navigate(`/meal/${id}`)}
      onRecordMeal={() => navigate('/meal')}
    />
  );
}

/** 記録/食事の編集画面。未保存があるとき離脱を useBlocker で遮り破棄確認。保存後は navigate(-1) で元の画面へ。 */
function RecordRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const saved = useRef(false);
  const blocker = useBlocker(() => dirty && !saved.current);
  return (
    <>
      <RecordScreen
        editWorkoutId={id ?? null}
        onDirty={setDirty}
        onSaved={() => {
          saved.current = true;
          navigate(-1);
        }}
      />
      {blocker.state === 'blocked' && (
        <DiscardGuard onDiscard={() => blocker.proceed()} onCancel={() => blocker.reset()} />
      )}
    </>
  );
}

function MealRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const saved = useRef(false);
  const blocker = useBlocker(() => dirty && !saved.current);
  return (
    <>
      <MealScreen
        editMealId={id ?? null}
        onDirty={setDirty}
        onSaved={() => {
          saved.current = true;
          navigate(-1);
        }}
      />
      {blocker.state === 'blocked' && (
        <DiscardGuard onDiscard={() => blocker.proceed()} onCancel={() => blocker.reset()} />
      )}
    </>
  );
}

// ============ レイアウト(ヘッダ + Outlet + ボトムナビ + 記録チューザー) ============
function Layout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [chooser, setChooser] = useState(false);
  const tab: Tab | null =
    pathname === '/'
      ? 'home'
      : pathname.startsWith('/training')
        ? 'training'
        : pathname.startsWith('/body')
          ? 'body'
          : pathname.startsWith('/settings')
            ? 'settings'
            : null;
  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="flex-1 overflow-y-auto px-5 pb-28 pt-3">
        <div key={pathname} className="rise">
          <Outlet />
        </div>
      </main>
      {chooser && (
        <LogChooser
          onClose={() => setChooser(false)}
          onPick={(v) => {
            setChooser(false);
            navigate(v === 'meal' ? '/meal' : '/record');
          }}
        />
      )}
      <BottomNav
        tab={tab}
        onTab={(v) => navigate(v === 'home' ? '/' : `/${v}`)}
        onPlus={() => setChooser(true)}
      />
    </div>
  );
}

type Tab = 'home' | 'training' | 'body' | 'settings';

/** 未保存の記録から離脱しようとしたときの破棄確認(データ消失防止)。 */
function DiscardGuard({ onDiscard, onCancel }: { onDiscard: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-8">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onCancel}
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
      />
      <div className="rise relative w-full max-w-xs rounded-2xl bg-card p-5 text-center shadow-[0_20px_50px_-12px] shadow-ink/40">
        <h2 className="font-display text-base font-bold">記録を破棄しますか?</h2>
        <p className="mt-1.5 text-sm text-muted">入力中の内容は保存されていません。</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-line py-2.5 text-sm font-semibold text-muted"
          >
            続ける
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-bold text-card"
          >
            破棄する
          </button>
        </div>
      </div>
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
  tab,
  onTab,
  onPlus,
}: {
  tab: Tab | null;
  onTab: (v: Tab) => void;
  onPlus: () => void;
}) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur-md">
      <div className="mx-auto grid max-w-md grid-cols-5 items-stretch px-2">
        <NavTab Icon={House} label="ホーム" active={tab === 'home'} onClick={() => onTab('home')} />
        <NavTab
          Icon={Dumbbell}
          label="トレーニング"
          active={tab === 'training'}
          onClick={() => onTab('training')}
        />
        <div className="flex items-center justify-center">
          <button
            type="button"
            aria-label="記録する"
            onClick={onPlus}
            className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-card shadow-[0_8px_24px_-6px] shadow-accent/60 transition-transform active:scale-95"
          >
            <Plus strokeWidth={2.5} className="h-7 w-7" />
          </button>
        </div>
        <NavTab
          Icon={HeartPulse}
          label="からだ"
          active={tab === 'body'}
          onClick={() => onTab('body')}
        />
        <NavTab
          Icon={Settings}
          label="設定"
          active={tab === 'settings'}
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

function LogChooser({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (v: 'record' | 'meal') => void;
}) {
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
