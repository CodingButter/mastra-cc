#!/usr/bin/env python3
"""Gate for the documents in this repository.

Checked in, not run by hand from somewhere else — the same rule the documents
themselves state (ADR-0001).

Three checks:
  links     every relative markdown link resolves to a file on disk
  index     every ADR file is listed in the ADR index, and vice versa
  coverage  every numbered doc named in the README exists

Exit 0 when clean, 1 with a report otherwise.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
FENCE = re.compile(r"```.*?```", re.S)


SKIP_DIRS = {".git", ".mastracode"}


def markdown_files() -> list[Path]:
    return sorted(p for p in ROOT.rglob("*.md") if SKIP_DIRS.isdisjoint(p.parts))


def check_links() -> list[str]:
    problems: list[str] = []
    for path in markdown_files():
        body = FENCE.sub("", path.read_text(encoding="utf-8"))
        for target in LINK.findall(body):
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            file_part = target.split("#", 1)[0]
            if not file_part:
                continue
            resolved = (path.parent / file_part).resolve()
            if not resolved.exists():
                rel = path.relative_to(ROOT)
                problems.append(f"{rel}: dead link -> {target}")
    return problems


def check_adr_index() -> list[str]:
    problems: list[str] = []
    decisions = ROOT / "docs" / "02-DECISIONS"
    index = decisions / "README.md"
    if not index.exists():
        return [f"missing ADR index: {index.relative_to(ROOT)}"]

    on_disk = {p.name for p in decisions.glob("[0-9][0-9][0-9][0-9]-*.md")}
    targets = {t.split("#", 1)[0] for t in LINK.findall(index.read_text(encoding="utf-8"))}
    listed = {t for t in targets if re.fullmatch(r"[0-9]{4}-[a-z0-9-]+\.md", t)}

    for name in sorted(on_disk - listed):
        problems.append(f"ADR not listed in index: {name}")
    for name in sorted(listed - on_disk):
        problems.append(f"index lists a missing ADR: {name}")

    numbers = sorted(int(n[:4]) for n in on_disk)
    expected = list(range(1, len(numbers) + 1))
    if numbers != expected:
        problems.append(f"ADR numbering has a gap or a duplicate: {numbers}")
    return problems


def check_coverage() -> list[str]:
    required = [
        "docs/00-PRODUCT.md",
        "docs/01-ARCHITECTURE.md",
        "docs/02-DECISIONS/README.md",
        "docs/03-LESSONS.md",
        "docs/04-INTEGRATION-PLAN.md",
        "docs/05-TEST-STRATEGY.md",
        "docs/06-OPERATIONS.md",
        "docs/07-ROADMAP.md",
        "docs/08-GLOSSARY.md",
        "README.md",
        "CONTRIBUTING.md",
    ]
    return [f"missing required document: {r}" for r in required if not (ROOT / r).exists()]


def main() -> int:
    files = markdown_files()
    if not files:
        print("check-docs: found no markdown files - the check itself is broken")
        return 1

    problems = check_coverage() + check_links() + check_adr_index()
    if problems:
        print(f"check-docs: {len(problems)} problem(s) across {len(files)} files\n")
        for p in problems:
            print(f"  {p}")
        return 1

    print(f"check-docs: ok - {len(files)} files, every relative link resolves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
