/**
 * Logbook MCP — remote MCP サーバ(Cloudflare Worker, Streamable HTTP)。
 * 設計: docs/mcp-design.md。web とは別 Worker・同一 D1/KV 共有。全 write は @ghs/core/services 経由(§8.5)。
 *
 * 認証(§4 / §6.3): 一次=URL 埋め込み `MCP_SHARED_SECRET`(fail-closed・定数時間比較)、
 * 二次=Anthropic outbound IP allowlist(既定 fail-open。ENFORCE_IP_ALLOWLIST=true で厳格化)。
 *
 * M2-a: get_settings 1本で疎通確認。read/write は M2-b 以降で §5.2 のカタログを追加。
 */
import { getActiveNutritionTarget, getSettings, makeContext } from '@ghs/core';
import { StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Hono } from 'hono';

export interface Env {
  DB: D1Database;
  TOKENS: KVNamespace;
  CACHE: KVNamespace;
  LOCK: KVNamespace;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FEATURE_GH_NUTRITION_PUSH?: string;
  MCP_SHARED_SECRET?: string;
  ANTHROPIC_OUTBOUND_CIDR?: string;
  ENFORCE_IP_ALLOWLIST?: string;
}

/** 定数時間比較(長さ差でも固定ステップ。タイミング攻撃で secret を漏らさない)。 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** IPv4 が CIDR(例 160.79.104.0/21)に含まれるか。二次防御用の素朴判定(v6 は対象外=スキップ)。 */
function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!range || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (s: string): number | null => {
    const p = s.split('.');
    if (p.length !== 4) return null;
    let n = 0;
    for (const o of p) {
      const v = Number(o);
      if (!Number.isInteger(v) || v < 0 || v > 255) return null;
      n = (n << 8) | v;
    }
    return n >>> 0;
  };
  const ipN = toInt(ip);
  const rN = toInt(range);
  if (ipN == null || rN == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipN & mask) === (rN & mask);
}

/** リクエスト毎に McpServer を新規生成(ステートレス)。M2-a は get_settings のみ。 */
function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: 'logbook-mcp', version: '0.1.0' });

  server.registerTool(
    'get_settings',
    {
      title: '設定の取得',
      description:
        '単位(kg/lb)・e1RM 式・栄養目標(phase/PFC/kcal)・週間目標セット数を返す。分析時に単位や e1RM 式を揃え、目標基準で評価するために最初に呼ぶ。引数なし。',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const ctx = makeContext(env);
      const [settings, nutritionTarget] = await Promise.all([
        getSettings(ctx.db),
        getActiveNutritionTarget(ctx.db),
      ]);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ provenance: 'd1_confirmed', settings, nutritionTarget }),
          },
        ],
      };
    },
  );

  return server;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.text('ok'));
app.get('/', (c) => c.text('Logbook MCP. Connect via /mcp (Streamable HTTP).'));

// 認証ガード(/mcp のみ)。一次 secret は fail-closed、二次 IP は既定 fail-open(§6.3)。
app.use('/mcp', async (c, next) => {
  const provided = c.req.query('key') ?? c.req.header('x-mcp-secret') ?? '';
  const expected = c.env.MCP_SHARED_SECRET ?? '';
  if (!expected || !timingSafeEqual(provided, expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const cidr = c.env.ANTHROPIC_OUTBOUND_CIDR;
  if (cidr) {
    const ip = c.req.header('cf-connecting-ip') ?? '';
    const allowed = ip.includes(':') // IPv6 は当面判定対象外(v4 allowlist のみ)
      ? true
      : cidr.split(',').some((r) => ipv4InCidr(ip, r.trim()));
    if (!allowed) {
      console.warn(JSON.stringify({ evt: 'ip_not_in_allowlist', ip }));
      if (c.env.ENFORCE_IP_ALLOWLIST === 'true') return c.json({ error: 'forbidden' }, 403);
    }
  }
  await next();
});

app.all('/mcp', async (c) => {
  const server = buildServer(c.env);
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined }); // ステートレス
  await server.connect(transport);
  const res = await transport.handleRequest(c);
  return res ?? c.body(null, 204);
});

export default app;
