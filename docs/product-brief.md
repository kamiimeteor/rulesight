# Rulesight — 产品说明

Oct 28, 2026 · @kamiimeteor

## 一句话和要解决的问题

Rulesight（Agent 行为复盘工具）会对照你给 agent 定的规则，检查一次编程 agent 会话，逐步指出它在哪里遵守了规则、在哪里违反了规则，或者声称做了其实没做的事。

现在大家会在 CLAUDE.md、skill 和行为规范里给 agent 定规则，但很难检查 agent 到底有没有照做。一次长会话可能有几百次工具调用，现有的查看器只能告诉你发生了什么，不能告诉你做得对不对。

产品名：**Rulesight**（2026-10-30 定，GitHub 和 npm 均已查重，域名 rulesight.dev）。

## 为什么是现在

编写 agent 行为的标准在 2026 年已经出现，但给写规则的人用的复盘体验还没有。

- **行为规范已成为开放标准。** Braintrust 和 Basis 发布了 [BEHAVIOR.md](https://github.com/braintrustdata/agentbehavior)：每种期望行为写一个文件，按整条执行轨迹判定为 true、false 或 n/a。
- **规范可以直接转成测试。** 微软在 2026 年 6 月开源了 [ASSERT](https://commandline.microsoft.com/assert-written-intent-executable-evals/)，能把自然语言写的要求转成测试用例，并对执行轨迹打分。
- **两者都面向工程师。** 输出的是 YAML、JSON 和命令行结果，还没有工具把附带证据、看得懂的结论交给写规则的人。

所以要赶在大厂补上这一层之前，先把附带证据、看得懂的判定交到用户手里。

## 目标用户和核心场景

第一版服务用 Claude Code 做东西、但不写代码的人：他们自己维护 CLAUDE.md 规则或 skill，想知道 agent 是否真的照做。

- **主要用户：** 用 Claude Code 做产品的设计师、产品经理和创业者。他们看不懂代码和 diff，没法自己核实 agent 说的是不是真的，只能相信它的话。
- **为什么不是工程师：** 工程师能自己读代码核实，也已经有 heeded、showwork 这类命令行工具；不写代码的人写不出正则，也看不懂命令行表格。
- **之后：** 为团队要上线的 agent 编写行为规范的 AI 产品设计师和产品经理。

核心场景：

1. 用户有一条规则，比如“没有实际跑过测试，就不能说测试通过了”。
2. 用户正常完成一次 Claude Code 会话。
3. 在 Claude Code 里输入 `/rulesight:rulesight`，工具读取本地日志和用户的规则。
4. 用户拿到一份报告：每条规则标注为遵守、违反或不适用，并链接到作为证据的具体那一步。
5. 用户修改规则或提示词，下一次会话再检查。

## 竞争格局和定位

会话查看器已经很拥挤，所以这个产品不再做一个查看器，而是在查看器之上做“判断层”。

| 层 | 例子 | 回答的问题 | 缺口 |
| --- | --- | --- | --- |
| 会话查看器 | [claude-devtools](https://trendshift.io/repositories/161105)、[Claude Trace Replay](https://github.com/harrylettering/claude-trace-replay/wiki)、[claude-code-log-trajectory](https://github.com/swchen44/claude-code-log-trajectory/releases) | agent 按顺序做了什么？ | 不会对照你的规则做判断 |
| 行为标准和测试 | [BEHAVIOR.md](https://github.com/braintrustdata/agentbehavior)、[ASSERT](https://commandline.microsoft.com/assert-written-intent-executable-evals/) | 怎么定义行为、怎么打分？ | 输出给工程师看，不是给写规则的人看 |
| 规则遵守检查（2026 年 10 月新出现） | [heeded](https://github.com/mmelqadi/heeded)、[showwork](https://github.com/bmdhodl/showwork)，以及 heeded README 提到的 HarnessScope、rulehook、dead-rules-audit、claude-doctor | 规则有没有被遵守？遵守率多少？ | 规则要写成正则或 JSON；输出是命令行表格，不是给人看的报告 |
| **本产品** | Rulesight | 它有没有遵守我的规则？证据在哪？ | 切入点 |

定位：日志读取自己做（官方 SDK 读长会话不完整，见决定记录），但只做到能读全为止，把精力放在导入规则、做判定，以及一份非工程师两分钟就能看懂的报告上。

和 heeded、showwork 这类规则检查工具的差异只有两点，必须做实：

1. **规则用自然语言写，由 LLM 判定。** “需求不明确先问用户”、“不要改和任务无关的文件”这类规则写不成正则。
2. **每条判定附带证据，报告给人看。** 卡片式报告，先说发生了什么，再给出那一步的原文，最后给出处理建议。

## 第一版范围：做什么，不做什么

第一版是一个 Claude Code 插件，加一个本地网页报告：用户在 Claude Code 里输入 `/rulesight:rulesight`，不用碰终端。只支持一个 agent（Claude Code），只做一件事——给出附带证据的规则判定。第一版免费。

**做**

- 读取本地的 Claude Code 会话日志（JSONL），Rulesight 自己读取（读全整份文件），再整理成 Rulesight 自己的步骤格式（判定和报告只认这个格式，以后接 Codex、Cursor 只加适配器）
- 从 CLAUDE.md 和 BEHAVIOR.md 文件导入规则
- 由一个单独的判定子 agent 对每次会话逐条判定规则：遵守、违反或不适用。它用用户自己的 Claude Code 和订阅额度，上下文全新、只读，不是被检查的会话给自己打分。API key 可选，只用于校准测试
- 每条判定都链接到能证明它的那一步
- 每次会话生成一个报告页面，可以导出成独立的 HTML 文件分享

**不做**

- 会话进行中的实时监控
- Codex、Cursor 等其他 agent（放到第二版）
- 成本和 token 统计（已有很多工具）
- 账号、云同步、团队看板、支付

## 成功标准和里程碑

到 2027 年 2 月中旬，“做成了”的意思是：有外部用户真正用过，并且已经公开发布。

- [ ] 至少 10 个我以外的人用它检查过自己的会话
- [ ] 其中至少 3 人给出书面反馈
- [ ] 在 20 次会话上，判定结果与我的人工复核一致率至少 80%
- [ ] 公开代码仓库、发布帖，以及一篇关于 agent 行为复盘的文章

里程碑：产品说明和第一篇文章（10/28–11/8）→ 判定原型（11/9–11/29）→ 公开发布 v0.1（12/13）→ 10 个外部用户（12/14–1/17）→ v0.3、文章（1/18–2/7）。

12 月中旬的公开发布是硬性节点；之后，用户反馈和打磨并行推进。

## 风险和待定问题

最大的风险是判定结果错得太多，用户不再信任报告。

| 风险 | 应对 |
| --- | --- |
| LLM 判定出错 | 每条判定都展示证据那一步；用户可以标记“判错了”；上线前用 20 次人工复核过的会话测一致率 |
| 会话日志里有私密代码 | 本地优先；除了经用户自己的 Claude Code 调用模型，数据不离开本机 |
| 判定依赖用户 Claude Code 当前的模型，结果可能不稳定 | 判定子 agent 固定输出格式，每条判定必须附证据；一致率测试用固定模型的 API key 跑 |
| 用户没有 API key | 默认用用户自己 Claude Code 的订阅额度；不提供 claude.ai 登录（Agent SDK 条款不允许第三方这么做） |
| Claude Code 更改日志格式 | 依赖有人维护的解析器；锁定版本；每次发版都测试 |
| 大厂抢先做了这一层 | 12 月中旬前发布 v0.1；守住附带证据、给人看的判定报告这个差异点 |
| 可投入的时间不够 | 范围只限一个 agent、一份报告；每周列出可以砍掉的内容 |

待定问题：

- [x] 正式产品名：Rulesight
- [x] 基于哪个解析器开发：先用官方 Agent SDK，2026-10-29 改为自己读 JSONL（SDK 读长会话只返回最后一段）
- [ ] 报告形式：只做网页，还是同时为 pull request 生成 Markdown 摘要
- [ ] 校准测试用哪个 API 模型
- [x] 读取 `private/` 里的 JSONL 文件：改 `CLAUDE_CONFIG_DIR`（见 `docs/decisions.md` 2026-10-28）
