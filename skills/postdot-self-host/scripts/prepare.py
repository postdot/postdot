#!/usr/bin/env python3
"""Prepare a new private deployment without starting services or printing secrets."""

import argparse
import os
from pathlib import Path
import secrets
import sys
from urllib.parse import urlsplit

IMAGE = "ghcr.io/postdot/postdot@sha256:eceecc8898aa1d1b27c4e5b91fe53b8d78afebf74be410bd4b8f7d4751d5ee9e"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if (
        origin.scheme not in ("https", "http")
        or not origin.hostname
        or origin.username
        or origin.password
        or origin.query
        or origin.fragment
        or origin.path not in ("", "/")
        or any(c.isspace() for c in args.origin)
    ):
        parser.error(
            "origin must be an HTTP(S) origin without credentials, path or query"
        )
    if origin.scheme == "http" and origin.hostname not in (
        "127.0.0.1",
        "localhost",
        "::1",
    ):
        parser.error("non-loopback origins require HTTPS")
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    if origin.scheme == "http" and (origin.port or 80) != args.port:
        parser.error("local HTTP origin port must match the host port")
    target = args.directory.absolute()
    if target.is_symlink() or (
        target.exists() and (not target.is_dir() or any(target.iterdir()))
    ):
        parser.error("destination must be a new or empty directory, not a symlink")
    assets = Path(__file__).resolve().parent.parent / "assets"
    config = (assets / "compose.env.example").read_text()
    replacements = {
        "POSTBOT_HTTP_PORT": str(args.port),
        "BETTER_AUTH_URL": args.origin.rstrip("/"),
        "POSTBOT_WEB_ORIGIN": args.origin.rstrip("/"),
        "BETTER_AUTH_SECRET": secrets.token_hex(32),
        "POSTBOT_MEDIA_PUBLIC_URL_SECRET": secrets.token_hex(32),
        "POSTBOT_PUBLISHER_ENCRYPTION_KEY": secrets.token_hex(32),
    }
    config = (
        "\n".join(
            line.split("=", 1)[0] + "=" + replacements[line.split("=", 1)[0]]
            if line.split("=", 1)[0] in replacements
            else line
            for line in config.splitlines()
        )
        + "\nPOSTBOT_IMAGE="
        + IMAGE
        + "\n"
    )
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, value in (
        ("compose.yaml", (assets / "compose.yaml").read_text()),
        (".env", config),
    ):
        # Exclusive creation preserves existing files, including a concurrent writer's.
        fd = os.open(target / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            output.write(value)
    print(
        "Deployment files prepared. Secrets are stored only in the private .env file. No services started."
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError):
        print(
            "Preparation failed; inspect destination permissions/files privately. Nothing was overwritten.",
            file=sys.stderr,
        )
        sys.exit(1)
