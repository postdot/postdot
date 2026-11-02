"""Exercise generated completion in a clean shell's actual interactive line editor."""

import fcntl
import os
from pathlib import Path
import pty
import re
import select
import shlex
import struct
import subprocess
import sys
import tempfile
import termios
import time

shell, script = sys.argv[1:]


def quote(value):
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'" if shell == "fish" else shlex.quote(value)


with tempfile.TemporaryDirectory(prefix="postdot-completion-shell-") as directory:
    environment = dict(os.environ, HOME=directory, XDG_CONFIG_HOME=directory, TERM="xterm-256color")
    master, slave = pty.openpty()
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 160, 0, 0))

    def session():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    arguments = {"bash": ["--noprofile", "--norc", "-i"], "zsh": ["-f", "-i"], "fish": ["--no-config", "-i"]}[shell]
    process = subprocess.Popen([shell, *arguments], stdin=slave, stdout=slave, stderr=slave,
                               env=environment, cwd=directory, preexec_fn=session)
    os.close(slave)
    buffer = ""

    def receive(pattern):
        global buffer
        deadline = time.monotonic() + 15
        while True:
            match = re.search(pattern, buffer)
            if match:
                value = match.group(1) if match.lastindex else ""
                buffer = buffer[match.end():]
                return value.rstrip("\r")
            if time.monotonic() >= deadline:
                raise AssertionError(f"{shell}: completion timed out; output: {buffer[-1600:]!r}")
            if select.select([master], [], [], 0.1)[0]:
                buffer += os.read(master, 65536).decode(errors="replace")

    try:
        source = f"source {quote(script)}"
        if shell == "bash":
            setup = source + "; __postdot_capture() { printf '\\n__POSTDOT_RESULT__:%s\\n' \"$READLINE_LINE\"; READLINE_LINE=''; }; bind -x '\"\\C-x\":__postdot_capture'"
        elif shell == "zsh":
            setup = "autoload -Uz compinit; compinit -u -D; " + source + "; bindkey -e; __postdot_capture() { print -r -- ''; print -r -- \"__POSTDOT_RESULT__:$BUFFER\"; BUFFER=''; zle reset-prompt; }; zle -N __postdot_capture; bindkey '^X' __postdot_capture"
        else:
            setup = source + "; function __postdot_capture; printf '\\n__POSTDOT_RESULT__:%s\\n' (commandline); commandline ''; commandline -f repaint; end; bind ctrl-x __postdot_capture"
        os.write(master, (setup + "; printf '%s%s\\n' '__POSTDOT_' 'READY__'\n").encode())
        receive(r"__POSTDOT_READY__\r?\n")
        sentinel = Path(directory) / "must-not-execute"
        cases = [
            ("postdot proj", "postdot projects"),
            ("postdot publications sh", "postdot publications show"),
            ("postdot publications reconcile --resol", "postdot publications reconcile --resolution"),
            ("postdot publications reconcile --resolution=p", "postdot publications reconcile --resolution=published"),
            ("postdot --base-url http://127.0.0.1:3000 publications sh", "postdot --base-url http://127.0.0.1:3000 publications show"),
            ("postdot --profile 'work space' publications sh", "postdot --profile 'work space' publications show"),
            (f"postdot --profile '$(touch {sentinel})' publications sh", f"postdot --profile '$(touch {sentinel})' publications show"),
            ("postdot completion z", "postdot completion zsh"),
        ]
        cases = [(before, expected, 0) for before, expected in cases] + [
            ("postdot publications sh --json", "postdot publications show --json", 7),
        ]
        for before, expected, left in cases:
            os.write(master, before.encode() + b"\x1b[D" * left + b"\t")
            # The capture key is processed after synchronous completion finishes.
            os.write(master, b"\x18")
            actual = receive(r"__POSTDOT_RESULT__:(.*?)\r?\n").rstrip()
            if shell == "zsh" and left:
                actual = re.sub(r"  +", " ", actual)
            assert actual == expected, f"{shell}: {before!r}: expected {expected!r}, got {actual!r}"
            assert not sentinel.exists(), "Completion executed literal shell text"
        print(f"{shell}: {len(cases)} real Tab-completion cases passed")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        os.close(master)
