# commitwork on Debian 12 with Node 22: the CLI, the Linux scanners the image can pin, and bwrap +
# pasta for the lane sandbox. container/README.md covers the run flags, what is pinned and how.
#
# Build from a commit, so only tracked files are read (from a working-tree context bin/install.sh
# installs that checkout's HEAD, never its uncommitted or ignored files):
#   git archive --format=tar HEAD | docker build -f container/Dockerfile -t commitwork:local -
# Run against one repository, mounted read-only at /repo:
#   docker run --rm --init --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
#     --device /dev/net/tun -v "$PWD:/repo:ro" -v "$PWD/../scans:/out" commitwork:local scan --root /repo --out /out

FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

# Comma list for `setup --only`, or `none`. install.sh --release-only refuses any tool setup would
# not take from a release asset pinned by SHA-256 in manifests/install-catalog.json.
ARG SCANNERS=gitleaks,trufflehog

ENV CW_SETUP_BIN_DIR=/usr/local/bin \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

COPY container/debian.sources /etc/apt/sources.list.d/debian.sources
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates=20250419~deb12u1 \
      git=1:2.39.5-0+deb12u3 \
      bubblewrap=0.8.0-2+deb12u1 \
      passt=0.0~git20230309.7c7625d-1 \
      python3=3.11.2-1+b1 \
      python3-venv=3.11.2-1+b1 \
 && rm -rf /var/lib/apt/lists/*

# One venv for the Python scanners, from the hash lock. pip is Debian's, from the snapshot above.
RUN --mount=type=bind,source=container/requirements.txt,target=/tmp/requirements.txt \
    python3 -m venv /opt/scanners \
 && /opt/scanners/bin/pip install --require-hashes --no-deps --only-binary=:all: -r /tmp/requirements.txt \
 && for t in semgrep bandit flawfinder ruff zizmor; do ln -s "/opt/scanners/bin/$t" "/usr/local/bin/$t"; done

RUN --mount=type=bind,target=/src \
    sh /src/bin/install.sh --from /src --dest /opt/commitwork --prefix /usr/local --release-only --scanners "$SCANNERS" \
 && rm -rf /root/.commitwork /root/.cache /root/.npm /tmp/*

# /repo is the one tree git may read under another owner; a root of many repositories needs
# --user "$(id -u):$(id -g)" instead (container/README.md). semgrep must create ~/.semgrep, which a
# lane cannot do under the read-only root, so the image makes it.
RUN git config --system --add safe.directory /repo \
 && mkdir -p /out /home/node/.semgrep && chown 1000:1000 /out /home/node/.semgrep

# A lane the sandbox cannot confine is refused as noscan, never run unconfined. No setup prompt.
ENV CW_SANDBOX=require \
    CW_SKIP_SETUP=1
# The base image's `node` user, numeric so a runtime without a passwd lookup still drops root.
USER 1000:1000
WORKDIR /home/node
ENTRYPOINT ["node", "/opt/commitwork/bin/commitwork.mjs"]
CMD ["doctor", "--manifest", "security-baseline"]
