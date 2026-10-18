# Privacy

ObsyncBridge is a client for a companion service. This page describes what leaves your machine and what does not.

## What is sent to the ObsyncBridge service

Only when you pair, pull links, or report results:

- The pairing code you enter, and after claiming, the access token issued for that pairing.
- A randomly generated device ID and a device name (defaults to `Obsidian`).
- The name of the vault you are writing into, used to label sync results.
- For each article: its ID, source URL and title, plus whether the note was written and where.
- Nothing else from your notes. Note contents, tags, links and file paths other than the archive target are not uploaded.

## What is stored by the service

The service stores the article links you queue from the Mini Program, their sync status, and the pairing/token record. It does not receive the Markdown bodies produced in your vault.

## What stays on your machine

- Article bodies and images, downloaded directly from the source pages and CDNs into your vault.
- Your settings, including the access token, in `.obsidian/plugins/vault-bridge/data.json` inside the vault.

## Telemetry

There is no client-side telemetry or analytics. The plugin makes no network request unless you trigger an action.

## Deleting your data

Unpairing the device in the Mini Program revokes the token. To have the server-side pairing and queue records deleted, open an issue at <https://github.com/UntilTheEndOfWorld/obsidian-plugins-vault-bridge/issues>.
