[English](README.md) | 简体中文

# Rulesight

Rulesight 是一个 Claude Code 插件：对照你写给 Claude 的规则（`CLAUDE.md`），检查当前这场会话，给每条规则一个判定（遵守 / 违反 / 不适用），遵守和违反都指出是哪一步，最后打开一份看得懂的网页报告。

给自己维护 `CLAUDE.md`、但不读代码的人用：设计师、产品经理、创业者。你没法自己翻几百次工具调用去核实 agent 有没有照规则做，Rulesight 替你翻，并把证据摆出来。

> v0.1，还在早期。判定由模型完成，会判错。遵守或违反要先看指出的那一步，再下结论。

## 它能告诉你什么

比如你的 `CLAUDE.md` 里写了“删除文件前先问我”，报告会写：

- **发生了什么**：第 142 步删除了 `old-assets/`，之前没有问你。
- **那一步的原文**：agent 实际运行的命令和结果。
- **规则原文和出处**：`CLAUDE.md` 第 12 行。
- **建议**：一句处理建议，加一条可以直接复制给 Claude 的指令。

被权限系统或沙盒拦下的违规尝试也算违反。Rulesight 回答的是“agent 有没有照规则做”，不是“最后有没有出事”。

## 和 hook 的关系

Rulesight 只检查，不拦截：它在会话结束后翻记录，不是沙盒，挡不住正在发生的操作。能被机器直接拦下的规则（不准动项目文件夹外的文件、不准跑某类命令），最好交给 Claude Code 的 hook 或权限设置，在出事前就挡住。“需求不明确先问我”“改稿前先读风格指南”这类要靠判断的规则写不成 hook，留给 Rulesight 事后检查。

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

Rulesight 会先告诉你对照了多少条规则、会切成几段、大约花多少钱和多久；超过 10 段时会先问你，你同意了才开始。跑完后自动打开报告，报告文件保存在插件的数据目录里；那里写不进去时（比如开了沙盒），会在判定开始前改存到临时目录，并告诉你路径。报告是一个 HTML 文件，不联网也能打开。

## 要先知道的事

**用的是你自己的额度。** 判定会调用你本机的 `claude`，走你自己的订阅额度。显示的美元数是按接口价格折算的估计，不会另外收费。短会话一般一两分钟就能判完；连续用了很多天的长会话可能要切几十段，按接口价格折算是几美元到几十美元。

**会话内容会发给 Anthropic。** 判定时，会话内容和你的规则经由你自己的 Claude Code 发给 Anthropic 的模型，和你平时用 Claude Code 一样。不会发给 Rulesight 的作者，也不会发到其他地方。判定用的是一个全新、不能调用任何工具的 Claude，不是被检查的会话给自己打分。

**报告里有会话原文。** 被当作证据的那几步会写进原文，其他每一步也会写一句摘要（含命令和文件名）。报告只存在你的电脑上；转发给别人之前，先看一眼里面有没有密码、客户信息。

**旧会话会被 Claude Code 自动删掉。** Claude Code 默认只把会话记录在本机保留 30 天，在桌面版里开始或最后继续过的会话默认不删。想留着以后检查，就在 `~/.claude/settings.json` 里加上 `"cleanupPeriodDays": 365`（或者直接让 Claude 帮你加）。

**你在会话里亲口同意过的操作，算遵守。** 比如规则是“删除文件前先问我”，你在会话里说了“把 old-notes/ 删掉吧，不用问我”，agent 照做就判遵守，报告会把你说这句话的那一步列为证据。Claude 用选项卡片问你、你在卡片里选的回答，也算你亲口说的。你后来又说“先别删”，之后再删就算违反。工具输出或文件里自称“用户已批准”的一律不算。不想让会话里的临时同意算数，就在规则里写明，例如“即使我说过不用问，也要先问我”。

**会判错。** 同一份会话判两次，结果大约有一成的出入，多半是“遵守”和“不适用”之间的边界情况。判错的条目可以在报告里点“判错了”。

## 现在的限制

- 只支持 Claude Code，暂时不支持 Codex、Cursor。
- 只检查你输入命令的这场会话，而且只看输入命令之前的部分；命令后面跟的文字不会被当成任务去做。
- 规则按 Claude Code 的读法读：`~/.claude/CLAUDE.md`、`~/.claude/rules/` 里的文件，会话所在项目根目录的 `CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md`、`.claude/rules/` 里的文件，以及这些文件里 `@` 引用的文件（最多跟 4 层）。项目上层文件夹和子文件夹里的 `CLAUDE.md`、`AGENTS.md`、BEHAVIOR.md 不读。
- 有些被引用的文件不是规则（比如决定记录、笔记），条数又多，每次都检查只会多花钱。把它们的路径写进 `~/.rulesight/skip.txt`（一行一个，可以用 `~`），Rulesight 就不检查它们，也不读它们再引用的文件，检查计划里会写明跳过了哪些、各多少条。也可以直接让 Claude 帮你加。
- 只有列表项（`- ……`、`1. ……`）和表格行会被当成规则。成段写的规则会漏掉，想让它被检查，就改写成列表。
- 规则按你运行检查时文件里的内容来判，分不出“这条规则当时根本没被 Claude 读到”和“读到了但没照做”。子 agent 实际拿到了哪些规则、规则之间有没有互相冲突，也都不检查。
- 只看会话记录，不看磁盘上的真实文件，也不看 git。agent 跑脚本、用通配符或构建命令改了文件，只要记录里没写出具体路径，就查不到。
- 长会话会被切成几段分别判定。前面几段里只有你亲口说的话（包括在选项卡片里选的回答）能当证据，而且只用来判你同意或收回过什么；其他内容只帮助理解。前面的话太多时只带最近约 2 万字，更早说过的同意可能看不到。
- 只有简体中文和英文。
- 目前只在 macOS 上测过。
- 读会话靠的是 Claude Code 的本地日志。日志格式不是公开接口，Claude Code 更新后可能读不全或读不了。

## 语言 / Language

命令输出、报告页和判定理由都支持中文和英文。默认跟着你在这场会话里和 Claude 说的语言走：中文会话出中文报告，其他语言出英文。会话里看不出来时（比如一句话都没说），看系统语言（`LC_ALL`、`LC_MESSAGES`、`LANG`，再看 Node 的 `Intl` 语言），最后默认英文。想固定语言，在启动 Claude Code 前设置环境变量：

```
export RULESIGHT_LANG=zh   # 或 en
```

## 更新和卸载

更新要两步：先更新插件市场，再更新插件本身，然后重开一次 Claude Code。只做第一步，装的还是旧版本。

```
claude plugin marketplace update rulesight
claude plugin update rulesight@rulesight
```

卸载：

```
claude plugin uninstall rulesight@rulesight
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
