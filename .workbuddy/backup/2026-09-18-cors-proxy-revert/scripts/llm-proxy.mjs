#!/usr/bin/env node
/**
 * 本地 CORS 代理 —— 解决「大模型网关没有开启 CORS，浏览器直连被拦截」的问题
 * ---------------------------------------------------------------------------
 * 为什么需要它：
 *   浏览器里发一个带 `Authorization` 头的 POST，会先发一次 **OPTIONS 预检**。
 *   很多自建网关（One-API / new-api / 自研 Caddy-Nginx 反代）只处理 POST，
 *   对 OPTIONS 直接返回 403 或不返回 `Access-Control-Allow-Origin`，
 *   于是浏览器抛 `TypeError: Failed to fetch`。
 *   这个失败发生在**响应到达 JS 之前**，页面里改任何代码都拿不到它，
 *   因此唯一的客户端解法就是让请求同源 —— 也就是走本代理。
 *
 * 用法：
 *   npm run llm:proxy                       # 推荐：监听 127.0.0.1:8787
 *   node scripts/llm-proxy.mjs              # 等价写法
 *   PORT=9000 node scripts/llm-proxy.mjs    # 换端口
 *   LLM_PROXY_ALLOW=api.qingcuicore.com node scripts/llm-proxy.mjs
 *
 * 然后在「模型连接 → 高级：跨域代理与私有网关」里把代理前缀填成
 *   http://localhost:8787
 * 平台会把请求拼成 `${代理前缀}${接口地址}`：
 *   http://localhost:8787/https://api.qingcuicore.com/v1/chat/completions
 *
 * 安全边界（务必了解）：
 *   - 默认只绑定 127.0.0.1，同机其它进程才能访问；**不要**把它暴露到公网。
 *   - 默认放行任意上游地址（方便调试）。用 `LLM_PROXY_ALLOW` 限定域名白名单。
 *   - 代理会把浏览器的 Authorization 头原样转发给上游，它自己也**不保存任何 Key**。
 */
import http from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = '127.0.0.1';
/** 单次请求体上限，防止被当成任意文件上传通道。 */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** 逐跳首部，按 RFC 9110 不应转发。 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * 从代理请求的 URL 里还原出真正的上游地址。
 *
 * 支持两种形式（`withProxy()` 走的是第一种）：
 *   ① 路径式：/https://api.example.com/v1/chat/completions?x=1
 *   ② 查询式：/?url=https%3A%2F%2Fapi.example.com%2Fv1%2Fchat%2Fcompletions
 *
 * 注意第 ① 种对 `//` 的容错：少数客户端会把路径里的连续斜杠折叠成单个，
 * 变成 /https:/api.example.com/...，这里一并还原，否则会拼出非法 URL。
 */
export function resolveTargetUrl(requestUrl) {
  let pathname;
  let search;
  try {
    const parsed = new URL(requestUrl ?? '/', 'http://placeholder.invalid');
    pathname = parsed.pathname;
    search = parsed.search;
  } catch {
    return null;
  }

  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // 路径里有非法百分号编码：退回原文，下面的正则仍然能命中
  }

  const pathMatch = decoded.match(/^\/(https?):\/+(.+)$/i);
  if (pathMatch) return `${pathMatch[1]}://${pathMatch[2]}${search}`;

  const fromQuery = new URLSearchParams(search).get('url');
  return fromQuery || null;
}

/**
 * 上游地址是否被允许。
 * allowHosts 为空表示不限制（本机开发默认）；否则按「域名与其子域」匹配。
 */
export function isAllowedTarget(target, allowHosts) {
  if (!allowHosts || allowHosts.length === 0) return true;
  let host;
  try {
    host = new URL(target).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowHosts.some((allowed) => {
    const a = allowed.trim().toLowerCase();
    if (!a) return false;
    return host === a || host.endsWith(`.${a}`);
  });
}

/**
 * 构造回给浏览器的 CORS 首部。
 * 预检时回显 `Access-Control-Request-Headers` —— 少回一个 `authorization`
 * 就会让预检失败，这正是原网关 403 的等价错误。
 */
export function buildCorsHeaders(req) {
  const origin = req.headers?.origin;
  const requested = req.headers?.['access-control-request-headers'];
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers':
      requested || 'authorization, content-type, accept, x-requested-with',
    'access-control-expose-headers': 'content-type, content-length, x-request-id',
    'access-control-max-age': '86400',
    // 回显 origin 时必须带 Vary，否则中间层可能缓存错源
    vary: 'origin, access-control-request-headers',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`请求体超过上限 ${MAX_BODY_BYTES} 字节`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, req) {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  res.writeHead(status, {
    ...buildCorsHeaders(req),
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
  });
  res.end(body);
}

export function createProxyServer({ allowHosts = [], log = () => {} } = {}) {
  return http.createServer(async (req, res) => {
    // ── 预检：这一步是本代理存在的首要理由 ──────────────────────────────
    if (req.method === 'OPTIONS') {
      res.writeHead(204, buildCorsHeaders(req));
      res.end();
      return;
    }

    // ── 健康检查：供「模型连接」弹窗的「检测代理」按钮使用 ──────────────
    if (req.url === '/__health' || req.url === '/healthz') {
      sendJson(res, 200, { ok: true, service: 'llm-cors-proxy' }, req);
      return;
    }

    const target = resolveTargetUrl(req.url);
    if (!target) {
      sendJson(
        res,
        400,
        {
          error: {
            message:
              '代理用法不对：请在「模型连接 → 高级」里把代理前缀填成 http://localhost:8787，' +
              '平台会自动拼成 http://localhost:8787/https://你的网关/路径。',
          },
        },
        req,
      );
      return;
    }

    if (!isAllowedTarget(target, allowHosts)) {
      sendJson(res, 403, { error: { message: `上游地址不在白名单内：${target}` } }, req);
      return;
    }

    // ── 组装转发首部 ────────────────────────────────────────────────────
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      // host 必须由目标决定；origin/referer 带上会触发上游自身的防盗链校验
      if (lower === 'host' || lower === 'origin' || lower === 'referer') continue;
      headers[key] = value;
    }
    // 强制不压缩：SSE 一旦被压缩，中间层就会缓冲，流式输出变成「一次性吐出」
    headers['accept-encoding'] = 'identity';

    const started = Date.now();
    try {
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: hasBody ? await readBody(req) : undefined,
        redirect: 'follow',
      });

      const outHeaders = buildCorsHeaders(req);
      for (const [key, value] of upstream.headers) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP.has(lower)) continue;
        // 上游自带的 CORS 首部一律丢弃，避免出现重复值导致浏览器判为非法
        if (lower.startsWith('access-control-')) continue;
        outHeaders[key] = value;
      }
      // 显式告知各类反代不要缓冲，保证 SSE 逐段到达
      if (!outHeaders['cache-control']) outHeaders['cache-control'] = 'no-cache';
      outHeaders['x-accel-buffering'] = 'no';

      res.writeHead(upstream.status, outHeaders);
      log(`${req.method} ${target} → ${upstream.status} (${Date.now() - started}ms)`);

      if (!upstream.body) {
        res.end();
        return;
      }
      // 用 pipe 直通而不是先读完整包：SSE 的逐段增量必须原样保留。
      // 只从一个 body 造一个可读流 —— 重复调用 fromWeb 会得到两个流互相抢数据。
      const source = Readable.fromWeb(upstream.body);
      source.on('error', () => source.destroy());
      source.pipe(res);
      res.on('close', () => source.destroy());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${req.method} ${target} → 502 (${message})`);
      if (!res.headersSent) {
        sendJson(res, 502, { error: { message: `代理转发失败：${message}` } }, req);
      } else {
        res.end();
      }
    }
  });
}

/** 启动代理，返回实际监听地址（便于测试用 0 端口随机分配）。 */
export function startProxy(options = {}) {
  const { port = DEFAULT_PORT, host = DEFAULT_HOST, allowHosts = [], onLog } = options;
  const log = onLog ?? ((line) => console.log(`[llm-proxy] ${line}`));
  const server = createProxyServer({ allowHosts, log });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      const base = `http://${host}:${actualPort}`;
      log(`已启动：${base}`);
      log('在「模型连接 → 高级：跨域代理与私有网关」中把代理前缀填为：');
      log(`  ${base}`);
      log('（弹窗里点「填入本地代理」会自动填默认端口，换了端口才需要手动改）');
      if (allowHosts.length > 0) {
        log(`白名单：${allowHosts.join(', ')}`);
      } else {
        log('未设置 LLM_PROXY_ALLOW，当前放行任意上游（仅本机可访问）。');
      }
      log('按 Ctrl+C 停止。');
      resolve({ server, port: actualPort, host, url: base });
    });
  });
}

function parseAllowList(raw) {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  startProxy({
    port: Number(process.env.PORT) || DEFAULT_PORT,
    host: process.env.HOST || DEFAULT_HOST,
    allowHosts: parseAllowList(process.env.LLM_PROXY_ALLOW),
  }).catch((err) => {
    const port = Number(process.env.PORT) || DEFAULT_PORT;
    if (err && err.code === 'EADDRINUSE') {
      // 常见于「npm run dev 自动拉起」与「手动再起一个」撞车 —— 不是故障。
      // 这里刻意用退出码 0，避免把自动启动的那一侧判成失败。
      console.error(
        `[llm-proxy] 端口 ${port} 已被占用：本机已经有一个代理在运行，直接用即可，无需重复启动。`,
      );
      process.exit(0);
      return;
    }
    console.error(`[llm-proxy] 启动失败：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
