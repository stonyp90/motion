#!/usr/bin/env python3
"""ACA Job worker: drain segmentation requests from Azure Storage Queue.

Message shape (JSON):
    {
        "job_id": "...",
        "reference_blob": "workdirs/<work_id>/reference.mp4",
        "out_prefix":     "workdirs/<work_id>/segmentation/",
        "backend":        "sam2",
        "model":          "sam2.1_t.pt"
    }

Auth: User-Assigned Managed Identity (AZURE_CLIENT_ID env).
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
QUEUE_NAME = os.environ["MOTION_FORGE_QUEUE_NAME"]
SEGMENT_SCRIPT = "/app/segment_video.py"


def credential() -> DefaultAzureCredential:
    # Workload identity is preferred; falls through to env / managed identity.
    return DefaultAzureCredential(
        managed_identity_client_id=os.environ.get("AZURE_CLIENT_ID"),
        exclude_environment_credential=False,
    )


def main() -> int:
    cred = credential()
    blob = BlobServiceClient(account_url=f"https://{ACCOUNT}.blob.core.windows.net", credential=cred)
    queue = QueueClient(account_url=f"https://{ACCOUNT}.queue.core.windows.net", queue_name=QUEUE_NAME, credential=cred)

    # ACA Jobs typically scale per-message — drain just one then exit so
    # KEDA can recycle the replica. Loop here is defensive.
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        messages = list(queue.receive_messages(messages_per_page=1, visibility_timeout=900))
        if not messages:
            print("queue empty; exiting", file=sys.stderr)
            return 0

        msg = messages[0]
        payload = json.loads(msg.content)
        print(f"processing job {payload.get('job_id')!r}", file=sys.stderr)

        tmp = Path(tempfile.mkdtemp(prefix="mf-seg-"))
        try:
            ref_blob_path = payload["reference_blob"]
            container_name, blob_name = ref_blob_path.split("/", 1)
            local_ref = tmp / "reference.mp4"
            with open(local_ref, "wb") as f:
                downloader = blob.get_blob_client(container_name, blob_name).download_blob()
                f.write(downloader.readall())

            out_dir = tmp / "out"
            out_dir.mkdir(parents=True)
            cmd = [
                "python3", SEGMENT_SCRIPT,
                "--input", str(local_ref),
                "--out-dir", str(out_dir),
                "--backend", payload.get("backend", "sam2"),
                "--model", payload.get("model", "sam2.1_t.pt"),
            ]
            print(f"$ {' '.join(cmd)}", file=sys.stderr)
            subprocess.run(cmd, check=True)

            # Upload everything under out_dir back to Blob.
            out_prefix = payload["out_prefix"].rstrip("/")
            for p in out_dir.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(out_dir).as_posix()
                    target = f"{out_prefix}/{rel}"
                    target_container, target_blob = target.split("/", 1)
                    with open(p, "rb") as data:
                        blob.get_blob_client(target_container, target_blob).upload_blob(data, overwrite=True)

            queue.delete_message(msg)
            print(f"job {payload.get('job_id')!r} done; uploaded to {out_prefix}", file=sys.stderr)
            return 0
        except Exception as e:
            print(f"job failed: {e}", file=sys.stderr)
            # Don't delete the message — visibility times out and another replica retries.
            return 2
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
