# dsh-mook-skill —— Mook Agent 插件

让 **DeepSeek Harness** 的 Agent 接管你的 [Mook](https://github.com/NikoYomi/mook) ——
管理托管服务器、在服务器上执行命令、读写文件、编辑常用命令库。

## 前置：Mook ≥ v0.4.0

访问密钥与 `/api/agent/*` 接口是 v0.4.0 引入的。低于这个版本没有 Agent 接口。

## 三步装好

### 第 1 步 · 在 Mook 里建密钥

打开 Mook 网页端 → **设置 → 访问密钥 → 新建密钥**，勾选权限，
**复制那串 `mk_` 开头的密钥**（只显示一次，关掉就再也看不到）。

| 想要的能力 | 勾选的权限 |
| --- | --- |
| 只看服务器和命令 | `servers:read`、`commands:read`（默认） |
| 还要增删改常用命令 | 加 `commands:write` |
| 还要增删改服务器 | 加 `servers:write` |
| 还想跑命令、读写文件 | 加 `servers:exec` ⚠️ |

> `servers:exec` 等于把远程 shell 交出去，**默认不勾选**。只在你确实需要时开。

### 第 2 步 · 装技能（DeepSeek 的主路径）

```bash
git clone https://github.com/NikoYomi/dsh-mook-skill.git
cd dsh-mook-skill
./install.sh                 # 装到 $DSH_HOME/skills（默认 ~/.dsh/skills）
```

脚本只做一件事：把 `skills/mook/` 复制到技能根，并校验层级没放错。想手动装也行：

```bash
# DSH_HOME 默认是 dsh-data 目录，技能根就是它下面的 skills/
cp -r skills/mook "${DSH_HOME:-$HOME/.dsh}/skills/mook"
```

本机（飞牛 199）的实际路径是：

```bash
cp -r skills/mook /vol1/@appdata/deepseek.harness/dsh-data/skills/mook
```

装完 DSH **无需重启**即可发现（技能目录被 watch），`mook` 会出现在技能目录里。

**配置环境变量**（Agent 靠它们调接口）：

```bash
export MOOK_URL=http://192.168.31.199:5866     # 你的 Mook 地址，不要尾斜杠
export MOOK_API_KEY=mk_你的密钥
```

要让 DSH 长期带上这两个变量，写进它的启动环境或 profile。

### 第 3 步 · 装 MCP 工具（可选，但推荐）

技能教 Agent「怎么调」，MCP 给它「现成的工具」。装上后 Agent 不用手拼 curl。

```bash
cd mcp
npm install --registry=https://registry.npmmirror.com
```

然后在 DSH 的会话级 MCP 配置里声明：

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

两个路径**必须是绝对路径**（`which node` 查出来填）。

## 装完是什么样

DSH 会在这些时机自动加载 `mook` 技能：

- 你说「在服务器上跑一下 `df -h`」
- 你说「看看我有哪些服务器」
- 你说「把这条命令存进常用命令」
- 你说「帮我读一下那台机器上的 nginx 配置」

## 提供的 14 个 MCP 工具

| 分类 | 工具 |
| --- | --- |
| 服务器 | `list_servers` · `get_server` · `add_server` · `update_server` · `remove_server` |
| 执行 | `exec_command` |
| 文件 | `list_files` · `read_file` · `write_file` |
| 命令库 | `list_commands` · `save_command` · `update_command` · `delete_command` · `mark_command_used` |

## 权限对照

| 权限 | 覆盖的工具 |
| --- | --- |
| `servers:read` | `list_servers`、`get_server` |
| `servers:write` | `add_server`、`update_server`、`remove_server` |
| `servers:exec` | `exec_command`、`list_files`、`read_file`、`write_file` |
| `commands:read` | `list_commands`、`mark_command_used` |
| `commands:write` | `save_command`、`update_command`、`delete_command` |

权限不足返回 403，**权限不可追加**，只能撤销后带新权限重建密钥。

## 安全

- **`servers:exec` 就是远程 shell**：Agent 能执行 `rm -rf /`。只给信任的 Agent。
- **按用途分密钥**：查询类 Agent 给只读密钥，需要执行的单独一把。
- **设有效期**（30 / 90 天），比永久密钥安全。
- Mook 后端只记录 `key id / 方法 / 路径 / 状态码`，**不记命令内容与文件路径**。
- 密钥泄露立刻去 **设置 → 访问密钥 → 撤销**。

## 目录结构

```text
dsh-mook-skill/
├── README.md                       # 本文件
├── install.sh                      # 一键安装技能到 DSH 技能根
├── manifest.json                   # 插件元数据
├── LICENSE                         # MIT
├── mcp/
│   ├── mook-mcp.js                 # MCP 服务器（stdio，14 个工具）
│   ├── package.json
│   └── README.md
└── skills/
    └── mook/
        ├── SKILL.md                # 技能入口（DSH 标准 frontmatter）
        └── reference/
            ├── setup.md            # 从零安装与配置
            ├── api.md              # 全部接口字段参考
            └── troubleshooting.md  # 排错手册
```

## 排错

| 现象 | 处理 |
| --- | --- |
| 技能目录里没有 `mook` | 检查 `SKILL.md` 是否在 `<技能根>/mook/SKILL.md`（不是嵌套更深） |
| Agent 不会用 | 说「查一下 mook 里有哪些服务器」触发技能加载 |
| Agent 看不到 mook 工具 | 重启 DSH 会话；确认 `command` 是绝对路径 |
| `Cannot find module '@modelcontextprotocol/sdk'` | 在 `mcp/` 里跑 `npm install` |
| 401 `API 密钥无效` | 密钥抄错，或用了别的 Mook 实例的密钥 |
| 403 `密钥缺少权限：X` | 带着 X 重建密钥 |
| 改连不上的服务器要等约 10 秒 | 正常——GET 会触发实时状态采集，SSH 超时 10 秒 |

完整排错见 [`skills/mook/reference/troubleshooting.md`](skills/mook/reference/troubleshooting.md)。

## 许可

MIT，与 Mook 项目一致。
