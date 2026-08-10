import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// CI step 8 (docs/05-TEST-STRATEGY.md:134 and §3): mutation checks by the manual
// method the prototype practised - break a guarantee on purpose, run the suite,
// require at least one test to go red, restore. tools/mutations.json is the
// committed table of mutations. A mutation that produces zero red tests fails
// the step, because that is the guarantee whose test asserts nothing.

const root = fileURLToPath(new URL("..", import.meta.url));
const table = JSON.parse(readFileSync(join(root, "tools", "mutations.json"), "utf8"));

if (table.length === 0) {
  console.error("mutations: the table is empty - the step would pass vacuously");
  process.exit(1);
}

let survived = 0;
for (const mutation of table) {
  const file = join(root, mutation.file);
  const original = readFileSync(file, "utf8");
  if (!original.includes(mutation.find)) {
    console.error(`mutation ${mutation.name}: find string not present in ${mutation.file} - the table is stale`);
    survived += 1;
    continue;
  }

  const report = join(mkdtempSync(join(tmpdir(), "mutations-")), "report.json");
  writeFileSync(file, original.replace(mutation.find, ""));
  let red = 0;
  try {
    spawnSync(
      join(root, "tools", "node_modules", ".bin", "vitest"),
      ["run", mutation.testFile, "--reporter=json", "--outputFile", report],
      { cwd: join(root, mutation.cwd), stdio: "ignore" },
    );
    red = JSON.parse(readFileSync(report, "utf8")).numFailedTests;
  } catch (err) {
    console.error(`mutation ${mutation.name}: the test run produced no readable report (${err.message})`);
  } finally {
    writeFileSync(file, original);
  }

  console.log(`mutation ${mutation.name}: ${red} test(s) went red`);
  if (red === 0) survived += 1;
}

if (survived > 0) {
  console.error(`mutations: ${survived} mutation(s) survived - a surviving mutation is a test that asserts nothing`);
  process.exit(1);
}
console.log(`mutations: ok - ${table.length} mutation(s), none survived`);
