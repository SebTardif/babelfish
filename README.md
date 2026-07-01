# Babelfish

Babelfish lets OpenClaw install and use plugins made for other coding and agent
apps.

Install a source plugin through the human-operated OpenClaw CLI, restart
OpenClaw, and Babelfish exposes each compatible contribution through the
closest native OpenClaw surface. Unsupported contributions are reported rather
than silently approximated.

## Install

```bash
npm install
npm run build
openclaw plugins install --link .
```

Enable the plugin:

```jsonc
{
  "plugins": {
    "entries": {
      "babelfish": {
        "enabled": true
      }
    }
  }
}
```

Install a plugin from Git:

```bash
openclaw babelfish install <app> <git-url>
```

Supported app identifiers are `claude-code`, `codex`, and `hermes`.

Examples:

```bash
openclaw babelfish install claude-code https://github.com/owner/plugin.git
openclaw babelfish install codex https://github.com/owner/plugin.git
```

Restart OpenClaw after installing or removing a plugin. OpenClaw plugin
metadata and tool contracts are process-stable, so Babelfish generates the
contracts for the next load.

Management commands:

```bash
openclaw babelfish list [app]
openclaw babelfish install <app> <git-url> [--name <name>] [--force]
openclaw babelfish uninstall <app> <name>
```

Installing a plugin executes code from that repository while inspecting MCP
tools and while running imported hooks or tools. Babelfish intentionally does
not expose install or uninstall as agent tools. The read-only
`babelfish_plugins_list` agent tool lists installed plugins and detected
surfaces.

## How surfaces map

| Source plugin contribution | OpenClaw behavior |
| --- | --- |
| Agent tools | Generated native OpenClaw tools with the source JSON schema |
| MCP tools | Generated native OpenClaw tools backed by the declared MCP server |
| Skills | Native OpenClaw skills, including their bundled support files |
| Prompt commands | User-invoked OpenClaw skills with model auto-invocation disabled |
| Terminal commands | Top-level `openclaw <command>` commands when the source format provides them |
| Compatible command hooks | Matching OpenClaw lifecycle, prompt, tool, compaction, and subagent hooks |
| Compatible middleware | Matching OpenClaw tool middleware |
| Unsupported contributions | Recorded during generation and logged at Gateway startup |

Names remain unchanged when unique. Collisions receive a plugin-qualified
name. Install and uninstall regenerate `openclaw.plugin.json`,
`babelfish.generated.json`, and the generated skill directories.

## Support matrix

**Full** means the source behavior has a direct native mapping. **Partial**
means the useful behavior works with listed semantic gaps. **No** means the
surface is detected or documented but not executed. **N/A** means the source
format does not provide that surface.

| Plugin surface | Claude Code | Codex | Hermes Agent |
| --- | --- | --- | --- |
| Manifest metadata | Full | Full | Full |
| Native source-runtime tools | N/A | N/A | Full |
| MCP tools | Full for stdio, HTTP, and SSE without interactive auth | Full for stdio, HTTP, and SSE without interactive auth | N/A |
| MCP resources and prompts | No | No | N/A |
| Skills and support files | Full | Full | Full |
| User prompt commands | Partial: imported as user-only skills | N/A | Full: native slash commands |
| Terminal CLI commands | N/A | N/A | Full |
| Plugin-defined agents | Partial: imported as user-only skills; model and tool isolation are not preserved | N/A | N/A |
| Pre-tool command hooks | Full: block and argument rewrite | Full: block and argument rewrite | Full |
| Permission command hooks | No: OpenClaw has no equivalent approval-boundary event | No: OpenClaw has no equivalent approval-boundary event | N/A |
| Post-tool command hooks | Full, including failure hooks | Full | Full |
| Session start hooks | Full, including next-turn context injection | Full, including next-turn context injection | Full |
| Session end hooks | Full | Full when declared | Full |
| User-prompt hooks | Partial: additional context maps; prompt replacement and hard stop do not | Partial: additional context maps; prompt replacement and hard stop do not | Partial |
| Stop/finalization hooks | Full for continue/block decisions | Full for continue/block decisions | Partial |
| Pre/post compaction hooks | Full for observation | Full for observation | N/A |
| Subagent lifecycle hooks | Full | Full | Full |
| Prompt or agent hook handlers | No | No | N/A |
| Notification hooks | No | N/A | N/A |
| Tool-result middleware | N/A | N/A | Full |
| LLM/request/execution middleware | N/A | N/A | No |
| Codex app connectors | N/A | No | N/A |
| LSP servers | No | N/A | N/A |
| Monitors | No | N/A | N/A |
| Output styles | Partial: imported as user-only skills | N/A | N/A |
| Plugin settings/default agent | No | N/A | N/A |
| Supporting scripts, binaries, and assets | Full when referenced by an imported skill, hook, or MCP server | Full when referenced by an imported skill, hook, or MCP server | Full |
| Marketplace-native resolution | No; install the plugin Git repository directly | No; install the plugin Git repository directly | No; install the plugin Git repository directly |

## App notes

### Claude Code

Babelfish reads `.claude-plugin/plugin.json`, declared or conventional skill,
command, agent, output-style, hook, and MCP paths. Existing `SKILL.md`
directories are copied intact. Markdown commands, agents, and output styles are
converted to user-invoked OpenClaw skills.

Command hooks run with `${CLAUDE_PLUGIN_ROOT}` set to the installed plugin
directory. `command` handlers are supported. `prompt` and `agent` hook handlers
are reported as unsupported.

### Codex

Babelfish reads `.codex-plugin/plugin.json`, declared or conventional skills,
hooks, and MCP configuration. Manifest-inline hook declarations are supported.
`${PLUGIN_ROOT}` is expanded for hook and MCP commands.

Codex app connector IDs are not MCP servers and currently have no equivalent
Babelfish runtime surface.

### Hermes Agent

The selected Python environment must import each installed plugin and its
dependencies. Plugins that import client internals also require the source
client's Python package.

```bash
export OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR=/path/to/plugins
export OPENCLAW_BABELFISH_HERMES_PYTHON=/path/to/python3
export OPENCLAW_BABELFISH_HERMES_TIMEOUT_MS=120000
```

Compatible lifecycle, tool, message, run, subagent, and middleware callbacks
map to their matching OpenClaw hooks. Unmatched approval, kanban, execution,
LLM request, and output-transform callbacks produce startup warnings.

External plugins need conversation access for message and run hooks:

```jsonc
{
  "plugins": {
    "entries": {
      "babelfish": {
        "hooks": {
          "allowConversationAccess": true
        }
      }
    }
  }
}
```

## Optional MCP compatibility mode

The separate compatibility server is not part of the default OpenClaw install
path:

```bash
babelfish mcp
```

## Verification

```bash
npm run check
```

The test suite covers source-runtime tools, commands, skills, hook translation,
bundle discovery, transactional install/uninstall, and the optional MCP server.
