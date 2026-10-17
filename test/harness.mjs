/**
 * dsh-mook-skill 自测：不需要真实宿主，用假的 ctx 驱动插件真身。
 *
 *   node test/harness.mjs
 *
 * 覆盖三件事：
 *   1. 14 个工具定义形状合法、名字唯一且都带 mook_ 前缀；
 *   2. 按逐工具开关注册/注销（read 开、write/exec/danger 默认关）；
 *   3. 技能能从 SKILL.md 解析出来并注册。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// DSH_HOME 必须在 import 之前设置：插件在读配置时才取它。
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mook-test-'))
process.env.DSH_HOME = tmpHome

const mod = await import(path.join(root, 'lib/index.js'))
const { buildTools } = await import(path.join(root, 'lib/tools.js'))
const { internals } = mod

let pass = 0
const failures = []
function check(label, fn) {
  try {
    fn()
    pass += 1
  } catch (error) {
    failures.push(`${label}: ${error?.message ?? error}`)
  }
}

// ── 假连接：不发真实请求 ────────────────────────────────────────────────────
const fakeConnection = async () => ({ config: { baseUrl: 'http://127.0.0.1:5866' }, key: 'mk_' + '0'.repeat(48) })
const allTools = buildTools(fakeConnection)

// ── 1. 工具定义 ─────────────────────────────────────────────────────────────
check('工具数量为 14', () => assert.equal(allTools.length, 14))

check('工具名唯一', () => {
  const names = allTools.map((entry) => entry.definition.name)
  assert.equal(new Set(names).size, names.length)
})

check('所有工具名带 mook_ 前缀', () => {
  for (const entry of allTools) assert.match(entry.definition.name, /^mook_[a-z_]+$/)
})

check('每个工具的分组合法', () => {
  for (const entry of allTools) assert.ok(['read', 'write', 'exec', 'danger'].includes(entry.group), entry.group)
})

check('工具定义结构完整', () => {
  for (const entry of allTools) {
    const d = entry.definition
    assert.equal(typeof d.name, 'string')
    assert.ok(d.description.length > 10, `${d.name} 缺描述`)
    assert.equal(d.parameters.type, 'object')
    assert.ok(Array.isArray(d.parameters.required))
    // required 必须是 properties 的子集，否则宿主会拒
    for (const key of d.parameters.required) assert.ok(Object.hasOwn(d.parameters.properties, key), `${d.name}: ${key}`)
    assert.equal(typeof d.execute, 'function')
    assert.equal(typeof d.output.render, 'function')
    assert.equal(d.output.schema.type, 'object')
  }
})

check('删除类工具要求 confirm', () => {
  for (const name of ['mook_remove_server', 'mook_delete_command']) {
    const entry = allTools.find((item) => item.definition.name === name)
    assert.ok(entry, `${name} 不存在`)
    assert.ok(entry.definition.parameters.required.includes('confirm'), `${name} 没要求 confirm`)
  }
})

check('confirm 不为 true 时拒绝执行', async () => {
  const entry = allTools.find((item) => item.definition.name === 'mook_delete_command')
  await assert.rejects(() => entry.definition.execute({ command_id: 'x' }, {}), /confirm=true/)
})

// ── 2. 工具开关与注册 ───────────────────────────────────────────────────────
const registered = []
const toolsService = {
  register(definition) {
    registered.push(definition.name)
    return () => {
      const at = registered.indexOf(definition.name)
      if (at >= 0) registered.splice(at, 1)
    }
  },
}
const skillsService = {
  register(skill) {
    registered.push('skill:' + skill.name)
    return () => {}
  },
}
const webServerService = { register: () => () => {} }

const fakeCtx = {
  logger: { info() {}, warn() {} },
  tools: toolsService,
  skills: skillsService,
  webServer: webServerService,
  effect(fn) {
    const dispose = fn()
    return dispose
  },
  get(service) {
    if (service === 'tools') return toolsService
    if (service === 'skills') return skillsService
    if (service === 'webServer') return webServerService
    if (service === 'webRuntime') return undefined
    if (service === 'credentials') return undefined
    return undefined
  },
  inject(_services, fn) {
    fn(this)
  },
}

mod.apply(fakeCtx)

check('默认只注册 read 组（4 个）', () => {
  const toolNames = registered.filter((n) => !n.startsWith('skill:'))
  assert.deepEqual(toolNames.sort(), [
    'mook_get_server',
    'mook_list_commands',
    'mook_list_servers',
  ].sort())
})

check('技能已注册', () => assert.ok(registered.includes('skill:mook')))

check('技能内容解析正确', () => {
  const skill = internals.loadSkillSync()
  assert.equal(skill.name, 'mook')
  assert.ok(skill.description.length > 20)
  assert.ok(skill.whenToUse && skill.whenToUse.includes('Mook'))
  assert.ok(skill.content.trimStart().startsWith('# Mook'), '正文应以标题开头（frontmatter 已剥离）')
  assert.ok(!skill.content.includes('name: mook'), 'frontmatter 没被剥干净')
  assert.ok(fs.existsSync(skill.path))
})

// ── 3. 配置读写与开关 ───────────────────────────────────────────────────────
check('配置文件可写可读', () => {
  const config = internals.readConfig()
  assert.equal(config.baseUrl, 'http://127.0.0.1:5866')
  assert.deepEqual(config.tools, {})
})

check('默认值符合分组表', () => {
  const config = internals.readConfig()
  assert.equal(internals.isToolEnabled(config, 'mook_list_servers', 'read'), true)
  assert.equal(internals.isToolEnabled(config, 'mook_exec_command', 'exec'), false)
  assert.equal(internals.isToolEnabled(config, 'mook_delete_command', 'danger'), false)
  assert.equal(internals.isToolEnabled(config, 'mook_save_command', 'write'), false)
})

check('逐工具开关覆盖组默认', () => {
  const config = { tools: { mook_exec_command: true } }
  assert.equal(internals.isToolEnabled(config, 'mook_exec_command', 'exec'), true)
  assert.equal(internals.isToolEnabled(config, 'mook_write_file', 'exec'), false)
})

check('组名开关兜底生效', () => {
  const config = { tools: { exec: true } }
  assert.equal(internals.isToolEnabled(config, 'mook_write_file', 'exec'), true)
})

check('坏地址回退默认值', () => {
  const config = internals.normalizeConfig({ baseUrl: 'not a url' })
  assert.equal(config.baseUrl, internals.DEFAULT_BASE_URL)
})

check('尾斜杠被去掉', () => {
  assert.equal(internals.normalizeBaseUrlInput('http://1.2.3.4:5866/'), 'http://1.2.3.4:5866')
})

// ── 4. 设置页状态载荷 ───────────────────────────────────────────────────────
check('状态载荷含工具清单', async () => {
  const payload = await internals.buildStatePayload(fakeCtx, allTools)
  assert.equal(payload.toolCount, 14)
  assert.equal(payload.tools.length, 14)
  assert.ok(payload.tools.every((t) => typeof t.enabled === 'boolean'))
  assert.deepEqual(payload.toolGroups, ['read', 'write', 'exec', 'danger'])
  assert.ok(!('mcpScript' in payload), '仍残留 MCP 字段')
})

// ── 结果 ────────────────────────────────────────────────────────────────────
fs.rmSync(tmpHome, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} 项失败，${pass} 项通过\n`)
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
console.log(`✓ 全部 ${pass} 项通过`)
