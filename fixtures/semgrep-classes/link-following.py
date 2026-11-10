# Annotated fixture for manifests/semgrep-classes/link-following.yaml (Python rule).
import shutil
import shutil as _sh


def export_bundle(src, dst):
    # ruleid: cw-copytree-follows-links-py
    shutil.copytree(src, dst)


def export_bundle_aliased(src, dst):
    # ruleid: cw-copytree-follows-links-py
    _sh.copytree(src, dst, dirs_exist_ok=True)


def export_bundle_links_kept(src, dst):
    # ok: cw-copytree-follows-links-py
    shutil.copytree(src, dst, symlinks=True)


def export_one(src, dst):
    # ok: cw-copytree-follows-links-py
    shutil.copy2(src, dst)
