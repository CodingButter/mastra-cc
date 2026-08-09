// Throwaway. The thing being automated, and the ability to change it underneath
// a stored workflow.
//
// A mail-shaped page: a link that materialises a message list, whose rows are
// virtualised so most do not exist until scrolled to. `mutate` renames the
// link's accessible name, which is what makes a stored rung-1 locator (meaning:
// role plus name) miss while the element itself is still there. That is drift,
// and recovering from it is what the improvement thesis actually claims.

import { Cdp } from '../browser/lib/cdp.mjs';
import { launchChrome } from '../browser/lib/chrome.mjs';
import { serve } from '../browser/lib/serve.mjs';
import { cdpSurface } from './surface.mjs';

export const PAGE = `<!doctype html><title>mail</title>
<body>
  <main role="main" aria-label="Mail">
    <a href="#inbox" id="inbox">Inbox</a>
    <div id="mount"></div>
  </main>
<script>
  const ROWS = 40, WINDOW = 8;
  let firstRow = 0, mounted = false;
  document.getElementById('inbox').addEventListener('click', (e) => {
    e.preventDefault();
    if (mounted) return;
    mounted = true;
    const ul = document.createElement('ul');
    ul.setAttribute('aria-label', 'Messages');
    ul.id = 'list';
    ul.style.cssText = 'height:200px;overflow:auto;position:relative';
    const spacer = document.createElement('div');
    spacer.style.height = (ROWS * 30) + 'px';
    ul.appendChild(spacer);
    document.getElementById('mount').appendChild(ul);
    render();
    ul.addEventListener('scroll', () => {
      firstRow = Math.floor(ul.scrollTop / 30);
      render();
    });
  });
  function render() {
    const ul = document.getElementById('list');
    [...ul.querySelectorAll('li')].forEach(n => n.remove());
    for (let i = firstRow; i < Math.min(firstRow + WINDOW, ROWS); i++) {
      const li = document.createElement('li');
      li.style.cssText = 'position:absolute;top:' + (i*30) + 'px';
      const h = document.createElement('h3');
      h.textContent = i === 0 ? 'The newest subject' : ('Subject number ' + i);
      li.appendChild(h);
      ul.appendChild(li);
    }
  }
</script>
</body>`;

/** Counts every call that reaches the surface. Steps-to-completion is the
 *  pass/fail measure, and it means daemon calls and element resolutions — so it
 *  has to be counted at the boundary, not estimated afterwards. */
export const countingSurface = (inner) => {
  const counts = { query: 0, snapshot: 0, act: 0, waitFor: 0 };
  return {
    counts,
    get steps() {
      // snapshot() is instrumentation the interpreter does for effect
      // attribution, not work the agent asked for. Counting it would inflate
      // every run equally and make the comparison look better than it is.
      return counts.query + counts.act + counts.waitFor;
    },
    async query(p) {
      counts.query++;
      return inner.query(p);
    },
    async snapshot() {
      counts.snapshot++;
      return inner.snapshot();
    },
    async act(v, t, s) {
      counts.act++;
      return inner.act(v, t, s);
    },
    async waitFor(p, ms) {
      counts.waitFor++;
      return inner.waitFor(p, ms);
    },
  };
};

export const openScene = async ({ port = 9541 } = {}) => {
  const origin = await serve({ '/': PAGE });
  const chrome = await launchChrome({ port, url: `http://127.0.0.1:${origin.port}/` });
  await new Promise((r) => setTimeout(r, 1500));
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes(`${origin.port}`));
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send('Accessibility.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Runtime.enable');

  return {
    cdp,
    surface: cdpSurface(cdp),
    /** Rename the entry point. The element still exists; its name changed —
     *  which is precisely the drift a stored workflow has to survive. Rung 1
     *  (role plus name) misses; rung 2 (role within an ancestor) should find
     *  it. */
    async mutate() {
      await cdp.send('Runtime.evaluate', {
        expression: `document.getElementById('inbox').setAttribute('aria-label','Primary mail'); true`,
      });
    },

    /** A redesign rather than a rename: the entry point is renamed AND a second
     *  link is added beside it, so "the only link inside Mail" is no longer
     *  true. Rung 2 now matches two elements and is refused rather than
     *  guessed, which defeats the whole ladder and forces re-planning.
     *
     *  This exists because the mild mutation was absorbed at zero cost, and a
     *  recovery curve with no spike in it measures nothing — it would also
     *  leave the re-planning path shipped but never executed. */
    async mutateSevere() {
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const a = document.getElementById('inbox');
          a.setAttribute('aria-label', 'Primary mail');
          const extra = document.createElement('a');
          extra.href = '#settings';
          extra.textContent = 'Settings';
          a.parentElement.insertBefore(extra, a);
          return true;
        })()`,
      });
    },
    async reload() {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.evaluate', { expression: 'location.reload()' });
      await new Promise((r) => setTimeout(r, 900));
    },
    async close() {
      cdp.close();
      await chrome.kill();
      await origin.close();
    },
  };
};
