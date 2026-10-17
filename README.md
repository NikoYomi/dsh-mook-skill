# dsh-mook-skill —— Mook Agent 插件

让 **DeepSeek Harness** 的 Agent 接管你的 [Mook](https://github.com/NikoYomi/mook) ——
管理托管服务器、在服务器上执行命令、读写文件、编辑常用命令库。

**装一个插件就全都有了**：14 个 `mook_*` 工具、`mook` 技能、设置页，全部由同一个包提供。
不再需要单独装 MCP server、也不需要把技能拷到技能根。

## 前置：Mook ≥ v0.4.0

访问密钥与 `/api/agent/*` 接口是 v0.4.0 引入的。低于这个版本没有 Agent 接口。

## 两步装好

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

### 第 2 步 · 装插件

```bash
dsh plugin --profile web add @yoursc/dsh-mook-skill
```

然后**重启 `dsh web`**（插件在 profile 组合树装载时注册，新增插件必须重启一次）。
之后打开 **设置 → Mook**，填地址和密钥即可，工具与技能自动可用。

> 装完不用改 profile 的 `cordis.patch.yml`：`dsh plugin add` 会把包加进
> `dsh.profile.bundles`，包自带的 `cordis.patch.yml` 负责把插件挂进组合树。
> 0.x 版本需要手工粘 MCP 配置，1.0.0 起不再需要。

## 设置页里有什么

**设置 → Mook** 有四张卡，各自独立保存：

| 卡片 | 作用 |
| --- | --- |
| **连接** | 填 Mook 地址，点「测试连接」当场验证（不用先保存） |
| **API 密钥** | 密钥存进 dsh 凭据库（`MOOK_API_KEY`），**页面不回显**，可清除 |
| **工具开关** | 14 个工具按只读 / 写入 / 执行 / 危险四组排列，可逐个或整组开关 |
| **清除全部数据** | 卸载前清掉地址配置与密钥（两段式确认，幂等） |

### 工具开关的默认值

| 分组 | 默认 | 工具 |
| --- | --- | --- |
| 只读 | **开** | `mook_list_servers`、`mook_get_server`、`mook_list_commands` |
| 写入 | **关** | `mook_add_server`、`mook_update_server`、`mook_save_command`、`mook_update_command`、`mook_mark_command_used` |
| 执行 | **关** | `mook_exec_command`、`mook_list_files`、`mook_read_file`、`mook_write_file` |
| 危险 | **关** | `mook_remove_server`、`mook_delete_command`（都要求 `confirm=true`） |

写入与执行默认关闭，是因为它们会**真实改动你的服务器**。建议先只开只读用一段时间，
确认 Agent 的表现符合预期，再逐组打开。开关保存后**即时生效，不需要重启 dsh**。

## 装完是什么样

DSH 会在这些时机自动加载 `mook` 技能：

- 你说「在服务器上跑一下 `df -h`」
- 你说「看看我有哪些服务器」
- 你说「把这条命令存进常用命令」
- 你说「帮我读一下那台机器上的 nginx 配置」

技能里写清了权限对应关系、五个必须知道的陷阱与安全红线；工具由技能指导调用。

## 权限对照

| 权限 | 覆盖的工具 |
| --- | --- |
| `servers:read` | `mook_list_servers`、`mook_get_server` |
| `servers:write` | `mook_add_server`、`mook_update_server`、`mook_remove_server` |
| `servers:exec` | `mook_exec_command`、`mook_list_files`、`mook_read_file`、`mook_write_file` |
| `commands:read` | `mook_list_commands`、`mook_mark_command_used` |
| `commands:write` | `mook_save_command`、`mook_update_command`、`mook_delete_command` |

权限不足返回 403，**权限不可追加**，只能撤销后带新权限重建密钥。

## 安全

- **`servers:exec` 就是远程 shell**：Agent 能执行 `rm -rf /`。只给信任的 Agent，
  并且没用到时把「执行」组关掉。
- **按用途分密钥**：查询类 Agent 给只读密钥，需要执行的单独一把。
- **设有效期**（30 / 90 天），比永久密钥安全。
- Mook 后端只记录 `key id / 方法 / 路径 / 状态码`，**不记命令内容与文件路径**。
- 密钥泄露立刻去 **设置 → 访问密钥 → 撤销**。

## 卸载前请先清除数据

**DSH 卸载插件时只删程序文件，插件自己写的数据不会跟着走。** 想卸载得干净，先在设置页
**设置 → Mook → 「清除全部数据」** 点一下（两段式确认）。

本插件只往两处写数据，都很小：

| 位置 | 内容 |
| --- | --- |
| `$DSH_HOME/storages/mook/config.json` | Mook 地址与工具开关 |
| dsh 凭据库的 `MOOK_API_KEY` | API 密钥，与其它凭据加密共存于同一个 `.credentials.yaml` |

点「清除全部数据」会同时删掉这两处；**不动**凭据库里的其它条目，并且是幂等的。

> 为什么不自动清？cordis 在插件 dispose 时广播的 `internal/plugin` 事件，
> **「禁用插件」和「卸载插件」走的是同一条路径**，插件无法区分。自动删会在用户只是
> 临时禁用一下时把密钥删掉，所以改成显式按钮。

**技能不用手动删**：1.0.0 起技能随插件注册（`ctx.skills.register`），不落地到
`$DSH_HOME/skills`，卸载插件即消失。

## 从 0.x 升级

1.0.0 是破坏性变更，从旧版升级时要注意：

| 变更 | 影响 |
| --- | --- |
| 工具名加前缀 | `mcp__mook__list_servers` → `mook_list_servers`（其余同理） |
| 删除 MCP server | `mcp/` 目录整个移除，**不再需要** `@deepseek-ai/dsh-mcp-client` 实例 |
| 删除 `install.sh` | 技能改为随插件注册，`$DSH_HOME/skills/mook/` 里 **0.x 拷贝的旧副本要手动 `rm -rf`**，否则它会盖住插件内置的技能 |
| 写入/执行类默认关闭 | 升级后要先去设置页打开，否则 Agent 只有只读工具 |
| 删除操作要 `confirm=true` | `mook_remove_server`、`mook_delete_command` 现在必须显式确认 |

升级前请先把 profile `cordis.patch.yml` 里旧的 `id: mook` + `@deepseek-ai/dsh-mcp-client`
那一段**删掉**，否则会同时出现两套 Mook 工具。

## 目录结构

```text
dsh-mook-skill/
├── README.md                       # 本文件
├── manifest.json                   # 插件元数据
├── package.json                    # DSH 插件包定义（宿主半场 + Web 客户端）
├── cordis.patch.yml                # 装机时把插件挂进 profile
├── locale/
│   ├── en.json                     # 插件显示名与简介（英文）
│   └── zh.json                     # 插件显示名与简介（中文）
├── lib/
│   ├── index.js                    # 宿主半场：配置、凭据、工具注册、技能注册、路由
│   ├── tools.js                    # 14 个 mook_* 工具定义
│   └── client.js                   # 客户端半场：设置 → Mook 面板
├── test/
│   └── harness.mjs                 # 自测：工具形状、开关、技能解析（npm test）
├── LICENSE                         # MIT
└── skills/
    └── mook/
        ├── SKILL.md                # 技能入口（打包内嵌，注册成 runtime 技能）
        └── reference/
            ├── setup.md            # 从零安装与配置
            ├── api.md              # 全部接口字段参考
            └── troubleshooting.md  # 排错手册
```

## 排错

| 现象 | 处理 |
| --- | --- |
| 工具列表里没有 `mook_*` | 重启 `dsh web`；然后去设置页确认对应分组开关已打开 |
| 只有三个只读工具 | 正常，写入/执行/危险默认关闭 |
| 设置页里没有 Mook 这一项 | 重启 `dsh web`；确认插件在 `dsh.profile.bundles` 里 |
| 技能没有生效 | 检查 `$DSH_HOME/skills/mook/` 是否有 0.x 留下的旧副本（它会盖住内置技能），有就删掉 |
| 同时出现两套 Mook 工具 | profile `cordis.patch.yml` 里还有旧的 `dsh-mcp-client` 实例，删掉并重启 |
| 401 `API 密钥无效` | 密钥抄错，或用了别的 Mook 实例的密钥 |
| 403 `密钥缺少权限：X` | 带着 X 重建密钥 |
| 404 / `没有返回 JSON` | 飞牛套件版地址少了 `/app/mook` 前缀 |
| 改连不上的服务器要等约 10 秒 | 正常——GET 会触发实时状态采集，SSH 超时 10 秒 |
| 设置里的插件名显示成 `@yoursc/dsh-mook-skill` | 重启 `dsh web`；名字来自 `locale/*.json` 的 `meta.title`，且 `package.json` 的 `exports` 必须放行 `./locale/*` |

完整排错见 [`skills/mook/reference/troubleshooting.md`](skills/mook/reference/troubleshooting.md)。

## 开发

```bash
npm test       # 自测：工具形状、开关注册、技能解析、配置读写（17 项）
npm run check  # 三个 lib 文件的语法检查
```

自测不需要真实 DSH 宿主：`test/harness.mjs` 用假 ctx 驱动插件真身，
并临时指向空的 `DSH_HOME`，不会碰你的真实配置。

## 许可

MIT，与 Mook 项目一致。
