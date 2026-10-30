# Rulesight 步骤格式

状态：第 2 版，2026-10-29（第 1 版 2026-10-28）。第 2 版只加了步骤的 `at` 字段。改格式时把 `formatVersion` 加 1，并在 `docs/decisions.md` 记一笔。

## 它是什么

各种 agent 的原始日志 → 各自的适配器 → **步骤格式** → 判定 → 报告页。

判定子 agent 和报告页只读这个格式，不碰原始日志。第一版只有 Claude Code 一个适配器（用官方 Agent SDK 读取）。

## 一次会话

```json
{
  "formatVersion": 2,
  "source": "claude_code",
  "sessionId": "8f2c…",
  "title": "给登录页加忘记密码",
  "cwd": "/Users/me/projects/my-app",
  "startedAt": "2026-10-28T09:12:00Z",
  "endedAt": "2026-10-28T10:05:00Z",
  "steps": [ … ]
}
```

| 字段 | 说明 | 报告页用在哪 |
|---|---|---|
| `formatVersion` | 格式版本号，以后改格式时加 1 | 不显示 |
| `source` | 日志来源：`claude_code`，第二版加 `codex`、`cursor` | 不显示 |
| `sessionId` | 原始会话 ID，用来回查原始日志 | 不显示 |
| `title` | 会话名称：优先用会话标题，没有就用第一句用户消息 | 页头 |
| `cwd` | 会话所在的项目目录 | 页头（可选） |
| `startedAt` / `endedAt` | 开始和结束时间 | 页头：开始时间、用时 |
| `steps` | 步骤列表，按发生顺序排 | 进度条、证据 |

## 一个步骤

```json
{
  "n": "47",
  "kind": "agent_message",
  "agent": "main",
  "summary": "Agent 回复：改好了，所有测试都通过了。",
  "text": "改好了，所有测试都通过了。",
  "tool": null,
  "parentStep": null,
  "at": "2026-10-28T09:47:12.345Z",
  "raw": ["a1b2c3d4-…"]
}
```

工具调用的例子：

```json
{
  "n": "46",
  "kind": "tool_call",
  "agent": "main",
  "summary": "修改文件 src/auth.ts",
  "text": null,
  "tool": {
    "name": "Edit",
    "input": { "file_path": "src/auth.ts", "old_string": "…", "new_string": "…" },
    "output": "The file src/auth.ts has been updated.",
    "isError": false
  },
  "parentStep": null,
  "at": "2026-10-28T09:46:58.001Z",
  "raw": ["e5f6…", "a7b8…"]
}
```

| 字段 | 说明 |
|---|---|
| `n` | 步骤号，字符串，从 "1" 开始。主会话连续编号；子 agent 的步骤见下面的“子 agent” |
| `kind` | 步骤类型，只有 5 种：`user_message` 用户消息、`agent_message` Agent 回复、`thinking` Agent 思考、`tool_call` 工具调用（含结果）、`system` 系统事件（比如上下文压缩） |
| `agent` | 谁做的：`main` 是主会话；子 agent 写它的 ID |
| `summary` | 一句话说明这一步做了什么，用中文，由适配器按规则生成，不调用模型。例：“运行命令 npm test”“修改文件 src/auth.ts”“读取文件 README.md” |
| `text` | 原文：用户消息、Agent 回复、思考内容。工具调用为 `null` |
| `tool` | 只有 `tool_call` 才有：工具名、输入、输出、是否报错。输出保存全文，交给判定时再截断 |
| `parentStep` | 子 agent 的步骤指向启动它的那一步；主会话为 `null` |
| `at` | 这一步的时间（第一条原始条目的时间戳，ISO），用来按时间段判定；不知道时为 `null` |
| `raw` | 这一步对应的原始日志条目 ID，用来回查和排错，报告页不显示 |

## 四条规则

1. **一次工具调用和它的结果合成一步。** 原始日志里调用和结果是分开的两条。合并以后，报告可以直接写“第 46 步 运行命令 npm test → 3 个失败”，不写代码的人更容易看懂，步骤数也大约减半。
2. **一条 Agent 消息里有几块内容，就拆成几步。** 同一条消息里经常先思考、再说话、再调工具，拆开以后证据能精确到某一句话或某一次调用。
3. **子 agent 的步骤编成子步骤。** 主会话第 12 步启动了子 agent，子 agent 的步骤就编成 12.1、12.2……，挂在第 12 步下面（`n` 写成 `"12.1"`；所以 `n` 统一用字符串）。主会话的步骤号不受影响。
4. **思考内容也算步骤。** “我先跳过测试”这类话常常只出现在思考里，是很强的证据。

## 已知限制

2026-10-29 起，适配器自己读原始 JSONL（主会话文件 + `<会话 ID>/subagents/` 下的子 agent 文件），不再经过 Agent SDK。

- 步骤时间（`at`）在第 2 版加上，用于按时间段判定。会话的开始和结束时间取第一条和最后一条条目的时间。
- 思考内容基本是空的（2026-10-28 实测）：Claude Code 2.1.30x 的会话里，思考块几乎只留签名；8 月的 2.1.229 还有正文。空的就跳过，不生成空步骤。所以判定不能指望思考，主要证据是 Agent 回复和工具调用。
- 上下文压缩记成 `system` 步骤（summary "上下文压缩"）；压缩时模型写的摘要也记成 `system` 步骤（"上下文压缩摘要"），不算用户的话。
- 不是所有用户侧消息都来自用户：子 agent 交回结果（`origin.kind: "peer"`）和后台任务通知（`task-notification`）记成 `system` 步骤，免得判定把 agent 自己的报告当成用户指令。
- 用户在 agent 干活时插的话存在 `attachment`（`queued_command`）条目里，适配器把它们也读成用户消息。
- 斜杠命令：带参数的（如 `/loop …`）参数就是用户的指令，保留为用户消息；不带参数的命令和本地命令输出不算用户消息。
- `tool.output` 为 `null` 表示原始文件里没有这次调用的结果（极少见），判定时按"不知道"处理，不等于失败。
- 很长的会话一次判不完：一份 9 月到 10 月的会话读全有 2.6 万步，步骤文件 434MB，已接近 Node 读单个字符串的上限，也放不进一次判定。所以长会话分段判定，见 `docs/decisions.md` 2026-10-29。
- 不记 token 和费用：第一版不做成本统计。
