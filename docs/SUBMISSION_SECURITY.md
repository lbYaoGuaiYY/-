# Anonymous submission capability

`QINGSHE_SUBMISSION_TOKEN` is a server-only HMAC signing secret. It must never
be exposed as a `VITE_*` variable or included in a frontend bundle.

The client keeps its existing anonymous UUID in `X-Qingshe-Client` and first
calls `POST /api/v1/submission-sessions`. The service returns a capability that
expires after about ten minutes and is signed for that UUID. A submission must
send the capability as `Authorization: Bearer <upload capability>` together
with the same client UUID. The capability is short-lived authorization, not
user authentication; status reads continue to use the per-submission status
token.

The service does not persist raw capabilities. Verification checks the HMAC in
constant time, expiry, and client binding. New submissions consume atomic UTC
daily counters keyed by SHA-256 hashes of the client UUID and the trusted
remote address. Exact idempotent retries do not consume another slot. Limits
return `429` with `Retry-After`; session issuance is also minute-rate-limited.

`request.client.host` is the default remote address. Forwarded headers are
accepted only when the direct peer matches `QINGSHE_TRUSTED_PROXY_IPS` (an IP
or CIDR list), which is the explicit Caddy/uvicorn trust boundary. Raw client
and IP values are never stored. If the library filesystem has less than the
configured safety reserve, uploads return `507 Insufficient Storage`.

Production pins Caddy to `172.30.232.3` on a dedicated two-service Compose
network and trusts only that `/32`; the API container has no published port.
Because `assets.xiduoduo.top` is proxied by Cloudflare, Caddy also trusts the
official Cloudflare IPv4/IPv6 ranges with strict right-to-left forwarded-IP
parsing. Caddy overwrites the private `X-Qingshe-Client-IP` upstream header
with its parsed `{client_ip}` value; the API ignores `X-Forwarded-For` so a
visitor cannot prepend a spoofed quota identity. When Cloudflare changes its
published ranges, update the Caddy list before deployment and run
`caddy validate`.
