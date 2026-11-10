# Annotated fixture for manifests/semgrep-classes/fetch-then-load.yaml (Python rule).
import hashlib
import pickle

import torch

from .io import get_local_path, verify_sha256

PINNED = "0" * 64


def load_index(opts):
    remote = opts["dataset.index_file"]
    local = get_local_path(opts, path=remote)
    with open(local, "rb") as fh:
        # ruleid: cw-fetched-then-unpickled-py
        return pickle.load(fh)


def load_weights(opts):
    local = get_local_path(opts, path=opts["model.weights"])
    # ruleid: cw-fetched-then-unpickled-py
    return torch.load(local)


def load_index_pinned(opts):
    local = get_local_path(opts, path=opts["dataset.index_file"])
    verify_sha256(local, PINNED)
    with open(local, "rb") as fh:
        # ok: cw-fetched-then-unpickled-py
        return pickle.load(fh)


def load_index_hashed(opts):
    local = get_local_path(opts, path=opts["dataset.index_file"])
    with open(local, "rb") as fh:
        digest = hashlib.file_digest(fh, "sha256").hexdigest()
    if digest != PINNED:
        raise ValueError("digest mismatch")
    with open(local, "rb") as fh:
        # ok: cw-fetched-then-unpickled-py
        return pickle.load(fh)


def load_local(path):
    with open(path, "rb") as fh:
        # ok: cw-fetched-then-unpickled-py
        return pickle.load(fh)
