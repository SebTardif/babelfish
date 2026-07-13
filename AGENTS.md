# Repository Guidelines

## Scope

These instructions apply to the entire repository. Babelfish imports plugin
surfaces from Claude Code, Codex, and Hermes Agent into OpenClaw.

## Commands

```bash
npm ci
npm run check
npm run pack:check
npx vitest run src/<name>.test.ts
```

Python 3 must be available as `python3` for Hermes bridge tests.

## Layout

- `src/`: TypeScript plugin discovery, translation, runtime, CLI, and tests.
- `python/`: Hermes Agent bridge.
- `test/fixtures/`: Minimal source-plugin fixtures.
- `scripts/`: Build and package validation.
- `openclaw.plugin.json`: Stable OpenClaw plugin contract.
- `skills/` and `babelfish.generated.json`: Generated runtime outputs.

## Boundaries

Always:

- Add focused tests for compatibility or execution changes.
- Preserve transactional install and rollback behavior.
- Update the README compatibility table and changelog when semantics change.
- Use temporary directories and fixtures in tests.

Ask first:

- Changing public command names, generated tool names, or manifest contracts.
- Adding dependencies or broadening plugin trust permissions.
- Changing install locations or generated-file ownership.

Never:

- Commit `dist/`, package archives, `node_modules/`, or generated plugin output.
- Read from or mutate live `~/.openclaw` state in tests.
- Hide unsupported source behavior or weaken trust-boundary warnings.
- Add secrets, private paths, internal hosts, or unredacted logs.
