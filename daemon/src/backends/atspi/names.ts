// Every name comparison is Unicode-normalised (NFKC) before matching. M0.5
// found a chat DM whose name used mathematical-bold characters: a plain
// substring search matched 0 of 30 candidates, and after NFKC exactly 1.
// Without this the system confidently reports that a person does not exist.

export function normalise(name: string): string {
  return name.normalize("NFKC");
}

// AN APPLICATION'S NAME IS THE SAME NAME IN ANY CASE. Measured 2026-09-02 on
// the demo desk: Chromium registers on the accessibility bus as "Chromium"
// while its desktop entry, and so the operator's grant and permit, read
// "chromium". Under NFKC alone the daemon walked past it, the census reported
// it not-answering, and an agent that had just launched it was told it had no
// window - all for one capital letter. So every comparison of APPLICATION
// names (grants, permits, entry ids, catalog keys, ownership records, the bus
// census) folds case after NFKC. Element names do not: nameMatches() below
// stays exact, because "OK" and "ok" on a screen are two different labels.
export function applicationName(name: string): string {
  return normalise(name).toLowerCase();
}

export function nameMatches(candidateName: string, queryName: string): boolean {
  return normalise(candidateName) === normalise(queryName);
}
