import packageJson from "../package.json" with { type: "json" };

export function isVersionRequest(args: ReadonlyArray<string>): boolean {
  return args.includes("--version") || args.includes("-v");
}

function printVersion() {
  process.stdout.write(`t3 v${packageJson.version}\n`);
}

if (import.meta.main) {
  if (isVersionRequest(process.argv.slice(2))) {
    printVersion();
  } else {
    void import("./cli/main.ts").then(({ runCli }) => {
      runCli(packageJson.version);
    });
  }
}
