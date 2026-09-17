import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const image = "lscr.io/linuxserver/webtop:ubuntu-kde@sha256:d91fb284794d554d89b4b210ebe56a538c755dfb2054a3741ed7471363cd5369";

describe("Webtop semantic desktop harness", () => {
  it("pins the approved image and preserves declared volumes", async () => {
    const compose = await read("infra/webtop/compose.yml");
    expect(compose).toContain(`image: ${image}`);
    expect(compose).toContain("127.0.0.1:${MASTRA_CC_WEBTOP_PORT}:3000");
    expect(compose).toContain("name: ${MASTRA_CC_WEBTOP_PROJECT}-config");
    expect(compose).toContain("name: ${MASTRA_CC_WEBTOP_PROJECT}-workspace");
    expect(compose).toContain("name: ${MASTRA_CC_WEBTOP_PROJECT}-profile");
  });

  it("uses built artifacts, bounded readiness, and scoped cleanup", async () => {
    const [common, start, cleanup] = await Promise.all([
      read("infra/webtop/common.sh"),
      read("infra/webtop/start.sh"),
      read("infra/webtop/cleanup.sh"),
    ]);
    expect(common).toContain('docker cp "$ROOT/daemon/dist/."');
    expect(common).toContain('docker cp "$ROOT/packages/transport/dist/."');
    // The built transport imports @mastra-cc/protocol-types at runtime, so the
    // built package must be deployed under node_modules or the scenario client
    // dies before any proof runs.
    expect(common).toContain('docker cp "$ROOT/packages/protocol-types/dist/."');
    expect(common).toContain("$DEPLOY/node_modules/@mastra-cc/protocol-types");
    expect(common).not.toContain("daemon/src");
    expect(common).not.toContain("packages/transport/src");
    expect(common).not.toContain("packages/protocol-types/src");
    expect(start).toMatch(/wait_for 'container health' \d+ \d+/);
    expect(start).toMatch(/wait_for 'AT-SPI accessibility bus' \d+ \d+/);
    expect(start).toMatch(/wait_for 'CDP daemon socket' \d+ \d+/);
    // A fresh named volume is root-owned, so every directory the session user
    // writes into must be handed to it before anything is launched. Chromium
    // aborts outright when it cannot create a lock in its profile directory.
    expect(start).toMatch(/chown -R 1000:1000 .*\/config\/\.chromium-proof/);
    expect(cleanup).toContain('"${COMPOSE[@]}" down --remove-orphans');
    expect(cleanup).not.toMatch(/docker\s+(system\s+prune|rm\s+-f\s+\$\()/);
  });

  it("corroborates the written sentence with a committed out-of-band visual witness", async () => {
    const [common, demo, witness] = await Promise.all([
      read("infra/webtop/common.sh"),
      read("infra/webtop/demo.sh"),
      read("infra/webtop/witness.mjs"),
    ]);
    // The witness is a committed artifact deployed into the container and driven
    // inside the desktop session (it needs DISPLAY and the AT-SPI bus).
    expect(common).toContain('docker cp "$WEBTOP_DIR/witness.mjs"');
    expect(demo).toContain('/witness.mjs');
    expect(demo).toContain("session_exec");
    // It must run against the sentence the semantic lane wrote, and before the
    // subscribe step overwrites the editor with a different sentence.
    expect(demo.indexOf("witness.mjs")).toBeGreaterThan(demo.indexOf("scenario-client.mjs\" semantic"));
    expect(demo.indexOf("witness.mjs")).toBeLessThan(demo.indexOf("scenario-client.mjs\" subscribe"));
    // It reads the element rectangle out of band from AT-SPI's Component
    // interface - not from the daemon under test - and captures only that crop.
    expect(witness).toContain("Atspi.CoordType.SCREEN");
    expect(witness).toContain("get_component_iface");
    expect(witness).toContain("Atspi.Component.get_extents");
    // It refuses to guess: named RED lines on stderr, and a single GREEN lock.
    expect(witness).toContain("WITNESS: RED - ");
    expect(witness).toContain('WITNESS: GREEN\\n');
    // It rejects a blank or uniform editor rather than passing on empty ink.
    expect(witness).toMatch(/blank or uniform/);
  });

  it("keeps protected values out of responses and diagnostics", async () => {
    const [client, demo, diagnostics] = await Promise.all([
      read("infra/webtop/scenario-client.mjs"),
      read("infra/webtop/demo.sh"),
      read("infra/webtop/diagnostics.sh"),
    ]);
    expect(client).toContain('element.content.kind === "redacted"');
    expect(client).toContain('if ("value" in protectedElement.content)');
    expect(demo).toContain('grep -Fq "$PROTECTED_VALUE"');
    expect(diagnostics).toContain('grep -R -Fq "$PROTECTED_VALUE"');
    expect(demo).not.toContain('diagnostics.sh" >/dev/null 2>&1 || true');
  });

  it("locks successful transcript lines last", async () => {
    const [demo, recreate] = await Promise.all([
      read("infra/webtop/demo.sh"),
      read("infra/webtop/recreate.sh"),
    ]);
    expect(demo.trimEnd().endsWith("printf 'PROOF: GREEN\\n'")).toBe(true);
    expect(recreate.trimEnd().endsWith("printf 'PERSISTENCE: GREEN\\n'")).toBe(true);
  });
});
