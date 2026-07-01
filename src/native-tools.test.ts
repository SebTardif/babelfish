import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildNativeToolEntries, normalizeMcpContent, regenerateNativeTools } from "./native-tools.js";

async function copyFixture(target: string): Promise<void> {
  const fixture = path.join(process.cwd(), "test/fixtures/simple-hermes-plugin");
  await fs.cp(fixture, path.join(target, "simple"), { recursive: true });
}

async function writeCommandFixture(root: string, name: string): Promise<void> {
  const target = path.join(root, name);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "plugin.yaml"), `name: ${name}\nversion: 0.0.0\n`);
  await fs.writeFile(
    path.join(target, "__init__.py"),
    [
      "def _handler(raw):",
      "    return raw",
      "",
      "def _setup(parser):",
      "    pass",
      "",
      "def register(ctx):",
      "    ctx.register_command('meet', _handler, 'Meet command')",
      "    ctx.register_cli_command('meet', 'Meet CLI', _setup, _handler, 'Meet CLI')",
      "",
    ].join("\n"),
  );
}

async function writeNamedCliFixture(root: string, plugin: string, command: string): Promise<void> {
  const target = path.join(root, plugin);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "plugin.yaml"), `name: ${plugin}\nversion: 0.0.0\n`);
  await fs.writeFile(
    path.join(target, "__init__.py"),
    `def register(ctx):\n    ctx.register_cli_command('${command}', '${command}', lambda parser: None, lambda args: None, '${command}')\n`,
  );
}

async function writeNamedCommandFixture(root: string, plugin: string, command: string): Promise<void> {
  const target = path.join(root, plugin);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "plugin.yaml"), `name: ${plugin}\nversion: 0.0.0\n`);
  await fs.writeFile(
    path.join(target, "__init__.py"),
    `def register(ctx):\n    ctx.register_command('${command}', lambda raw: raw, '${command}')\n`,
  );
}

describe("native generated tools", () => {
  it("maps MCP result blocks to OpenClaw text and image content", () => {
    expect(normalizeMcpContent([
      { type: "text", text: "ok" },
      { type: "image", data: "abc", mimeType: "image/png" },
      { type: "resource", resource: { text: "embedded" } },
      { type: "audio", data: "sound", mimeType: "audio/wav" },
    ])).toEqual([
      { type: "text", text: "ok" },
      { type: "image", data: "abc", mimeType: "image/png" },
      { type: "text", text: "embedded" },
      { type: "text", text: expect.stringContaining('"type": "audio"') },
    ]);
  });

  it("suffixes generated tool names that collide after sanitizing", () => {
    const tools = buildNativeToolEntries({
      installDir: "/tmp/hermes",
      plugins: [
        {
          key: "a.b",
          name: "A",
          version: "",
          description: "",
          path: "/tmp/hermes/a.b",
          tools: [
            {
              name: "shared",
              toolset: "a",
              description: "",
              schema: {},
              isAsync: false,
              requiresEnv: [],
              available: true,
            },
          ],
          hooks: [],
          middleware: [],
          commands: [],
          cliCommands: [],
          skills: [],
          auxiliaryTasks: [],
          unsupported: [],
        },
        {
          key: "a_b",
          name: "B",
          version: "",
          description: "",
          path: "/tmp/hermes/a_b",
          tools: [
            {
              name: "shared",
              toolset: "b",
              description: "",
              schema: {},
              isAsync: false,
              requiresEnv: [],
              available: true,
            },
            {
              name: "a_b__shared",
              toolset: "b",
              description: "",
              schema: {},
              isAsync: false,
              requiresEnv: [],
              available: true,
            },
          ],
          hooks: [],
          middleware: [],
          commands: [],
          cliCommands: [],
          skills: [],
          auxiliaryTasks: [],
          unsupported: [],
        },
      ],
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "a_b__shared",
      "a_b__shared_2",
      "a_b__shared_3",
    ]);
  });

  it("suffixes generated slash and CLI command names after sanitizing plugin slugs", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-commands-"));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-package-"));
    await Promise.all([writeCommandFixture(installDir, "a.b"), writeCommandFixture(installDir, "a_b")]);
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(root, "openclaw.plugin.json"),
      JSON.stringify({ id: "hermes-plugin", contracts: {} }, null, 2),
    );

    await regenerateNativeTools(
      { installDir, python: "python3", timeoutMs: 10000, env: {} },
      { root },
    );

    const registry = JSON.parse(
      await fs.readFile(path.join(root, "babelfish.generated.json"), "utf8"),
    );
    expect(registry.commands.map((entry: { name: string }) => entry.name)).toEqual([
      "babelfish_a_b_meet",
      "babelfish_a_b_meet_2",
    ]);
    expect(registry.cliCommands.map((entry: { name: string }) => entry.name)).toEqual([
      "babelfish_a_b_meet",
      "babelfish_a_b_meet_2",
    ]);
  });

  it("reserves the Babelfish management CLI root", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-commands-"));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-package-"));
    await writeNamedCliFixture(installDir, "client", "babelfish");
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(root, "openclaw.plugin.json"),
      JSON.stringify({ id: "babelfish", contracts: {} }, null, 2),
    );

    await regenerateNativeTools(
      { installDir, python: "python3", timeoutMs: 10000, env: {} },
      { root },
    );
    const registry = JSON.parse(
      await fs.readFile(path.join(root, "babelfish.generated.json"), "utf8"),
    );
    expect(registry.cliCommands[0]?.name).toBe("babelfish_client_babelfish");
  });

  it("namespaces OpenClaw CLI roots", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-commands-"));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-package-"));
    await writeNamedCliFixture(installDir, "client", "status");
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(root, "openclaw.plugin.json"),
      JSON.stringify({ id: "babelfish", contracts: {} }, null, 2),
    );

    await regenerateNativeTools(
      { installDir, python: "python3", timeoutMs: 10000, env: {} },
      { root },
    );
    const registry = JSON.parse(
      await fs.readFile(path.join(root, "babelfish.generated.json"), "utf8"),
    );
    expect(registry.cliCommands[0]?.name).toBe("babelfish_client_status");
  });

  it("namespaces OpenClaw reserved slash commands", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-commands-"));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-package-"));
    await writeNamedCommandFixture(installDir, "client", "status");
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(root, "openclaw.plugin.json"),
      JSON.stringify({ id: "babelfish", contracts: {} }, null, 2),
    );

    await regenerateNativeTools(
      { installDir, python: "python3", timeoutMs: 10000, env: {} },
      { root },
    );
    const registry = JSON.parse(
      await fs.readFile(path.join(root, "babelfish.generated.json"), "utf8"),
    );
    expect(registry.commands[0]?.name).toBe("babelfish_client_status");
  });

  it("writes generated registry and OpenClaw manifest tool contracts", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-native-tools-"));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-package-"));
    await copyFixture(installDir);
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(root, "openclaw.plugin.json"),
      JSON.stringify(
        {
          id: "hermes-plugin",
          contracts: { agentToolResultMiddleware: ["openclaw", "codex"] },
        },
        null,
        2,
      ),
    );

    await expect(
      regenerateNativeTools(
        { installDir, python: "python3", timeoutMs: 10000, env: {} },
        { root },
      ),
    ).resolves.toEqual({
      generatedTools: ["simple_echo", "simple_optional", "simple_state"],
      restartRequired: true,
    });

    const manifest = JSON.parse(await fs.readFile(path.join(root, "openclaw.plugin.json"), "utf8"));
    expect(manifest.contracts).toEqual({
      agentToolResultMiddleware: ["openclaw", "codex"],
      tools: ["babelfish_plugins_list", "simple_echo", "simple_optional", "simple_state"],
    });
    const registry = JSON.parse(
      await fs.readFile(path.join(root, "babelfish.generated.json"), "utf8"),
    );
    expect(registry.tools.map((entry: { name: string }) => entry.name)).toEqual([
      "simple_echo",
      "simple_optional",
      "simple_state",
    ]);
    expect(registry.commands).toEqual([
      {
        app: "hermes",
        name: "simple",
        plugin: "simple",
        originalName: "simple",
        description: "Simple command",
        argsHint: "<raw text>",
      },
    ]);
    expect(registry.cliCommands).toEqual([
      {
        app: "hermes",
        name: "simplecli",
        plugin: "simple",
        originalName: "simplecli",
        description: "Simple CLI command",
        argsHint: "",
      },
    ]);
    await expect(
      fs.readFile(
        path.join(root, "skills", "babelfish-generated", "babelfish-simple-simple_skill", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toContain("Simple Skill");
  });

  it("keeps generated contracts when an installed plugin fails to load", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-native-tools-"));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-package-"));
    const broken = path.join(installDir, "broken");
    await fs.mkdir(broken);
    await fs.writeFile(path.join(broken, "plugin.yaml"), "name: broken\n");
    await fs.writeFile(path.join(broken, "__init__.py"), "raise RuntimeError('broken')\n");
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    const manifest = '{"id":"babelfish","contracts":{"tools":["existing"]}}\n';
    const registry = '{"generatedAt":"old","installDir":"old","tools":[],"commands":[],"cliCommands":[]}\n';
    await fs.writeFile(path.join(root, "openclaw.plugin.json"), manifest);
    await fs.writeFile(path.join(root, "babelfish.generated.json"), registry);

    await expect(
      regenerateNativeTools(
        { installDir, python: "python3", timeoutMs: 10000, env: {} },
        { root },
      ),
    ).rejects.toThrow("broken");
    await expect(fs.readFile(path.join(root, "openclaw.plugin.json"), "utf8")).resolves.toBe(
      manifest,
    );
    await expect(fs.readFile(path.join(root, "babelfish.generated.json"), "utf8")).resolves.toBe(
      registry,
    );
  });

  it("qualifies copied skills and imports nested command markdown", async () => {
    const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "babelfish-bundle-state-"));
    const plugin = path.join(stateRoot, "claude-code", "fixture");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "babelfish-package-"));
    await fs.mkdir(path.join(plugin, ".claude-plugin"), { recursive: true });
    await fs.writeFile(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "fixture" }));
    await fs.mkdir(path.join(plugin, "skills", "review"), { recursive: true });
    await fs.writeFile(path.join(plugin, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: review\n---\n");
    await fs.mkdir(path.join(plugin, "commands", "git"), { recursive: true });
    await fs.writeFile(
      path.join(plugin, "commands", "git", "commit.md"),
      "---\ndescription: Commit selected files\nargument-hint: '[files]'\nallowed-tools: Bash(git status *)\n---\nCommit $ARGUMENTS.",
    );
    await fs.mkdir(path.join(root, "skills"));
    await fs.writeFile(path.join(root, "openclaw.plugin.json"), JSON.stringify({ id: "babelfish", contracts: {} }));
    await regenerateNativeTools(
      { installDir: path.join(stateRoot, "hermes"), rootDir: stateRoot, python: "python3", timeoutMs: 1000, env: {} },
      { root },
    );
    await expect(fs.readFile(path.join(root, "skills", "babelfish-bundles", "claude-code-fixture-review", "SKILL.md"), "utf8"))
      .resolves.toContain("name: claude-code-fixture-review");
    await expect(fs.readFile(path.join(root, "skills", "babelfish-bundles", "claude-code-fixture-git-commit", "SKILL.md"), "utf8"))
      .resolves.toMatch(/description: "Commit selected files"[\s\S]*argument-hint: '\[files\]'[\s\S]*allowed-tools: Bash\(git status \*\)[\s\S]*disable-model-invocation: true[\s\S]*Commit \$ARGUMENTS\./);
  });
});
