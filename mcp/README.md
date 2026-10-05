# Mook MCP Server

把 Mook 的 Agent 接口暴露成 14 个 MCP 工具，任何支持 Model Context Protocol 的
客户端都能直接用。

## 配置

只需要两个环境变量：

| 变量 | 说明 |
| --- | --- |
| `MOOK_URL` | Mook 实例地址，**不要带尾斜杠**，如 `http://192.168.31.199:5866` |
| `MOOK_API_KEY` | 访问密钥，`mk_` 开头 51 字符 |

密钥在 Mook 网页端 **设置 → 访问密钥** 创建，明文只显示一次。

## 客户端配置片段

```json
{
  "mcpServers": {
    "mook": {
      "command": "/usr/bin/node",
      "args": ["/绝对路径/dsh-mook-skill/mcp/mook-mcp.js"],
      "env": {
        "MOOK_URL": "http://192.168.31.199:5866",
        "MOOK_API_KEY": "mk_你的密钥"
      }
    }
  }
}
```

Claude Code 用命令行的方式：

```bash
claude mcp add mook --env MOOK_URL=http://192.168.31.199:5866 \
                      --env MOOK_API_KEY=mk_你的密钥 \
                      -- node /绝对路径/dsh-mook-skill/mcp/mook-mcp.js
```

## 装依赖

```bash
npm install --registry=https://registry.npmmirror.com
```

## 手动验证

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | MOOK_URL=http://127.0.0.1:5866 MOOK_API_KEY=mk_test node mook-mcp.js
```

## 工具一览

`list_servers` · `get_server` · `add_server` · `update_server` · `remove_server` ·
`exec_command` · `list_files` · `read_file` · `write_file` ·
`list_commands` · `save_command` · `update_command` · `delete_command` · `mark_command_used`

## 实现要点

- **stdio 传输**：stdout 全部留给 MCP 协议，**日志一律走 stderr**。
- **120 秒请求超时**：用 `AbortController` 控制，比服务端 exec 上限（600 秒）短 ——
  需要跑更久的命令请用 `nohup ... &` 后台执行再读日志。
- **启动即校验配置**：`MOOK_URL` / `MOOK_API_KEY` 缺失时打 stderr 并 `exit(1)`，
  不静默降级。
- **`update_server` 内建读-改-写**：后端 `PUT` 是全量替换，所以工具先 GET 当前值再合并，
  凭据字段留空则不发送（保持原值）。
- **错误友好化**：401 / 403 会翻译成中文提示，直接告诉 Agent 该补哪个权限。

## 注意

- 客户端对 server 名有格式限制（字母数字 `_` `-`，≤32 字符）。
- 某些 GUI 客户端不继承 shell 的 PATH，`command` 请写 `node` 的绝对路径。
- 本包只提供 stdio 形态；如果你的客户端只支持 HTTP 型 MCP，请提 issue。
