/**
 * dsh-mook-skill — Mook 集成：宿主半场。
 *
 * 职责：
 *  1. 维护插件配置（$DSH_HOME/storages/mook/config.json）：Mook 地址 + 逐工具开关；
 *  2. 把 API 密钥存进 dsh 凭据库（credential ref `MOOK_API_KEY`），配置页只说
 *     “是否已配置 / 来源 / 可写”，永不回显值；
 *  3. 按配置把 14 个 `mook_*` 工具注册进宿主工具表（见 lib/tools.js）。
 *     1.0.0 起不再有独立的 MCP 子进程，也不再需要往 cordis.patch.yml 粘配置；
 *  4. 把随包发布的技能（skills/mook/SKILL.md）注册成 runtime 技能，
 *     用户不再需要手工拷贝到 $DSH_HOME/skills；
 *  5. 注册 /mook/api/* 路由，供 Web 客户端设置页读写配置与测试连接。
 *
 * 于是安装面只剩一件事：`dsh plugin --profile web add @yoursc/dsh-mook-skill`。
 *
 * Mook Agent 接口约定（v0.4.0 实测）：鉴权头 `Authorization: Bearer mk_<48hex>`，
 * 成败看 HTTP 状态码；`/api/agent/servers/{id}/exec` 里命令非零退出**仍返回 200**，
 * 要看响应体的 `ok` 字段。
 *
 * 本文件只依赖 node 内建模块：宿主进程提供 ctx.tools / ctx.skills / ctx.webServer /
 * ctx.credentials。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildTools, mookFetch, TOOL_GROUP_DEFAULTS, TOOL_GROUPS } from './tools.js'

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

const DEFAULT_CONFIG = { baseUrl: DEFAULT_BASE_URL, tools: {} }

// ── 工具开关 ────────────────────────────────────────────────────────────────

/**
 * 某个工具当前是否启用。三级判定，顺序固定（与思源插件同一套规则）：
 * 1. `tools[工具名]`（用户在设置页点过就有）；
 * 2. `tools[组名]`（兼容手工写入的组级开关）；
 * 3. `TOOL_GROUP_DEFAULTS[组名]`（新装 / 新增工具时的默认值）。
 *
 * @param {object} config - readConfig() 的结果
 * @param {string} name - 工具名（如 mook_list_servers）
 * @param {string} group - 工具所属分组（read/write/exec/danger）
 */
function isToolEnabled(config, name, group) {
  const explicit = config.tools[name]
  if (typeof explicit === 'boolean') return explicit
  const legacyGroup = config.tools[group]
  if (typeof legacyGroup === 'boolean') return legacyGroup
  return TOOL_GROUP_DEFAULTS[group] === true
}

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
  // 只收布尔值：键可以是工具名，也可以是组名，两者都在 isToolEnabled 里解析。
  const rawTools = source.tools !== null && typeof source.tools === 'object' ? source.tools : {}
  const tools = {}
  for (const [key, value] of Object.entries(rawTools)) {
    if (typeof value === 'boolean') tools[key] = value
  }
  config.tools = tools
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
 * 删除配置文件本体。用于「清除全部数据」：只删文件、**不删目录**。
 * 目录（storages/mook/）留着，因为 DSH 的 storages 根下本来就有别的插件目录，
 * 一个空目录不构成「残留文件」，而删目录要和别人抢父目录，得不偿失。
 */
function removeConfig() {
  try {
    fs.unlinkSync(configPath())
  } catch (error) {
    // 文件本来就不存在 = 已经是目标状态，不算失败。
    if (error?.code !== 'ENOENT') throw error
  }
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

// ── 设置页状态 ──────────────────────────────────────────────────────────────

function maskKeyHint(source) {
  if (source === 'env') return '来自环境变量'
  if (source === 'file') return '存在 dsh 凭据库'
  if (source === 'project-env') return '来自项目 .env'
  if (source === 'user-env') return '来自用户 .env'
  return '已配置'
}

async function buildStatePayload(ctx, allTools) {
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
    toolGroups: TOOL_GROUPS,
    // 全部工具 + 当前是否启用。enabled 已经含「逐工具 → 组开关 → 组默认」三级解析，
    // 客户端直接拿来当表单初值，不重复实现一遍。
    tools: (allTools ?? []).map((entry) => ({
      name: entry.definition.name,
      group: entry.group,
      enabled: isToolEnabled(config, entry.definition.name, entry.group),
    })),
    toolCount: (allTools ?? []).length,
    apiPrefix: API_PREFIX,
  }
}

/** 插件自身目录（本文件在 <root>/lib/index.js）。 */
function pluginRoot() {
  // 用 fileURLToPath 而不是 `.pathname`：路径含中文/空格时后者会留下 %XX 转义。
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)))
}

/**
 * 工具调用时的连接信息：**现取**落盘配置与凭据库，不走设置页草稿。
 * 每次都现读，所以设置页改完地址/密钥后不需要重启宿主就能生效。
 */
async function resolveConnection(ctx) {
  return { config: readConfig(), key: await tokenValue(ctx) }
}

// ── 内嵌技能 ────────────────────────────────────────────────────────────────

/**
 * 把随包发布的 `skills/mook/SKILL.md` 读成 runtime 技能定义（`ctx.skills.register`）。
 *
 * 取代原先的 `install.sh`（把目录拷到 `$DSH_HOME/skills/mook`）：装插件即得技能，
 * 卸载即消失，不会在技能根留下副本。
 *
 * 返回的 `content` 是 SKILL.md 的正文（frontmatter 已剥离），`path` 指向原文件，
 * 让正文里的 `reference/*.md` 相对链接仍能按目录解析。
 *
 * 注意 runtime 技能的优先级**低于**项目级同名技能：如果用户的仓库里自带一份
 * `mook` 技能，那份会赢，这是有意为之。
 *
 * 同步读：`ctx.skills.register()` 是同步调用，且文件极小（< 10KB），不值得引入异步。
 *
 * @returns {object} 技能定义
 */
function loadSkillSync() {
  const file = path.join(pluginRoot(), 'skills', 'mook', 'SKILL.md')
  const parsed = parseSkillFile(fs.readFileSync(file, 'utf8'), file)
  return {
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
    content: parsed.content,
    path: file,
  }
}

/**
 * 解析 SKILL.md：YAML frontmatter 只取 `name` / `description` / `whenToUse`，
 * 正文原样保留。
 *
 * 这里手写而不用 YAML 库：插件要求零依赖，而 frontmatter 的形状是受控的
 * —— 前两个字段是单行标量，`whenToUse` 用 `|` 块标量或单行。碰到别的形状
 * （例如 `description` 写成多行 `>`）会直接报错，而不是悄悄解析成半个技能。
 */
function parseSkillFile(text, file = 'SKILL.md') {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) throw new Error(`${file} 缺少 YAML frontmatter`)
  const body = match[2] ?? ''
  const fields = {}
  const lines = match[1].split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const pair = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line)
    if (pair === null) continue
    const [, key, rawValue] = pair
    const value = rawValue ?? ''
    if (value === '|' || value === '|-' || value === '>') {
      // 块标量：吃掉后续所有缩进行
      const block = []
      while (index + 1 < lines.length && (/^\s/.test(lines[index + 1]) || lines[index + 1].trim() === '')) {
        index += 1
        block.push(lines[index].replace(/^\s{2}/, ''))
      }
      fields[key] = block.join('\n').replace(/\n+$/, '')
      continue
    }
    if (value.startsWith("'") || value.startsWith('"')) {
      const quote = value[0]
      if (!value.endsWith(quote) || value.length < 2) {
        throw new Error(`${file} 的 ${key} 引号未闭合，暂不支持这种写法`)
      }
      fields[key] = value.slice(1, -1)
      continue
    }
    fields[key] = value
  }
  if (typeof fields.name !== 'string' || fields.name === '') throw new Error(`${file} 缺少 name`)
  if (typeof fields.description !== 'string' || fields.description === '') throw new Error(`${file} 缺少 description`)
  return {
    name: fields.name,
    description: fields.description,
    ...(typeof fields.whenToUse === 'string' && fields.whenToUse !== '' ? { whenToUse: fields.whenToUse } : {}),
    content: body,
  }
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

  // 每次工具调用现取连接信息，设置页改完无需重启即可生效。
  const allTools = buildTools(() => resolveConnection(ctx))
  const statePayload = () => buildStatePayload(ctx, allTools)

  // ── 工具注册（按设置页的逐工具开关） ──
  // tools 是可选注入面：宿主没有工具服务时（例如纯 headless 外壳）插件其余部分
  // 仍应可用，因此这里尽力而为，而不是把整份 mount 绑死在 ctx.tools 上。
  let toolDisposers = []
  const disposeTools = () => {
    for (const dispose of toolDisposers) {
      try {
        dispose()
      } catch {
        // 已随插件树卸载时忽略
      }
    }
    toolDisposers = []
  }
  const syncTools = () => {
    disposeTools()
    const tools = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
    if (tools === undefined) {
      ctx.logger?.warn?.('[dsh-mook] 宿主没有工具服务，mook_* 工具未注册（设置页与技能仍可用）')
      return
    }
    const config = readConfig()
    const enabled = []
    for (const entry of allTools) {
      if (isToolEnabled(config, entry.definition.name, entry.group) !== true) continue
      toolDisposers.push(tools.register(entry.definition))
      enabled.push(entry.definition.name)
    }
    ctx.logger?.info?.(`[dsh-mook] 已注册工具：${enabled.join(', ') || '(无)'}`)
  }
  syncTools()
  ctx.effect(() => disposeTools, 'dsh-mook: tools')

  // ── 内嵌技能 ──
  // 技能解析失败只告警、不拖垮插件：设置页与工具仍应能用。
  const skills = typeof ctx.get === 'function' ? ctx.get('skills') : undefined
  if (skills === undefined) {
    ctx.logger?.warn?.('[dsh-mook] 宿主没有技能服务，mook 技能未注册')
  } else {
    try {
      const skill = loadSkillSync()
      ctx.effect(() => skills.register(skill), 'dsh-mook: skill')
      ctx.logger?.info?.(`[dsh-mook] 已注册技能：${skill.name}`)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-mook] 技能注册失败（插件其余功能不受影响）：${error?.message ?? String(error)}`)
    }
  }

  const handlers = {
    async getState() {
      return statePayload()
    },
    async updateConfig(body) {
      const config = readConfig()
      if (typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '') {
        // 保存入口就拒绝：否则设置页回“已保存”的假成功，之后所有请求都失败。
        config.baseUrl = normalizeBaseUrlInput(body.baseUrl)
      }
      if (body.tools !== null && typeof body.tools === 'object') {
        // 逐工具提交：先把**已有结论**固化（未提到的工具保持原状），再叠加本次改动。
        const incoming = {}
        for (const [key, value] of Object.entries(body.tools)) {
          if (typeof value === 'boolean') incoming[key] = value
        }
        const settled = {}
        for (const entry of allTools) {
          const name = entry.definition.name
          settled[name] = typeof incoming[name] === 'boolean' ? incoming[name] : isToolEnabled(config, name, entry.group)
          delete incoming[name]
        }
        // 剩下的键不是已知工具名（可能是手工写的组名开关）：原样保留。
        config.tools = { ...config.tools, ...settled, ...incoming }
      }
      writeConfig(config)
      syncTools()
      return statePayload()
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
      return statePayload()
    },
    async clearKey() {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) throw new Error('宿主的凭据服务不可用')
      try {
        await credentials.unset(TOKEN_REF)
      } catch (error) {
        throw new Error(`清除密钥失败：${error?.message ?? String(error)}`)
      }
      return statePayload()
    },
    async testConnection(body, req) {
      return testConnection(ctx, body, abortSignalOf(req))
    },
    /**
     * 一键清除全部落盘数据：地址配置 + 凭据库里的密钥。
     * 卸载插件前点一下就干净了 —— DSH 卸载时只删程序文件，插件数据归插件自己管。
     * 两步都尽力而为：一步失败不吞掉另一步的结果，最后统一报哪步没成功。
     * **必须幂等**：密钥本来就没有时，凭据服务的 unset 会抛
     * 「an empty value cannot be stored; use unset」——那不是失败，是已经是目标状态。
     */
    async clearAll() {
      const failed = []
      try {
        removeConfig()
      } catch (error) {
        failed.push(`配置文件：${error?.message ?? String(error)}`)
      }
      const credentials = ctx.get('credentials')
      if (credentials === undefined) {
        failed.push('密钥：宿主的凭据服务不可用')
      } else {
        try {
          await credentials.unset(TOKEN_REF)
        } catch (error) {
          // 先问一句「现在还有没有」再决定这算不算失败，别拿错误文案做判断。
          let stillThere = true
          try {
            const info = await credentials.describe(TOKEN_REF)
            stillThere = info?.configured === true
          } catch {
            // describe 也失败就保守认为没清干净
          }
          if (stillThere) failed.push(`密钥：${error?.message ?? String(error)}`)
        }
      }
      if (failed.length > 0) throw new Error(`部分数据未能清除 —— ${failed.join('；')}`)
      return statePayload()
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
  // `cannot get property ... without inject`。工具与技能是可选面（mount 内部
  // 用 ctx.get 探测），因此只有 webServer 是硬依赖。
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
  TOOL_GROUPS,
  TOOL_GROUP_DEFAULTS,
  configPath,
  removeConfig,
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
  resolveConnection,
  loadSkillSync,
  parseSkillFile,
  isToolEnabled,
  isTrustedRequest,
  isLoopbackHostname,
  maskKeyHint,
})
