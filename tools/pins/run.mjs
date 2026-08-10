import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// CI step 4 (docs/05-TEST-STRATEGY.md:130): run the wired source pins, and fail
// if the wired set does not match the declared list in README.md - a silently
// dropped pin must be a red build, not a quiet absence.

const here = fileURLToPath(new URL(".", import.meta.url));

const readme = readFileSync(join(here, "README.md"), "utf8");
const declaredLine = readme.match(/^Wired: *(.+)$/m);
if (!declaredLine) {
  console.error("pins: README.md declares no wired set (expected a line 'Wired: b1, b5, ...')");
  process.exit(1);
}
const declared = declaredLine[1]
  .split(",")
  .map((s) => s.trim())
  .sort();
const wired = readdirSync(here)
  .filter((f) => /^b\d+\.mjs$/.test(f))
  .map((f) => f.replace(".mjs", ""))
  .sort();

if (declared.join(",") !== wired.join(",")) {
  console.error(
    `pins: wired set [${wired.join(", ")}] does not match README.md's declared set [${declared.join(", ")}]`,
  );
  process.exit(1);
}

let red = 0;
for (const pin of wired) {
  const result = spawnSync(process.execPath, [join(here, `${pin}.mjs`)], { stdio: "inherit" });
  console.log(`PIN_${pin}=${result.status}`);
  if (result.status !== 0) red += 1;
}

if (red > 0) {
  console.error(`pins: ${red} pin(s) red`);
  process.exit(1);
}
console.log(`pins: all ${wired.length} wired pin(s) green`);
