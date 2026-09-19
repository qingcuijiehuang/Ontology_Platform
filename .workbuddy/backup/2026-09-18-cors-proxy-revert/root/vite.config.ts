import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 开发期自动拉起本地 CORS 代理（scripts/llm-proxy.mjs）。
 *
 * 为什么放在这里：接入自建网关失败时，绝大多数情况不是配置错，而是
 * **代理压根没启动** —— 用户填完代理前缀就以为完事了。与其每次报错再让人
 * 回到终端敲一条命令，不如 `npm run dev` 时顺手起起来，从根上消掉这类失败。
 *
 * 边界：
 *  - 只在 dev 生效（apply: 'serve'），build / preview 完全不碰；
 *  - 端口被占用不算失败（说明已有代理在跑），脚本会以退出码 0 自行退出；
 *  - 进程退出（含 Ctrl+C）时回收子进程，避免端口泄漏到下一个会话；
 *  - 设 LLM_PROXY_DISABLE=true 可整体关掉这段自动启动。
 */
function llmCorsProxyPlugin(): Plugin {
  // vite 会把 import.meta.url 定义为**配置文件自身**的地址（而非打包临时文件），
  // 所以这里能稳定解析到仓库内的脚本路径。
  const proxyScript = fileURLToPath(new URL('./scripts/llm-proxy.mjs', import.meta.url))

  return {
    name: 'llm-cors-proxy',
    apply: 'serve',
    configureServer() {
      if (process.env.LLM_PROXY_DISABLE === 'true') return

      let child: ChildProcess | null
      try {
        child = spawn(process.execPath, [proxyScript], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        })
      } catch (err) {
        // 自动启动只是便利，绝不能因此让 dev server 起不来
        console.warn(`[llm-proxy] 自动启动失败（不影响开发）：${err instanceof Error ? err.message : String(err)}`)
        return
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trimEnd()
        if (text) console.log(text)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trimEnd()
        if (text) console.warn(text)
      })

      let stopped = false
      const stop = () => {
        if (stopped) return
        stopped = true
        child?.kill()
        child = null
      }
      // 只在**进程退出**时回收，不挂 server 的 close 事件：
      // vite 重启 dev server（改 vite.config / .env）时会先 close 再重新跑
      // configureServer，若在 close 时就杀掉子进程，新起的那个可能撞上还没释放的
      // 端口、以「端口被占用」退出，结果是重启后反而没有代理在跑了。
      // Ctrl+C 时 vite 也会走 process.exit()，这条回收路径同样生效。
      process.once('exit', stop)
    },
  }
}

function resolveBasePath(): string {
  if (process.env.VITE_BASE_PATH) return process.env.VITE_BASE_PATH;

  // In GitHub Actions, derive Pages base from owner/repo when not explicitly provided.
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY) {
    const [, repoName] = process.env.GITHUB_REPOSITORY.split('/');
    if (repoName) return `/${repoName}/`;
  }

  return '/';
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), llmCorsProxyPlugin()],
  base: resolveBasePath(),
  build: {
    outDir: 'build',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('cytoscape')) return 'graph-vendor';
          if (id.includes('react') || id.includes('zustand') || id.includes('framer-motion')) return 'ui-vendor';
          return 'vendor';
        },
      },
    },
  },
  server: {
    proxy: {
      // GitHub OAuth device-flow endpoints don't support CORS — proxy in dev
      '/__github/login/device/code': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace('/__github', ''),
      },
      '/__github/login/oauth/access_token': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace('/__github', ''),
      },
      ...(process.env.VITE_ENABLE_AI_BUILDER === 'true'
        ? {
            '/api': {
              target: 'http://localhost:7071',
              changeOrigin: true,
            },
          }
        : {}),
    },
  },
})
