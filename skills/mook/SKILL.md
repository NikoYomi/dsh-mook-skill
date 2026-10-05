---
name: mook
description: Manage the servers and saved commands hosted on a Mook instance through its API-key Agent API. Use when the user mentions Mook, asks to run a command on one of their VPS/servers, wants to list servers or saved commands, or needs to edit the saved command library. Requires MOOK_URL and MOOK_API_KEY.
whenToUse: |
  - 用户提到 Mook、或让你操作他托管在 Mook 上的服务器
  - 用户说"在服务器上跑一下…"、"看看磁盘/内存/负载"、"重启某个服务"
  - 用户要查看、新增、修改、删除常用命令
  - 用户要往服务器上传文件、读日志文件、改配置文件
metadata:
  requires:
    env: [MOOK_URL, MOOK_API_KEY]
    mook: ">=0.4.0"
---

# Mook

Mook 是一个 AI 驱动的自托管 SSH 终端与 VPS 管理工具。本技能让你（Agent）通过**访问密钥**调用
Mook 的 `/api/agent/*` 接口，管理用户托管在 Mook 上的服务器、在上面执行命令、读写文件，
以及增删改查用户的常用命令库。

## 0. 前置条件：两个环境变量

调用任何接口前必须先确认：

| 变量 | 含义 | 示例 |
| --- | --- | --- |
| `MOOK_URL` | Mook 实例地址（**不要带尾斜杠**） | `http://192.168.31.199:5866` |
| `MOOK_API_KEY` | 访问密钥，`mk_` 开头，共 51 字符 | `mk_8514...` |

密钥在 Mook 网页端 **设置 → 访问密钥 → 新建密钥** 生成。**明文只在创建时显示一次**，
必须当场复制保存；丢失只能撤销重建。

如果这两个变量缺失，**不要猜测地址**，直接告诉用户去创建密钥并配置环境变量。
可以参考 `reference/setup.md` 的完整安装步骤。

## 1. 先查权限，再动手

密钥带**权限范围（scope）**，共 5 种：

| 权限 | 能做什么 | 危险度 |
| --- | --- | --- |
| `servers:read` | 查看服务器列表与详情（含实时监控） | 低 |
| `servers:write` | 新建 / 修改 / 删除服务器 | 中 |
| `servers:exec` | **在服务器上执行命令、读写远程文件** | **高** |
| `commands:read` | 查看常用命令库 | 低 |
| `commands:write` | 新建 / 修改 / 删除常用命令 | 中 |

权限不足时接口返回 **403** `{"error":"密钥缺少权限：servers:exec"}`。
遇到 403 不要重试，直接告诉用户需要补哪一项权限（需要重新创建密钥）。

## 2. 接口速查

所有请求都带认证头：

```bash
-H "Authorization: Bearer $MOOK_API_KEY"
# 等价写法：-H "X-API-Key: $MOOK_API_KEY"
```

### 服务器

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/agent/servers` | `servers:read` | 列表；**不含任何凭据** |
| GET | `/api/agent/servers/{id}` | `servers:read` | 详情 + 实时 stats（CPU/内存/磁盘/负载） |
| POST | `/api/agent/servers` | `servers:write` | 新建 |
| PUT | `/api/agent/servers/{id}` | `servers:write` | **全量更新**——见下方陷阱 |
| DELETE | `/api/agent/servers/{id}` | `servers:write` | 删除 |

### 执行与文件

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/agent/servers/{id}/exec` | `servers:exec` | 执行命令，body `{command, timeout_sec}` |
| GET | `/api/agent/servers/{id}/files?path=/` | `servers:exec` | 列目录 |
| GET | `/api/agent/servers/{id}/files/read?path=/etc/hosts` | `servers:exec` | 读文件（上限 1 MiB，超出带 `truncated:true`） |
| POST | `/api/agent/servers/{id}/files/write` | `servers:exec` | 写文件，body `{path, content}` |

### 常用命令

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/agent/commands` | `commands:read` | 列表 |
| POST | `/api/agent/commands` | `commands:write` | 新建，body `{name, command, category, pinned}` |
| PUT | `/api/agent/commands/{id}` | `commands:write` | 更新（只需传要改的字段） |
| DELETE | `/api/agent/commands/{id}` | `commands:write` | 删除 |
| POST | `/api/agent/commands/{id}/use` | `commands:read` | 使用次数 +1 |

完整字段定义见 `reference/api.md`。

## 3. 四个必须知道的陷阱

### 陷阱一：`PUT /servers/{id}` 是全量替换

后端会把请求体当作**完整对象**处理，没传的字段会被清空。所以更新前**必须先 GET 拿当前值再合并**：

```bash
# 正确做法
cur=$(curl -s -H "Authorization: Bearer $MOOK_API_KEY" "$MOOK_URL/api/agent/servers/1")
# 取出 name/host/port/username/auth_type/tags，改掉要改的，再整体 PUT 回去
```

用 MCP 的 `update_server` 工具时这步合并已经内建，直接传要改的字段即可。

**凭据特殊**：`password`/`private_key` 留空表示**保持不变**（复用库里的密文）。所以合并时
不要把这两个字段原样带上，除非确实要改密码。

**顺带一提**：GET 单台服务器会触发实时状态采集，对连不上的机器会阻塞约 **10 秒**
（SSH 超时）。所以 `update_server` 一台不可达的机器时，整个调用也要约 10 秒才返回 ——
这是正常等待，不是卡死。

### 陷阱二：exec 超时不是硬夹取

`timeout_sec` 的语义是：

| 你传的值 | 实际生效 |
| --- | --- |
| ≤ 0（含负数、0） | **重置为默认 60**（不是夹到 1） |
| 1 – 600 | 按原值 |
| > 600 | 夹到 **600** |

超时返回的错误信息是 `命令执行超时`，且实测会比设定值多约 2 秒宽限。

### 陷阱三：命令失败也是 HTTP 200

`exec` 在命令本身返回非零退出码时，**仍返回 200**，但 body 里的 `ok` 是 `false`，
并带真实 stderr：

```json
{"ok": false, "output": "...", "error": "..."}
```

**判断成功与否要看 `ok` 字段，不能只看 HTTP 状态码。**

### 陷阱四：日志与隐私

Mook 侧只记录 `key id / 方法 / 路径 / 状态码`，**不记命令内容和文件路径**。
但你自己在对话里展示命令输出时要注意：输出里可能有用户的敏感信息，别原样复述给无关方。

## 4. 安全红线

- **`servers:exec` 等于远程 shell**：执行任何破坏性命令（`rm`、`dd`、`mkfs`、重启服务、
  改防火墙、动 `/etc`）前，**必须先向用户说明要做什么并取得确认**。
- **不要擅自执行用户没要求的东西**。用户说"看看磁盘"，就跑 `df -h`，不要顺手 `apt upgrade`。
- **读写文件要确认路径**。写文件会覆盖，`files/write` 没有备份。
- **不要把密钥写进任何会提交的文件**（脚本、README、日志）。
- 密钥如果泄露，让用户立刻去 **设置 → 访问密钥** 撤销。

## 5. 排错对照表

| 现象 | 原因与处理 |
| --- | --- |
| 401 `缺少 API 密钥` | 没带 `Authorization` / `X-API-Key` 头 |
| 401 `API 密钥无效` | 密钥打错，或指向了别的 Mook 实例的密钥 |
| 401 `API 密钥已撤销` | 密钥被撤销，需要新建 |
| 401 `API 密钥已过期` | 超过有效期，需要新建 |
| 403 `密钥缺少权限：X` | 权限不足，需要带 X 重建密钥 |
| 404 `服务器不存在` | id 写错，先 `GET /api/agent/servers` 确认 |
| 502 | 连不上目标服务器（网络/认证/端口），检查 `host`/`port`/凭据 |
| `命令执行超时` | 调大 `timeout_sec`（上限 600），或让命令后台跑 |
| 连不上 `MOOK_URL` | 确认地址、端口、Mook 是否在运行；注意别加尾斜杠 |

更详细的排错见 `reference/troubleshooting.md`。

## 6. 参考文件

- `reference/setup.md` —— 从零安装：装 Node、建密钥、配置各客户端
- `reference/api.md` —— 全部接口的请求/响应字段
- `reference/troubleshooting.md` —— 排错手册
