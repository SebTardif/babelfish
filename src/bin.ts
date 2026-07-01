import { runBabelfishCli } from "./cli.js";

runBabelfishCli(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
