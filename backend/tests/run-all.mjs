// Runs every *.test.mjs in this folder, then reports one combined result.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { summary } from "./harness.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();

for (const file of files) {
  console.log(`\n########  ${file}  ########`);
  await import(`file://${path.join(dir, file).replace(/\\/g, "/")}`);
}

process.exit(summary() ? 0 : 1);
