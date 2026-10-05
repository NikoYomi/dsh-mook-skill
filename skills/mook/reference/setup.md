# 安装与配置

本插件为 **DeepSeek Harness（DSH）** 验证与支持，提供两种接入方式，**建议两个都装**：

| 方式 | 作用 | 装法 |
| --- | --- | --- |
| **技能（Skill）** | 教 Agent 怎么用：权限、接口、陷阱、安全红线 | 复制 `skills/mook/` 到 DSH 技能根 |
| **MCP 服务器** | 给 Agent 现成的 14 个工具，不用手拼 curl | 在会话级 MCP 配置里声明 |

技能是主路径（DSH 原生支持 `SKILL.md`）；MCP 是增强，让工具调用更结构化。

> 两者都建立在**通用 Agent 插件规范**上（标准 `SKILL.md` 目录束 + 标准 MCP），
> 所以 Claude Desktop / Cursor / Cline 也能用同一份包 —— 但我们只保证 DSH 这条路径。

**先决条件**：Node.js ≥ 18（`node --version` 检查；仅 MCP 方式需要）。

---

## 第 0 步：装技能（DeepSeek 主路径）

```bash
# DSH_HOME 默认指 dsh-data 目录，技能根是它下面的 skills/
cp -r skills/mook "${DSH_HOME:-$HOME/.dsh}/skills/mook"
```

本机（飞牛 199）的实际命令：

```bash
cp -r skills/mook /vol1/@appdata/deepseek.harness/dsh-data/skills/mook
```

**为什么要放这个位置**：DSH 的技能发现器扫描若干「技能根」，其中用户根是
`<DSH_HOME>/skills`。技能必须是**目录束**形态 `<名字>/SKILL.md`，且 `SKILL.md`
**只在技能根的直接子目录下才会被发现** —— 放到更深一层就静默失效。

装完**不用重启**：DSH 会 watch 技能目录，`mook` 会立刻出现在技能清单里。

验证：

```bash
ls "${DSH_HOME:-$HOME/.dsh}/skills/mook/SKILL.md" && echo "OK"
```

然后配置两个环境变量（Agent 靠它们调接口）：

```bash
export MOOK_URL=http://192.168.31.199:5866     # 不要尾斜杠
export MOOK_API_KEY=mk_你的密钥
```

---

## 第 1 步：在 Mook 网页端创建访问密钥

1. 打开 Mook 网页端 → **设置 → 访问密钥**
2. 点 **新建密钥**，填名称（如「我的 DeepSeek」）
3. 勾选权限：

   | 你想要的能力 | 需要的权限 |
   | --- | --- |
   | 只看服务器和命令 | `servers:read`、`commands:read`（默认） |
   | 还要增删改命令 | 加 `commands:write` |
   | 还要增删改服务器 | 加 `servers:write` |
   | 还想在服务器上跑命令、读写文件 | 加 `servers:exec` ⚠️ |

4. 有效期可选 0（永久）/ 7 / 30 / 90 / 365 天
5. **创建后立刻复制那串 `mk_` 开头的密钥** —— 明文只显示这一次，关掉就再也看不到

> ⚠️ `servers:exec` 等于把远程 shell 交出去，默认不勾选。只在你确实需要时开。

---

## 第 2 步：拿到 Mook 地址

就是你在浏览器里打开 Mook 的那个地址，**不要带尾斜杠**：

| 部署方式 | `MOOK_URL` 示例 |
| --- | --- |
| Docker 直连 | `http://192.168.31.199:5866` |
| 走网关 / 反向代理 | `https://mook.example.com` |
| 飞牛应用中心 | `http://<飞牛IP>:<网关端口>/app/mook` |

自测一下：

```bash
curl -s "$MOOK_URL/api/setup/status"
# 期望：{"setup_required":false}
```

---

## 第 3 步：配置 MCP 服务器（可选，推荐）

### 通用配置片段

所有客户端要的都是同一份东西——一个 stdio MCP server 的启动声明：

```json
{
  "mcpServers": {
    "mook": {
      "command": "node",
      "args": ["/绝对路径/dsh-mook-skill/mcp/mook-mcp.js"],
      "env": {
        "MOOK_URL": "http://192.168.31.199:5866",
        "MOOK_API_KEY": "mk_你的密钥"
      }
    }
  }
}
```

两个要点：

- `command` 必须是**绝对路径**。建议用 `which node` 查出来填进去，
  某些 GUI 客户端拿不到 shell 的 PATH。
- `args` 里的脚本路径也必须是绝对路径。

### 各客户端怎么填

**Claude Desktop** —— 编辑配置文件（macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`；
Windows：`%APPDATA%\Claude\claude_desktop_config.json`），把上面的 `mcpServers` 合并进去，重启客户端。

**Cursor** —— `~/.cursor/mcp.json`（或项目内 `.cursor/mcp.json`），格式同上。

**Cline / Roo Code（VS Code）** —— 设置里找到 MCP Servers，用「Edit MCP Settings」，
格式同上。

**Claude Code** ——

```bash
claude mcp add mook --env MOOK_URL=http://192.168.31.199:5866 \
                      --env MOOK_API_KEY=mk_你的密钥 \
                      -- node /绝对路径/dsh-mook-skill/mcp/mook-mcp.js
```

**DeepSeek Harness / 其他 ACP 客户端** —— 在会话级 MCP 配置里声明，字段是
`name` / `command`（绝对路径）/ `args` / `env`：

```json
{
  "name": "mook",
  "command": "/usr/bin/node",
  "args": ["/绝对路径/dsh-mook-skill/mcp/mook-mcp.js"],
  "env": {
    "MOOK_URL": "http://192.168.31.199:5866",
    "MOOK_API_KEY": "mk_你的密钥"
  }
}
```

> 客户端要求 `name` 只能含字母、数字、`_`、`-`（最长 32 字符）。
> 如果客户端还支持 HTTP 型 MCP，本项目目前**只提供 stdio 形态**，请用上面的方式。

### 依赖装在哪？

`mook-mcp.js` 需要 `@modelcontextprotocol/sdk` 和 `zod`。两种做法：

**做法一（推荐）**：在插件目录装一次

```bash
cd /绝对路径/dsh-mook-skill/mcp
npm install --registry=https://registry.npmmirror.com
```

装完 `node_modules/` 就在同目录，客户端启动时能解析到。

**做法二**：如果客户端支持自带依赖的包，也可以 `npm i -g mook-mcp`（若你已发布）。

---

## 第 4 步：验证

### 验证技能被发现（DeepSeek）

在 DSH 里说一句与 Mook 相关的话，例如「查一下 mook 里有哪些服务器」，
Agent 应当自动加载 `mook` 技能。也可以直接检查文件：

```bash
ls "${DSH_HOME:-$HOME/.dsh}/skills/mook/SKILL.md"
```

技能没出现时，按顺序排查：

1. 路径是不是 `<技能根>/mook/SKILL.md`（**不能**更深，如 `skills/mook/mook/SKILL.md`）
2. frontmatter 是否有 `name` 和 `description` 两个必需字段
3. `name` 是不是 kebab-case（只能小写字母、数字、连字符）
4. `SKILL.md` 里有没有 Tab 字符（YAML 不允许缩进用 Tab）

### 验证 MCP 服务器能起来

```bash
cd /绝对路径/dsh-mook-skill/mcp
npm install
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | MOOK_URL=http://192.168.31.199:5866 MOOK_API_KEY=mk_你的密钥 node mook-mcp.js
```

期望看到 `"name":"mook"` 和 14 个工具。**如果密钥缺失会直接退出并报错**，这是有意的。

### 验证权限

让 Agent 说「列出我的服务器」。如果报 403，说明密钥少了权限，回第 1 步重建。

---

## 常见问题

**Agent 说找不到 mook 工具**
- MCP 客户端没重启（改完配置必须重启）
- `command` 不是绝对路径
- `node` 不在客户端进程的 PATH 里

**`Cannot find module '@modelcontextprotocol/sdk'`**
- 忘了在 `dsh-mook-skill/mcp/` 下 `npm install`

**连不上**
- 确认 `MOOK_URL` 不带尾斜杠、Mook 在运行、网络可达
- 用 `curl $MOOK_URL/api/setup/status` 自测

**401 `API 密钥无效`**
- 密钥抄错了，或用了另一个 Mook 实例的密钥

**想改权限 / 延期**
- 密钥权限不可修改，只能撤销后新建
