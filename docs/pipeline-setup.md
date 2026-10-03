# Parser-server write credential

Pipeline writes require both the caller's Clerk workspace token and a separate
server credential. Workspace RLS continues to decide which rows are accessible.
The server credential prevents a browser client from publishing an invented
graph through the exposed RPCs.

Set `PIPELINE_WRITE_SECRET` to 32 cryptographically random bytes encoded as 64
lowercase hexadecimal characters in the server's `.env.local`. Never use a
`NEXT_PUBLIC_` environment variable for this value. Never commit or log it.

After the pipeline migration is approved and applied, an administrator inserts
the SHA-256 hash of that exact string into `private.pipeline_credentials`.
Only the hash belongs in the database. The table has RLS enabled and grants no
access to application roles. An empty table disables publishing.

Rotate by adding the replacement credential's hash, updating the server
environment, restarting the server, and removing the old hash after in-flight
runs finish. Keep each environment's credential separate.

Database acceptance must prove that `advance_analysis` and `publish_analysis`
reject missing and wrong credentials, reject another organization's analysis
even with the correct credential, and accept the parser server's own workspace
run. These checks await remote migration authorization.
