import { expect, test } from "vitest";
import { socketPath } from "../index.js";

test("the socket path is derived from the runtime directory", () => {
  expect(socketPath("/run/user/1000")).toBe("/run/user/1000/mastra-cc/daemon.sock");
});

test("an empty runtime directory is refused rather than silently accepted", () => {
  expect(() => socketPath("")).toThrow("must not be empty");
});
