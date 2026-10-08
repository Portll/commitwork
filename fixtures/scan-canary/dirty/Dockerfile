# PLANTED — container lane. Floating tag, no digest, unpinned package install, runs as root,
# and curl-pipe-to-shell. Four distinct Dockerfile-linter findings in six lines.
FROM ubuntu:latest
RUN apt-get update && apt-get install -y curl
RUN curl -sSL https://example.invalid/install.sh | sh
COPY . /app
CMD ["/app/run.sh"]
