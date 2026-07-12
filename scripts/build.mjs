import { build } from "esbuild";

const shared = {
  bundle: true,
  external: ["@modelcontextprotocol/sdk/*"],
  format: "esm",
  packages: "bundle",
  platform: "node",
};

await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
});

await build({
  ...shared,
  banner: { js: "#!/usr/bin/env node" },
  entryPoints: ["src/bin.ts"],
  outfile: "dist/bin.js",
});
