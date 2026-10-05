# Mook Agent API 参考

所有接口都挂在 `/api/agent/` 下，认证头二选一：

```
Authorization: Bearer mk_xxxxxxxx...
X-API-Key: mk_xxxxxxxx...
```

请求体是 JSON，响应体也是 JSON。失败时统一返回 `{"error": "中文错误信息"}`。

---

## 服务器

### GET `/api/agent/servers`

权限 `servers:read`。返回：

```json
{
  "servers": [
    {
      "id": 1,
      "name": "生产机",
      "host": "192.168.31.50",
      "port": 22,
      "username": "root",
      "auth_type": "password",
      "tags": ["生产", "华东"]
    }
  ],
  "count": 1
}
```

**永远不含密码或私钥。**

### GET `/api/agent/servers/{id}`

权限 `servers:read`。比列表多一个 `stats` 字段（实时采集，采集失败时该字段不出现）：

```json
{
  "server": { "id": 1, "name": "生产机", "host": "...", "port": 22,
              "username": "root", "auth_type": "password", "tags": [] },
  "stats": {
    "latency_ms": 75,
    "cores": 4,
    "cpu_percent": 12.5,
    "load1": 3.18, "load5": 2.9, "load15": 2.4,
    "mem_total": 8394121216, "mem_used": 3221225472,
    "disk_total": 107374182400, "disk_used": 53687091200,
    "ts": 1791193977
  }
}
```

id 不存在返回 **404** `服务器不存在`。

### POST `/api/agent/servers`

权限 `servers:write`。请求体：

```json
{
  "name": "新机器",
  "host": "10.0.0.5",
  "port": 22,
  "username": "root",
  "auth_type": "password",
  "password": "......",
  "private_key": "",
  "tags": ["测试"]
}
```

- `name` 与 `host` 必填，否则 400。
- `port` 缺省 22，`username` 缺省 `root`，`auth_type` 缺省 `password`，只接受 `password` 或 `key`。
- `auth_type` 为 `key` 时用 `private_key`。
- 两者都没填返回 `请填写密码或私钥`。

响应：`{"server": {...}}`

### PUT `/api/agent/servers/{id}`

权限 `servers:write`。**全量替换语义**——请求体与 POST 相同，未传的字段会被置空。
更新前必须先 GET 当前值再合并。

`password` / `private_key` **留空表示保持原凭据不变**。

响应：`{"server": {...}}`

### DELETE `/api/agent/servers/{id}`

权限 `servers:write`。响应：`{"ok": true}`

---

## 执行

### POST `/api/agent/servers/{id}/exec`

权限 `servers:exec`。请求体：

```json
{ "command": "df -h", "timeout_sec": 60 }
```

- `timeout_sec` 缺省 **60**。语义不是简单夹取：
  传 ≤ 0 会被**重置为默认 60**；传 > 600 会被夹到 **600**；1–600 之间按原值。

成功响应：

```json
{ "ok": true, "output": "...", "timeout": 60 }
```

**命令返回非零退出码时仍是 HTTP 200**，但：

```json
{ "ok": false, "output": "...", "error": "...", "timeout": 60 }
```

超时错误信息为 `命令执行超时`。
连不上目标机返回 **502**。

**判断成功要看 `ok` 字段。**

---

## 文件

### GET `/api/agent/servers/{id}/files?path=/`

权限 `servers:exec`。返回：

```json
{
  "path": "/",
  "entries": [
    { "name": "etc", "path": "/etc", "is_dir": true,
      "size": 4096, "mod_time": "2026-01-01T00:00:00Z", "mode": "-rwxr-xr-x" }
  ]
}
```

### GET `/api/agent/servers/{id}/files/read?path=/etc/hosts`

权限 `servers:exec`。**上限 1 MiB**，超出时截断并把 `truncated` 设为 `true`：

```json
{ "path": "/etc/hosts", "content": "...", "size": 209, "truncated": false }
```

### POST `/api/agent/servers/{id}/files/write`

权限 `servers:exec`。请求体：

```json
{ "path": "/tmp/note.txt", "content": "内容" }
```

响应：`{"ok": true, "path": "/tmp/note.txt", "bytes": 6}`

**会直接覆盖目标文件，没有备份。**

---

## 常用命令

命令对象结构：

```json
{
  "id": "cmd-1791193977248312770",
  "name": "查看磁盘占用",
  "command": "df -h",
  "category": "运维",
  "sort_order": 0,
  "usage_count": 0,
  "pinned": true
}
```

### GET `/api/agent/commands`

权限 `commands:read`。返回 `{"commands": [...], "count": N}`
排序规则：置顶优先 → 使用次数 → 添加顺序。

### POST `/api/agent/commands`

权限 `commands:write`。请求体：

```json
{ "name": "查看磁盘占用", "command": "df -h", "category": "运维", "pinned": true }
```

- `name`、`command` 必填，否则报 `命令名称与内容不能为空`。
- `id` 由服务端生成（`cmd-<纳秒时间戳>`），排到列表末尾。

响应：`{"command": {...}}`

### PUT `/api/agent/commands/{id}`

权限 `commands:write`。请求体同上。**只需传要修改的字段**（这是与 servers 不同的部分更新语义）：

- 空字符串字段会被忽略、保持原值。
- 布尔字段 `pinned` 只要出现在 body 里就会被应用（包括 `false`）。

响应：`{"command": {...}}`

### DELETE `/api/agent/commands/{id}`

权限 `commands:write`。响应：`{"ok": true}`

### POST `/api/agent/commands/{id}/use`

权限 `commands:read`。使用次数 +1。响应：`{"ok": true}`

---

## 状态码总表

| 码 | 含义 |
| --- | --- |
| 200 | 成功（注意 exec 的 `ok:false` 也算 200） |
| 400 | 请求体不合法 |
| 401 | `缺少 API 密钥` / `API 密钥无效` / `API 密钥已撤销` / `API 密钥已过期` |
| 403 | `密钥缺少权限：<scope>` |
| 404 | 资源不存在 |
| 502 | 目标服务器连不上（网络 / 认证 / 端口） |

---

## 刻意不开放的接口

以下接口**只有浏览器会话（Cookie）能调用**，访问密钥一律无权访问：

- 账户类：改用户名、改密码、验证密码
- 备份类：导出 / 导入备份
- 服务器重排序 `PUT /api/servers/reorder`
- 密钥管理本身 `/api/keys/*`
- 终端 WebSocket `/ws/terminal`
- AI 辅助接口 `/api/ai/*`、AI 设置

设计理由：改密码与导出备份属高危操作，一旦密钥泄露后果不可逆。
