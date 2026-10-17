# 安装与配置

本插件为 **DeepSeek Harness（DSH）** 验证与支持。**装一个插件就够了** —— 它同时提供：

| 部分 | 作用 | 装法 |
| --- | --- | --- |
| **14 个工具** | Agent 直接调用 Mook 接口，不用手拼 curl | 自动（`ctx.tools.register`） |
| **技能（Skill）** | 教 Agent 怎么用：权限、陷阱、安全红线 | 自动（`ctx.skills.register`，读包内 `SKILL.md`） |
| **设置页** | 填地址与密钥、逐个开关工具 | 自动（`/mook/api/*`） |

**先决条件**：Mook ≥ v0.4.0；DSH ≥ 0.1.5；Node.js ≥ 20（DSH 自带）。

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

## 第 2 步：装插件

```bash
dsh plugin --profile web add @yoursc/dsh-mook-skill
```

从源码目录装也行：

```bash
dsh plugin --profile web add /绝对路径/dsh-mook-skill
```

然后**重启 `dsh web`**。插件是在 profile 组合树装载时注册的，新增插件必须重启一次；
之后改设置页里的任何内容只需刷新页面。

> **不需要**手动编辑 profile 的 `cordis.patch.yml`。`dsh plugin add` 已把包加进
> `dsh.profile.bundles`，包自带的 `cordis.patch.yml` 会把插件挂进组合树。
> 0.x 版本要求手工粘 MCP 配置，1.0.0 起这件事被彻底去掉了。

---

## 第 3 步：在设置页填地址与密钥

打开 **设置 → Mook**，四张卡各自保存：

### 连接

填 Mook 地址，**不要带尾斜杠**：

| 部署方式 | 地址示例 |
| --- | --- |
| Docker 直连 | `http://192.168.31.199:5866` |
| 走网关 / 反向代理 | `https://mook.example.com` |
| 飞牛套件版（应用中心安装） | `http://<飞牛IP>:<端口>/app/mook` ← **注意带前缀** |

> ⚠️ **飞牛套件版要带 `/app/mook` 前缀。**
> 套件版设了 `MOOK_BASE_PATH=/app/mook`（统一网关需要它），Mook 因此只认带前缀的
> 路径；填 `http://<飞牛IP>:<端口>` 会得到 `404 page not found`。
>
> 例外：**Mook v0.4.5 及以后**在直连端口上同时接受带前缀与不带前缀两种写法。
> 带前缀的写法在**所有版本**上都有效，所以建议一律带上。

填好点 **「测试连接」** —— 它会**直接用你正在编辑的地址**，不必先保存。

### API 密钥

粘贴 `mk_` 开头的密钥，点「保存密钥」。密钥写进 dsh 凭据库（`MOOK_API_KEY`），
**页面永不回显**，只显示状态徽标（已配置 / 未配置 / 来自环境变量）。

若密钥来自只读来源（例如启动 dsh web 时设的环境变量 `MOOK_API_KEY`），输入框会置灰。
想改成在页面里管理，就去掉那个环境变量并重启。

### 工具开关

14 个工具分四组，见下一节。**保存即时生效，不需要重启 dsh。**

### 清除全部数据

卸载前点一下，见文末。

---

## 第 4 步：验证

### 验证工具已注册

在 DSH 里说「列出 Mook 里有哪些服务器」。Agent 应该调用 `mook_list_servers`。

看不到 `mook_*` 工具时，按顺序排查：

1. 重启 `dsh web` 了没有
2. 插件是否在 profile 的 `dsh.profile.bundles` 里
3. **是否只看到三个只读工具** —— 那是正常的，写入/执行/危险三组默认关闭，
   去 **设置 → Mook → 工具开关** 打开

### 验证技能已加载

说一句与 Mook 相关的话（如「查一下 mook 里有哪些服务器」），Agent 应自动加载 `mook` 技能。

**技能没生效时先查一件事**：`$DSH_HOME/skills/mook/` 里是否有 0.x 时代用 `install.sh`
拷贝的**旧副本**。技能发现器里项目级/文件系统技能优先于插件注册的 runtime 技能，
旧副本会盖住内置版本 —— 删掉它。

### 验证权限

让 Agent 执行一次实际操作。如果报 403，说明密钥少了权限，回第 1 步重建。

---

## 工具分组与默认值

| 分组 | 默认 | 工具 | 说明 |
| --- | --- | --- | --- |
| 只读 | **开** | `mook_list_servers`、`mook_get_server`、`mook_list_commands` | 看服务器与命令库 |
| 写入 | **关** | `mook_add_server`、`mook_update_server`、`mook_save_command`、`mook_update_command`、`mook_mark_command_used` | 改服务器与命令库 |
| 执行 | **关** | `mook_exec_command`、`mook_list_files`、`mook_read_file`、`mook_write_file` | ⚠️ 远程 shell 与文件读写 |
| 危险 | **关** | `mook_remove_server`、`mook_delete_command` | 删除，且必须传 `confirm=true` |

写入与执行默认关闭，是因为它们会**真实改动你的服务器**。建议先只开只读用一段时间，
确认 Agent 的表现符合预期，再逐组打开。

---

## 常见问题

**Agent 说找不到 mook 工具**
- 没重启 `dsh web`
- 对应分组被关掉了（设置页看一下）

**只有三个工具**
- 正常，写入/执行/危险默认关闭

**同时出现两套 Mook 工具**
- profile `cordis.patch.yml` 里还留着 0.x 的 `@deepseek-ai/dsh-mcp-client` 实例，
  删掉那一段并重启

**连不上**
- 确认地址不带尾斜杠、Mook 在运行、网络可达
- 用 `curl "$MOOK_URL/api/setup/status"` 自测，期望 `{"setup_required":false}`

**401 `API 密钥无效`**
- 密钥抄错了，或用了另一个 Mook 实例的密钥

**想改权限 / 延期**
- 密钥权限不可修改，只能撤销后新建

---

## 卸载插件前

DSH 卸载插件时**只删程序文件**，插件自己写的数据不会跟着走。卸载前请在
**设置 → Mook → 「清除全部数据」** 点一下（两段式确认，可重复点）。

清除范围：

| 位置 | 内容 |
| --- | --- |
| `$DSH_HOME/storages/mook/config.json` | Mook 地址与工具开关 |
| dsh 凭据库的 `MOOK_API_KEY` | API 密钥，与其它凭据加密共存于同一个 `.credentials.yaml` |

**不会动**凭据库中的其它条目。

**技能不用删**：1.0.0 起技能随插件注册，不落地到 `$DSH_HOME/skills`，卸载即消失。
（0.x 用 `install.sh` 拷过的话，那份旧副本要自己 `rm -rf`。）

插件**无法自动清理**：cordis 在插件 dispose 时广播 `internal/plugin` 事件，而「禁用插件」
与「卸载插件」走的是同一条路径，插件分不出来；自动删会在用户只是临时禁用一下时误删密钥。
