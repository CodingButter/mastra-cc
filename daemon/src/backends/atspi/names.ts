// Every name comparison is Unicode-normalised (NFKC) before matching. M0.5
// found a chat DM whose name used mathematical-bold characters: a plain
// substring search matched 0 of 30 candidates, and after NFKC exactly 1.
// Without this the system confidently reports that a person does not exist.

export function normalise(name: string): string {
  return name.normalize("NFKC");
}

export function nameMatches(candidateName: string, queryName: string): boolean {
  return normalise(candidateName) === normalise(queryName);
}
