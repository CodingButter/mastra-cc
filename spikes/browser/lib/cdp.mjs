// Throwaway. Minimal CDP client over Node's built-in WebSocket — no dependencies.
// See ../README.md: nothing here is imported by anything outside spikes/.

export class Cdp {
  #ws;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  static async connect(url) {
    const c = new Cdp();
    c.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      c.#ws.addEventListener('open', resolve, { once: true });
      c.#ws.addEventListener('error', () => reject(new Error(`cdp: cannot open ${url}`)), {
        once: true,
      });
    });
    c.#ws.addEventListener('message', (ev) => c.#onMessage(ev));
    return c;
  }

  #onMessage(ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else p.resolve(msg.result);
      return;
    }
    for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
    for (const fn of this.#listeners.get('*') ?? []) fn(msg.params, msg.sessionId, msg.method);
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(fn);
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.#ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`cdp timeout: ${method}`));
      }, 15000);
    });
  }

  // Resolves when `predicate(params, sessionId)` first returns true, or rejects on timeout.
  waitFor(method, predicate = () => true, ms = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`cdp: no ${method} within ${ms}ms`)), ms);
      this.on(method, (params, sessionId) => {
        if (!predicate(params, sessionId)) return;
        clearTimeout(timer);
        resolve({ params, sessionId });
      });
    });
  }

  close() {
    try {
      this.#ws.close();
    } catch {
      /* already gone */
    }
  }
}
