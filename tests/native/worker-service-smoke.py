#!/usr/bin/env python3
"""Validate a headless AppImage under a disposable systemd user unit; no user repositories."""
import argparse
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--application", required=True)
args = parser.parse_args()
name = "borgd-validation-" + uuid.uuid4().hex + ".service"
with tempfile.TemporaryDirectory(prefix="borgd-service-") as directory:
    try:
        subprocess.run(["systemd-run", "--user", "--unit=" + name, "--collect", "--property=KillMode=process", "--property=TimeoutStopSec=infinity", "--property=Restart=on-failure", str(Path(args.application).resolve()), "--worker", "--config-dir", directory], check=True, capture_output=True, text=True)
        path = Path(directory) / "worker/runtime.sock"
        deadline = time.monotonic() + 30
        while not path.exists():
            if time.monotonic() > deadline:
                raise AssertionError("systemd worker did not create its private socket")
            time.sleep(.1)
        with socket.socket(socket.AF_UNIX) as stream:
            stream.settimeout(5)
            stream.connect(str(path))
            stream.sendall(b'{"method":"worker_info","args":{}}\n')
            response = b""
            while not response.endswith(b"\n"):
                chunk = stream.recv(4096)
                if not chunk:
                    raise AssertionError("systemd worker disconnected")
                response += chunk
        assert json.loads(response)["result"]["running"] is True
        assert path.stat().st_mode & 0o777 == 0o600
        assert subprocess.check_output(["systemctl", "--user", "is-active", name], text=True).strip() == "active"
        print("PASS: packaged AppImage starts headlessly as a real systemd user service with a private RPC socket")
    finally:
        subprocess.run(["systemctl", "--user", "stop", name], capture_output=True, timeout=90)
    assert not path.exists()
    print("PASS: stopping the temporary user service gracefully removes the socket; no permanent service or user data changed")
