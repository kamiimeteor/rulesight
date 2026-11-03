# Rulesight

Rulesight 是一个 Claude Code 插件：对照你写给 Claude 的规则（`CLAUDE.md`），检查当前这场会话，给每条规则一个判定（遵守 / 违反 / 不适用），附上作为证据的那一步，最后打开一份看得懂的网页报告。

*Rulesight is a Claude Code plugin that checks the current session against the rules in your `CLAUDE.md`, gives each rule a verdict (followed / violated / not applicable) with the step that proves it, and opens a readable HTML report. Its language follows your system locale, defaults to English, and can be switched with `RULESIGHT_LANG`; see the Language section below.*

## 需要先准备

- [Claude Code](https://code.claude.com)，已经登录。
- Node.js 18 或更新的版本（[nodejs.org](https://nodejs.org)；Mac 上装了 Homebrew 的话也可以 `brew install node`）。
- 项目里有 `CLAUDE.md`，写了几条你希望 Claude 遵守的规则。

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

Rulesight 会先告诉你对照了多少条规则、会切成几段、大约花多少钱和多久；会话很长时会先问你要不要继续。跑完后自动打开报告，报告文件保存在插件的数据目录里（找不到时是 `~/.rulesight/reports/`）。

判定用的是你自己装的 `claude` 命令和你自己的额度：会话内容经由你自己的 Claude Code 发给 Anthropic 的模型做判定，Rulesight 不会把它发到别的地方。报告只存在你的电脑上。

## 语言 / Language

命令输出、报告页和判定理由都支持中文和英文。默认跟随系统语言：依次看 `RULESIGHT_LANG`、`LC_ALL`、`LC_MESSAGES`、`LANG`，都不是中文或英文时看 Node 的 `Intl` 语言，最后默认英文。想固定语言，在启动 Claude Code 前设置环境变量：

```
export RULESIGHT_LANG=zh   # 或 en
```

*Command output, the report page and the verdict reasons come in English or Chinese. By default Rulesight follows your system language: `RULESIGHT_LANG`, then `LC_ALL`, `LC_MESSAGES`, `LANG`, then Node's `Intl` locale, falling back to English. To switch it, set `RULESIGHT_LANG=en` (or `zh`) before starting Claude Code.*

## 更新和卸载

```
/plugin marketplace update rulesight
/plugin uninstall rulesight@rulesight
```

## 开发

```
npm ci
npm run typecheck
npm run build:plugin   # 重新生成 plugin/bin/rulesight.mjs 和 plugin/assets/report-template.html
npm test               # 语言选择和中英文输出的测试（先 build:plugin）
claude plugin validate .
```

本地试装：`claude --plugin-dir ./plugin`。

设计和决定记录在 `docs/`：`product-brief.md`（产品说明）、`decisions.md`（决定和理由）、`step-format.md`（步骤格式）、`report-ui.md`（报告页结构）。

## 许可证

MIT，见 [LICENSE](LICENSE)。
