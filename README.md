# Rulesight

Rulesight 是一个 Claude Code 插件：对照你写给 Claude 的规则（`CLAUDE.md`），检查当前这场会话，给每条规则一个判定（遵守 / 违反 / 不适用），遵守和违反都指出是哪一步，最后打开一份看得懂的网页报告。

给自己维护 `CLAUDE.md`、但不读代码的人用：设计师、产品经理、创业者。你没法自己翻几百次工具调用去核实 agent 有没有照规则做，Rulesight 替你翻，并把证据摆出来。

*Rulesight is a Claude Code plugin that checks the current session against the rules in your `CLAUDE.md`, gives each rule a verdict (followed / violated / not applicable) with the step that proves it, and opens a readable HTML report. It answers in the language you write to Claude in; see the Language section below.*

> v0.1，还在早期。判定由模型完成，会判错，请看证据再下结论。

## 它能告诉你什么

比如你的 `CLAUDE.md` 里写了“删除文件前先问我”，报告会写：

- **发生了什么**：第 142 步删除了 `old-assets/`，之前没有问你。
- **那一步的原文**：agent 实际运行的命令和结果。
- **规则原文和出处**：`CLAUDE.md` 第 12 行。
- **建议**：一句处理建议，加一条可以直接复制给 Claude 的指令。

被权限系统或沙盒拦下的违规尝试也算违反。Rulesight 回答的是“agent 有没有照规则做”，不是“最后有没有出事”。

## 和 hook 的关系

Rulesight 只检查，不拦截。能被机器直接拦下的规则（不准动项目文件夹外的文件、不准跑某类命令），最好交给 Claude Code 的 hook 或权限设置，在出事前就挡住。“需求不明确先问我”“改稿前先读风格指南”这类要靠判断的规则写不成 hook，留给 Rulesight 事后检查。

所以违反了规则时，建议不只是“下次注意”，而是按原因给一种让同样的错不再出现的改法：改成 hook 或权限设置、把流程存成 skill、换一个干净的会话，或者把规则改写得更明确。

## 需要先准备

- [Claude Code](https://code.claude.com)，已经登录。
- Node.js 18 或更新的版本（[nodejs.org](https://nodejs.org)；Mac 上装了 Homebrew 的话也可以 `brew install node`）。
- `CLAUDE.md` 里写了几条你希望 Claude 遵守的规则（全局的 `~/.claude/CLAUDE.md` 或项目里的都行）。

## 安装

在 Claude Code 会话里依次输入：

```
/plugin marketplace add kamiimeteor/rulesight
/plugin install rulesight@rulesight
```

第二条命令会打开插件详情面板，在面板里选安装范围并确认安装。装好后运行 `/reload-plugins`，或者重开一次 Claude Code。

也可以在终端里装（不用打开会话）：

```
claude plugin marketplace add kamiimeteor/rulesight
claude plugin install rulesight@rulesight
```

## 使用

在想检查的那场会话里输入：

```
/rulesight:rulesight
```

Rulesight 会先告诉你对照了多少条规则、会切成几段、大约花多少钱和多久；超过 10 段时会先问你，你同意了才开始。跑完后自动打开报告，报告文件保存在插件的数据目录里（找不到时是 `~/.rulesight/reports/`）。报告是一个 HTML 文件，不联网也能打开。

## 要先知道的事

**用的是你自己的额度。** 判定会调用你本机的 `claude`，走你自己的订阅额度。显示的美元数是按接口价格折算的估计，不会另外收费。短会话一般一两分钟就能判完；连续用了很多天的长会话可能要切几十段，按接口价格折算是几美元到几十美元。

**会话内容会发给 Anthropic。** 判定时，会话内容和你的规则经由你自己的 Claude Code 发给 Anthropic 的模型，和你平时用 Claude Code 一样。不会发给 Rulesight 的作者，也不会发到其他地方。判定用的是一个全新、不能调用任何工具的 Claude，不是被检查的会话给自己打分。

**报告里有会话原文。** 被当作证据的那几步会写进原文，其他每一步也会写一句摘要（含命令和文件名）。报告只存在你的电脑上；转发给别人之前，先看一眼里面有没有密码、客户信息。

**旧会话会被 Claude Code 自动删掉。** Claude Code 默认只把会话记录在本机保留 30 天，在桌面版里开始或最后继续过的会话默认不删。想留着以后检查，就在 `~/.claude/settings.json` 里加上 `"cleanupPeriodDays": 365`（或者直接让 Claude 帮你加）。

**会判错。** 同一份会话判两次，结果大约有一成的出入，多半是“遵守”和“不适用”之间的边界情况。判错的条目可以在报告里点“判错了”。

## 现在的限制

- 只支持 Claude Code，暂时不支持 Codex、Cursor。
- 只检查你输入命令的这场会话。
- 规则只读两个文件：`~/.claude/CLAUDE.md`，以及会话所在项目根目录的 `CLAUDE.md`。不读 `@` 引用的其他文件，也不读 BEHAVIOR.md。
- 只有列表项（`- ……`、`1. ……`）和表格行会被当成规则。成段写的规则会漏掉，想让它被检查，就改写成列表。
- 只有简体中文和英文。
- 目前只在 macOS 上测过。
- 读会话靠的是 Claude Code 的本地日志。日志格式不是公开接口，Claude Code 更新后可能读不全或读不了。

## 语言 / Language

命令输出、报告页和判定理由都支持中文和英文。默认跟着你在这场会话里和 Claude 说的语言走：中文会话出中文报告，其他语言出英文。会话里看不出来时（比如一句话都没说），看系统语言（`LC_ALL`、`LC_MESSAGES`、`LANG`，再看 Node 的 `Intl` 语言），最后默认英文。想固定语言，在启动 Claude Code 前设置环境变量：

```
export RULESIGHT_LANG=zh   # 或 en
```

*Command output, the report page and the verdict reasons come in English or Chinese. By default Rulesight follows the language you wrote to Claude in during the session: Chinese sessions get a Chinese report, anything else gets English. When the session doesn't tell, it falls back to your system language (`LC_ALL`, `LC_MESSAGES`, `LANG`, then Node's `Intl` locale), then English. To fix the language, set `RULESIGHT_LANG=en` (or `zh`) before starting Claude Code.*

## 更新和卸载

```
/plugin marketplace update rulesight
/plugin uninstall rulesight@rulesight
```

## 反馈

判错、读不了会话、报告看不懂，都欢迎开 issue。附上 Claude Code 版本和报错原文就够了，请不要贴会话内容。

## 开发

```
npm ci
npm run typecheck
npm run build:plugin   # 重新生成 plugin/bin/rulesight.mjs 和 plugin/assets/report-template.html
npm test               # 语言、步骤摘要和中英文输出的测试（先 build:plugin）
claude plugin validate .
```

本地试装：`claude --plugin-dir ./plugin`。

设计和决定记录在 `docs/`：`product-brief.md`（产品说明）、`decisions.md`（决定和理由）、`step-format.md`（步骤格式）、`report-ui.md`（报告页结构）。

## 许可证

MIT，见 [LICENSE](LICENSE)。
