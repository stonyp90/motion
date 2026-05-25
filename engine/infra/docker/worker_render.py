#!/usr/bin/env python3
"""ACA Job worker: drain render requests, rasterize Lottie -> MP4, upload.

Message shape (JSON):
    {
        "job_id":      "...",
        "lottie_blob": "outputs/<job>/out.lottie.json",
        "out_blob":    "outputs/<job>/out.mp4",
        "width":       1920,
        "height":      1080,
        "fps":         30
    }
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient
from azure.storage.queue import QueueClient

ACCOUNT = os.environ["MOTION_FORGE_BLOB_ACCOUNT"]
QUEUE_NAME = os.environ.get("MOTION_FORGE_RENDER_QUEUE_NAME", "jobs-render")
RENDER_SCRIPT = "/app/render_lottie.py"


def credential() -> DefaultAzureCredential:
    return DefaultAzureCredential(
        managed_identity_client_id=os.environ.get("AZURE_CLIENT_ID"),
        exclude_environment_credential=False,
    )


def main() -> int:
    cred = credential()
    blob = BlobServiceClient(account_url=f"https://{ACCOUNT}.blob.core.windows.net", credential=cred)
    queue = QueueClient(account_url=f"https://{ACCOUNT}.queue.core.windows.net", queue_name=QUEUE_NAME, credential=cred)

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        messages = list(queue.receive_messages(messages_per_page=1, visibility_timeout=1200))
        if not messages:
            print("render queue empty; exiting", file=sys.stderr)
            return 0

        msg = messages[0]
        payload = json.loads(msg.content)
        print(f"rendering job {payload.get('job_id')!r}", file=sys.stderr)

        tmp = Path(tempfile.mkdtemp(prefix="mf-render-"))
        try:
            local_lottie = tmp / "in.lottie.json"
            container, blob_name = payload["lottie_blob"].split("/", 1)
            with open(local_lottie, "wb") as f:
                f.write(blob.get_blob_client(container, blob_name).download_blob().readall())

            local_mp4 = tmp / "out.mp4"
            cmd = [
                "python3", RENDER_SCRIPT,
                "--input", str(local_lottie),
                "--output", str(local_mp4),
                "--width", str(int(payload.get("width", 1920))),
                "--height", str(int(payload.get("height", 1080))),
                "--fps", str(float(payload.get("fps", 30))),
            ]
            print(f"$ {' '.join(cmd)}", file=sys.stderr)
            subprocess.run(cmd, check=True)

            target_container, target_blob = payload["out_blob"].split("/", 1)
            with open(local_mp4, "rb") as data:
                blob.get_blob_client(target_container, target_blob).upload_blob(
                    data,
                    overwrite=True,
                    content_settings={"content_type": "video/mp4"},
                )

            queue.delete_message(msg)
            print(f"render done; uploaded to {payload['out_blob']}", file=sys.stderr)
            return 0
        except Exception as e:
            print(f"render failed: {e}", file=sys.stderr)
            return 2
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
