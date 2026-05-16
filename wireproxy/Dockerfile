# syntax=docker/dockerfile:1.7
# Build stage.
FROM docker.io/golang:1.26-alpine AS build

WORKDIR /usr/src/wireproxy

# Prime the module cache first so changes to source files don't reinvalidate
# the dependency download layer.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Now the source. We call `go build` directly (instead of `make`) so we don't
# need to install make in alpine, and we keep module + build caches mounted so
# incremental rebuilds skip recompilation of unchanged packages. The Makefile's
# `TAG` substitution becomes a static "docker" version string.
COPY . .
ENV CGO_ENABLED=0
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags "-s -w -X 'main.version=docker'" -o wireproxy ./cmd/wireproxy

# Runtime stage.
FROM gcr.io/distroless/static-debian11:nonroot
COPY --from=build /usr/src/wireproxy/wireproxy /usr/bin/wireproxy

VOLUME [ "/etc/wireproxy" ]
ENTRYPOINT [ "/usr/bin/wireproxy" ]
CMD [ "--config", "/etc/wireproxy/config" ]

LABEL org.opencontainers.image.title="wireproxy"
LABEL org.opencontainers.image.description="Wireguard client that exposes itself as a socks5 proxy"
LABEL org.opencontainers.image.licenses="ISC"
