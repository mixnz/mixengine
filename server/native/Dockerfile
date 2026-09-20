# An image of the native server, for somebody self-hosting who would rather pull than compile.
#
# **Nothing in the hosted path is a container.** The default instance is the Cloudflare Worker in
# ../worker/, which Cloudflare builds from this repository. This image is a distribution format for
# the second implementation and appears nowhere else — ADR 0046, decision 3: it is a way of
# packaging `server/native/`, not a third implementation.
#
# It is built from `master` and tagged `latest` and `sha-<short>`, the same cadence the Worker
# already deploys on, so a self-hoster and the default instance never run different generations of
# /v1. It is deliberately not attached to a `v*` tag: that would give the server the
# versioned-artifact lifecycle ADR 0046 names as the one thing that would justify splitting it back
# into a repository of its own.

FROM rust:1.98-bookworm AS build
WORKDIR /src
# The manifest and the lock first, so a change to a source file does not re-resolve the tree.
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# The directory the database lives in, made here because the runtime image has no shell to make it
# with. Owned by the unprivileged user the server runs as.
RUN mkdir -p /data && chown 65532:65532 /data

# `cc` and not `static`: rusqlite compiles SQLite itself but still links libc, and reqwest is built
# against rustls so there is no OpenSSL to carry.
FROM gcr.io/distroless/cc-debian12:nonroot AS runtime
COPY --from=build /src/target/release/mixlab-sync /usr/local/bin/mixlab-sync
COPY --from=build --chown=65532:65532 /data /data

ENV MIXLAB_SYNC_BIND=0.0.0.0:8080
ENV MIXLAB_SYNC_DATABASE=/data/mixlab-sync.db

# The two secrets are not here and never will be. A container started without them refuses to
# start and names what is missing, which is the difference between an afternoon and a weekend for
# the first person who self-hosts this.
EXPOSE 8080
VOLUME ["/data"]
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/mixlab-sync"]
