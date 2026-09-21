+++
title = "Running your own sync server"
slug = "self-hosting"
order = 18
summary = "Sync with a server you run yourself, on Cloudflare Workers or in a Docker container, and point MixLab at it."
+++

# Running your own sync server

MixLab encrypts everything on your machine before it syncs, so the default server at
`https://sync-0.lab.mixnz.com` holds your data without being able to read it. Running your own
server keeps even that encrypted copy with you. The server is open source and lives in the
[`server/`](https://github.com/mixnz/mixlab/tree/master/server) folder of MixLab's repository, and
there are two ways to run it.

## On Cloudflare Workers

This is what the default server runs on, and Cloudflare's free plan is enough for a few people.

1. Fork [mixnz/mixlab](https://github.com/mixnz/mixlab).
2. In the Cloudflare dashboard, create a Worker from your fork with **`server/worker/`** as its
   root directory.
3. Under the Worker's **Settings → Variables and Secrets**, set `PEPPER` (32 random bytes in
   base64) and `EMAIL_API_KEY` as secrets, and `EMAIL_FROM` and `EMAIL_PROVIDER` as variables.
4. Put your Worker's address into MixLab, as below.

Every setting, and what the free plan allows, is in the
[Worker's README](https://github.com/mixnz/mixlab/blob/master/server/worker/README.md#deploying-it-to-your-own-cloudflare-account).

## In a Docker container

The image `ghcr.io/mixnz/mixlab-sync-server` holds the server as one binary and keeps its data in
one SQLite file. Any machine that runs Docker will do.

1. Create a `.env` file with a pepper and your email provider:

   ```bash
   umask 077
   cat > .env <<EOF
   MIXLAB_SYNC_PEPPER=$(openssl rand -base64 32)
   MIXLAB_SYNC_EMAIL_FROM=noreply@example.com
   MIXLAB_SYNC_EMAIL_PROVIDER=resend
   MIXLAB_SYNC_EMAIL_API_KEY=
   EOF
   ```

2. Save the compose file from the README as `compose.yaml` beside it, and run
   `docker compose up -d`.
3. Put a reverse proxy with TLS in front of it, and put its address into MixLab, as below.

**Generate the pepper once and back it up with the database.** If it changes, every account on the
server is locked out. The
[README](https://github.com/mixnz/mixlab/blob/master/server/native/README.md#using-the-container-image)
has the full configuration, backups, and how to check your server with the conformance suite.

## Pointing MixLab at it

In **Settings → Sync**, press **Add a server** beside the **Server** list, type your server's
address and press **Add**. It has to start with `https://`; plain `http://` works only for a server
on the same machine. Then create an account on it, the same way as on the default server.

If you already sync with another server, use **Move to another server** instead. It copies your
account and everything in it, still encrypted, and signs you in on the new one.
