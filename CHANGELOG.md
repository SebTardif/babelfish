# Changelog

## Unreleased

- Prefer exact installed Hermes plugin keys and reject ambiguous manifest aliases.
- Run imported command hooks, monitors, and package builds through platform-portable paths; accept native Windows plugin source paths, preserve POSIX login-shell behavior, terminate process trees across platforms, and report launch failures without terminating OpenClaw.
- Generate MCP tools, resources, and prompts only when the server advertises the corresponding capability.
