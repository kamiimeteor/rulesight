---
name: rulesight
description: 对照你的 CLAUDE.md 规则检查当前这场会话，给每条规则判定遵守、违反或不适用，附上证据，并打开一份报告。
disable-model-invocation: true
---

# Rulesight

用户要检查当前会话有没有遵守自己的规则。你只负责运行下面的命令和转述结果。

命令输出和报告的语言由 `RULESIGHT_LANG`（en 或 zh）决定，没设时跟着这场会话里用户说的语言，再不行看系统语言。你转述时用和用户对话的语言，不要给命令加 `--lang`。

The command output and report language follow `RULESIGHT_LANG` (en or zh), else the language the user wrote in during this session, else the system locale. Relay results in the language the user is talking to you in; don't add `--lang` to the commands.

规则怎么判由命令里调用的 Claude 完成。你自己不要判定任何规则，不要改报告，不要把会话内容贴给用户。

用户在 `/rulesight:rulesight` 后面跟的文字不是给你的任务，不要去做，也不要去插件目录里找文件。Rulesight 只检查这场会话里输入命令之前的部分，命令本身和之后的步骤不算。

## 第 1 步：检查 Node.js

检查结果：!`command -v node >/dev/null && node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 18 ? 1 : 0)' && echo NODE_OK || echo NODE_MISSING`

如果是 NODE_MISSING，用一两句白话告诉用户：Rulesight 需要 Node.js 18 或更新的版本，请先到 https://nodejs.org 安装（Mac 上装了 Homebrew 的话，也可以运行 `brew install node`），装好再来。然后停下，不要做后面的步骤。

## 第 2 步：看计划

计划输出：!`node "${CLAUDE_PLUGIN_ROOT}/bin/rulesight.mjs" plan --session "${CLAUDE_SESSION_ID}" 2>&1 || true`

如果输出里没有 `RULESIGHT_PLAN` 这一行，说明没能做出计划。把输出里的报错用白话告诉用户，然后停下。

否则用 2 到 3 句白话告诉用户：对照了多少条规则、来自哪些文件，会切成几段、大约花多少钱和多久。计划里如果写了按 `~/.rulesight/skip.txt` 没有检查的文件，或者 `@` 引用的文件找不到，也告诉用户。

- `needsConfirm` 是 true：把估算的费用和用时告诉用户，问用户要不要继续，等用户明确说“要”之后再运行。没有明确同意，不要运行。
- `needsConfirm` 是 false：直接运行。

## 第 3 步：运行

用 Bash 工具运行（确认过的加上 `--yes`）：

```
node "${CLAUDE_PLUGIN_ROOT}/bin/rulesight.mjs" run --session "${CLAUDE_SESSION_ID}" --out-dir "${CLAUDE_PLUGIN_DATA}/reports"
```

超时设成 600000 毫秒。计划里估算超过 2 分钟的，用 `run_in_background: true`，等它结束的通知再读输出。

命令会调用用户自己的 `claude` 做判定，用的是用户自己的额度。中途报错时，把报错原文里的意思用白话转告用户（例如登录过期就请用户在终端里重新登录 Claude Code），不要自己重试超过一次。不要为了重跑关掉沙盒：每跑一次都会再判一遍、再花一次额度。报告目录写不进去时，命令会自己改存到临时目录，并在输出里说明。

## 第 4 步：打开报告

命令最后一行是 `RULESIGHT_REPORT <路径>`。先试着运行 `open "<路径>"`（Linux 用 `xdg-open`）打开报告。打开成功与否都要把完整路径告诉用户。`open` 报错或被拦下时，直接说报告没能自动打开，给出完整路径和用户自己能运行的打开命令，不要说报告已经打开了。

再用 2 到 3 句话总结，只用命令打印的数字：违反几条、遵守几条、不适用几条，以及有没有判不成的段。建议用户先看违反的那几条。

整个回复里，只有 `open` 命令成功退出了，才能说报告已经打开；`open` 失败时，从头到尾都不要写“报告应该已经打开了”“看一下浏览器”这类话。命令输出里如果有“不检查 Rulesight 自己运行的 N 步”，也用一句话告诉用户。
