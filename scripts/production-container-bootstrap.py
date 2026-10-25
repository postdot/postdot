"""Accept offline bootstrap and release identity against an isolated built image."""

import argparse
import json
import secrets
import subprocess
import tempfile
import time
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--image", required=True)
args = parser.parse_args()


def docker(*arguments, success=True):
    result = subprocess.run(["docker", *arguments], capture_output=True, text=True, timeout=90)
    if success and result.returncode:
        raise RuntimeError(result.stderr)
    return result


image = json.loads(docker("image", "inspect", args.image).stdout)[0]
identity = json.loads(docker("run", "--rm", image["Id"], "--version", "--json").stdout)
labels = image["Config"].get("Labels") or {}
assert identity["revision"] == labels["org.opencontainers.image.revision"]
assert identity["version"] == (labels.get("org.opencontainers.image.version") or None)
with tempfile.TemporaryDirectory(prefix="postdot-bootstrap-container-") as directory:
    root = Path(directory)
    data = root / "data"
    data.mkdir()
    data.chmod(0o777)
    credentials = {"name": "Administrator", "email": "bootstrap@example.test", "password": secrets.token_hex(24)}
    secret = root / "bootstrap.json"
    secret.write_text(json.dumps(credentials))
    # Parent directory is private; the container's unprivileged user can read the mount.
    secret.chmod(0o444)
    mounts = ["--volume", f"{data}:/data", "--volume", f"{secret}:/run/secrets/bootstrap.json:ro"]
    command = ["account", "bootstrap", "--database", "/data/postbot.sqlite", "--input", "/run/secrets/bootstrap.json"]
    first = docker("run", "--rm", *mounts, image["Id"], *command)
    assert "administrator created" in first.stdout
    assert credentials["password"] not in first.stdout + first.stderr
    second = docker("run", "--rm", *mounts, image["Id"], *command, success=False)
    assert second.returncode != 0 and "already configured" in second.stderr
    assert credentials["password"] not in second.stdout + second.stderr
    environment = root / "environment"
    environment.write_text("\n".join(f"{key}={value}" for key, value in {
        "BETTER_AUTH_URL": "http://localhost:3000", "POSTBOT_WEB_ORIGIN": "http://localhost:3000",
        "BETTER_AUTH_SECRET": secrets.token_hex(32), "POSTBOT_MEDIA_PUBLIC_URL_SECRET": secrets.token_hex(32),
        "POSTBOT_PUBLISHER_ENCRYPTION_KEY": secrets.token_hex(32), "POSTBOT_MEDIA_DIRECTORY": "/data/media", "LOG_LEVEL": "error",
    }.items()))
    environment.chmod(0o600)
    name = "postdot-bootstrap-" + secrets.token_hex(6)
    try:
        docker("run", "--detach", "--name", name, *mounts, "--env-file", str(environment), image["Id"])
        for _ in range(100):
            probe = docker("exec", name, "bun", "-e", "if (!(await fetch('http://localhost:3000/health')).ok) process.exit(1)", success=False)
            if probe.returncode == 0:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("Bootstrap image did not become live")
        api_identity = json.loads(docker("exec", name, "bun", "-e", "console.log(await (await fetch('http://localhost:3000/api/version')).text())").stdout)
        assert api_identity == identity
        blocked = docker("run", "--rm", *mounts, image["Id"], *command, success=False)
        assert blocked.returncode != 0 and "lock" in blocked.stderr.lower()
        # Credentials remain in a mounted file, never command arguments or output.
        docker("exec", name, "bun", "-e", "const input = await Bun.file('/run/secrets/bootstrap.json').json(); const r = await fetch('http://localhost:3000/api/auth/sign-in/email', {method:'POST', headers:{'content-type':'application/json',origin:'http://localhost:3000'},body:JSON.stringify(input)}); if(!r.ok || (await r.json()).user.role !== 'admin') process.exit(1)")
    finally:
        docker("rm", "--force", name, success=False)
print("Offline bootstrap, repeat/live refusal, administrator sign-in and CLI/API/image identity passed.")
