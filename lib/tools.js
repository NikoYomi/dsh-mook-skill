/**
 * dsh-mook-skill — Mook 集成：模型可调用的 14 个工具（宿主进程内注册）。
 *
 * 从 1.0.0 起，Mook 的工具不再是一个独立的 MCP 子进程，而是直接注册进宿主工具表
 * （`ctx.tools.register()`），与思源插件同一套做法：没有子进程、没有 stdio 握手、
 * 包内也不再有 15M 的 MCP SDK 依赖。安装面因此只剩 `dsh plugin add` 一件事。
 *
 * 与原 MCP 时代的分工没变：参数校验在这里做（原先交给 zod），HTTP 错误在这里
 * 翻译成人话，Mook 自己的业务错误原样透出。
 *
 * 工具名统一带 `mook_` 前缀：`list_files`、`list_commands` 这类通用名直接进宿主
 * 工具表极易与别的插件撞名，撞名会导致注册失败。
 *
 * Mook Agent 接口约定（v0.4.0 实测）：鉴权头 `Authorization: Bearer mk_<48hex>`，
 * 成败看 HTTP 状态码；`/api/agent/servers/{id}/exec` 里命令非零退出**仍返回 200**，
 * 要看响应体的 `ok` 字段。
 */

/** 远程执行可能很慢（服务端上限 600 秒），请求超时要比设置页探测宽得多。 */
const REQUEST_TIMEOUT_MS = 120_000

/** 工具分组：决定设置页里的排列与「新装时的默认值」。 */
export const TOOL_GROUPS = ['read', 'write', 'exec', 'danger']

/**
 * 每组默认开关。写入 / 执行 / 危险默认关闭：这三组会**真实改动**用户的服务器，
 * 与思源插件「写权限默认关」同一个理由。
 */
export const TOOL_GROUP_DEFAULTS = { read: true, write: false, exec: false, danger: false }

/** 统一的取消错误：宿主约定抛 name=AbortError 才会被包装成 ABORTED 结果。 */
function abortError() {
  const error = new Error('已取消')
  error.name = 'AbortError'
  return error
}

function assertNotAborted(signal) {
  if (signal?.aborted === true) throw abortError()
}

/**
 * 调 Mook 的 agent 接口 —— 工具调用与设置页探测共用的唯一一份实现。
 *
 * 两边的差异只在超时：工具调用给 120 秒（远程执行上限 600 秒，但不必等满），
 * 设置页探测给 8 秒（Mook 没开也不让页面干等），由调用方传 `timeout` 决定。
 *
 * @param {string} baseUrl - 已规范化的 Mook 地址（不带尾斜杠）
 * @param {string} key - API 密钥
 * @param {string} apiPath - 以 / 开头的接口路径
 * @param {object} [options] - method / body / signal / timeout
 * @returns {Promise<unknown>} 解析后的 JSON（无响应体时返回空字符串）
 */
export async function mookFetch(baseUrl, key, apiPath, { method = 'GET', body, signal, timeout = REQUEST_TIMEOUT_MS } = {}) {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('还没有配置 API 密钥，请先在 设置 → Mook 里保存密钥')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const onAbort = () => controller.abort()
  if (signal !== undefined) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  let response
  let text
  try {
    response = await fetch(`${baseUrl}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    text = await response.text()
  } catch (error) {
    if (error?.name === 'AbortError') {
      // 调用方取消（用户中断）与请求自身超时是两回事，分开报。
      if (signal?.aborted === true) throw abortError()
      throw new Error(`请求 Mook 超时（${Math.round(timeout / 1000)} 秒）`)
    }
    throw new Error(`无法连接 Mook（${baseUrl}）：${error?.message ?? String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }

  let payload
  let parsed = false
  if (text !== undefined && text !== '') {
    try {
      payload = JSON.parse(text)
      parsed = true
    } catch {
      // 非 JSON 响应：404 与「拿到 HTML」是两种不同的地址错误，分开说清楚——
      // 飞牛套件版真正的原因是地址**少了**前缀，按「地址写错」去改反而越改越错。
      if (response.status === 404) {
        throw new Error(
          'Mook 返回 404，这个地址上没有接口：飞牛套件版（应用中心安装）需要带 /app/mook ' +
            '前缀，例如 http://<飞牛IP>:<端口>/app/mook；独立 Docker 部署则填服务根地址。',
        )
      }
      throw new Error(`Mook 没有返回 JSON（HTTP ${response.status}）：地址可能指向了网页端而不是接口根路径，请检查。`)
    }
  }

  if (!response.ok) {
    const message = parsed && typeof payload?.error === 'string' && payload.error !== '' ? payload.error : text || `HTTP ${response.status}`
    if (response.status === 401) throw new Error(`鉴权失败：${message}。请检查 MOOK_API_KEY 是否有效或已被撤销。`)
    if (response.status === 403) throw new Error(`权限不足：${message}。请在 Mook 中为该密钥补授对应权限。`)
    throw new Error(`请求失败（HTTP ${response.status}）：${message}`)
  }

  return parsed ? payload : text
}

// ── 参数 schema 小工具（原先 zod 的替身） ───────────────────────────────────

const stringProp = (description) => ({ type: 'string', description })
const nonEmptyString = (description) => ({ type: 'string', minLength: 1, description })
const intProp = (description, extra = {}) => ({ type: 'integer', ...extra, description })
const boolProp = (description) => ({ type: 'boolean', description })
const stringArrayProp = (description) => ({ type: 'array', items: { type: 'string' }, description })
const positiveInt = (description) => intProp(description, { minimum: 1 })
const confirmProp = () => boolProp('必须显式传 true 才会执行，用于防止误删')

/**
 * 文本工具定义的统一外壳：所有 Mook 工具都只返回一段文本，
 * 因此 output schema 与 render 只写一次。
 */
function defineTextTool(spec) {
  const properties = spec.parameters ?? {}
  const required = Array.isArray(spec.required) ? spec.required.filter((key) => Object.hasOwn(properties, key)) : []
  return {
    name: spec.name,
    description: spec.description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.result }],
    },
    async execute(args, exec) {
      const signal = exec?.signal
      assertNotAborted(signal)
      return { result: await spec.execute(args, signal) }
    },
  }
}

/** 与 MCP 时代相同的序列化：字符串原样，对象按两格缩进展开。 */
function format(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

/**
 * 构造全部工具定义。
 *
 * @param {(signal?: AbortSignal) => Promise<{config: object, key: string}>} resolveConnection
 *   每次调用现取连接信息：设置页改了地址或密钥后**不需要重启**就生效。
 * @returns {Array<{group: string, definition: object}>}
 */
export function buildTools(resolveConnection) {
  const api = async (signal, apiPath, options) => {
    const { config, key } = await resolveConnection(signal)
    return mookFetch(config.baseUrl, key, apiPath, { ...options, signal })
  }

  return [
    // ── 服务器 ────────────────────────────────────────────────────────────
    {
      group: 'read',
      definition: defineTextTool({
        name: 'mook_list_servers',
        description: '列出 Mook 中托管的所有服务器。返回每台服务器的 id、名称、地址、端口、用户名与标签，不包含任何登录凭据。',
        parameters: {},
        execute: async (_args, signal) => format(await api(signal, '/api/agent/servers')),
      }),
    },
    {
      group: 'read',
      definition: defineTextTool({
        name: 'mook_get_server',
        description: '获取单台服务器的详情，并附带该机器的实时状态（CPU、内存、磁盘、负载、延迟）。执行前先用 mook_list_servers 取得服务器 id。注意：对连不上的机器会阻塞约 10 秒（SSH 超时）。',
        parameters: { server_id: positiveInt('服务器 id，来自 mook_list_servers') },
        required: ['server_id'],
        execute: async (args, signal) => format(await api(signal, `/api/agent/servers/${args.server_id}`)),
      }),
    },
    {
      group: 'write',
      definition: defineTextTool({
        name: 'mook_add_server',
        description: '在 Mook 中新增一台服务器。需要具备 servers:write 权限。密码或私钥会被加密存储，接口不会回显。',
        parameters: {
          name: nonEmptyString('服务器显示名称'),
          host: nonEmptyString('主机地址（IP 或域名）'),
          port: intProp('SSH 端口，默认 22', { minimum: 1, maximum: 65535 }),
          username: stringProp('登录用户名，默认 root'),
          auth_type: { type: 'string', enum: ['password', 'key'], description: '认证方式，默认 password' },
          password: stringProp('登录密码（auth_type=password 时必填）'),
          private_key: stringProp('私钥内容（auth_type=key 时必填）'),
          tags: stringArrayProp('标签，便于分组'),
        },
        required: ['name', 'host'],
        execute: async (args, signal) => {
          const payload = { ...args }
          if (payload.port === undefined) payload.port = 22
          if (payload.auth_type === undefined || payload.auth_type === '') payload.auth_type = 'password'
          return format(await api(signal, '/api/agent/servers', { method: 'POST', body: payload }))
        },
      }),
    },
    {
      group: 'write',
      definition: defineTextTool({
        name: 'mook_update_server',
        description: '更新一台已有服务器的配置。只需传要修改的字段：后端 PUT 是全量替换，本工具已内建「先读当前值再合并」，未传的字段保持原值；凭据字段留空则不变。需要 servers:write 权限。',
        parameters: {
          server_id: positiveInt('要更新的服务器 id'),
          name: stringProp('新的显示名称'),
          host: stringProp('新的主机地址'),
          port: intProp('新的 SSH 端口', { minimum: 1, maximum: 65535 }),
          username: stringProp('新的登录用户名'),
          auth_type: { type: 'string', enum: ['password', 'key'], description: '新的认证方式' },
          password: stringProp('新的登录密码（留空表示不改）'),
          private_key: stringProp('新的私钥内容（留空表示不改）'),
          tags: stringArrayProp('新的标签列表（整体替换）'),
        },
        required: ['server_id'],
        execute: async (args, signal) => {
          const { server_id, ...rest } = args
          // 后端 PUT 要求完整字段：先取当前值，再用传入字段覆盖
          const current = await api(signal, `/api/agent/servers/${server_id}`)
          const s = current?.server ?? {}
          const body = {
            name: rest.name ?? s.name ?? '',
            host: rest.host ?? s.host ?? '',
            port: rest.port ?? s.port ?? 22,
            username: rest.username ?? s.username ?? 'root',
            auth_type: rest.auth_type ?? s.auth_type ?? 'password',
            tags: rest.tags ?? s.tags ?? [],
          }
          if (rest.password) body.password = rest.password
          if (rest.private_key) body.private_key = rest.private_key
          return format(await api(signal, `/api/agent/servers/${server_id}`, { method: 'PUT', body }))
        },
      }),
    },
    {
      group: 'danger',
      definition: defineTextTool({
        name: 'mook_remove_server',
        description: '从 Mook 中删除一台服务器（仅移除托管记录，不会影响服务器本身）。不可撤销，需要 servers:write 权限。只有用户明确要求删除时才调用，并传 confirm=true。',
        parameters: {
          server_id: positiveInt('要删除的服务器 id'),
          confirm: confirmProp(),
        },
        required: ['server_id', 'confirm'],
        execute: async (args, signal) => {
          if (args.confirm !== true) throw new Error('删除是破坏性操作，需要在用户明确要求后传 confirm=true')
          return format(await api(signal, `/api/agent/servers/${args.server_id}`, { method: 'DELETE' }))
        },
      }),
    },

    // ── 远程执行 ──────────────────────────────────────────────────────────
    {
      group: 'exec',
      definition: defineTextTool({
        name: 'mook_exec_command',
        description: '在一台服务器上通过 SSH 执行 shell 命令并返回输出。需要 servers:exec 权限。命令以该服务器配置的登录用户身份运行；耗时命令请调大 timeout_sec。注意：命令非零退出时 HTTP 仍是 200，要看返回体的 ok 字段。',
        parameters: {
          server_id: positiveInt('目标服务器 id'),
          command: nonEmptyString('要执行的 shell 命令，例如 "df -h" 或 "systemctl status nginx"'),
          timeout_sec: intProp('超时秒数，1-600，默认 60（服务端对 ≤0 重置为 60，对 >600 夹到 600）', { minimum: 1, maximum: 600 }),
        },
        required: ['server_id', 'command'],
        execute: async (args, signal) =>
          format(
            await api(signal, `/api/agent/servers/${args.server_id}/exec`, {
              method: 'POST',
              body: { command: args.command, timeout_sec: args.timeout_sec ?? 60 },
            }),
          ),
      }),
    },

    // ── 文件 ──────────────────────────────────────────────────────────────
    {
      group: 'exec',
      definition: defineTextTool({
        name: 'mook_list_files',
        description: '列出服务器上某个目录的内容。需要 servers:exec 权限。',
        parameters: {
          server_id: positiveInt('目标服务器 id'),
          path: stringProp('目录绝对路径，默认 /'),
        },
        required: ['server_id'],
        execute: async (args, signal) =>
          format(await api(signal, `/api/agent/servers/${args.server_id}/files?path=${encodeURIComponent(args.path || '/')}`)),
      }),
    },
    {
      group: 'exec',
      definition: defineTextTool({
        name: 'mook_read_file',
        description: '读取服务器上某个文本文件的内容。单次最多返回 1 MiB，超出部分会被截断（返回的 truncated 字段为 true）。需要 servers:exec 权限。',
        parameters: {
          server_id: positiveInt('目标服务器 id'),
          path: nonEmptyString('文件绝对路径，例如 /etc/nginx/nginx.conf'),
        },
        required: ['server_id', 'path'],
        execute: async (args, signal) =>
          format(await api(signal, `/api/agent/servers/${args.server_id}/files/read?path=${encodeURIComponent(args.path)}`)),
      }),
    },
    {
      group: 'exec',
      definition: defineTextTool({
        name: 'mook_write_file',
        description: '把内容写入服务器上的指定文件（已存在则整体覆盖，不存在则创建，没有备份）。需要 servers:exec 权限。',
        parameters: {
          server_id: positiveInt('目标服务器 id'),
          path: nonEmptyString('文件绝对路径'),
          content: stringProp('要写入的完整文件内容'),
        },
        required: ['server_id', 'path', 'content'],
        execute: async (args, signal) =>
          format(
            await api(signal, `/api/agent/servers/${args.server_id}/files/write`, {
              method: 'POST',
              body: { path: args.path, content: args.content ?? '' },
            }),
          ),
      }),
    },

    // ── 常用命令 ──────────────────────────────────────────────────────────
    {
      group: 'read',
      definition: defineTextTool({
        name: 'mook_list_commands',
        description: '列出 Mook 中保存的所有常用命令（含 id、名称、命令内容、分类、使用次数、是否置顶）。',
        parameters: {},
        execute: async (_args, signal) => format(await api(signal, '/api/agent/commands')),
      }),
    },
    {
      group: 'write',
      definition: defineTextTool({
        name: 'mook_save_command',
        description: '新增一条常用命令，保存到 Mook 供用户在网页终端里一键使用。需要 commands:write 权限。',
        parameters: {
          name: nonEmptyString('命令的显示名称，如「查看磁盘占用」'),
          command: nonEmptyString('实际执行的命令内容'),
          category: stringProp('分类，便于分组'),
          pinned: boolProp('是否置顶'),
        },
        required: ['name', 'command'],
        execute: async (args, signal) =>
          format(
            await api(signal, '/api/agent/commands', {
              method: 'POST',
              body: {
                name: args.name,
                command: args.command,
                category: args.category ?? '',
                pinned: args.pinned ?? false,
              },
            }),
          ),
      }),
    },
    {
      group: 'write',
      definition: defineTextTool({
        name: 'mook_update_command',
        description: '修改一条已保存的常用命令。只传要改的字段即可（name / command / category 传空字符串表示保持原值）。需要 commands:write 权限。',
        parameters: {
          command_id: nonEmptyString('命令 id，来自 mook_list_commands'),
          name: stringProp('新的名称'),
          command: stringProp('新的命令内容'),
          category: stringProp('新的分类'),
          pinned: boolProp('是否置顶'),
        },
        required: ['command_id'],
        execute: async (args, signal) =>
          format(
            await api(signal, `/api/agent/commands/${encodeURIComponent(args.command_id)}`, {
              method: 'PUT',
              body: {
                name: args.name ?? '',
                command: args.command ?? '',
                category: args.category ?? '',
                pinned: args.pinned ?? false,
              },
            }),
          ),
      }),
    },
    {
      group: 'danger',
      definition: defineTextTool({
        name: 'mook_delete_command',
        description: '删除一条已保存的常用命令。不可撤销，需要 commands:write 权限。只有用户明确要求删除时才调用，并传 confirm=true。',
        parameters: {
          command_id: nonEmptyString('要删除的命令 id'),
          confirm: confirmProp(),
        },
        required: ['command_id', 'confirm'],
        execute: async (args, signal) => {
          if (args.confirm !== true) throw new Error('删除是破坏性操作，需要在用户明确要求后传 confirm=true')
          return format(await api(signal, `/api/agent/commands/${encodeURIComponent(args.command_id)}`, { method: 'DELETE' }))
        },
      }),
    },
    {
      group: 'write',
      definition: defineTextTool({
        name: 'mook_mark_command_used',
        description: '把某条常用命令的使用次数 +1（影响网页端的排序）。一般无需手动调用。',
        parameters: { command_id: nonEmptyString('命令 id') },
        required: ['command_id'],
        execute: async (args, signal) =>
          format(await api(signal, `/api/agent/commands/${encodeURIComponent(args.command_id)}/use`, { method: 'POST' })),
      }),
    },
  ]
}
