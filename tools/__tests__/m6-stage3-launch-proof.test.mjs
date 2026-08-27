import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const proof = resolve(
  root,
  ".mastracode/plans/m6-stage3-orchestrator-launch-seam.proof",
);

const read = (path) => readFile(resolve(proof, path), "utf8");

describe("the M6 Stage 3 live proof", () => {
  test("records the intended red and green verdicts", async () => {
    const [without, withSeam] = await Promise.all([
      read("without.txt"),
      read("with.txt"),
    ]);

    expect(without.trimEnd().endsWith("PROOF: RED")).toBe(true);
    expect(withSeam.trimEnd().endsWith("PROOF: GREEN")).toBe(true);
    expect(withSeam).toContain("success.application=yad");
    expect(withSeam).toContain("success.window=true");
    expect(withSeam).toContain("refusal.application=gmail");
    expect(withSeam).toContain("refusal.byte_exact=true");
    expect(withSeam).toContain("gmail.launched=false");
    expect(withSeam).toContain("cleanup.proof_owned_processes=true");
  });

  test("calls the built orchestrator seam rather than the human CLI", async () => {
    const [client, script] = await Promise.all([read("client.mjs"), read("demo.sh")]);

    expect(client).toContain("dist/orchestrator/launch.mjs");
    expect(client).toContain("launchApplication(client, { name: applicationName })");
    expect(script).not.toContain("hub --open");
  });

  test("keeps personal data and browser launch commands out of the proof", async () => {
    const texts = await Promise.all(
      ["client.mjs", "demo.sh", "without.txt", "with.txt"].map(read),
    );
    const joined = texts.join("\n");

    for (const forbidden of [
      /user-data-dir/i,
      /profile directory/i,
      /cookies?/i,
      /credentials?/i,
      /email address/i,
      /mailbox/i,
      /[".]subject["=]/i,
      /[".]sender["=]/i,
      /[".]snippet["=]/i,
      /(?:exec|nohup|setsid)\s+(?:google-chrome|chromium)/i,
      /ps\s+(?:aux|-[a-z]*f)/i,
      /pgrep\s+-a/i,
    ]) {
      expect(joined).not.toMatch(forbidden);
    }
  });
});
