import solc from "solc";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function compile() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const sources = Object.fromEntries(
    ["Settlement", "TestUSDC"].map((name) => [
      `${name}.sol`,
      {
        content: readFileSync(
          resolve(root, "contracts", `${name}.sol`),
          "utf8",
        ),
      },
    ]),
  );
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "shanghai",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
      {
        import: (path: string) => {
          try {
            return {
              contents: readFileSync(
                resolve(root, "node_modules", path),
                "utf8",
              ),
            };
          } catch {
            return { error: `Missing import ${path}` };
          }
        },
      },
    ),
  );
  const errors = (output.errors ?? []).filter(
    (e: { severity: string }) => e.severity === "error",
  );
  if (errors.length)
    throw new Error(
      errors
        .map((e: { formattedMessage: string }) => e.formattedMessage)
        .join("\n"),
    );
  return Object.fromEntries(
    ["Settlement", "TestUSDC"].map((name) => [
      name,
      {
        abi: output.contracts[`${name}.sol`][name].abi,
        bytecode:
          `0x${output.contracts[`${name}.sol`][name].evm.bytecode.object}` as `0x${string}`,
      },
    ]),
  ) as Record<"Settlement" | "TestUSDC", { abi: any; bytecode: `0x${string}` }>;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  mkdirSync(".local/artifacts", { recursive: true });
  for (const [name, artifact] of Object.entries(compile()))
    writeFileSync(
      `.local/artifacts/${name}.json`,
      JSON.stringify(artifact, null, 2),
    );
  console.log("Compiled Settlement and TestUSDC (test networks only).");
}
