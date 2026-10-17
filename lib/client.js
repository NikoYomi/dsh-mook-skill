/**
 * dsh-mook-skill — Mook 集成：Web 客户端半场（设置页）。
 *
 * 四张卡各自保存，互不阻塞：
 *   1. 连接      —— Mook 地址 + 「测试连接」
 *   2. API 密钥  —— 填/换/清除密钥（值只进宿主凭据库，页面永不回显）
 *   3. 工具开关  —— 14 个 mook_* 工具逐个开关（按只读/写入/执行/危险分组）
 *   4. 清除数据  —— 卸载前清掉地址配置与密钥
 *
 * 1.0.0 起不再有「MCP 配置」卡片：工具直接注册在宿主里，装插件即用。
 *
 * 走 DSH 外壳的 `settings.section` 槽位。样式全部使用 DSH 主题 CSS 变量，
 * 跟随用户当前主题（明/暗/皮肤）。
 */

window.__ModuleLoader__.load({
  id: "@yoursc/dsh-mook-skill",
  factory: (require) => {
    const React = require("react");
    const e = React.createElement;

    const API_PREFIX = "mook/api";
    const API_TIMEOUT_MS = 15000;
    const SECTION_LABEL = "Mook";

    const NAV_ICON_VIEW_BOX = "0 0 24 24";
    const NAV_ICON_PATHS = [
      "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z",
      "M7.5 9.5l2.5 2.5-2.5 2.5",
      "M13 14.5h4",
    ];

    // ── 样式 ────────────────────────────────────────────────────────────────

    const CSS = `
.dmk-wrap { display: flex; flex-direction: column; gap: 16px; }
.dmk-card {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  padding: 14px 16px;
}
.dmk-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.dmk-card-title { font-weight: 600; color: var(--dsw-alias-label-primary); font-size: 14px; }
.dmk-card-desc { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.6; margin-bottom: 10px; }
.dmk-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.dmk-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dmk-input {
  width: 100%; box-sizing: border-box;
  padding: 7px 10px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-family: inherit;
}
.dmk-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dmk-input:disabled { opacity: .6; cursor: not-allowed; }
.dmk-mono { font-family: var(--dsw-font-markdown-code-block-small, ui-monospace, Menlo, Consolas, monospace); font-size: 12px; }
.dmk-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dmk-btn {
  padding: 6px 13px; font-size: 13px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-family: inherit; transition: background .12s;
}
.dmk-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dmk-btn:disabled { opacity: .5; cursor: not-allowed; }
.dmk-btn-primary {
  background: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
  color: #fff;
}
.dmk-btn-danger { color: var(--dsw-alias-state-error-primary); }
.dmk-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
}
.dmk-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dmk-badge-ok { color: var(--dsw-alias-state-success-primary); border-color: currentColor; }
.dmk-badge-warn { color: var(--dsw-alias-state-warn-primary); border-color: currentColor; }
.dmk-msg { font-size: 12px; line-height: 1.6; margin-top: 8px; }
.dmk-msg-ok { color: var(--dsw-alias-state-success-primary); }
.dmk-msg-err { color: var(--dsw-alias-state-error-primary); }
.dmk-msg-warn { color: var(--dsw-alias-state-warn-primary); }
.dmk-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.6; }
.dmk-scopes { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.dmk-scope { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
.dmk-scope-key { color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-markdown-code-block-small, monospace); }
.dmk-scope-desc { color: var(--dsw-alias-label-tertiary); }
.dmk-scope-danger { color: var(--dsw-alias-state-warn-primary); }
.dmk-group { margin-top: 12px; }
.dmk-group-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dmk-group-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dmk-group-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-left: 8px; font-weight: 400; }
.dmk-tool {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 7px 2px; cursor: pointer;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dmk-tool:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dmk-tool-name {
  font-family: var(--dsw-font-markdown-code-block-small, monospace);
  font-size: 12px; color: var(--dsw-alias-label-primary);
}
.dmk-switch {
  position: relative; flex: 0 0 auto;
  width: 34px; height: 20px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-border-l1);
  transition: background .12s, border-color .12s;
}
.dmk-switch-on {
  background: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}
.dmk-switch::after {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #fff; transition: transform .12s;
}
.dmk-switch-on::after { transform: translateX(14px); }
`;

    function injectCss() {
      if (typeof document === "undefined") return;
      if (document.querySelector("style[data-dsh-mook]") !== null) return;
      const style = document.createElement("style");
      style.setAttribute("data-dsh-mook", "");
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    // ── 宿主 API ────────────────────────────────────────────────────────────

    /**
     * 路径**不带前导斜杠**：宿主前端注入 `<base href="./">`，写成 `/mook/api/...`
     * 是绝对路径、不受 base 影响，子路径部署下会丢前缀拿到 HTML 404 页。
     */
    async function api(method, body) {
      const response = await fetch(API_PREFIX + "/" + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(API_TIMEOUT_MS) : undefined,
      });
      let payload;
      const text = await response.text();
      try {
        payload = text === "" ? undefined : JSON.parse(text);
      } catch {
        throw new Error("宿主没有返回 JSON（HTTP " + response.status + "）");
      }
      if (payload === undefined || payload.ok !== true) {
        const message = payload && payload.error && payload.error.message ? payload.error.message : "未知错误";
        throw new Error(message);
      }
      return payload.value;
    }

    // ── 小工具 ──────────────────────────────────────────────────────────────

    /** 拖选文字时不要误触整行开关/按钮。 */
    function isDragSelectingInside(node) {
      if (typeof window === "undefined" || !window.getSelection) return false;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return false;
      try {
        return selection.containsNode(node, true);
      } catch {
        return false;
      }
    }

    function Badge(props) {
      const cls = "dmk-badge" + (props.tone ? " dmk-badge-" + props.tone : "");
      return e("span", { className: cls }, e("span", { className: "dmk-dot" }), props.children);
    }

    function Message(props) {
      if (!props.text) return null;
      return e("div", { className: "dmk-msg dmk-msg-" + (props.tone || "ok") }, props.text);
    }

    // ── 卡 1：连接 ──────────────────────────────────────────────────────────

    function ConnectionCard(props) {
      const state = props.state;
      const [draft, setDraft] = React.useState(state ? state.baseUrl : "");
      const [busy, setBusy] = React.useState(null);
      const [message, setMessage] = React.useState(null);

      React.useEffect(() => {
        if (state) setDraft(state.baseUrl);
      }, [state && state.baseUrl]);

      if (!state) return null;
      const saved = state.baseUrl;
      const dirty = draft.trim() !== saved;
      const locked = busy !== null;

      const save = async () => {
        setBusy("save");
        setMessage(null);
        try {
          const next = await api("updateConfig", { baseUrl: draft });
          props.onState(next);
          setMessage({ tone: "ok", text: "已保存" });
        } catch (error) {
          setMessage({ tone: "err", text: error.message });
        } finally {
          setBusy(null);
        }
      };

      const test = async () => {
        setBusy("test");
        setMessage(null);
        try {
          const result = await api("testConnection", { baseUrl: draft });
          props.onState(await api("getState"));
          const names = (result.servers || []).map((s) => s.name).join("、");
          setMessage({
            tone: "ok",
            text: result.message + (names ? "：" + names : "") + "（地址 " + result.baseUrl + "）",
          });
        } catch (error) {
          setMessage({ tone: "err", text: error.message });
        } finally {
          setBusy(null);
        }
      };

      return e(
        "div",
        { className: "dmk-card" },
        e(
          "div",
          { className: "dmk-card-head" },
          e("span", { className: "dmk-card-title" }, "连接"),
          dirty ? e(Badge, { tone: "warn" }, "未保存") : null
        ),
        e("div", { className: "dmk-card-desc" }, "Mook 服务地址，填到端口即可，不要带 /api 之类的路径后缀。"),
        e(
          "div",
          { className: "dmk-field" },
          e("label", { className: "dmk-label" }, "Mook 地址"),
          e("input", {
            className: "dmk-input dmk-mono",
            value: draft,
            disabled: locked,
            placeholder: state.defaultBaseUrl,
            spellCheck: false,
            onChange: (event) => setDraft(event.target.value),
          })
        ),
        e(
          "div",
          { className: "dmk-row" },
          e(
            "button",
            { className: "dmk-btn dmk-btn-primary", disabled: locked || !dirty, onClick: save },
            busy === "save" ? "保存中…" : "保存"
          ),
          e(
            "button",
            { className: "dmk-btn", disabled: locked || draft.trim() === "", onClick: test },
            busy === "test" ? "测试中…" : "测试连接"
          ),
          e(
            "button",
            {
              className: "dmk-btn",
              disabled: locked || !dirty,
              onClick: () => {
                setDraft(saved);
                setMessage(null);
              },
            },
            "还原"
          )
        ),
        e(Message, message)
      );
    }

    // ── 卡 2：API 密钥 ──────────────────────────────────────────────────────

    function KeyCard(props) {
      const state = props.state;
      const [draft, setDraft] = React.useState("");
      const [busy, setBusy] = React.useState(null);
      const [message, setMessage] = React.useState(null);
      const [confirmClear, setConfirmClear] = React.useState(false);

      if (!state) return null;
      const info = state.key;
      const locked = busy !== null;
      const readOnly = info.writable !== true && info.configured === true;

      const save = async () => {
        setBusy("save");
        setMessage(null);
        try {
          const next = await api("setKey", { key: draft });
          props.onState(next);
          setDraft("");
          setMessage({ tone: "ok", text: "密钥已存入 dsh 凭据库" });
        } catch (error) {
          setMessage({ tone: "err", text: error.message });
        } finally {
          setBusy(null);
        }
      };

      const clear = async () => {
        setBusy("clear");
        setMessage(null);
        try {
          const next = await api("clearKey");
          props.onState(next);
          setConfirmClear(false);
          setMessage({ tone: "ok", text: "密钥已清除" });
        } catch (error) {
          setMessage({ tone: "err", text: error.message });
        } finally {
          setBusy(null);
        }
      };

      return e(
        "div",
        { className: "dmk-card" },
        e(
          "div",
          { className: "dmk-card-head" },
          e("span", { className: "dmk-card-title" }, "API 密钥"),
          e(
            Badge,
            { tone: info.configured ? (info.source === "env" ? "warn" : "ok") : undefined },
            info.configured ? info.hint : "未配置"
          )
        ),
        e(
          "div",
          { className: "dmk-card-desc" },
          "在 Mook 网页端「设置 → 访问密钥」创建，明文只显示一次。密钥存在 dsh 凭据库（",
          e("code", { className: "dmk-mono" }, "MOOK_API_KEY"),
          "），本页面不回显。"
        ),
        readOnly
          ? e(
              "div",
              { className: "dmk-msg dmk-msg-warn" },
              "当前密钥来自只读来源（环境变量或部署配置），页面无法覆盖。想改成在页面里管理：去掉 dsh web 的 MOOK_API_KEY 环境变量后重启。"
            )
          : null,
        e(
          "div",
          { className: "dmk-field" },
          e("label", { className: "dmk-label" }, info.configured ? "替换密钥" : "填入密钥"),
          e("input", {
            className: "dmk-input dmk-mono",
            type: "password",
            value: draft,
            disabled: locked || readOnly,
            placeholder: "mk_…",
            spellCheck: false,
            autoComplete: "off",
            onChange: (event) => setDraft(event.target.value),
          })
        ),
        e(
          "div",
          { className: "dmk-row" },
          e(
            "button",
            { className: "dmk-btn dmk-btn-primary", disabled: locked || readOnly || draft.trim() === "", onClick: save },
            busy === "save" ? "保存中…" : "保存密钥"
          ),
          info.configured && info.writable === true
            ? confirmClear
              ? e(
                  React.Fragment,
                  null,
                  e("button", { className: "dmk-btn dmk-btn-danger", disabled: locked, onClick: clear }, busy === "clear" ? "清除中…" : "确认清除"),
                  e("button", { className: "dmk-btn", disabled: locked, onClick: () => setConfirmClear(false) }, "取消")
                )
              : e("button", { className: "dmk-btn dmk-btn-danger", disabled: locked, onClick: () => setConfirmClear(true) }, "清除")
            : null
        ),
        e(Message, message),
        e(
          "div",
          { className: "dmk-scopes" },
          e("div", { className: "dmk-label" }, "密钥权限（在 Mook 侧勾选）"),
          (state.scopes || []).map((scope) =>
            e(
              "div",
              { className: "dmk-scope", key: scope.key },
              e("span", { className: "dmk-scope-key" }, scope.key),
              e("span", { className: "dmk-scope-desc" }, scope.label + " —— " + scope.description),
              scope.dangerous ? e("span", { className: "dmk-scope-danger" }, "⚠️ 危险") : null
            )
          )
        )
      );
    }

    // ── 卡 3：工具开关 ──────────────────────────────────────────────────────

    const GROUP_META = {
      read: { label: "只读", hint: "查看服务器与命令库 · 默认开" },
      write: { label: "写入", hint: "增改服务器与命令 · 默认关" },
      exec: { label: "执行", hint: "远程 shell 与读写文件 ⚠️ · 默认关" },
      danger: { label: "危险", hint: "删除操作，需 confirm=true · 默认关" },
    };

    function Switch(props) {
      return e("span", {
        className: "dmk-switch" + (props.on ? " dmk-switch-on" : ""),
        role: "switch",
        "aria-checked": props.on ? "true" : "false",
      });
    }

    function ToolsCard(props) {
      const state = props.state;
      const [draft, setDraft] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);

      // 宿主是唯一事实来源：刷新后以服务端返回的 enabled 重置草稿。
      React.useEffect(() => {
        if (!state || !Array.isArray(state.tools)) return;
        const next = {};
        for (const tool of state.tools) next[tool.name] = tool.enabled === true;
        setDraft(next);
      }, [state]);

      if (!state || !Array.isArray(state.tools)) return null;
      const current = draft ?? {};

      const saved = {};
      for (const tool of state.tools) saved[tool.name] = tool.enabled === true;

      const dirty = state.tools.some((tool) => (current[tool.name] === true) !== saved[tool.name]);
      const enabledCount = state.tools.filter((tool) => (current[tool.name] === true) !== saved[tool.name] ? current[tool.name] === true : saved[tool.name]).length;

      const toggle = (name) => {
        setMessage(null);
        setDraft((prev) => {
          const base = prev ?? {};
          return { ...base, [name]: !(base[name] === true ? true : saved[name]) };
        });
      };

      const toggleGroup = (group) => {
        const members = state.tools.filter((tool) => tool.group === group);
        const allOn = members.every((tool) => (current[tool.name] === true));
        setMessage(null);
        setDraft((prev) => {
          const base = { ...(prev ?? {}) };
          for (const tool of members) base[tool.name] = !allOn;
          return base;
        });
      };

      const save = async () => {
        setBusy(true);
        setMessage(null);
        try {
          const next = await api("updateConfig", { tools: current });
          props.onState(next);
          setMessage({ tone: "ok", text: "已保存，工具开关即时生效（不需要重启 dsh）" });
        } catch (error) {
          setMessage({ tone: "err", text: error.message });
        } finally {
          setBusy(false);
        }
      };

      const groups = state.toolGroups ?? ["read", "write", "exec", "danger"];
      const rows = [];
      for (const group of groups) {
        const members = state.tools.filter((tool) => tool.group === group);
        if (members.length === 0) continue;
        const meta = GROUP_META[group] ?? { label: group, hint: "" };
        const allOn = members.every((tool) => current[tool.name] === true);
        rows.push(
          e(
            "div",
            { className: "dmk-group", key: "group-" + group },
            e(
              "div",
              { className: "dmk-group-head" },
              e(
                "span",
                { className: "dmk-group-name" },
                meta.label,
                e("span", { className: "dmk-group-hint" }, meta.hint)
              ),
              e(
                "button",
                { type: "button", className: "dmk-btn", disabled: busy, onClick: () => toggleGroup(group) },
                allOn ? "整组停用" : "整组启用"
              )
            ),
            members.map((tool) =>
              e(
                "div",
                {
                  className: "dmk-tool",
                  key: tool.name,
                  role: "switch",
                  tabIndex: 0,
                  "aria-checked": current[tool.name] === true ? "true" : "false",
                  onClick: (event) => {
                    if (isDragSelectingInside(event.currentTarget)) return;
                    toggle(tool.name);
                  },
                  onKeyDown: (event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      toggle(tool.name);
                    }
                  },
                },
                e("span", { className: "dmk-tool-name" }, tool.name),
                e(Switch, { on: current[tool.name] === true })
              )
            )
          )
        );
      }

      return e(
        "div",
        { className: "dmk-card" },
        e(
          "div",
          { className: "dmk-card-head" },
          e("span", { className: "dmk-card-title" }, "工具开关"),
          e(Badge, { tone: enabledCount > 0 ? "ok" : undefined }, "已启用 " + enabledCount + " / " + state.tools.length)
        ),
        e(
          "div",
          { className: "dmk-card-desc" },
          "这些是 Agent 可以直接调用的 mook_* 工具。写入、执行、危险三组默认关闭——打开「执行」等于把服务器的远程 shell 交给 Agent。整行可点，组标题的按钮可整组开合。"
        ),
        rows,
        e(
          "div",
          { className: "dmk-row", style: { marginTop: "12px" } },
          e(
            "button",
            { className: "dmk-btn dmk-btn-primary", disabled: busy || !dirty, onClick: save },
            busy ? "保存中…" : "保存开关"
          ),
          dirty ? e("span", { className: "dmk-hint" }, "有未保存的改动") : null
        ),
        e(Message, message)
      );
    }

    // ── 卡 4：清除全部数据 ──────────────────────────────────────────────────

    // 卸载插件前先点一下这个，可以少留东西在设备上。
    // DSH 卸载插件时只删程序文件，插件自己的数据（地址配置 + 凭据库里的密钥）
    // 归插件管，所以这里给一个显式入口。
    function CleanupCard(props) {
      const state = props.state;
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);
      const [confirm, setConfirm] = React.useState(false);

      if (!state) return null;
      const keyConfigured = state.key && state.key.configured === true;
      const anythingToClear = keyConfigured || (state.baseUrl && state.baseUrl !== state.defaultBaseUrl);

      const clearAll = async () => {
        setBusy(true);
        setMessage(null);
        try {
          const next = await api("clearAll");
          props.onState(next);
          setConfirm(false);
          setMessage({ tone: "ok", text: "已清除：地址配置与密钥都已移除" });
        } catch (error) {
          setMessage({ tone: "err", text: error.message });
        } finally {
          setBusy(false);
        }
      };

      return e(
        "div",
        { className: "dmk-card" },
        e(
          "div",
          { className: "dmk-card-head" },
          e("span", { className: "dmk-card-title" }, "清除全部数据"),
          e(Badge, { tone: anythingToClear ? "warn" : undefined }, anythingToClear ? "有数据" : "无数据")
        ),
        e(
          "div",
          { className: "dmk-card-desc" },
          "卸载本插件前点一下，可清掉两处落盘数据：Mook 地址配置（",
          e("code", { className: "dmk-mono" }, "storages/mook/config.json"),
          "）与 dsh 凭据库里的密钥（",
          e("code", { className: "dmk-mono" }, "MOOK_API_KEY"),
          "）。卸载插件本身不会自动清这两处。"
        ),
        e(
          "div",
          { className: "dmk-row" },
          confirm
            ? e(
                React.Fragment,
                null,
                e("button", { className: "dmk-btn dmk-btn-danger", disabled: busy, onClick: clearAll }, busy ? "清除中…" : "确认全部清除"),
                e("button", { className: "dmk-btn", disabled: busy, onClick: () => setConfirm(false) }, "取消")
              )
            : e("button", { className: "dmk-btn dmk-btn-danger", disabled: busy, onClick: () => setConfirm(true) }, "清除全部数据"),
          e("span", { className: "dmk-hint" }, "清除后需重新填地址与密钥才能继续使用")
        ),
        e(Message, message)
      );
    }

    // ── 面板 ────────────────────────────────────────────────────────────────

    function MookSection() {
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState(null);

      React.useEffect(() => {
        let alive = true;
        api("getState")
          .then((next) => {
            if (alive) setState(next);
          })
          .catch((err) => {
            if (alive) setError(err.message);
          });
        return () => {
          alive = false;
        };
      }, []);

      if (error) {
        return e("div", { className: "dmk-wrap" }, e("div", { className: "dmk-msg dmk-msg-err" }, "读取插件状态失败：" + error));
      }
      if (!state) return e("div", { className: "dmk-wrap" }, e("div", { className: "dmk-hint" }, "加载中…"));

      return e(
        "div",
        { className: "dmk-wrap" },
        e(ConnectionCard, { state: state, onState: setState }),
        e(KeyCard, { state: state, onState: setState }),
        e(ToolsCard, { state: state, onState: setState }),
        e(CleanupCard, { state: state, onState: setState })
      );
    }

    // ── 导航图标（外壳只给内置面板配图形，其余回退齿轮） ────────────────────

    function patchNavCell(cell) {
      const svg = cell.querySelector("svg");
      if (!svg) return false;
      if (svg.getAttribute("data-dsh-mook-icon") === "1") return true;
      const next = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      next.setAttribute("viewBox", NAV_ICON_VIEW_BOX);
      next.setAttribute("data-dsh-mook-icon", "1");
      next.setAttribute("class", svg.getAttribute("class") || "");
      next.setAttribute("width", svg.getAttribute("width") || "16");
      next.setAttribute("height", svg.getAttribute("height") || "16");
      next.setAttribute("fill", "none");
      next.setAttribute("stroke", "currentColor");
      next.setAttribute("stroke-width", "1.6");
      next.setAttribute("stroke-linecap", "round");
      next.setAttribute("stroke-linejoin", "round");
      for (const d of NAV_ICON_PATHS) {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        next.appendChild(p);
      }
      // 整根替换（而非改子节点）：React 手里仍握旧引用，
      // 换掉后卸载时不会 removeChild 抛错。
      svg.replaceWith(next);
      return true;
    }

    function watchNavIcon(documentObject) {
      if (!documentObject || !documentObject.body) return () => {};
      let scheduled = false;
      const scan = () => {
        scheduled = false;
        const cells = documentObject.querySelectorAll("nav button");
        for (const cell of cells) {
          const span = cell.querySelector("span");
          if (span && span.textContent && span.textContent.trim() === SECTION_LABEL) {
            patchNavCell(cell);
            return;
          }
        }
      };
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(scan);
        else setTimeout(scan, 16);
      };
      scan();
      const observer = new MutationObserver(schedule);
      observer.observe(documentObject.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    }

    // ── 注册 ────────────────────────────────────────────────────────────────

    const inject = ["slots"];

    function apply(ctx) {
      injectCss();
      const slots = ctx.slots ?? (typeof ctx.get === "function" ? ctx.get("slots") : undefined);
      if (slots === undefined) return;
      slots.inject("settings.section", () =>
        slots.register({ name: "settings.section", id: "mook", order: 41, label: SECTION_LABEL }, MookSection)
      );
      const documentObject = typeof document === "undefined" ? undefined : document;
      if (typeof ctx.effect === "function") ctx.effect(() => watchNavIcon(documentObject), "dsh-mook-skill: 设置面板导航图标");
      else watchNavIcon(documentObject);
    }

    const module2 = { exports: {} };
    const exports2 = module2.exports;
    exports2.inject = inject;
    exports2.apply = apply;
    exports2.internals = { SECTION_LABEL, NAV_ICON_VIEW_BOX, NAV_ICON_PATHS, patchNavCell, watchNavIcon, api };
    return module2.exports;
  },
});
