"""Verify an isolated previous-release upgrade and backup restoration.

Requires Docker, Python 3 and a locally built candidate. No real provider calls.
The previous image is pinned; the candidate is resolved to its immutable local ID.
The previous release is seeded with a connected custom webhook channel and a scheduled
automatic publication, so the ownership conversion is exercised on a recorded connection and
queued work. Nothing is dispatched: the endpoint is unreachable and the time is distant.
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
import urllib.error
import urllib.request
from pathlib import Path

PREVIOUS = "ghcr.io/postdot/postdot@sha256:c345e86ab7995417b2a789e083fe262044c6132d5bb87edadd80337994e49ba3"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--image", required=True)
parser.add_argument("--previous-image", default=PREVIOUS)
args = parser.parse_args()


def differences(before, after, path="$"):
    # Paths and short values only; the compared API state holds no credentials.
    if type(before) is not type(after):
        return [[path, str(before)[:80], str(after)[:80]]]
    if isinstance(before, dict):
        found = []
        for key in sorted(set(before) | set(after)):
            if key not in before or key not in after:
                found.append([f"{path}.{key}", "missing" if key not in before else "present", "missing" if key not in after else "present"])
            else:
                found += differences(before[key], after[key], f"{path}.{key}")
        return found
    if isinstance(before, list):
        if len(before) != len(after):
            return [[path, f"len {len(before)}", f"len {len(after)}"]]
        return [d for i, (a, b) in enumerate(zip(before, after)) for d in differences(a, b, f"{path}[{i}]")]
    return [] if before == after else [[path, str(before)[:80], str(after)[:80]]]


def comparable(editor, shared=False):
    # Profile attribution becomes a workspace actor snapshot in the upgrade; every other field must match.
    # The rename migration rewrites built-in profile hash labels; compare them under the new name.
    copy = json.loads(json.dumps(editor).replace("sha256:postbot-", "sha256:postdot-"))
    # Added editor metadata is checked explicitly on the candidate below.
    copy.get("editor", {}).pop("movement", None)
    for name in ("profile", "selectedTargetProfile"):
        profile = copy.get("editor", {}).get(name)
        if isinstance(profile, dict):
            profile.pop("createdByActorId", None)
    if shared:
        # Attaching a project is a channel mutation: its revision and time advance by design.
        channel = copy.get("editor", {}).get("channel")
        if isinstance(channel, dict):
            channel.pop("revision", None)
            channel.pop("updatedAt", None)
    return copy


def docker(*arguments):
    result = subprocess.run(
        ["docker", *arguments], capture_output=True, text=True, timeout=180, check=True
    )
    return result.stdout.strip()


candidate = json.loads(docker("image", "inspect", args.image))[0]
if docker("version", "--format", "{{.Server.Arch}}") != candidate["Architecture"]:
    raise RuntimeError("Upgrade acceptance requires a native Docker host matching the candidate")
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
                # The previous release only knows the original names; the candidate must accept them.
            }.items()
        )
    )
    config.chmod(0o600)
    container = "postdot-upgrade-" + secrets.token_hex(6)
    running = False
    origin = ""
    client = None
    password = secrets.token_hex(24)

    def request(method, path, body=None, raw=None, expected_status=None):
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
        try:
            with client.open(req, timeout=15) as response:
                data = response.read()
                if expected_status is not None:
                    raise RuntimeError(f"Expected HTTP {expected_status}, received {response.status}")
                return (
                    json.loads(data)
                    if "json" in response.headers.get("Content-Type", "")
                    else data
                )
        except urllib.error.HTTPError as error:
            data = error.read()
            if expected_status == error.code:
                return json.loads(data)
            print(f"{method} {path} -> HTTP {error.code}: {data[:400]!r}", flush=True)
            if error.code >= 500:
                print(docker("logs", "--tail", "20", container), flush=True)

            raise

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

    def verify_foreign_keys():
        result = docker(
            "exec", container, "bun", "-e",
            "const {Database}=require('bun:sqlite'); const db=new Database(process.env.DB_FILE_NAME,{readonly:true}); const errors=db.query('pragma foreign_key_check').all(); db.close(); if(errors.length) throw new Error('Foreign key violations'); console.log('ok');",
        )
        if result != "ok":
            raise RuntimeError("Foreign-key verification did not finish")

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
        webhook_profile = {
            "id": "custom-webhook",
            "version": 1,
            "origin": "custom",
            "contentSchema": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {"body": {"type": "string", "minLength": 1, "maxLength": 1000000}},
                "required": ["body"],
                "additionalProperties": False,
            },
            "fieldBindings": [{"id": "body", "semantic": "primary_text", "path": "/body"}],
            "capabilities": {
                "revision": "postbot-custom-v1",
                "textFields": [
                    {
                        "bindingId": "body",
                        "acceptedSourceFormats": ["plain_text", "markdown"],
                        "maxLength": 1000000,
                    }
                ],
                "mediaFields": [],
                "relations": [],
            },
            "execution": {
                "kind": "declarative_http",
                "contractId": "custom-webhook",
                "revision": "v1",
                "mode": "postbot_webhook",
            },
        }
        webhook = request(
            "POST",
            f"/api/projects/{project}/channels",
            {"name": "Connected webhook", "profile": webhook_profile},
        )["channel"]["id"]
        request(
            "POST",
            f"/api/projects/{project}/channels/{webhook}/publisher/custom-http/connect",
            {
                "endpointUrl": "https://receiver.invalid",
                "authentication": {"kind": "none"},
                "secret": secrets.token_hex(24),
            },
        )
        scheduled_at = int(time.time() * 1000) + 30 * 86_400_000
        queued = request(
            "POST",
            f"/api/projects/{project}/posts",
            {
                "title": "Queued automatic work",
                "sourceContent": {
                    "body": {"text": "Queued across the upgrade", "format": "plain_text"},
                    "media": [],
                },
                "publications": [
                    {
                        "channelId": webhook,
                        "deliveryMode": "automatic",
                        "scheduledAt": scheduled_at,
                        "targetContent": {"body": "Queued across the upgrade"},
                    }
                ],
            },
        )["publications"][0]["id"]
        queued_before = request(
            "GET", f"/api/projects/{project}/publications/{queued}/editor"
        )

        def stable_connection():
            # The attribution actor is a workspace snapshot after the upgrade, so it is excluded.
            connections = request("GET", f"/api/projects/{project}/publishers")["connections"]
            match = next(item for item in connections if item["channelId"] == webhook)
            return {
                key: match[key]
                for key in [
                    "id",
                    "publisherId",
                    "channelId",
                    "kind",
                    "credentialId",
                    "endpointUrl",
                    "state",
                    "destination",
                ]
            }

        connection_before = stable_connection()
        if connection_before["state"] != "active":
            raise RuntimeError("Previous-release connection was not active")

        def verify_preservation(shared=False):
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
            if comparable(editor, shared) != comparable(editor_before, shared):
                print("Editor differences:", json.dumps(differences(editor_before, editor))[:1500], flush=True)
                raise RuntimeError("Draft editor state changed")
            if stable_connection() != connection_before:
                raise RuntimeError("Publisher connection changed")
            queued_editor = request(
                "GET", f"/api/projects/{project}/publications/{queued}/editor"
            )
            if comparable(queued_editor, shared) != comparable(queued_before, shared):
                print("Queued differences:", json.dumps(differences(queued_before, queued_editor))[:1500], flush=True)
                raise RuntimeError("Queued automatic publication changed")
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
        legacy_database = (root / "data/postbot.sqlite").exists()
        start(candidate["Id"], "data")
        logs = subprocess.run(
            ["docker", "logs", container], capture_output=True, text=True, timeout=60, check=True
        )
        candidate_logs = logs.stdout + logs.stderr
        if "Deprecated environment names" not in candidate_logs:
            raise RuntimeError("The candidate did not report the deprecated variable names")
        # Only a pre-rename previous image stores postbot.sqlite; the candidate must adopt it.
        if legacy_database and (
            (root / "data/postbot.sqlite").exists() or not (root / "data/postdot.sqlite").exists()
        ):
            raise RuntimeError("The candidate did not adopt the previous database file")
        login()
        verify_preservation()
        if request("GET", "/api/recovery/status")["held"]:
            raise RuntimeError("Ordinary upgrade unexpectedly entered recovery hold")
        # The agent endpoint serves the migrated data to a scoped key and refuses everything else.
        key = request(
            "POST",
            "/api/api-keys",
            {"name": "MCP acceptance", "projectIds": [project], "actionAccess": ["project:read"]},
        )["token"]

        def mcp(method, params=None, token=key):
            req = urllib.request.Request(
                origin + "/mcp",
                data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode(),
                method="POST",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.loads(response.read())["result"]

        tools = mcp("tools/list")["tools"]
        if not tools or any(not tool["annotations"]["readOnlyHint"] for tool in tools):
            raise RuntimeError("A read-only key must see only read-only MCP tools")
        projects = mcp("tools/call", {"name": "list_projects", "arguments": {}})
        if projects["isError"] or project not in projects["content"][0]["text"]:
            raise RuntimeError("MCP did not return the migrated project")
        try:
            mcp("tools/list", token="postdot_pat_invalid")
            raise RuntimeError("MCP accepted an invalid key")
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
        # Sharing works on the converted data: the migrated channel keeps its recorded connection.
        target = request(
            "POST", "/api/projects", {"name": "Candidate-only sharing target"}
        )["project"]["id"]
        sharing = request(
            "GET", f"/api/projects/{project}/channels/{webhook}/sharing"
        )
        if sharing["channel"]["shared"] or len(sharing["usages"]) != 1:
            raise RuntimeError("Migrated channel should start with one attachment")
        request(
            "POST",
            f"/api/projects/{project}/channels/{webhook}/attachments",
            {"projectId": target, "expectedRevision": sharing["channel"]["revision"]},
        )
        shared_channel = next(
            item
            for item in request("GET", f"/api/projects/{target}/channels")["channels"]
            if item["id"] == webhook
        )
        if not shared_channel["shared"]:
            raise RuntimeError("Attached channel is not reported as shared")
        target_connections = request("GET", f"/api/projects/{target}/publishers")[
            "connections"
        ]
        if not any(item["channelId"] == webhook for item in target_connections):
            raise RuntimeError("Attached project cannot use the channel connection")
        verify_preservation(shared=True)
        verify_foreign_keys()
        for item in [publication, queued]:
            movement = request(
                "GET", f"/api/projects/{project}/publications/{item}/editor"
            )["editor"]["movement"]
            if movement != {"canMove": True, "fromPublicationId": None,
                            "toPublicationId": None, "requestedScheduledAt": None}:
                raise RuntimeError("Migrated pending work has unexpected move eligibility/history")

        # Exercise the new tables and admission paths on the converted connection.
        rules = request("PUT", f"/api/projects/{project}/channels/{webhook}/cadence", {
            "expectedRevision": 0, "timeZone": "UTC", "dailyMax": 1,
            "weeklyMax": None, "minimumIntervalMs": 60000,
        })
        candidate_time = int(time.time() * 1000) + 86_400_000
        plan = {
            "sourceContent": {"body": {"text": "Retain this pending content", "format": "plain_text"}, "media": []},
            "publications": [{"channelId": webhook, "deliveryMode": "manual",
                              "scheduledAt": candidate_time,
                              "targetContent": {"body": "Retain this pending content"}}],
        }
        first = request("POST", f"/api/projects/{target}/posts", plan)["publications"][0]
        conflict = request("POST", f"/api/projects/{target}/posts", plan, expected_status=409)
        if conflict["error"]["code"] != "cadence_conflict" or not conflict["error"]["warnings"]:
            raise RuntimeError("Planning did not return an explicit cadence challenge")
        if len(request("GET", f"/api/projects/{target}/publications")["publications"]) != 1:
            raise RuntimeError("Rejected planning left partial work")
        second = request("POST", f"/api/projects/{target}/posts", {
            **plan, "cadenceConfirmation": conflict["error"]["confirmation"],
        })["publications"][0]
        stop()
        start(candidate["Id"], "data")
        login()
        if request("GET", f"/api/projects/{project}/channels/{webhook}/cadence")["rules"] != rules:
            raise RuntimeError("Cadence configuration did not survive restart")
        verify_preservation(shared=True)

        manual_profile = json.loads(json.dumps(webhook_profile))
        manual_profile["id"] = "candidate-manual"
        manual_profile["execution"] = {"kind": "manual"}
        destination = request("POST", f"/api/projects/{target}/channels", {
            "name": "Candidate manual destination", "profile": manual_profile,
        })["channel"]
        narrow_profile = json.loads(json.dumps(manual_profile))
        narrow_profile["id"] = "candidate-short-manual"
        narrow_profile["contentSchema"]["properties"]["body"]["maxLength"] = 1
        narrow_profile["capabilities"]["textFields"][0]["maxLength"] = 1
        narrow = request("POST", f"/api/projects/{target}/channels", {
            "name": "Candidate short destination", "profile": narrow_profile,
        })["channel"]

        def move_input(editor, channel):
            current = editor["publication"]
            return {
                "targetChannelId": channel["id"], "deliveryMode": "manual",
                "expectedPublicationUpdatedAt": current["updatedAt"],
                "expectedDraftRevision": editor["draft"]["revision"],
                "expectedSourceRevision": editor["post"]["sourceRevision"],
                "expectedTargetRevisionId": current["targetRevisionId"],
                "expectedScheduledAt": current["scheduledAt"],
                "expectedTargetProfileVersionId": channel["profileVersionId"],
            }

        moved_ids = []
        for original, move_channel, compatible in [(first, destination, True), (second, narrow, False)]:
            path = f"/api/projects/{target}/publications/{original['id']}"
            before_move = request("GET", path + "/editor")["editor"]
            payload = move_input(before_move, move_channel)
            stale = request("POST", path + "/move", {**payload, "expectedDraftRevision": 999}, expected_status=409)
            if stale["error"]["code"] != "write_conflict":
                raise RuntimeError("Stale move was not refused")
            if request("GET", path + "/editor")["editor"] != before_move:
                raise RuntimeError("Refused move changed original work")
            moved = request("POST", path + "/move", payload)["editor"]
            after_move = request("GET", path + "/editor")["editor"]
            if moved["draft"]["content"] != before_move["draft"]["content"]:
                raise RuntimeError("Move lost saved content")
            if moved["publication"]["postId"] != original["postId"]:
                raise RuntimeError("Move did not retain its source post")
            if moved["publication"]["scheduledAt"] != (candidate_time if compatible else None):
                raise RuntimeError("Move did not retain the expected schedule/review boundary")
            if not compatible and moved["publication"]["reviewState"] != "review_required":
                raise RuntimeError("Incompatible destination did not retain a review draft")
            if after_move["publication"]["state"] != "cancelled" or after_move["selectedTarget"] != before_move["selectedTarget"]:
                raise RuntimeError("Move rewrote the original selected content/history")
            if moved["movement"]["requestedScheduledAt"] != candidate_time or moved["movement"]["fromPublicationId"] != original["id"]:
                raise RuntimeError("Move linkage/requested schedule was lost")
            moved_ids.append(moved["publication"]["id"])
        stop()
        start(candidate["Id"], "data")
        login()
        for moved_id in moved_ids:
            if not request("GET", f"/api/projects/{target}/publications/{moved_id}/editor")["editor"]["movement"]["fromPublicationId"]:
                raise RuntimeError("Move history did not survive restart")
        impact = request("GET", f"/api/projects/{project}/lifecycle")
        request("DELETE", f"/api/projects/{project}/lifecycle", {
            "fingerprint": impact["fingerprint"], "confirmName": "Previous-release project",
            "cancelPending": True,
        })
        retained = request("GET", f"/api/projects/{target}/publishers")["connections"]
        if not any(item["channelId"] == webhook and item["credentialId"] == connection_before["credentialId"] for item in retained):
            raise RuntimeError("Deleting the managing project removed a surviving connection")
        manager = request("GET", f"/api/projects/{target}/channels/{webhook}/sharing")["channel"]["management"]
        if manager["kind"] != "workspace":
            raise RuntimeError("Deleting the manager silently promoted another project")
        verify_foreign_keys()
        print("PASS: native candidate retains cadence and move receipts after restart; stale writes are atomic; incompatible content stays reviewable; manager deletion preserves the shared connection and foreign keys.", flush=True)
        request("POST", "/api/projects", {"name": "Candidate-only project"})
        print(
            "PASS: previous-image data upgraded; login, project, channel, draft, media, recorded connection and queued automatic work preserved; sharing and new-work lifecycle work on migrated data; candidate accepts writes.",
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
        verify_foreign_keys()
        if not request("GET", "/api/recovery/status")["held"]:
            raise RuntimeError("Restoration did not enable recovery hold")
        if any(
            item["name"] in ("Candidate-only project", "Candidate-only sharing target")
            for item in request("GET", "/api/projects")["projects"]
        ):
            raise RuntimeError("Restored backup includes post-upgrade writes")
        try:
            request("POST", "/api/projects", {"name": "Must remain blocked"})
        except urllib.error.HTTPError as error:
            if error.code != 503:
                raise
        else:
            raise RuntimeError("Recovery hold accepted project writes")
        print(
            "PASS: pre-upgrade backup restored with previous image; original data preserved and writes held. No external publication was dispatched.",
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
