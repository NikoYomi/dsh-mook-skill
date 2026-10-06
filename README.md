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

然后在 DSH 里把它声明成**一个 Cordis 插件实例**，写进 profile 的
`cordis.patch.yml`（Web profile 就是 `${DSH_HOME:-~/.dsh}/profiles/web/cordis.patch.yml`）：

```yaml
- id: mook
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    transport: stdio
    serverName: mook
    command: /usr/bin/node
    args:
      - /绝对路径/dsh-mook-skill/mcp/mook-mcp.js
    env:
      MOOK_URL: "http://192.168.31.199:5866"
      MOOK_API_KEY: "mk_你的密钥"
```

四个要点：

- **`transport: stdio` 必填**。写成 ACP 风格的 `{name, command}` 或漏掉它都会启动失败。
- **是 `serverName` 不是 `name`**（外层的 `id: mook` 才是实例标识）。
- `command` 与 `args` 里的路径**都必须是绝对路径**（`which node` 查出来填）——DSH 擦洗过父进程环境，拿不到 shell 的 PATH。
- `env` 两个变量**必须显式写全**：`dsh-mcp-client` 会剔除父环境里的凭据形状变量，`MOOK_API_KEY` 不能靠外部环境变量兜底。

改完**重启 `dsh web`** 生效，工具会以 `mcp__mook__<工具名>` 注册给模型。

## 第 4 步 · 装设置页（可选，最省事）

前面三步是手工路线。装**宿主半场**后，地址与密钥都能在图形界面里填：

```bash
dsh plugin --profile web add /绝对路径/dsh-mook-skill
```

重启 `dsh web`，打开 **设置 → Mook**，有三张卡：

- **连接** —— 填 Mook 地址，点「测试连接」当场验证
- **API 密钥** —— 密钥存进 dsh 凭据库（`MOOK_API_KEY`），**页面不回显**，可清除
- **MCP 配置** —— 按你填的地址和密钥**生成**第 3 步那段 YAML，点「复制」自己粘进 `cordis.patch.yml`

> 密钥明文：生成的片段里含明文密钥。`dsh-mcp-client` 会擦洗父进程环境，
> 而 Loader 的 `!!js` 是同步求值、`credentials.resolve()` 是异步的，
> 所以没法从凭据库动态注入——这段片段里必然是明文。
> **别把它提交到公开仓库。**

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

## 卸载前请先清除数据

**DSH 卸载插件时只删程序文件，插件自己写的数据不会跟着走。** 想卸载得干净，先在设置页 **设置 → Mook → 「清除全部数据」** 点一下（两段式确认）。

本插件只往两处写数据，都很小：

| 位置 | 内容 |
| --- | --- |
| `$DSH_HOME/storages/mook/config.json` | Mook 地址，约 46 字节 |
| dsh 凭据库的 `MOOK_API_KEY` | API 密钥，与其它凭据加密共存于同一个 `.credentials.yaml` |

点「清除全部数据」会同时删掉这两处；**不动**凭据库里的其它条目。「清除全部数据」是幂等的，重复点不会报错。

技能目录（`$DSH_HOME/skills/mook/`）由 `install.sh` 复制，卸载插件不会删它，需要自己 `rm -rf`。

> 为什么不自动清？cordis 在插件 dispose 时广播的 `internal/plugin` 事件，**「禁用插件」和「卸载插件」走的是同一条路径**，插件无法区分。自动删会在用户只是临时禁用一下时把密钥删掉，所以改成显式按钮。

## 目录结构

```text
dsh-mook-skill/
├── README.md                       # 本文件
├── install.sh                      # 一键安装技能到 DSH 技能根
├── manifest.json                   # 插件元数据
├── package.json                    # DSH 插件包定义（宿主半场 + Web 客户端）
├── cordis.patch.yml                # 装机时把插件挂进 profile
├── locale/
│   ├── en.json                     # 插件显示名与简介（英文）
│   └── zh.json                     # 插件显示名与简介（中文）
├── lib/
│   ├── index.js                    # 宿主半场：设置页的后端路由（/mook/api/*）
│   └── client.js                   # 客户端半场：设置 → Mook 面板
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
| Agent 看不到 mook 工具 | 重启 `dsh web`；确认 `transport: stdio` 在、`serverName: mook` 没写错、`command` 是绝对路径 |
| MCP 条目加了但启动失败 | 最常见是漏了 `transport` 或用了 ACP 形状的 `{name, command}`——见第 3 步 |
| `Cannot find module '@modelcontextprotocol/sdk'` | 在 `mcp/` 里跑 `npm install` |
| 401 `API 密钥无效` | 密钥抄错，或用了别的 Mook 实例的密钥 |
| 403 `密钥缺少权限：X` | 带着 X 重建密钥 |
| 改连不上的服务器要等约 10 秒 | 正常——GET 会触发实时状态采集，SSH 超时 10 秒 |
| 设置里的插件名显示成 `@yoursc/dsh-mook-skill` | 重启 `dsh web`；名字来自 `locale/*.json` 的 `meta.title`，且 `package.json` 的 `exports` 必须放行 `./locale/*` |

完整排错见 [`skills/mook/reference/troubleshooting.md`](skills/mook/reference/troubleshooting.md)。

## 许可

MIT，与 Mook 项目一致。
