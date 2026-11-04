# Rulesight

Rulesight 会对照用户给 agent 定的规则（CLAUDE.md、BEHAVIOR.md），检查一次 Claude Code 会话，给每条规则一个判定（遵守 / 违反 / 不适用），并附上作为证据的那一步。

开始工作前先读：
- `docs/product-brief.md`：产品说明（问题、用户、竞品、第一版范围、里程碑、风险）
- `docs/decisions.md`：已经做过的决定和理由，不要推翻，除非我明确要求
- `docs/report-ui.md`：报告页的结构，界面以它为准
- `docs/step-format.md`：步骤格式，判定和报告只读这个格式

## 目标和时间

- 2026-12-13 前公开发布 v0.1（硬性节点）。
- 2027 年 2 月中旬前：至少 10 个外部用户，判定和人工复核一致率至少 80%。
- 这是个人项目，范围要小。拿不准的功能，默认不做。

## 硬性约束

- 测试用的会话文件放在 `private/` 目录下（已在 .gitignore 里）。含私人信息的会话永远不提交、不分享、不写进示例或文档；公开示例只用专门为演示准备的会话（比如一个个人菜谱 App）。
- 判定时会把会话内容发给模型 API。第一次跑判定前，先停下来和我确认用哪个模型、哪个 API key。
- 只做 Claude Code 一个 agent。Codex、Cursor 放到第二版。

## 当前进度（2026-10-28）

- 已完成：产品说明、命名（Rulesight）、报告页样稿验证、项目文件夹和交接文档；目标用户改为不写代码的 Claude Code 用户；第一版定为免费的 Claude Code 插件；会话读取定为官方 Agent SDK；步骤格式第 1 版定稿（`docs/step-format.md`）。
- 已完成（续）：Claude Code 适配器原型（`npm run adapt -- <sessionId> --projects-dir private/claude-home/projects`，`npm run check` 自检），测试会话放在 `private/claude-home/`。实测结论见 `docs/step-format.md` 的已知限制。
- 已完成（续）：判定原型（`npm run judge -- <steps.json> --rules <CLAUDE.md>`，`npm run check:verdicts` 校验），sonnet 第一次实测见 `docs/decisions.md`。
- 已完成（续）：被拦下的违规尝试算违反；报告页第 2 版（`npm run build:report` 后 `npm run report -- <verdicts.json> <steps.json>`），结构见 `docs/report-ui.md`。
- 已完成（续）：用全新 git 历史重建仓库（10-29，原因见 `docs/decisions.md` 2026-10-29）；产品改名 Rulesight（10-30）。
- 已完成（续）：会话读取改成自己读 JSONL，长会话能读全（10-29）。
- 已完成（续）：长会话分段判定（`--from/--to` 判一段时间，超过 10 段先报价，`--yes` 确认），步骤格式第 2 版。
- 已完成（11-04）：插件 `/rulesight:rulesight` 能跑完 读会话 → 判定 → 报告；语言改成先看会话语言；违反时按原因选修法；本地另一条线的改动合并进来（见 `docs/decisions.md` 2026-11-04）。
- 已完成（11-04）：v0.1 公开发布，GitHub Release `rulesight--v0.1.2`（https://github.com/kamiimeteor/rulesight/releases/tag/rulesight--v0.1.2）。从 GitHub 安装实测通过；条款复查过（见 `docs/decisions.md` 2026-11-04）。
- 下一步：找 3 到 5 个非工程师试用（社区调研里目标用户没出现）；在没配 GitHub SSH 密钥的电脑上试一次安装。每次发布都要改插件版本号。

## 产品原则

- 每条判定都必须附带证据，指向会话里具体的一步。没有证据的判定不输出。
- 报告给人看：先写发生了什么，再给出那一步的原文，最后给出规则和处理建议。不要只输出命令行表格。
- 规则用自然语言写，由 LLM 判定。这是和 heeded、showwork 等正则类工具的主要差异。
- 会话日志由 Rulesight 自己读 JSONL（2026-10-29 改，原因见 `docs/decisions.md`），读全整份文件，包括压缩前的内容和所有子 agent 分支。读出来后先转成 Rulesight 自己的步骤格式，判定和报告只认这个格式。

## 和我协作的方式

- 用中文和我沟通。代码、命令、文件名保持英文。
- 涉及安装、配置、调试的操作，一次只给一步，等我确认或贴出输出后再给下一步。
- 直接说问题，不要客套。我判断错了就指出来。
- 动手写代码前，先用几句话说明打算怎么做，等我同意。

## Skill 分工

已装的 skill 和 pstack（`pstack@cursor-plugins`，命令带 `pstack:` 前缀）有重叠，按下表选，一个环节只用一个。表里没有的 skill，默认不用。

| 环节 | 用这个 | 不用 |
|---|---|---|
| 写功能 | `/pstack:poteto-mode`，只走 feature playbook | 其他 skill 自由发挥 |
| 修 bug | `/pstack:poteto-mode` 的 bug-fix playbook；有便宜的本地测试时加 `/pstack:tdd` | `systematic-debugging`（作用重叠） |
| TypeScript 类型 | `/pstack:typescript-best-practices` | |
| 测试 / 验证 | `/pstack:create-verification-skill` 生成的项目内验证 skill；收尾前用 `verification-before-completion` | |
| 审代码 | `/pstack:interrogate` | `code-review`（只在 interrogate 不可用时用） |
| 查密钥、脱敏 | `security-review` | |
| 报告页检查 | 内置浏览器，对照 `docs/report-ui.md` | `ego-browser` |
| 一致率校准 | `claude plugin eval` | |
| 文档和文案 | `/pstack:unslop` | `humanizer`、`ai-tone-audit`（作用重叠） |

禁用：
- pstack 的 autopilot-full、autopilot-stack、shipping、autonomous-run、orchestrate、babysit playbook：它们会一直跑到合并，不停下来，和"写代码前先说明、等我同意"冲突。
- 任何把 `private/` 里的会话内容发给非 Claude 模型的多模型流程。
