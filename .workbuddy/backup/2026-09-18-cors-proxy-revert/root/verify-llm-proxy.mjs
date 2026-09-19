/**
 * 临时端到端复验（跑完即删）
 * 1) 用 `npm run llm:proxy` 真的把代理起起来 —— 验证脚本名不是「文案里的幻影」
 * 2) 转发链路用**本地上游**做确定性验证（沙箱对 Node 的 https 出网有限制，不能拿来判定代理好坏）
 * 3) 顺带探测真实网关，仅作参考（区分「沙箱出网受限」与「代理有问题」）
 */
import { spawn } from 'node:child_process';
import http from 'node:http';

// ── 本地上游：模拟一个「没开 CORS 的网关」 ────────────────────────────────
let seenAuth = null;
const upstream = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(403).end(); return; } // 正是原网关的行为
  seenAuth = req.headers.authorization;
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
  res.write('data: {"choices":[{"delta":{"content":"连"}}]}\n\n');
  setTimeout(() => { res.write('data: {"choices":[{"delta":{"content":"通"}}]}\n\n'); res.end('data: [DONE]\n\n'); }, 30);
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upstreamPort = upstream.address().port;
const localTarget = `http://127.0.0.1:${upstreamPort}/v1/chat/completions`;

// ── 用 npm 脚本启动代理 ────────────────────────────────────────────────────
const child = spawn('npm', ['run', 'llm:proxy'], { shell: true });
let out = '';
let ready = false;
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('代理 20s 内未就绪')), 20000);
  child.stdout.on('data', (b) => { out += b.toString(); if (!ready && /已启动/.test(out)) { ready = true; clearTimeout(timer); resolve(); } });
  child.stderr.on('data', (b) => { out += b.toString(); });
  child.on('exit', (c) => { if (!ready) { clearTimeout(timer); reject(new Error(`代理提前退出 code=${c}\n${out}`)); } });
});

const PROXY = 'http://127.0.0.1:8787';
const ORIGIN = 'http://localhost:5173';
let failed = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '×'} ${label}: ${actual}${ok ? '' : `（期望 ${expected}）`}`);
};

try {
  console.log('--- 1. npm run llm:proxy 启动成功 ---');
  console.log(out.trim().split('\n').filter((l) => l.includes('llm-proxy')).join('\n'));

  console.log('\n--- 2. 本地上游（模拟未开 CORS 的网关）经代理 ---');
  const direct = await fetch(localTarget, { method: 'OPTIONS' });
  check('直连上游预检（这就是浏览器死掉的原因）', direct.status, 403);

  const pre = await fetch(`${PROXY}/${localTarget}`, {
    method: 'OPTIONS',
    headers: { origin: ORIGIN, 'access-control-request-headers': 'authorization,content-type' },
  });
  check('经代理预检', pre.status, 204);
  check('回显 allow-origin', pre.headers.get('access-control-allow-origin'), ORIGIN);
  check('回显 allow-headers', pre.headers.get('access-control-allow-headers'), 'authorization,content-type');

  const res = await fetch(`${PROXY}/${localTarget}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test', origin: ORIGIN },
    body: JSON.stringify({ model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'hi' }] }),
  });
  check('经代理 POST 状态', res.status, 200);
  check('响应带 CORS 头', Boolean(res.headers.get('access-control-allow-origin')), true);
  check('Authorization 已转发给上游', seenAuth, 'Bearer sk-test');
  const text = await res.text();
  check('SSE 增量完整（连+通）', text.includes('连') && text.includes('通') && text.includes('[DONE]'), true);

  console.log('\n--- 3. 真实网关（仅参考；本沙箱对 Node 的 https 出网有限制）---');
  const realTarget = 'https://api.qingcuicore.com/v1/chat/completions';
  const realPre = await fetch(`${PROXY}/${realTarget}`, {
    method: 'OPTIONS',
    headers: { origin: ORIGIN, 'access-control-request-headers': 'authorization,content-type' },
  });
  console.log(`  · 预检 ${realPre.status}（本地即可判定 CORS 补齐能力，无需依赖出网）`);
  const real = await fetch(`${PROXY}/${realTarget}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test-invalid', origin: ORIGIN },
    body: JSON.stringify({ model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'hi' }] }),
  });
  const realBody = (await real.text()).slice(0, 120);
  if (real.status === 401) {
    console.log(`  · POST ${real.status} → 转发成功（401 = 网关正常拒绝无效 Key）`);
  } else {
    console.log(`  · POST ${real.status}：${realBody}`);
    console.log('    （若为 502「fetch failed」，是沙箱禁止 Node 直连外网所致 —— 见下方 curl 对照）');
  }
  console.log(`  · 无论上游结果如何，CORS 头均已补齐：${real.headers.get('access-control-allow-origin')}`);
} catch (err) {
  console.error('复验异常：', err.message);
  failed++;
} finally {
  console.log(`\n=== 结论：${failed === 0 ? '全部通过' : `${failed} 项未通过`} ===`);
  child.kill('SIGTERM');
  upstream.closeAllConnections();
  upstream.close();
  setTimeout(() => { child.kill('SIGKILL'); process.exit(failed === 0 ? 0 : 1); }, 600);
}
