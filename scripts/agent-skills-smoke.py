"""Validate installed skill HTTP examples on a disposable published-alpha container.

Requires Python 3, Docker and the pinned image locally. No provider is connected.
"""

import json, os, pathlib, secrets, socket, subprocess, tempfile, time, urllib.request, urllib.error, http.cookiejar

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMAGE = "ghcr.io/postdot/postdot@sha256:690778f5d1af8f4a363406b989e17da8672fc764c6e62f9cca8e1a09c483638e"
name = "postdot-agent580-" + secrets.token_hex(4)
with tempfile.TemporaryDirectory(prefix="postdot-agent580-live-") as d:
    p = pathlib.Path(d)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    origin = "http://127.0.0.1:" + str(port)
    env = {
        "BETTER_AUTH_URL": origin,
        "POSTBOT_WEB_ORIGIN": origin,
        "BETTER_AUTH_SECRET": secrets.token_hex(32),
        "POSTBOT_MEDIA_PUBLIC_URL_SECRET": secrets.token_hex(32),
        "POSTBOT_PUBLISHER_ENCRYPTION_KEY": secrets.token_hex(32),
        "POSTBOT_PUBLISHER_ENCRYPTION_KEY_ID": "v1",
        "POSTBOT_MEDIA_DIRECTORY": "/data/media",
        "LOG_LEVEL": "error",
    }
    config = p / "environment"
    config.write_text("\n".join(k + "=" + v for k, v in env.items()))
    config.chmod(0o600)
    subprocess.run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "--env-file",
            str(config),
            "-p",
            f"127.0.0.1:{port}:3000",
            IMAGE,
        ],
        capture_output=True,
        check=True,
    )
    try:
        for n in range(80):
            try:
                with urllib.request.urlopen(origin + "/ready", timeout=2) as r:
                    if r.status == 200:
                        break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError("isolated image did not become ready")
        cookies = http.cookiejar.CookieJar()
        client = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cookies)
        )

        def api(method, path, body=None):
            req = urllib.request.Request(
                origin + path,
                data=None if body is None else json.dumps(body).encode(),
                method=method,
                headers={"Content-Type": "application/json", "Origin": origin},
            )
            try:
                with client.open(req, timeout=10) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                raise RuntimeError(
                    f"{method} {path}: {e.code}, {e.read().decode()[:400]}"
                )

        api(
            "POST",
            "/api/auth/sign-up/email",
            {
                "email": "alpha@example.test",
                "name": "Alpha smoke",
                "password": secrets.token_hex(20),
            },
        )
        project = api("POST", "/api/projects", {"name": "Skill evaluation"})["project"][
            "id"
        ]
        channel = api(
            "POST", f"/api/projects/{project}/channels", {"name": "Manual evaluation"}
        )["channel"]["id"]
        full_key = api(
            "POST",
            "/api/api-keys",
            {"name": "Skill evaluation", "projectIds": [project]},
        )["token"]
        key = api(
            "POST",
            "/api/api-keys",
            {
                "name": "Draft evaluation",
                "projectIds": [project],
                "actionAccess": ["project:read", "publication:manage"],
            },
        )["token"]
        # Copy only the installed product skill; no workspace packages or Bun required.
        import shutil

        shutil.copytree(ROOT / "skills/postdot", p / "postdot")

        def helper(method, path, body=None, expected=0):
            args = ["python3", str(p / "postdot/scripts/request.py"), method, path]
            if body is not None:
                f = p / "body.json"
                f.write_text(json.dumps(body))
                args += ["--input", str(f)]
            run = subprocess.run(
                args,
                env={
                    "PATH": os.environ["PATH"],
                    "POSTBOT_URL": origin,
                    "POSTBOT_API_KEY": key,
                },
                capture_output=True,
                text=True,
            )
            if run.returncode != expected:
                raise RuntimeError("helper failure: " + run.stderr)
            assert key not in run.stdout + run.stderr
            return json.loads(run.stdout if run.returncode == 0 else run.stderr)

        assert helper("GET", "/api/projects")["projects"]
        assert helper("GET", f"/api/projects/{project}/channels")["channels"]
        profile = helper("GET", f"/api/projects/{project}/channels/{channel}/profile")
        assert profile["active"]["profile"]
        helper("GET", f"/api/projects/{project}/publishers")
        helper("GET", f"/api/projects/{project}/media/upload-policy")
        body = {
            "title": "Release announcement",
            "sourceContent": {
                "body": {"text": "The release is ready.", "format": "plain_text"},
                "media": [],
            },
            "publications": [
                {
                    "channelId": channel,
                    "deliveryMode": "manual",
                    "targetContent": {"body": "The release is ready.", "media": []},
                }
            ],
        }
        created = helper("POST", f"/api/projects/{project}/posts", body)
        pub = created["publications"][0]["id"]
        editor = helper("GET", f"/api/projects/{project}/publications/{pub}/editor")
        (p / "editor.json").write_text(json.dumps(editor))
        print("Editor readback received.")
        assert editor["editor"]["publication"]["state"] == "draft"
        assert editor["editor"]["publication"]["scheduledAt"] is None
        revision = editor["editor"]["draft"]["revision"]
        helper(
            "POST",
            f"/api/projects/{project}/publications/{pub}/approval-request",
            {
                "expectedDraftRevision": revision,
                "proposedScheduledAt": int(time.time() * 1000) + 86400000,
            },
        )
        reviewed = helper("GET", f"/api/projects/{project}/publications/{pub}/editor")[
            "editor"
        ]["publication"]
        assert reviewed["state"] == "draft" and reviewed["scheduledAt"] is None
        rejected = helper(
            "POST",
            f"/api/projects/{project}/publications/{pub}/approval-request/approve",
            {},
            expected=1,
        )
        assert rejected["error"]["status"] in (401, 403)
        refused = helper(
            "POST",
            f"/api/projects/{project}/publications/{pub}/draft/promote",
            {
                "expectedRevision": revision,
                "scheduledAt": int(time.time() * 1000) + 86400000,
            },
            expected=1,
        )
        assert refused["error"]["status"] == 403
        helper(
            "PATCH",
            f"/api/projects/{project}/publications/{pub}/draft",
            {
                "expectedRevision": revision,
                "targetContent": {"body": "Revised synthetic draft", "media": []},
            },
        )
        conflict = helper(
            "PATCH",
            f"/api/projects/{project}/publications/{pub}/draft",
            {
                "expectedRevision": revision,
                "targetContent": {"body": "Stale write", "media": []},
            },
            expected=1,
        )
        assert conflict["error"]["status"] == 409
        key = full_key
        current = helper("GET", f"/api/projects/{project}/publications/{pub}/editor")[
            "editor"
        ]
        at = int(time.time() * 1000) + 86400000
        helper(
            "POST",
            f"/api/projects/{project}/publications/{pub}/draft/promote",
            {"expectedRevision": current["draft"]["revision"], "scheduledAt": at},
        )
        scheduled = helper("GET", f"/api/projects/{project}/publications/{pub}/editor")[
            "editor"
        ]["publication"]
        assert scheduled["state"] == "scheduled" and scheduled["scheduledAt"] == at
        helper(
            "PATCH",
            f"/api/projects/{project}/publications/cancel",
            {"publicationIds": [pub]},
        )
        assert (
            helper("GET", f"/api/projects/{project}/publications/{pub}/editor")[
                "editor"
            ]["publication"]["state"]
            == "cancelled"
        )
        print(
            "PASS: future manual scheduling and cancellation with dispatch key; manage-only promotion denied."
        )
        print(
            "PASS: published-image HTTP discovery, active profile, media policy, manual draft, inert review request, human-only approval refusal and stale revision conflict. No provider request; only future manual scheduling/cancellation."
        )
    finally:
        subprocess.run(
            ["docker", "stop", "--time", "10", name], capture_output=True, check=True
        )
