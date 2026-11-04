# Protecting credentials and runtime data

Keep production `.env` files outside version control. Use a different, randomly
generated administrator password and session secret for each deployment. Never
use a real credential in documentation, tests, screenshots, issues, or logs.

On a Linux deployment, only the service account should be able to read `.env`,
SQLite databases (including `-wal` and `-shm`), session data, and backups. Set
private files to mode `0600` and private directories to `0700`. Set ownership
to the actual service account before tightening permissions. The application
starts with umask `0077` so newly created runtime files remain private.

Move old environment files and source backups out of the deployment tree into
a private directory. In particular, never leave `.bak` files under `public/`.
The application rejects requests for environment files, Git metadata, database
files, keys, and common backup suffixes as a second layer of protection.

Before committing, run `python3 scripts/check-private-paths.py` and
`gitleaks git --redact=100 --log-opts="--all" .`. The secret-check workflow
performs both checks on pushes and pull requests. It uses a pinned Gitleaks
release and SHA-256 checksum and does not upload credential-bearing reports.
These checks complement review; they cannot guarantee that every secret format
or image is detected.

If a credential becomes readable by an unintended account, rotate it at its
issuer and update the private deployment configuration. Rotate the application's
session secret and remove old administrator sessions when session material may
have been exposed. Verify that the old credential fails, the new credential
works, and normal public pages are still available. MaxMind license keys must
be replaced and the old key revoked in the MaxMind account portal; changing a
local configuration file alone does not revoke the old key.

Do not commit database snapshots, WAL/SHM files, uploaded user data, or backup
archives. Deleting a file from the newest commit does not remove it from Git
history. After an authorized history cleanup, collaborators should make a fresh
clone rather than merge or push old history. Public forks, existing clones and
GitHub cached commit views may retain the data; coordinate with their owners or
GitHub Support where necessary.
