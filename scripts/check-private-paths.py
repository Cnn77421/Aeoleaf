#!/usr/bin/env python3
"""Reject runtime secrets and database artifacts even when forcibly staged."""
import pathlib
import re
import subprocess
import sys

tracked = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
blocked = []
for name in filter(None, tracked):
    path = pathlib.PurePosixPath(name)
    basename = path.name
    env_file = basename.startswith('.env') and basename != '.env.example'
    runtime_file = name.startswith('database/') or name.startswith('public/uploads/')
    secret_suffix = re.search(r'\.(pem|key|p12|pfx|aebak|db|sqlite3?|sql)(?:[-.]|$)', basename, re.I)
    backup_suffix = re.search(r'\.(bak|backup|orig|swp)(?:[-.]|$)|~$', basename, re.I)
    if env_file or runtime_file or secret_suffix or backup_suffix:
        blocked.append(name)
if blocked:
    print('Remove these private/runtime files from the Git index:', file=sys.stderr)
    print('\n'.join(blocked), file=sys.stderr)
    sys.exit(1)
print('No private configuration, runtime databases or backup artifacts are tracked.')
