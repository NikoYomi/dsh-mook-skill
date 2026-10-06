/**
 * dsh-mook-skill — Mook 集成：宿主半场。
 *
 * 职责：
 *  1. 维护插件配置（$DSH_HOME/storages/mook/config.json）：Mook 地址；
 *  2. 把 API 密钥存进 dsh 凭据库（credential ref `MOOK_API_KEY`），配置页只说
 *     “是否已配置 / 来源 / 可写”，永不回显值；
 *  3. 注册 /mook/api/* 路由，供 Web 客户端设置页读写配置与测试连接；
 *  4. 提供 `mook-mcp-config` 路由：按当前配置生成可直接粘贴的 cordis.patch.yml 片段。
 *
 * Mook Agent 接口约定（v0.4.0 实测）：鉴权头 `Authorization: Bearer mk_<48hex>`，
 * 成败看 HTTP 状态码；`/api/agent/servers/{id}/exec` 里命令非零退出**仍返回 200**，
 * 要看响应体的 `ok` 字段。
 *
 * 本文件只依赖 node 内建模块：宿主进程提供 ctx.webServer / ctx.credentials。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'mook'

/** 配置页与客户端调用的路由前缀。 */
const API_PREFIX = '/mook/api'
/** 存 API 密钥的凭据引用（POSIX 环境变量名风格，兼容已有的 MOOK_API_KEY 环境变量）。 */
const TOKEN_REF = 'MOOK_API_KEY'
const DEFAULT_BASE_URL = 'http://127.0.0.1:5866'
/** 探测超时：Mook 没开也不让页面干等。 */
const PROBE_TIMEOUT_MS = 8000
const MAX_BODY_BYTES = 1 * 1024 * 1024
/** 密钥固定形状：`mk_` + 48 位十六进制 = 51 字符。 */
const KEY_PATTERN = /^mk_[0-9a-f]{48}$/

/** 密钥权限清单（与 Mook 后端 `backend/api/keys.go` 的 agentScopes 一致）。 */
const SCOPES = [
  { key: 'servers:read', label: '查看服务器', description: '列出、查看已托管的服务器与实时状态', dangerous: false },
  { key: 'servers:write', label: '管理服务器', description: '新增、修改、删除服务器', dangerous: false },
  { key: 'servers:exec', label: '远程执行', description: '在服务器上执行任意命令、读写文件', dangerous: true },
  { key: 'commands:read', label: '查看常用命令', description: '列出、查看你保存的常用命令', dangerous: false },
  { key: 'commands:write', label: '管理常用命令', description: '新增、修改、删除常用命令', dangerous: false },
]

const DEFAULT_CONFIG = { baseUrl: DEFAULT_BASE_URL }

// ── 配置持久化 ──────────────────────────────────────────────────────────────

function dshHome() {
  const env = process.env.DSH_HOME
  return env !== undefined && env.trim() !== '' ? env : path.join(os.homedir(), '.dsh')
}

function configPath() {
  return path.join(dshHome(), 'storages', 'mook', 'config.json')
}

function normalizeBaseUrlInput(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') throw new Error('Mook 地址不能为空')
  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error(`Mook 地址不是合法的 URL：「${text}」`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Mook 地址必须以 http:// 或 https:// 开头：「${text}」`)
  }
  // 尾斜杠会让所有拼接出来的路径变成 //api/...，服务端路由匹配不上。
  return url.origin + url.pathname.replace(/\/+$/, '')
}

function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const config = { ...DEFAULT_CONFIG }
  const candidate = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : ''
  if (candidate !== '') {
    try {
      config.baseUrl = normalizeBaseUrlInput(candidate)
    } catch {
      // 配置文件里存了坏地址：回退默认值，别让读取路径抛错。
      config.baseUrl = DEFAULT_BASE_URL
    }
  }
  return config
}

let warnedCorruptFile = ''
function reportConfigCorrupt(file, reason) {
  if (warnedCorruptFile === file) return
  warnedCorruptFile = file
  onConfigCorrupt?.(file, reason)
}
let onConfigCorrupt
export const internals = {}

function readConfig() {
  const file = configPath()
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeConfig(undefined)
    reportConfigCorrupt(file, `读取失败：${error?.message ?? String(error)}`)
    return normalizeConfig(undefined)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    reportConfigCorrupt(file, `不是合法 JSON：${error?.message ?? String(error)}`)
    return normalizeConfig(undefined)
  }
  warnedCorruptFile = ''
  return normalizeConfig(parsed)
}

/**
 * 原子写入配置：同目录写临时文件 → fsync → rename 覆盖。
 * 直接 writeFileSync 覆盖目标文件时，写到一半被打断会留下半个 JSON，
 * 而 readConfig 对坏文件只能回退默认值 —— 用户会静默丢掉全部设置。
 */
function writeConfig(config) {
  const target = configPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}`
  try {
    const handle = fs.openSync(temporary, 'w', 0o600)
    try {
      fs.writeFileSync(handle, JSON.stringify(config, null, 2) + '\n', 'utf8')
      fs.fsyncSync(handle)
    } finally {
      fs.closeSync(handle)
    }
    fs.renameSync(temporary, target)
  } catch (error) {
    try {
      fs.unlinkSync(temporary)
    } catch {
      // 临时文件没建起来或已被清掉都无所谓
    }
    throw error
  }
}

// ── 凭据 ────────────────────────────────────────────────────────────────────

/**
 * 工具调用路径：只要密钥值，不要元数据。
 * 只有凭据服务不存在时才回退 process.env —— 服务存在但库里没值时**不回退**，
 * 否则「页面里清除了密钥」会被环境变量悄悄复活。
 */
async function tokenValue(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    const fallback = process.env[TOKEN_REF]
    return typeof fallback === 'string' ? fallback.trim() : ''
  }
  try {
    const hit = await credentials.resolve(TOKEN_REF)
    return typeof hit?.value === 'string' ? hit.value : ''
  } catch {
    return ''
  }
}

/**
 * 设置页路径：回 configured / source / writable，**永不回显值**。
 * source 为 `env` 时是只读来源（环境变量或部署配置），页面不能覆盖。
 */
async function tokenState(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    const fallback = process.env[TOKEN_REF]
    const configured = typeof fallback === 'string' && fallback.trim() !== ''
    return { configured, source: configured ? 'env' : undefined, writable: false }
  }
  try {
    const info = await credentials.describe(TOKEN_REF)
    return {
      configured: info?.configured === true,
      source: typeof info?.source === 'string' ? info.source : undefined,
      writable: info?.writable === true,
    }
  } catch {
    return { configured: false, writable: false }
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/** 打 Mook Agent 接口。返回解析后的 JSON；HTTP 非 2xx 抛带服务端 message 的错误。 */
async function mookFetch(baseUrl, key, apiPath, { method = 'GET', body, timeout = PROBE_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const onAbort = () => controller.abort()
  if (signal !== undefined) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const response = await fetch(`${baseUrl}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let payload
    try {
      payload = text === '' ? undefined : JSON.parse(text)
    } catch {
      // 拿到的不是 JSON：多半是地址填成了 Mook 的网页端而不是 API 根路径。
      throw new Error(`Mook 没有返回 JSON（HTTP ${response.status}）：地址可能填错了，应为服务根地址`)
    }
    if (!response.ok) {
      const message = typeof payload?.error === 'string' && payload.error !== ''
        ? payload.error
        : `HTTP ${response.status}`
      throw new Error(message)
    }
    return payload
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`请求 Mook 超时（${Math.round(timeout / 1000)} 秒）`)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }
}

// ── 设置页状态 ──────────────────────────────────────────────────────────────

function maskKeyHint(source) {
  if (source === 'env') return '来自环境变量'
  if (source === 'file') return '存在 dsh 凭据库'
  if (source === 'project-env') return '来自项目 .env'
  if (source === 'user-env') return '来自用户 .env'
  return '已配置'
}

async function buildStatePayload(ctx) {
  const config = readConfig()
  const key = await tokenState(ctx)
  return {
    baseUrl: config.baseUrl,
    defaultBaseUrl: DEFAULT_BASE_URL,
    key: {
      configured: key.configured,
      source: key.source,
      writable: key.writable,
      hint: key.configured ? maskKeyHint(key.source) : '未配置',
    },
    scopes: SCOPES,
    configPath: configPath(),
    mcpCommand: process.execPath,
    mcpScript: path.join(pluginRoot(), 'mcp', 'mook-mcp.js'),
    apiPrefix: API_PREFIX,
  }
}

/** 插件自身目录（本文件在 <root>/lib/index.js）。 */
function pluginRoot() {
  // 用 fileURLToPath 而不是 `.pathname`：路径含中文/空格时后者会留下 %XX 转义，
  // 生成的 MCP 配置里 args 指向一个不存在的文件。
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)))
}

/**
 * 探测连接：**优先用设置页正在编辑的草稿**（body.baseUrl / body.key），
 * 没给才回落到已落盘配置与凭据库。否则「填了新地址、没保存就点测试连接」
 * 测的是旧地址，结论会误导人。
 */
async function probeConnection(ctx, body) {
  const config = readConfig()
  if (typeof body?.baseUrl === 'string' && body.baseUrl.trim() !== '') {
    config.baseUrl = normalizeBaseUrlInput(body.baseUrl)
  }
  const draftKey = typeof body?.key === 'string' ? body.key.trim() : ''
  const key = draftKey === '' ? await tokenValue(ctx) : draftKey
  const keySource = draftKey === '' ? (await tokenState(ctx)).source : 'draft'
  return { config, key, keySource }
}

/**
 * 一次探测只打一个请求：`GET /api/agent/servers` 同时验证
 * 地址可达、密钥有效、且 `servers:read` 权限在位。
 */
async function testConnection(ctx, body, signal) {
  const { config, key } = await probeConnection(ctx, body)
  if (key === '') throw new Error('还没有配置 API 密钥，请先在「API 密钥」卡片里保存')
  const payload = await mookFetch(config.baseUrl, key, '/api/agent/servers', { timeout: PROBE_TIMEOUT_MS, signal })
  const servers = Array.isArray(payload?.servers) ? payload.servers : []
  return {
    ok: true,
    baseUrl: config.baseUrl,
    serverCount: servers.length,
    servers: servers.slice(0, 20).map((server) => ({
      id: server?.id,
      name: server?.name,
      host: server?.host,
      online: server?.stats?.online === true,
    })),
    message: `连接成功，密钥可读到 ${servers.length} 台服务器`,
  }
}

/** 生成可直接粘进 profile `cordis.patch.yml` 的 MCP 实例片段。 */
async function mcpConfig(ctx) {
  const config = readConfig()
  const key = await tokenValue(ctx)
  const script = path.join(pluginRoot(), 'mcp', 'mook-mcp.js')
  const command = process.execPath
  const lines = [
    '- id: mook',
    '  name: "@deepseek-ai/dsh-mcp-client"',
    '  config:',
    '    transport: stdio',
    '    serverName: mook',
    `    command: ${command}`,
    '    args:',
    `      - ${script}`,
    '    env:',
    `      MOOK_URL: "${config.baseUrl}"`,
    `      MOOK_API_KEY: "${key === '' ? 'mk_在此填入你的密钥' : key}"`,
  ]
  return {
    yaml: lines.join('\n') + '\n',
    command,
    script,
    baseUrl: config.baseUrl,
    keyConfigured: key !== '',
    profileHint: path.join(dshHome(), 'profiles', '<profile>', 'cordis.patch.yml'),
  }
}

// ── 路由 ────────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES_GUARD = MAX_BODY_BYTES

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES_GUARD) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

function headerValue(headers, name) {
  const raw = headers?.[name]
  if (Array.isArray(raw)) return raw[0]
  return typeof raw === 'string' ? raw : undefined
}

function isLoopbackHostname(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
}

/**
 * CSRF 防护：只放行回环地址（或 webRuntime 声明的可信主机），
 * 且 `Origin` 的 host（含端口）必须与 `Host` 完全一致 —— 只比 hostname
 * 会把同机不同端口的恶意页面当成同源放行。
 */
function isTrustedRequest(req, trustedHosts) {
  const host = headerValue(req.headers, 'host')
  if (host === undefined) return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  const trusted = Array.isArray(trustedHosts) ? trustedHosts : []
  const isTrustedAuthority = trusted.some((candidate) => typeof candidate === 'string' && (candidate === host || candidate === hostUrl.host))
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority) return false
  if (headerValue(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = headerValue(req.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function mount(ctx) {
  onConfigCorrupt = (file, reason) => ctx.logger?.warn?.(`[dsh-mook] 配置文件损坏，已回退默认值：${file}（${reason}）`)

  const handlers = {
    async getState() {
      return buildStatePayload(ctx)
    },
    async updateConfig(body) {
      const config = readConfig()
      if (typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '') {
        // 保存入口就拒绝：否则设置页回“已保存”的假成功，之后所有请求都失败。
        config.baseUrl = normalizeBaseUrlInput(body.baseUrl)
      }
      writeConfig(config)
      return buildStatePayload(ctx)
    },
    async setKey(body) {
      const value = typeof body.key === 'string' ? body.key.trim() : ''
      if (value === '') throw new Error('密钥不能为空')
      if (!KEY_PATTERN.test(value)) {
        throw new Error('密钥格式不对，应为 mk_ 开头、共 51 个字符（在 Mook「设置 → 访问密钥」中创建）')
      }
      const credentials = ctx.get('credentials')
      if (credentials === undefined) throw new Error('宿主的凭据服务不可用，无法保存密钥')
      await credentials.set(TOKEN_REF, value)
      return buildStatePayload(ctx)
    },
    async clearKey() {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) throw new Error('宿主的凭据服务不可用')
      try {
        await credentials.unset(TOKEN_REF)
      } catch (error) {
        throw new Error(`清除密钥失败：${error?.message ?? String(error)}`)
      }
      return buildStatePayload(ctx)
    },
    async testConnection(body, req) {
      return testConnection(ctx, body, abortSignalOf(req))
    },
    async getMcpConfig() {
      return mcpConfig(ctx)
    },
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          const trustedHosts = ctx.get('webRuntime')?.trustedHosts
          if (!isTrustedRequest(req, trustedHosts)) {
            writeJson(res, 403, { ok: false, error: { message: 'forbidden' } })
            return
          }
          if (req.method !== 'POST') {
            writeJson(res, 405, { ok: false, error: { message: 'method not allowed' } })
            return
          }
          const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
          const method = pathname.startsWith(API_PREFIX + '/') ? pathname.slice(API_PREFIX.length + 1) : ''
          const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined
          if (handler === undefined) {
            writeJson(res, 404, { ok: false, error: { message: `unknown mook api method "${method}"` } })
            return
          }
          try {
            const body = await readJsonBody(req)
            const value = await handler(body, req)
            writeJson(res, 200, { ok: true, value })
          } catch (error) {
            writeJson(res, 200, { ok: false, error: { message: error?.message ?? String(error) } })
          }
        },
      }),
    'dsh-mook: settings routes',
  )

  ctx.logger?.info?.(`[dsh-mook] 设置页已就绪：${API_PREFIX}`)
}

/** 客户端断开时取消在途探测，避免请求悬着。 */
function abortSignalOf(req) {
  if (typeof AbortController !== 'function') return undefined
  const controller = new AbortController()
  req.on?.('close', () => controller.abort())
  return controller.signal
}

export function apply(ctx) {
  // cordis 规定：没声明 inject 的上下文读 ctx.webServer 会抛
  // `cannot get property ... without inject`。
  ctx.inject(['webServer'], (sctx) => {
    mount(sctx)
  })
}

Object.assign(internals, {
  API_PREFIX,
  TOKEN_REF,
  DEFAULT_BASE_URL,
  SCOPES,
  KEY_PATTERN,
  configPath,
  dshHome,
  normalizeConfig,
  normalizeBaseUrlInput,
  readConfig,
  writeConfig,
  tokenValue,
  tokenState,
  mookFetch,
  buildStatePayload,
  probeConnection,
  testConnection,
  mcpConfig,
  isTrustedRequest,
  isLoopbackHostname,
  maskKeyHint,
})
