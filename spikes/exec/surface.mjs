// Throwaway. Two surfaces behind one shape.
//
// The interpreter never learns which one it is driving — the same object
// contract answers a fixture in memory and a real browser over the protocol.
// That is deliberate: the properties under test (refusing ambiguity, deriving a
// manifest, suspending mid-plan) are best proven against a fixture where the
// awkward cases can be SEEDED, and the real browser then shows the same
// interpreter working on a real interface.

/** A fixture surface. Deterministic, seedable, no credentials, no network. */
export const fixtureSurface = (dom) => {
  let tree = structuredClone(dom);
  const flat = (nodes, parents = []) =>
    nodes.flatMap((n) => [
      { ...n, ancestry: parents, key: n.key },
      ...flat(n.children ?? [], [...parents, { role: n.role, name: n.name, key: n.key }]),
    ]);

  return {
    async query(pred) {
      let all = flat(tree);
      if (pred.within) {
        const scope = pred.within;
        all = all.filter((n) => n.ancestry.some((a) => a.key === scope.key));
      }
      return all.filter((n) => {
        if (pred.role && n.role !== pred.role) return false;
        if (pred.name !== undefined && n.name !== pred.name) return false;
        if (pred.nameContains && !String(n.name ?? '').includes(pred.nameContains)) return false;
        if (pred.states) for (const s of pred.states) if (!(n.states ?? []).includes(s)) return false;
        return true;
      });
    },
    async snapshot() {
      return flat(tree).map((n) => ({ key: n.key, role: n.role, name: n.name, value: n.value }));
    },
    async act(verb, target, step) {
      if (verb === 'read') return target?.value ?? target?.name ?? null;
      if (verb === 'click') {
        // Materialisation: clicking may create things that did not exist.
        const node = findByKey(tree, target.key);
        if (node?.reveals) {
          tree = structuredClone(tree);
          const parent = findByKey(tree, node.revealInto ?? target.key) ?? tree[0];
          parent.children = [...(parent.children ?? []), ...structuredClone(node.reveals)];
        }
        return true;
      }
      if (verb === 'type') {
        const node = findByKey(tree, target.key);
        if (node) node.value = step.value;
        return true;
      }
      return true;
    },
    async waitFor(pred) {
      const m = await this.query(pred);
      return m.length > 0;
    },
  };
};

function findByKey(nodes, key) {
  for (const n of nodes) {
    if (n.key === key) return n;
    const hit = findByKey(n.children ?? [], key);
    if (hit) return hit;
  }
  return null;
}

/**
 * A surface backed by a real browser over the debugging protocol, using the
 * accessibility tree the browser computes for itself. Same contract.
 */
export const cdpSurface = (cdp) => {
  const nodes = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    // Ancestry carries the ancestor's KEY, not just its role and name. The
    // relation rung means "inside this particular element", and scoping by
    // role and name instead matches anything that merely looks like it — which
    // collapses entirely when names are empty, as list items usually are. This
    // is the same identity lesson the prototype paid for: a description is not
    // an identity.
    const ancestryOf = (n) => {
      const out = [];
      let cur = n;
      for (let i = 0; i < 20 && cur?.parentId; i++) {
        cur = byId.get(cur.parentId);
        if (!cur) break;
        const role = cur.role?.value;
        const name = cur.name?.value;
        if (role && role !== 'none' && role !== 'generic')
          out.unshift({ role, name, key: cur.nodeId });
      }
      return out;
    };
    return nodes
      .filter((n) => n.role?.value && n.role.value !== 'none')
      .map((n) => ({
        key: n.nodeId,
        backendNodeId: n.backendDOMNodeId,
        role: n.role.value,
        name: n.name?.value ?? '',
        value: n.value?.value ?? null,
        states: (n.properties ?? []).filter((p) => p.value?.value === true).map((p) => p.name),
        ancestry: ancestryOf(n),
      }));
  };

  return {
    async query(pred) {
      let all = await nodes();
      if (pred.within) {
        const scope = pred.within;
        all = all.filter((n) => n.ancestry.some((a) => a.key === scope.key));
      }
      return all.filter((n) => {
        if (pred.role && n.role !== pred.role) return false;
        if (pred.name !== undefined && n.name !== pred.name) return false;
        if (pred.nameContains && !n.name.includes(pred.nameContains)) return false;
        if (pred.states) for (const s of pred.states) if (!n.states.includes(s)) return false;
        return true;
      });
    },
    async snapshot() {
      return (await nodes()).map((n) => ({ key: n.key, role: n.role, name: n.name, value: n.value }));
    },
    async act(verb, target, step) {
      if (verb === 'read') return target.value ?? target.name;
      if (verb === 'click') {
        const { object } = await cdp.send('DOM.resolveNode', {
          backendNodeId: target.backendNodeId,
        });
        await cdp.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function(){ this.click(); }',
        });
        return true;
      }
      if (verb === 'scroll') {
        const { object } = await cdp.send('DOM.resolveNode', {
          backendNodeId: target.backendNodeId,
        });
        await cdp.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function(){ this.scrollIntoView({block:"center"}); }',
        });
        return true;
      }
      return true;
    },
    async waitFor(pred, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ((await this.query(pred)).length > 0) return true;
        await new Promise((r) => setTimeout(r, 150));
      }
      return false;
    },
  };
};
