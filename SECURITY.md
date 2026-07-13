# Security Policy

If you believe you found a security vulnerability in Babelfish, report it
privately. Do not open a public issue or pull request containing an exploit,
secret, or unpatched vulnerability.

## Reporting

Use a private [GitHub security advisory](https://github.com/openclaw/babelfish/security/advisories/new).
If that route is unavailable, email `security@openclaw.ai` and include
`Babelfish` in the subject.

Include:

- The affected version or commit.
- A minimal reproduction or proof of concept.
- The security boundary crossed and resulting impact.
- Relevant configuration with credentials and private data removed.
- A suggested remediation, when possible.

The project supports the latest published release and current `main`. Reports
against older revisions should also show that the issue remains reachable in a
supported version.

## Trust Model

Babelfish installs and adapts third-party plugins. Installing a plugin grants
that plugin the privileges of local code running as the OpenClaw process.
Plugin discovery, hooks, commands, tools, MCP servers, and Hermes imports may
execute code from the installed repository.

A malicious plugin behaving maliciously after an operator deliberately
installs it is not, by itself, a Babelfish vulnerability. Security reports
should demonstrate a Babelfish boundary failure, such as:

- Escaping the configured install or generated-output directories.
- Executing plugin code without the operator installing or enabling it.
- Bypassing an OpenClaw approval, tool-policy, or trust boundary.
- Leaking secrets or private data through Babelfish-controlled behavior.
- Confusing plugin identity so one plugin replaces or invokes another.
- Command, hook, or MCP translation changing the source security semantics.

Prompt injection alone, scanner output without a reachable impact, and
dependency advisories without a Babelfish reproduction are generally treated
as hardening or maintenance issues rather than vulnerabilities.
