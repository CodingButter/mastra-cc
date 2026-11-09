#!/usr/bin/env node
import { createConnection } from "node:net";

const socketPath = process.env.MASTRA_CC_SOCKET;
if (!socketPath) throw new Error("open-main-apps: MASTRA_CC_SOCKET is required");

const SCHEMA_DIGEST = "e6b619d6f5c04696582fb5728c180918a5e8caa3efd095df77e808f173ee60c8";
const APPLICATIONS = ["kate", "dolphin", "konsole", "chromium"];
const TIMEOUT_MS = 75_000;

const socket = createConnection(socketPath);
let buffer = "";
let nextId = 1;
const pending = new Map();
let helloResolve;
let helloReject;
const hello = new Promise((resolve, reject) => { helloResolve = resolve; helloReject = reject; });

function fail(error) {
  const failure = error instanceof Error ? error : new Error(String(error));
  helloReject(failure);
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(failure);
  }
  pending.clear();
}

socket.setEncoding("utf8");
socket.on("error", fail);
socket.on("close", () => {
  if (pending.size > 0) fail(new Error("open-main-apps: daemon connection closed before every application opened"));
});
socket.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.type === "hello") {
      if (message.digest !== SCHEMA_DIGEST) helloReject(new Error(`open-main-apps: daemon schema digest ${message.digest} did not match ${SCHEMA_DIGEST}`));
      else helloResolve();
      continue;
    }
    if (message.type === "refusal") {
      fail(new Error(typeof message.refusal === "string" ? message.refusal : JSON.stringify(message.refusal)));
      continue;
    }
    if (message.type !== "response" || typeof message.id !== "number") continue;
    const request = pending.get(message.id);
    if (!request) continue;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.result?.refusal) request.reject(new Error(`open-main-apps: ${request.name}: ${JSON.stringify(message.result.refusal)}`));
    else if (!message.result?.application || message.result.application.role !== "application") request.reject(new Error(`open-main-apps: ${request.name}: launch returned no owned application`));
    else request.resolve(message.result.application);
  }
});

await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("error", reject);
});
socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
await hello;

function openApplication(name) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`open-main-apps: ${name}: timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    pending.set(id, { name, resolve, reject, timer });
    socket.write(`${JSON.stringify({ type: "request", id, method: "openApplication", params: { name } })}\n`);
  });
}

try {
  for (const name of APPLICATIONS) await openApplication(name);
} finally {
  socket.end();
}
