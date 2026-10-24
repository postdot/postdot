#!/usr/bin/env python3
"""Make one Postdot JSON API request without exposing credentials in arguments."""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("method", choices=("GET", "POST", "PATCH", "DELETE"))
    parser.add_argument("path")
    parser.add_argument("--input", help="JSON file or - for stdin")
    args = parser.parse_args()
    base = os.environ.get("POSTBOT_URL", "").rstrip("/")
    key = os.environ.get("POSTBOT_API_KEY", "")
    try:
        origin = urlsplit(base)
        origin.port  # Validate malformed ports without including their value in errors.
    except ValueError:
        parser.error("POSTBOT_URL must be a valid origin")
    if (
        origin.scheme not in ("https", "http")
        or not origin.hostname
        or origin.username
        or origin.password
        or origin.path not in ("", "/")
        or origin.query
        or origin.fragment
        or any(c.isspace() for c in base)
    ):
        parser.error(
            "POSTBOT_URL must be an HTTP(S) origin without credentials, path or query"
        )
    loopback = origin.hostname == "localhost"
    try:
        loopback = loopback or ipaddress.ip_address(origin.hostname).is_loopback
    except ValueError:
        pass
    if origin.scheme == "http" and not loopback:
        parser.error("non-loopback API access requires HTTPS")
    if not key or any(c.isspace() for c in key):
        parser.error("set POSTBOT_API_KEY privately; no key value is printed")
    route = urlsplit(args.path)
    decoded = unquote(route.path)
    if (
        route.scheme
        or route.netloc
        or route.fragment
        or not (decoded == "/api/projects" or decoded.startswith("/api/projects/"))
        or any(part in (".", "..") for part in decoded.split("/"))
        or "\\" in decoded
        or any(c.isspace() for c in args.path)
    ):
        parser.error("path must be an instance-relative project API route")
    if args.method == "GET" and args.input:
        parser.error("GET does not accept a request body")
    data = None
    if args.input:
        with (
            sys.stdin.buffer if args.input == "-" else Path(args.input).open("rb")
        ) as source:
            data = source.read(1_048_577)
        if len(data) > 1_048_576:
            parser.error("JSON input exceeds 1 MiB")
        try:
            body = json.loads(data)
        except (ValueError, UnicodeError):
            parser.error("input must contain valid JSON")
        if not isinstance(body, dict):
            parser.error("input must contain a JSON object")
    req = Request(
        base + args.path,
        data=data,
        method=args.method,
        headers={
            "Authorization": "Bearer " + key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with build_opener(NoRedirect).open(req, timeout=30) as response:
            body = response.read(4_194_305)
            if len(body) > 4_194_304:
                print(
                    '{"error":{"code":"response_too_large","outcome":"inspect_server_state"}}',
                    file=sys.stderr,
                )
                return 1
            try:
                result = json.loads(body)
            except (ValueError, UnicodeError):
                print(
                    '{"error":{"code":"unexpected_response","outcome":"inspect_server_state"}}',
                    file=sys.stderr,
                )
                return 1
            print(json.dumps(result, indent=2))
            return 0
    except HTTPError as error:
        code = "http_error"
        try:
            candidate = json.loads(error.read(65536)).get("error", {}).get("code", "")
            if isinstance(candidate, str) and re.fullmatch(
                r"[a-z][a-z0-9_]{0,79}", candidate
            ):
                code = candidate
        except (ValueError, AttributeError):
            pass
        print(
            json.dumps({"error": {"status": error.code, "code": code}}), file=sys.stderr
        )
        return 1
    except (URLError, TimeoutError, OSError):
        print(
            '{"error":{"code":"transport_error","outcome":"unknown"}}', file=sys.stderr
        )
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError):
        print('{"error":{"code":"local_input_error"}}', file=sys.stderr)
        sys.exit(2)
