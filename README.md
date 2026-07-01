# Babelfish

Babelfish lets OpenClaw use plugins built for other coding and agent apps.

Install an app plugin through Babelfish, restart OpenClaw, and its supported
tools, commands, skills, hooks, and middleware become native OpenClaw surfaces.
The source app remains responsible for its plugin format and runtime
dependencies.

## Supported apps

| App | Status | Plugin surfaces |
| --- | --- | --- |
| Hermes Agent | Supported | Tools, slash commands, CLI commands, skills, compatible hooks, and compatible middleware |
| Claude Code | Planned | Not implemented |
| Codex | Planned | Not implemented |

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

Install a plugin from the human-operated OpenClaw CLI:

```bash
openclaw babelfish install hermes https://github.com/owner/plugin-example.git
```

Installing a plugin executes code from that repository while generating its
OpenClaw surfaces. Babelfish does not expose install or uninstall as agent tools.

Restart or reload OpenClaw after installing or removing a plugin. OpenClaw
plugin metadata is process-stable, so Babelfish generates the native contracts
for the next load.

Other management commands:

- `openclaw babelfish list [app]` lists installed plugins and imported surfaces.
- `openclaw babelfish uninstall <app> <name>` removes an installed plugin and
  regenerates native contracts.
- `babelfish_plugins_list` is the read-only agent tool for inspecting installed
  plugins.

## Surface mapping

Babelfish maps each source app to the closest stable OpenClaw plugin SDK
surface:

| Source surface | OpenClaw surface |
| --- | --- |
| Agent-callable tools | Generated native OpenClaw tools with the source JSON schema |
| User slash commands | OpenClaw plugin commands |
| Terminal CLI commands | Generated `openclaw <command>` roots |
| Skills | Generated OpenClaw `SKILL.md` files |
| Lifecycle, run, message, and tool hooks | Matching OpenClaw plugin hooks |
| Tool-result transforms | OpenClaw tool-result middleware |
| Unsupported hooks | Startup warnings; behavior is not approximated |

Imported tool and command names remain unchanged when unique. Collisions use a
plugin-qualified name. Installing or removing a plugin updates
`openclaw.plugin.json`, `babelfish.generated.json`, and generated skills.

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

## App reference

### Hermes Agent

The selected Python environment must be able to import each installed plugin
and its dependencies. Plugins that import client internals also require the
`hermes-agent` Python package.

The default plugin directory is `~/.openclaw/babelfish/hermes`. Override the
adapter runtime when needed:

```bash
export OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR=/path/to/plugins
export OPENCLAW_BABELFISH_HERMES_PYTHON=/path/to/python3
export OPENCLAW_BABELFISH_HERMES_TIMEOUT_MS=120000
```

Supported mappings:

| Client API | OpenClaw behavior |
| --- | --- |
| `ctx.register_tool(...)` | Native agent tool |
| `ctx.register_command(...)` | Native slash command |
| `ctx.register_cli_command(...)` | Native CLI command |
| `ctx.register_skill(...)` | Generated native skill |
| `pre_tool_call` / `post_tool_call` | `before_tool_call` block decisions / `after_tool_call` observation |
| `transform_tool_result` / `transform_terminal_output` | Tool-result middleware |
| `pre_llm_call` / `post_llm_call` | Turn preparation and LLM output hooks |
| `pre_api_request` / `post_api_request` / `api_request_error` | Model-call hooks |
| Session lifecycle hooks | Session and run lifecycle hooks |
| `subagent_start` / `subagent_stop` | Subagent lifecycle hooks |
| `pre_gateway_dispatch` | `before_dispatch`; `skip` is mapped, `allow` continues normally, and `rewrite` is listed only |
| `tool_request` middleware | `before_tool_call` argument rewrite, composed in registration order |
| Execution and LLM request middleware | Unsupported; logged at startup |
| Output transforms, approval, and kanban hooks | Unsupported; logged at startup |

## CLI

The maintenance binary mirrors the native management tools:

```bash
openclaw babelfish list
openclaw babelfish install hermes https://github.com/owner/plugin-example.git
openclaw babelfish uninstall hermes plugin-example
```

The optional MCP compatibility server is separate from the default install
path:

```bash
babelfish mcp
```

## Verification

```bash
npm run check
```

The current adapter is tested against plugins that exercise tools, commands,
skills, lifecycle hooks, tool hooks, and result transforms.
