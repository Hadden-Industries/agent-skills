"""Run the same CLI from source and from its self-contained Python archive."""

from .cli import main

raise SystemExit(main())
