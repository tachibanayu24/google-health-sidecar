import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** /api/me で認証確認。未ログインならログイン画面(→ /auth/login)。dev は DEV_AUTH_BYPASS で素通り。 */
export function LoginGate({ children }: { children: ReactNode }) {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/me', { credentials: 'same-origin' });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error(`auth check failed: ${res.status}`);
      return (await res.json()) as { email: string; sub: string };
    },
    retry: false,
  });

  if (me.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-faint">…</div>;
  }
  if (!me.data) return <Login />;
  return <>{children}</>;
}

function Login() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-8 flex flex-col items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-card">
          <span className="font-display text-2xl font-black leading-none">L</span>
        </span>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Logbook</h1>
        <p className="text-sm text-muted">ボディメイクの記録 — あなた専用</p>
      </div>
      <a
        href="/auth/login"
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl border border-line bg-card py-3.5 font-semibold shadow-sm transition active:scale-[0.99]"
      >
        <GoogleMark /> Google でログイン
      </a>
      <p className="mt-6 max-w-xs text-[11px] leading-relaxed text-faint">
        許可されたアカウントのみアクセスできます。
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" role="img" aria-label="Google">
      <title>Google</title>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
