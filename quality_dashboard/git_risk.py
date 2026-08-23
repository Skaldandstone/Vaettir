"""Real git-churn based risk footprint, using `git log --stat` on a local clone.

No coverage.json or JUnit XML exists in most repos yet (Kall included) so this
uses two things that are always true of any git repo with a pytest/jest-style
layout: how often a file actually changes, and whether a plausibly-matching
test file exists. See QUALITY_INTELLIGENCE.md #2 and #4 for the full rationale
and the upgrade path once real coverage artifacts exist.
"""

from __future__ import annotations

import re
import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

_CHANGED_FILE_RE = re.compile(r"^\s*(?P<path>[^\s|]+)\s*\|\s*\d+")

# Extensions we consider "source" for risk purposes -- config/lockfiles/docs
# churn a lot without being a testing-risk signal.
_SOURCE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx"}

_SKIP_DIR_PARTS = {"tests", "test", "e2e", "__pycache__", "node_modules", "migrations"}


def _run_git(repo_path: Path, args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_path,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def _churn_counts(repo_path: Path, since_days: int) -> Counter[str]:
    output = _run_git(repo_path, ["log", f"--since={since_days}.days", "--stat", "--pretty=format:COMMIT"])
    counts: Counter[str] = Counter()
    for line in output.splitlines():
        if line == "COMMIT" or not line.strip():
            continue
        match = _CHANGED_FILE_RE.match(line)
        if not match:
            continue
        path = match.group("path").strip()
        p = Path(path)
        if p.suffix not in _SOURCE_EXTENSIONS:
            continue
        if any(part in _SKIP_DIR_PARTS for part in p.parts):
            continue
        counts[path] += 1
    return counts


_NAME_PREFIXES = ("api_", "test_", "services_")


def _module_name(path: str) -> str:
    """Turns backend/kall/api_growth.py -> api_growth, apps/web/app/profiles/GrowthTab.tsx -> GrowthTab."""
    return Path(path).stem


def _normalized_topic(stem: str) -> str:
    """Strips common prefixes so api_growth.py and test_growth.py both
    normalize to 'growth' -- source and test files rarely share an exact
    stem (api_x.py vs test_x.py), so matching on the topic after the
    prefix is what actually reflects Kall's naming convention.
    """
    lowered = stem.lower()
    for prefix in _NAME_PREFIXES:
        if lowered.startswith(prefix):
            lowered = lowered[len(prefix) :]
    return lowered


def _find_test_files(repo_path: Path) -> list[Path]:
    test_files: list[Path] = []
    for pattern in ("tests/**/*.py", "**/*.spec.ts", "**/*.test.ts", "**/*.test.tsx"):
        test_files.extend(repo_path.glob(pattern))
    return [p for p in test_files if "node_modules" not in p.parts]


@dataclass
class RiskEntry:
    path: str
    change_count: int
    test_confidence: float
    risk_score: float
    matched_test: str | None


def compute_risk_footprint(repo_path: Path, since_days: int = 90, top_n: int = 15) -> list[RiskEntry]:
    churn = _churn_counts(repo_path, since_days)
    if not churn:
        return []
    max_churn = max(churn.values())

    test_files = _find_test_files(repo_path)
    test_contents: dict[Path, str] = {}
    for tf in test_files:
        try:
            test_contents[tf] = tf.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

    entries: list[RiskEntry] = []
    for path, count in churn.items():
        module = _module_name(path)
        topic = _normalized_topic(module)
        matched_test: str | None = None
        confidence = 0.0
        for tf, content in test_contents.items():
            test_topic = _normalized_topic(tf.stem)
            name_hit = topic == test_topic or module.lower() in tf.name.lower()
            content_hit = re.search(rf"\b{re.escape(module)}\b", content) is not None
            if name_hit and content_hit:
                confidence = 1.0
                matched_test = str(tf.relative_to(repo_path))
                break
            if name_hit and confidence < 0.7:
                confidence = 0.7
                matched_test = str(tf.relative_to(repo_path))
            elif content_hit and confidence < 0.4:
                confidence = 0.4
                matched_test = str(tf.relative_to(repo_path))

        change_frequency = count / max_churn
        risk_score = change_frequency * (1 - confidence)
        entries.append(
            RiskEntry(
                path=path,
                change_count=count,
                test_confidence=confidence,
                risk_score=risk_score,
                matched_test=matched_test,
            )
        )

    entries.sort(key=lambda e: e.risk_score, reverse=True)
    return entries[:top_n]
