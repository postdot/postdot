"""Verify an isolated previous-release upgrade and backup restoration.

Requires Docker, Python 3 and a locally built candidate. No real provider calls.
The previous image is pinned; the candidate is resolved to its immutable local ID.
"""

import argparse
import base64
import hashlib
import http.cookiejar
import json
import os
import secrets
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

PREVIOUS = "ghcr.io/postdot/postdot@sha256:690778f5d1af8f4a363406b989e17da8672fc764c6e62f9cca8e1a09c483638e"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--image", required=True)
parser.add_argument("--previous-image", default=PREVIOUS)
args = parser.parse_args()


def docker(*arguments):
    result = subprocess.run(
        ["docker", *arguments], capture_output=True, text=True, timeout=180, check=True
    )
    return result.stdout.strip()


candidate = json.loads(docker("image", "inspect", args.image))[0]
docker("pull", "--platform", f"linux/{candidate['Architecture']}", args.previous_image)
previous = json.loads(docker("image", "inspect", args.previous_image))[0]
if candidate["Id"] == previous["Id"]:
    raise RuntimeError("Upgrade requires two different images")
if (candidate["Os"], candidate["Architecture"]) != (
    previous["Os"],
    previous["Architecture"],
):
    raise RuntimeError("Previous and candidate platforms must match")
print(f"Previous: {previous['Id']}; candidate: {candidate['Id']}", flush=True)

with tempfile.TemporaryDirectory(prefix="postdot-upgrade-") as directory:
    root = Path(directory)
    for name in ["data", "restored", "backups"]:
        (root / name).mkdir(mode=0o777)
        (root / name).chmod(0o777)
    config = root / "environment"
    config.write_text(
        "\n".join(
            f"{key}={value}"
            for key, value in {
                "BETTER_AUTH_URL": "http://localhost:3000",
                "POSTBOT_WEB_ORIGIN": "http://localhost:3000",
                "BETTER_AUTH_SECRET": secrets.token_hex(32),
                "POSTBOT_MEDIA_PUBLIC_URL_SECRET": secrets.token_hex(32),
                "POSTBOT_PUBLISHER_ENCRYPTION_KEY": secrets.token_hex(32),
                "POSTBOT_MEDIA_DIRECTORY": "/data/media",
                "LOG_LEVEL": "error",
            }.items()
        )
    )
    config.chmod(0o600)
    container = "postdot-upgrade-" + secrets.token_hex(6)
    running = False
    origin = ""
    client = None
    password = secrets.token_hex(24)

    def request(method, path, body=None, raw=None):
        payload = (
            raw
            if raw is not None
            else None
            if body is None
            else json.dumps(body).encode()
        )
        req = urllib.request.Request(
            origin + path,
            data=payload,
            method=method,
            headers={
                "Content-Type": "image/png" if raw is not None else "application/json",
                "Origin": "http://localhost:3000",
            },
        )
        with client.open(req, timeout=15) as response:
            data = response.read()
            return (
                json.loads(data)
                if "json" in response.headers.get("Content-Type", "")
                else data
            )

    def start(image, data):
        global origin, client, running
        docker(
            "run",
            "--detach",
            "--name",
            container,
            "--publish",
            "127.0.0.1::3000",
            "--env-file",
            str(config),
            "--mount",
            f"type=bind,source={root / data},target=/data",
            image,
        )
        running = True
        port = docker("port", container, "3000/tcp").splitlines()[0].rsplit(":", 1)[1]
        origin = f"http://127.0.0.1:{port}"
        client = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        for _ in range(120):
            try:
                request("GET", "/ready")
                return
            except (OSError, TimeoutError):
                time.sleep(0.5)
        raise RuntimeError("Isolated image readiness failed")

    def stop():
        global running
        docker("stop", "--timeout", "30", container)
        if docker("inspect", "--format", "{{.State.ExitCode}}", container) != "0":
            raise RuntimeError("Container did not stop gracefully")
        docker("rm", container)
        running = False

    def maintenance(image, data, *command):
        docker(
            "run",
            "--rm",
            "--env-file",
            str(config),
            "--mount",
            f"type=bind,source={root / data},target=/data",
            "--mount",
            f"type=bind,source={root / 'backups'},target=/backups",
            image,
            *command,
        )

    def login():
        request(
            "POST",
            "/api/auth/sign-in/email",
            {"email": "upgrade@example.test", "password": password},
        )

    try:
        start(previous["Id"], "data")
        request(
            "POST",
            "/api/auth/sign-up/email",
            {
                "name": "Upgrade acceptance",
                "email": "upgrade@example.test",
                "password": password,
            },
        )
        project = request(
            "POST",
            "/api/projects",
            {"name": "Previous-release project", "timeZone": "UTC"},
        )["project"]["id"]
        channel = request(
            "POST", f"/api/projects/{project}/channels", {"name": "Manual destination"}
        )["channel"]["id"]
        post = request(
            "POST",
            f"/api/projects/{project}/posts",
            {
                "title": "Preserved draft",
                "sourceContent": {
                    "body": {"text": "Previous-release draft", "format": "plain_text"},
                    "media": [],
                },
                "publications": [
                    {
                        "channelId": channel,
                        "deliveryMode": "manual",
                        "targetContent": {
                            "body": "Previous-release draft",
                            "media": [],
                        },
                    }
                ],
            },
        )
        publication = post["publications"][0]["id"]
        image = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII="
        )
        upload = request(
            "POST",
            f"/api/projects/{project}/media/uploads",
            {
                "originalFilename": "upgrade.png",
                "expectedSize": len(image),
                "contentType": "image/png",
            },
        )
        intent, asset = upload["upload"]["intentId"], upload["asset"]["id"]
        request("PUT", f"/api/projects/{project}/media/uploads/{intent}", raw=image)
        finalized = request(
            "POST", f"/api/projects/{project}/media/uploads/{intent}/finalize"
        )
        if finalized["media"]["asset"]["state"] != "ready":
            raise RuntimeError("Previous-release media was not ready")
        digest = hashlib.sha256(image).digest()
        editor_before = request(
            "GET", f"/api/projects/{project}/publications/{publication}/editor"
        )

        def verify_preservation():
            projects = request("GET", "/api/projects")["projects"]
            if not any(item["id"] == project for item in projects):
                raise RuntimeError("Project was not preserved")
            if not any(
                item["id"] == channel
                for item in request("GET", f"/api/projects/{project}/channels")[
                    "channels"
                ]
            ):
                raise RuntimeError("Channel was not preserved")
            editor = request(
                "GET", f"/api/projects/{project}/publications/{publication}/editor"
            )
            if editor != editor_before:
                raise RuntimeError("Draft editor state changed")
            content = request("GET", f"/api/projects/{project}/media/{asset}/content")
            if hashlib.sha256(content).digest() != digest:
                raise RuntimeError("Media bytes were not preserved")

        verify_preservation()
        stop()
        maintenance(
            previous["Id"],
            "data",
            "backup",
            "--media",
            "--output",
            "/backups/pre-upgrade.bundle",
        )
        start(candidate["Id"], "data")
        login()
        verify_preservation()
        if request("GET", "/api/recovery/status")["held"]:
            raise RuntimeError("Ordinary upgrade unexpectedly entered recovery hold")
        request("POST", "/api/projects", {"name": "Candidate-only project"})
        print(
            "PASS: previous-image data upgraded; login, project, channel, draft and media preserved; candidate accepts writes.",
            flush=True,
        )
        stop()
        maintenance(
            previous["Id"],
            "restored",
            "restore",
            "--media",
            "--input",
            "/backups/pre-upgrade.bundle",
        )
        start(previous["Id"], "restored")
        login()
        verify_preservation()
        if not request("GET", "/api/recovery/status")["held"]:
            raise RuntimeError("Restoration did not enable recovery hold")
        if any(
            item["name"] == "Candidate-only project"
            for item in request("GET", "/api/projects")["projects"]
        ):
            raise RuntimeError("Restored backup includes post-upgrade writes")
        import urllib.error

        try:
            request("POST", "/api/projects", {"name": "Must remain blocked"})
        except urllib.error.HTTPError as error:
            if error.code != 503:
                raise
        else:
            raise RuntimeError("Recovery hold accepted project writes")
        print(
            "PASS: pre-upgrade backup restored with previous image; original data preserved and writes held. No provider was connected.",
            flush=True,
        )
        stop()
    finally:
        if running:
            try:
                stop()
            except subprocess.SubprocessError:
                docker("rm", "--force", container)
        # Reclaim only this private test root from container-owned files.
        docker(
            "run",
            "--rm",
            "--user",
            "root",
            "--entrypoint",
            "chown",
            "--mount",
            f"type=bind,source={root},target=/test-root",
            candidate["Id"],
            "-R",
            f"{os.getuid()}:{os.getgid()}",
            "/test-root",
        )
