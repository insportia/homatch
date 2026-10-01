"""Container entry: serve Runpod jobs. Nothing to download, nothing secret to read."""
from __future__ import annotations


def main() -> None:
    import runpod  # type: ignore

    from .handler import handle

    runpod.serverless.start({"handler": handle})


if __name__ == "__main__":
    main()
