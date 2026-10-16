"""The canonical repository is also a consumer of its independently deployed archive."""

from pathlib import Path
import sys

from test_cli import SOURCE, VENDOR

sys.path[:0] = [str(SOURCE), str(VENDOR)]

from repository_skill_reconciliation import consumer_contracts


class CommittedSkillsLockTests(consumer_contracts.RepositorySkillContracts):
    repository_root = Path(__file__).resolve().parents[3]

    @classmethod
    def validate_runtime(cls):
        sys.path.insert(0, str(cls.repository_root / "scripts"))
        try:
            from _commands import require_python_version
            require_python_version()
        finally:
            sys.path.pop(0)
