"""Typed CLI failures; recovery-required failures retain their distinct exit status."""


class ReconciliationError(Exception):
    """Report a stable machine code, human explanation and nonzero process status."""

    def __init__(
        self, message: str, code: str = "operation-failed", exit_status: int = 1
    ):
        super().__init__(message)
        self.code = code
        self.exit_status = exit_status
