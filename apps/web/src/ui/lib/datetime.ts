/**
 * JST(Asia/Tokyo)前提の日付ヘルパ。UI 全体の日付処理をここに一本化する
 * (従来の `new Date(Date.now()+9*3600_000)` 的な手計算を置換)。
 * ※ サーバ(@ghs/core)側は Worker 用に依存を絞った独自 util/date を使い続ける。
 */
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export const JST = 'Asia/Tokyo';

/** 今日(JST)の 'YYYY-MM-DD'。 */
export const todayJst = (): string => dayjs().tz(JST).format('YYYY-MM-DD');

/** epoch 秒 → JST の 'YYYY-MM-DD'。 */
export const epochToJstDate = (sec: number): string => dayjs.unix(sec).tz(JST).format('YYYY-MM-DD');

/** epoch 秒 → JST の 'HH:mm'(就寝/起床などの時刻表示)。 */
export const epochToJstHhmm = (sec: number): string => dayjs.unix(sec).tz(JST).format('HH:mm');

/** epoch 秒 → JST の 'MM/DD'(リスト等の短い日付)。 */
export const epochToJstMonthDay = (sec: number): string => dayjs.unix(sec).tz(JST).format('MM/DD');

/** 現在の JST 時(0-23)。食事種別の時間帯デフォルト判定などに。 */
export const jstHourNow = (): number => dayjs().tz(JST).hour();

/** 'YYYY-MM-DD' → 曜日番号(0=日..6=土, JST 基準)。 */
export const jstDayOfWeek = (dateStr: string): number => dayjs.tz(dateStr, JST).day();

/** 'YYYY-MM-DD' を delta 日ずらす(日付の純粋な加減算・UTC基準で安全)。 */
export const shiftDate = (date: string, delta: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

/** 'YYYY-MM-DD' → 'MM/DD'(リスト等の短い表示)。 */
export const formatDateForDisplay = (date: string): string => date.slice(5).replace('-', '/');

const DOW_JA_LONG = ['日', '月', '火', '水', '木', '金', '土'];
/** 'YYYY-MM-DD' → 'YYYY.M.D (曜)'(シェアレポート見出し用)。 */
export const formatDateLong = (date: string): string => {
  const d = dayjs.tz(date, JST);
  return `${d.format('YYYY.M.D')} (${DOW_JA_LONG[d.day()]})`;
};

// ---- datetime-local <input> 用(ローカル壁時計 = JST として解釈) ----

/** 現在時刻を datetime-local 値 'YYYY-MM-DDTHH:mm'(JST)で。 */
export const nowDatetimeLocal = (): string => dayjs().tz(JST).format('YYYY-MM-DDTHH:mm');

/** epoch 秒 → datetime-local 値(JST 壁時計)。編集時の prefill 用。 */
export const epochToDatetimeLocal = (sec: number): string =>
  dayjs.unix(sec).tz(JST).format('YYYY-MM-DDTHH:mm');

/** datetime-local 値(JST 壁時計と解釈)→ epoch 秒。 */
export const datetimeLocalToEpochSec = (value: string): number => dayjs.tz(value, JST).unix();

/** datetime-local 値 → その JST 日付 'YYYY-MM-DD'。 */
export const datetimeLocalToJstDate = (value: string): string =>
  dayjs.tz(value, JST).format('YYYY-MM-DD');
