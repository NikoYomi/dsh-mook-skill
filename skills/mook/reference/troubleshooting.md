# 排错手册

## 一、认证类（401）

错误信息是精确的，直接对号入座：

| 响应 | 根因 | 处理 |
| --- | --- | --- |
| `缺少 API 密钥` | 请求没带 `Authorization: Bearer` 或 `X-API-Key` 头 | 检查头是否拼错、env 是否传到进程里 |
| `API 密钥无效` | 密钥字符串不对 | 重新从网页端复制；注意别漏字符（应为 `mk_` + 48 位十六进制 = 51 字符） |
| `API 密钥已撤销` | 密钥被撤销了 | 网页端新建 |
| `API 密钥已过期` | 超过有效期 | 网页端新建 |

Mook **刻意不区分**「密钥不存在」和「密钥不匹配」，两者都返回 `API 密钥无效`，
以防攻击者用错误信息探测密钥是否有效。

### 快速自测

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $MOOK_API_KEY" \
  "$MOOK_URL/api/agent/commands"
```

- `200` → 认证通过
- `401` → 密钥问题
- `403` → 权限问题
- `000` → 根本连不上

---

## 二、权限类（403）

响应形如 `{"error":"密钥缺少权限：servers:exec"}`。

**权限不能事后追加**，必须带着需要的权限重新创建密钥。所以要一次想清楚：

| 想做的事 | 至少要有的权限 |
| --- | --- |
| 列服务器、看实时状态 | `servers:read` |
| 加 / 改 / 删服务器 | `servers:write` |
| 在服务器上执行命令 | `servers:exec` |
| 列目录、读文件、写文件 | `servers:exec` |
| 看常用命令 | `commands:read` |
| 加 / 改 / 删常用命令 | `commands:write` |
| 点「使用」某条命令（计数 +1） | `commands:read` |

注意：**文件操作要的是 `servers:exec`，不是 `servers:write`**，这是容易搞错的地方。

---

## 三、连接类（502 / 连不上）

### Mook 自己连不上（`MOOK_URL` 打不通）

```bash
curl -v "$MOOK_URL/api/setup/status"
```

- 检查地址有没有多写 `/`（`http://host:5866/` 尾斜杠在某些客户端会拼出 `//api/...`）
- Mook 容器在跑吗：`docker ps | grep mook`
- 端口通吗：`nc -zv <host> <port>`

### Mook 连不上目标服务器（502）

这是 Mook 去拨 SSH 失败，与你的网络无关。检查：

- 服务器 `host` / `port` 填对了吗（`GET /api/agent/servers/{id}`）
- 凭据对不对（密码或私钥）—— 注意凭据**永远不会回显**，看不出对错，只能改一次试试
- 目标机 sshd 在跑、防火墙放行、没被 fail2ban 封

**Docker 部署的一个坑**：Mook 容器在 bridge 网络里时，`127.0.0.1` 指的是**容器自己**，
不是宿主机。要连宿主机的服务得用 bridge 网关地址（通常是 `172.17.0.1`）。

---

## 四、执行类

### `命令执行超时`

设定的 `timeout_sec` 到了。注意语义不是简单夹取：

| 你传的值 | 实际生效 |
| --- | --- |
| ≤ 0（含负数、0） | **重置为默认 60** |
| 1 – 600 | 按原值 |
| > 600 | 夹到 **600** |

另外实测会比设定值多约 **2 秒**宽限。长任务建议：
`nohup cmd > /tmp/out.log 2>&1 &` 后台跑，再用 `read_file` 取日志。

### 返回 200 但命令失败了

这是**设计如此**。命令非零退出码时 HTTP 仍是 200：

```json
{ "ok": false, "output": "...", "error": "..." }
```

**必须看 `ok` 字段。** 典型误判：`systemctl restart nginx` 失败，Agent 因为看到 200
就报告"重启成功"。

### 输出被截断了

`output` 是完整输出，但**读文件**上限 1 MiB。大文件用
`exec` 跑 `tail -c 100000 /var/log/x` 之类的方式取片段。

---

## 五、更新服务器时的坑

`PUT /api/agent/servers/{id}` 是**全量替换**。只传要改的字段会把其他字段清空。

### 正确姿势

```bash
# 1. 先拿当前值
curl -s -H "Authorization: Bearer $MOOK_API_KEY" \
  "$MOOK_URL/api/agent/servers/1" | jq '.server'
# 2. 在结果上改，然后整体 PUT 回去（包含 id 之外的字段）
# 3. password / private_key 留空字符串 → 保持原凭据不变
```

MCP 的 `update_server` 工具已经内建了这个「先 GET 再合并」的逻辑，直接用即可。

### ⚠️ 更新不可达的服务器会卡约 10 秒

`GET /api/agent/servers/{id}` 会**顺带做一次实时状态采集**。如果那台机器连不上
（网络不通、已下线），采集会一直等到 SSH 的 10 秒超时。

因为 `update_server` 内部要先 GET，**改一台连不上的服务器时整个调用会耗时约 10 秒**
才返回。这不是卡死，是正常的超时等待。修改机器信息（比如改错的主机名）时要有心理准备，
别以为 Agent 挂了。

对称地，`get_server` 对连不上的机器同样会等约 10 秒，且返回结果里**不会有 `stats` 字段**。

### 对称地，命令是部分更新

`PUT /api/agent/commands/{id}` 与之相反：只传要改的字段，空字符串会被忽略。
`pinned` 例外——只要出现在 body 里就会被应用（含 `false`），所以想置顶要显式传 `true`。

---

## 六、MCP 客户端类

| 现象 | 处理 |
| --- | --- |
| 工具列表里没有 mook 的工具 | 重启客户端；确认 `command` 是绝对路径 |
| `Cannot find module '@modelcontextprotocol/sdk'` | 在 `mcp/` 目录跑 `npm install` |
| 启动即退出、stderr 报 `请设置 MOOK_URL` | `env` 没传进去，检查配置的 `env` 块 |
| `mcpServers contains duplicate normalized name` | 配了两个同名的 server，改名 |
| server 名字被加了随机后缀 | 名字含非法字符，只能用字母数字 `_` `-` |
| 工具报 `fetch failed` | `MOOK_URL` 不可达 |

### 手工验证 MCP 能起来

```bash
cd /绝对路径/dsh-mook-skill/mcp
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"p","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | MOOK_URL=http://127.0.0.1:5866 MOOK_API_KEY=mk_test node mook-mcp.js
```

期望第一行是 `initialize` 的响应（`"name":"mook"`），之后是 14 个工具的列表。

> stderr 上的日志是正常的（这个 server 把 stdout 全留给 MCP 协议）。

---

## 七、安全提醒

- **`servers:exec` = 远程 shell**。给 Agent 这个权限前想清楚：它能 `rm -rf /`。
- 密钥泄露立刻去 **设置 → 访问密钥 → 撤销**。
- 别把密钥提交进 git、别写进日志、别贴进公开对话。
  本项目后端也只记录 `key id / 方法 / 路径 / 状态码`，**不记命令内容与文件路径**。
- 定期检查「最近使用」时间，发现陌生调用立刻撤销。
