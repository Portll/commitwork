# A runner slot: one GitHub Actions job per container lifetime, on the commitwork image.
# container/runner/README.md covers the run flags and the compose service that restarts it.
#
#   docker build -f container/runner/Dockerfile --build-arg BASE=commitwork:<sha> -t commitwork-runner:<sha> <ctx>

ARG BASE=commitwork:local
ARG RUNNER_VERSION=2.338.0
ARG TARGETARCH

FROM scratch AS runner-arm64
ARG RUNNER_VERSION
ADD --checksum=sha256:628b4a7258487b80c1d3c221095a7ded349f5ae0175fd3dfab708d07428f041b \
    https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz /runner.tar.gz

FROM scratch AS runner-amd64
ARG RUNNER_VERSION
ADD --checksum=sha256:af4b794c1bc41d73d40535e3fe092a39f9679cd8d965954c2aca25a05ca41d32 \
    https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz /runner.tar.gz

FROM runner-${TARGETARCH} AS runner

FROM ${BASE}
USER 0
# setup-node's Node 26 build links libatomic, which GitHub's hosted images carry and slim Debian does
# not. From the base image's dated snapshot, pinned like its other packages.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libatomic1=12.2.0-14+deb12u1 \
 && rm -rf /var/lib/apt/lists/*
RUN --mount=type=bind,from=runner,target=/fetch \
    mkdir -p /opt/actions-runner \
 && tar -xzf /fetch/runner.tar.gz -C /opt/actions-runner \
 && chown -R 0:0 /opt/actions-runner \
 && chmod -R a-w /opt/actions-runner \
 && install -d -m 0555 -o 0 -g 0 /opt/commitwork/container/runner /opt/commitwork/runner \
 && install -d -m 0700 -o 1000 -g 1000 /data
# Already in /opt/commitwork once committed (install.sh copies the tree); copied so an uncommitted
# slot layer can be measured against a committed base. The hook imports runner/admission.mjs.
COPY --chmod=0444 container/runner/*.mjs /opt/commitwork/container/runner/
COPY --chmod=0555 container/runner/job-started.sh /opt/commitwork/container/runner/
COPY --chmod=0444 runner/*.mjs /opt/commitwork/runner/

# The base image's licence directory again, now with the runner, its .NET runtime and libatomic1.
ARG SOURCES_AT=
RUN --mount=type=bind,target=/src \
    node /src/container/licenses.mjs --image commitwork-runner --tree /src --sources-at "$SOURCES_AT"

# The runner loads ICU only for culture data; invariant mode keeps libicu out of the image.
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    CW_SLOT_WORK=/work
# Root is the supervisor only: it wipes /work, drops the job to uid 1000, and reads the cgroup after.
ENTRYPOINT ["node", "/opt/commitwork/container/runner/supervisor.mjs"]
CMD []
