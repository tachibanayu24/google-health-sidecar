import { RefreshCw } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';

const THRESHOLD = 64; // この距離(減衰後 px)を超えて離すと発火
const MAX_PULL = 96;
const DAMPING = 0.5; // 指の移動量に対する引き量(ゴム感)

/**
 * スクロールコンテナ最上部での下スワイプ(pull-to-refresh)。スクロールは <main> 内で起き、body は
 * overscroll-behavior-y:none なので Android Chrome 標準の引っ張り更新は発火しない → 自前実装(二重発火なし)。touchmove で preventDefault するので native listener(passive:false)。
 * モーダル/シートは document.body へ portal されるため、ここ(コンテナ)の listener には届かない。
 */
export function PullToRefresh({
  scrollRef,
  enabled,
  onRefresh,
  children,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onRefresh: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // listener は1回だけ張るので、最新値は ref 経由で読む。
  const state = useRef({ startY: null as number | null, pull: 0, refreshing: false });
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;
    const s = state.current;
    const set = (v: number) => {
      s.pull = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      s.startY = !s.refreshing && el.scrollTop <= 0 ? (e.touches[0]?.clientY ?? null) : null;
    };
    const onMove = (e: TouchEvent) => {
      if (s.startY == null) return;
      const dy = (e.touches[0]?.clientY ?? s.startY) - s.startY;
      if (dy <= 0 || el.scrollTop > 0) {
        // 上方向 = 通常スクロール。引き始め前なら追跡をやめて native に委ねる。
        if (s.pull === 0) s.startY = null;
        else set(0);
        return;
      }
      // ラバーバンド/伸縮エフェクトではなく引き量として扱う。スクロール開始後は cancelable=false なので触らない。
      if (e.cancelable) e.preventDefault();
      set(Math.min(MAX_PULL, dy * DAMPING));
    };
    const onEnd = () => {
      if (s.startY == null) return;
      s.startY = null;
      if (s.pull < THRESHOLD) {
        set(0);
        return;
      }
      s.refreshing = true;
      setRefreshing(true);
      set(THRESHOLD);
      onRefreshRef
        .current()
        .catch(() => {
          /* 失敗表示は同期バナー(sync-status)側に任せる */
        })
        .finally(() => {
          s.refreshing = false;
          setRefreshing(false);
          set(0);
        });
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef, enabled]);

  const dragging = pull > 0 && !refreshing && state.current.startY != null;
  const ready = pull >= THRESHOLD;
  return (
    <>
      <div
        aria-hidden={!refreshing}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{
          transform: `translateY(${pull - 40}px)`,
          opacity: Math.min(1, pull / THRESHOLD),
          transition: dragging ? 'none' : 'transform 200ms ease, opacity 200ms ease',
        }}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card shadow-sm">
          <RefreshCw
            className={`h-4 w-4 ${ready || refreshing ? 'text-accent' : 'text-faint'} ${
              refreshing ? 'animate-spin' : ''
            }`}
            strokeWidth={2.4}
            style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          />
        </div>
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: dragging ? 'none' : 'transform 200ms ease',
        }}
      >
        {children}
      </div>
    </>
  );
}
