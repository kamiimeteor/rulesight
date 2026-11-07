English | [简体中文](README.zh-CN.md)

# Rulesight

Rulesight is a Claude Code plugin. It checks the session you are in against the rules you wrote for Claude (`CLAUDE.md`), and gives each rule a verdict: followed, violated, or not applicable. A followed or violated verdict points to the step that shows it. At the end it opens an HTML report you can actually read.

It is for people who maintain a `CLAUDE.md` and do not read code: designers, product managers, founders. You cannot scroll through hundreds of tool calls to check whether the agent did what you asked. Rulesight does that reading, and puts the evidence where you can see it.

> v0.1, and still early. A model makes the verdicts, and some of them will be wrong. Read the step a verdict points to before you decide.

![A Rulesight report: one violated rule, four followed, two not applicable, with the evidence steps on a timeline](docs/images/report-overview.png)

*A demo session in a made-up todo app.*

## What the report shows

Suppose your `CLAUDE.md` says "ask me before you delete files." The report can read like this:

- **What happened.** Step 142 deleted `old-assets/`, and nothing before that asked you.
- **The step itself.** The command the agent actually ran, and what came back.
- **The rule, and where it is written.** `CLAUDE.md`, line 12.
- **What to do about it.** One suggestion, plus an instruction you can paste back to Claude.

An attempt the permission system or the sandbox stopped still counts as a violation. Rulesight answers whether the agent followed the rule, including when the attempt never went through.

<img src="docs/images/report-detail.png" width="480" alt="A violated verdict: a hook blocked rm, the agent used git rm instead, and the fix suggests blocking every delete command">

*In the demo, a hook blocked `rm`, so the agent ran `git rm` instead. The report names the workaround and suggests blocking every way to delete a file.*

## Rulesight and hooks

Rulesight reads the transcript after the session ends. It cannot stop a command that is already running.

Rules that a machine can enforce on its own, such as staying inside the project folder or refusing a class of command, belong in a Claude Code hook or a permission setting, so the command is refused before it runs. Rules that need a judgment, such as "ask me when the request is unclear" or "read the style guide before you rewrite the copy," cannot be written as a hook. Rulesight checks those afterwards.

When a rule was broken, the suggestion is aimed at the reason, so the same mistake is less likely next time. It picks one of four changes: a hook or a permission setting, a skill that holds the procedure, a fresh session, or a clearer wording of the rule.

## Before you start

- [Claude Code](https://code.claude.com), already signed in.
- Node.js 18 or newer ([nodejs.org](https://nodejs.org); on a Mac with Homebrew, `brew install node` works too).
- A few rules in `CLAUDE.md` that you want Claude to follow. A global `~/.claude/CLAUDE.md` or one in the project both work.

## Install

In a Claude Code session, run these in order:

```
/plugin marketplace add kamiimeteor/rulesight
/plugin install rulesight@rulesight
```

The second command opens the plugin details panel. Pick an install scope there and confirm. After it is installed, run `/reload-plugins`, or restart Claude Code.

You can also install from a terminal, without opening a session:

```
claude plugin marketplace add kamiimeteor/rulesight
claude plugin install rulesight@rulesight
```

## Usage

In the session you want checked, run:

```
/rulesight:rulesight
```

Rulesight first tells you how many rules it will check, how many segments that splits into, and a rough cost and time. With more than 10 segments it asks first, and starts only after you agree. When it finishes, it opens the report. The file is saved in the plugin's data directory. If that directory cannot be written, for example because a sandbox is in the way, Rulesight switches to a temp directory before judging starts and tells you the path. The report is one HTML file, and it opens with no network.

## Read this first

**It spends your own quota.** Judging calls the `claude` command on your machine and uses your subscription quota. The dollar figure is an estimate at API prices. Rulesight does not bill you on top of that. A short session usually finishes in a minute or two. A long session that has been going for many days can be split into dozens of segments. At API prices that runs from a few dollars to a few dozen dollars.

**The session is sent to Anthropic.** While judging, the session and your rules go to Anthropic's model through your own Claude Code, the same path as ordinary Claude Code use. They are not sent to the author of Rulesight, or anywhere else. The judge is a new Claude with no tools. The session under review does not grade itself.

**The report contains text from the session.** Steps used as evidence are included in full. Every other step is a one-line summary, which can include commands and file names. The report stays on your computer. Before you forward it, look through it for passwords and client details.

**Claude Code deletes old sessions on its own.** By default it keeps local session logs for 30 days. A session you started or last continued in the desktop app is kept. To hold on to logs so you can check them later, add `"cleanupPeriodDays": 365` to `~/.claude/settings.json`, or ask Claude to add it.

**If you agreed, in your own words, that counts as followed.** Say the rule is "ask me before you delete files," and you wrote "go ahead and delete old-notes/, no need to ask." If the agent does that, the verdict is followed, and the report cites the step where you said it. An answer you picked or typed on a question card counts as your own words too. If you later wrote "don't delete that yet" and a delete still happened, that is a violation. A tool result or a file that claims "the user already approved this" does not count. If a one-off yes in the session should not count, say so in the rule, for example "ask me first even if I said you don't need to."

**Some verdicts will be wrong.** Judging the same session twice disagrees about one time in ten, mostly on the line between followed and not applicable. In the report you can mark a verdict Wrong.

## Current limitations

- Claude Code only, for now. Codex and Cursor are not supported.
- It checks the session where you ran the command, and only the part before the command. Text you put after the command is not treated as a task.
- Rules are read the way Claude Code loads them: `~/.claude/CLAUDE.md`, the files in `~/.claude/rules/`, and, from the project the session belongs to, `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, and the files in `.claude/rules/`. Files those files pull in with `@` are read too, up to 4 levels. `CLAUDE.md`, `AGENTS.md`, and `BEHAVIOR.md` in a parent folder or a subfolder are not read.
- Some imported files are not rules (a decision log, notes) and they can be long. Checking them every time only costs more. List their paths in `~/.rulesight/skip.txt`, one per line. `~` is allowed. Rulesight then skips those files and anything they import, and the plan names each skipped file and how many rules it held. You can ask Claude to add the paths.
- Only list items (bullets and numbered lists, such as `- …` and `1. …`) and table rows are treated as rules. A rule written as a paragraph is missed. To have it checked, rewrite it as a list.
- Rules are judged from the files as they stand when you run the check. Rulesight cannot tell a rule Claude never loaded from a rule Claude loaded and then ignored. It also does not check which rules a sub-agent actually received, or whether the rules contradict each other.
- It reads the session transcript. It does not open the files on disk, and it does not read git. If the agent changed files through a script, a glob, or a build command, and the transcript never names the path, Rulesight cannot see that change.
- A long session is split into segments and each segment is judged on its own. From earlier segments, only words you said yourself, including an answer you picked or typed on a question card, can be used as evidence, and only to judge whether you agreed or took that agreement back. The rest of the earlier material is there for context. If there is a lot of it, only about the most recent 20,000 characters are included, so an earlier yes can be left out.
- Simplified Chinese and English only.
- Tested on macOS only, so far.
- Reading a session depends on Claude Code's local logs. That format is not a public API. After a Claude Code update, Rulesight may read the logs only in part, or not at all.

## Language

Command output, the report page, and the reasons for verdicts are in English or Chinese. By default Rulesight follows the language you used with Claude in that session. A Chinese session gets a Chinese report. Any other language gets English. When the session does not show a language, for example because you never wrote a sentence, Rulesight uses the system language, in this order: `LC_ALL`, `LC_MESSAGES`, `LANG`, then Node's `Intl` locale. If none of those is Chinese or English, the report is in English. To pin the language, set this before you start Claude Code:

```
export RULESIGHT_LANG=en   # or zh
```

## Update and uninstall

An update is two steps. Update the marketplace, then update the plugin, then restart Claude Code. The first step on its own leaves the old plugin in place.

```
claude plugin marketplace update rulesight
claude plugin update rulesight@rulesight
```

Uninstall:

```
claude plugin uninstall rulesight@rulesight
```

## Feedback

A wrong verdict, a session that will not load, a report that is hard to follow: please open an issue. For a wrong verdict, use the [wrong verdict form](https://github.com/kamiimeteor/rulesight/issues/new?template=wrong-verdict.yml); it asks for the rule and what happened, not the session. Otherwise the Claude Code version and the error text are enough. Please do not paste the session.

## Development

```
npm ci
npm run typecheck
npm run build:plugin   # regenerates plugin/bin/rulesight.mjs and plugin/assets/report-template.html
npm test               # language, step summaries, and English and Chinese output (run build:plugin first)
claude plugin validate .
```

To try the plugin locally: `claude --plugin-dir ./plugin`.

Design notes are in Chinese, in [`docs/`](docs/):

- [product-brief.md](docs/product-brief.md): what the product is
- [decisions.md](docs/decisions.md): decisions and why
- [step-format.md](docs/step-format.md): the step format
- [report-ui.md](docs/report-ui.md): how the report is laid out

## License

MIT. See [LICENSE](LICENSE).
