---
name: mook
description: Manage the servers and saved commands hosted on a Mook instance through its mook_* tools. Use when the user mentions Mook, asks to run a command on one of their VPS/servers, wants to list servers or saved commands, or needs to edit the saved command library. Requires the Mook plugin to be installed and configured (settings → Mook).
whenToUse: |
  - 用户提到 Mook、或让你操作他托管在 Mook 上的服务器
  - 用户说"在服务器上跑一下…"、"看看磁盘/内存/负载"、"重启某个服务"
  - 用户要查看、新增、修改、删除常用命令
  - 用户要往服务器上传文件、读日志文件、改配置文件
metadata:
  requires:
    plugin: "@yoursc/dsh-mook-skill"
    mook: ">=0.4.0"
---

# Mook

Mook 是一个 AI 驱动的自托管 SSH 终端与 VPS 管理工具。本技能让你（Agent）管理用户托管在
Mook 上的服务器、在上面执行命令、读写文件，以及增删改查用户的常用命令库。

## 0. 先确认工具可用

本插件（1.0.0 起）把 Mook 的接口包装成 **14 个 `mook_*` 工具**，直接注册在宿主进程里。
调用前先确认它们在本轮工具列表里：

| 分组 | 工具 |
| --- | --- |
| 只读 | `mook_list_servers` · `mook_get_server` · `mook_list_commands` |
| 写入 | `mook_add_server` · `mook_update_server` · `mook_save_command` · `mook_update_command` · `mook_mark_command_used` |
| 执行 | `mook_exec_command` · `mook_list_files` · `mook_read_file` · `mook_write_file` |
| 危险 | `mook_remove_server` · `mook_delete_command`（需 `confirm=true`） |

**工具不在 ≠ 插件坏了**：只有「只读」组默认开启，其余三组要用户在
**设置 → Mook → 工具开关**里打开。遇到这种情况，告诉用户需要开启哪一组，
**不要**改用 curl 直接打接口来绕过开关。

连接信息（地址与密钥）由插件自己管理，用户已在设置页填好。**不要去猜地址、
不要索取密钥、不要读环境变量** —— 这些工具不需要你关心连接细节。

## 1. 先查权限，再动手

密钥带**权限范围（scope）**，共 5 种：

| 权限 | 能做什么 | 对应工具 | 危险度 |
| --- | --- | --- | --- |
| `servers:read` | 查看服务器列表与详情（含实时监控） | `mook_list_servers`、`mook_get_server` | 低 |
| `servers:write` | 新建 / 修改 / 删除服务器 | `mook_add_server`、`mook_update_server`、`mook_remove_server` | 中 |
| `servers:exec` | **在服务器上执行命令、读写远程文件** | `mook_exec_command`、`mook_*_file(s)` | **高** |
| `commands:read` | 查看常用命令库 | `mook_list_commands`、`mook_mark_command_used` | 低 |
| `commands:write` | 新建 / 修改 / 删除常用命令 | `mook_save_command`、`mook_update_command`、`mook_delete_command` | 中 |

权限不足时工具会报 **403** `密钥缺少权限：servers:exec`。
遇到 403 不要重试，直接告诉用户需要补哪一项权限（需要重新创建密钥）。

## 2. 典型用法

```
mook_list_servers()                          # 先拿到服务器 id
mook_get_server(server_id=1)                 # 看实时状态
mook_exec_command(server_id=1, command="df -h")
mook_read_file(server_id=1, path="/etc/nginx/nginx.conf")
mook_list_commands()
```

底层接口与请求字段见 `reference/api.md`（需要排查工具行为时才用得上）。

## 3. 五个必须知道的陷阱

### 陷阱一：`mook_update_server` 是全量替换（工具已替你合并）

后端 `PUT /servers/{id}` 会把请求体当作**完整对象**处理，没传的字段会被清空。
`mook_update_server` 已内建「先 GET 当前值再合并」，所以只要传要改的字段即可。

**凭据特殊**：`password` / `private_key` 留空表示**保持不变**（复用库里的密文）。
所以不要原样带上这两个字段，除非确实要改密码。

**顺带一提**：GET 单台服务器会触发实时状态采集，对连不上的机器会阻塞约 **10 秒**
（SSH 超时）。所以 `mook_update_server` 一台不可达的机器时，整个调用也要约 10 秒才返回
—— 这是正常等待，不是卡死。

### 陷阱二：exec 超时不是硬夹取

`timeout_sec` 的语义是：

| 你传的值 | 实际生效 |
| --- | --- |
| ≤ 0（含负数、0） | **重置为默认 60**（不是夹到 1） |
| 1 – 600 | 按原值 |
| > 600 | 夹到 **600** |

超时返回的错误信息是 `命令执行超时`，且实测会比设定值多约 2 秒宽限。
要跑更久的命令，用 `nohup ... &` 放后台再读日志。

### 陷阱三：命令失败也是 HTTP 200

`mook_exec_command` 在命令本身返回非零退出码时，**工具仍算调用成功**，但返回体里
`ok` 是 `false`，并带真实 stderr：

```json
{"ok": false, "output": "...", "error": "..."}
```

**判断成功与否要看返回的 `ok` 字段，不能只看工具有没有报错。**

### 陷阱四：日志与隐私

Mook 侧只记录 `key id / 方法 / 路径 / 状态码`，**不记命令内容和文件路径**。
但你在对话里展示命令输出时要注意：输出里可能有用户的敏感信息，别原样复述给无关方。

### 陷阱五：飞牛套件版地址要带前缀

飞牛应用中心安装的 Mook 走统一网关，设了 `MOOK_BASE_PATH=/app/mook`，因此**只认带
前缀的路径**。地址要写 `http://<飞牛IP>:<端口>/app/mook`；只写到端口会拿到
`404 page not found`。

Mook v0.4.5 及以后直连端口同时接受两种写法，但带前缀在所有版本通用。
地址由用户在设置页填写，**你不需要改它**；只是在用户报 404 时知道该提示他什么。

## 4. 安全红线

- **`servers:exec` 等于远程 shell**：执行任何破坏性命令（`rm`、`dd`、`mkfs`、重启服务、
  改防火墙、动 `/etc`）前，**必须先向用户说明要做什么并取得确认**。
- **不要擅自执行用户没要求的东西**。用户说"看看磁盘"，就跑 `df -h`，不要顺手 `apt upgrade`。
- **读写文件要确认路径**。`mook_write_file` 会整体覆盖，没有备份。
- **删除工具必须显式确认**：`mook_remove_server` / `mook_delete_command` 要求传
  `confirm=true`。只有在用户**明确要求删除**时才传，且要说明删的是什么。
- **不要把密钥写进任何会提交的文件**（脚本、README、日志）。
- 密钥如果泄露，让用户立刻去 **设置 → 访问密钥** 撤销。

## 5. 排错对照表

| 现象 | 原因与处理 |
| --- | --- |
| 工具列表里没有 `mook_*` | 插件没装 / 没重启 dsh web；或用户把对应分组关掉了 |
| 只有只读工具 | 正常：写入、执行、危险三组默认关闭 |
| 401 `API 密钥无效` | 密钥打错，或指向了别的 Mook 实例的密钥 |
| 401 `API 密钥已撤销/已过期` | 密钥失效，需要新建 |
| 403 `密钥缺少权限：X` | 权限不足，需要带 X 重建密钥 |
| 404 `服务器不存在` | id 写错，先 `mook_list_servers` 确认 |
| 404 `没有返回 JSON` / 地址提示 | 飞牛套件版少了 `/app/mook` 前缀 |
| 502 | 连不上目标服务器（网络/认证/端口），检查 `host`/`port`/凭据 |
| `命令执行超时` | 调大 `timeout_sec`（上限 600），或让命令后台跑 |
| 连不上 Mook | 确认地址、端口、Mook 是否在运行；注意别加尾斜杠 |

更详细的排错见 `reference/troubleshooting.md`。

## 6. 参考文件

- `reference/setup.md` —— 从零安装：建密钥、装插件、设置页配置
- `reference/api.md` —— 全部接口的请求/响应字段
- `reference/troubleshooting.md` —— 排错手册
