# BuildKit supports this on Intel and Apple Silicon; Azure uses linux/amd64.
FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY *.go ./
RUN CGO_ENABLED=0 go test ./... && CGO_ENABLED=0 GOOS=linux go build -buildvcs=false -trimpath -ldflags="-s -w" -o /out/fema-mcp .

# The Go builder supplies current TLS roots. The final image needs no shell.
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/fema-mcp /fema-mcp
USER 65532:65532
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/fema-mcp"]
