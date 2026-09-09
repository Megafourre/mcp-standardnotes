# Troubleshooting

### "No session found. Run `npm run login` to authenticate first."

The keychain lookup (`service: mcp-standardnotes`, `account: SN_EMAIL`) found nothing. Make sure `SN_EMAIL` matches the email you used at login **exactly** (case-sensitive on some OSes).

### "Account is not on protocol 004..."

Legacy 003 accounts are rejected. Upgrade via the official Standard Notes app (Preferences → Security → Upgrade Encryption).

### Notes created via MCP don't appear in the official SN app

This was a known bug fixed in early 2026: the AAD `kp` field must be omitted for items-key-encrypted notes/tags (it's only included for items_keys encrypted under the root key). If you're on an old revision of this project and see this symptom, update.

### Server disconnects immediately in Claude Desktop

Logs show `SyntaxError: Unexpected token '??='`?

Claude Desktop does not inherit your shell's `nvm` setup — it's resolving `node` to an old version from its own PATH. Use an **absolute path** to a Node ≥ 20 binary in the `command` field:

```json
{
  "mcpServers": {
    "mcp-standardnotes": {
      "command": "/Users/you/.nvm/versions/node/v22.13.1/bin/node",
      "args": ["/absolute/path/to/mcp-standardnotes/dist/index.js"],
      "env": { "SN_EMAIL": "you@example.com" }
    }
  }
}
```

Then quit Claude Desktop completely (Cmd-Q) and relaunch.

Logs are at `~/Library/Logs/Claude/mcp-server-mcp-standardnotes.log`.

### Rate limited (429) after repeated logins

Standard Notes caps auth at ~5/min. Wait a minute before retrying. Do **not** retry in a loop.

### Sync returns conflicts

On create/update, if the server returns conflicts, the MCP throws with the conflict payload instead of silently swallowing. For `notes_update`, the common cause is a stale `updated_at_timestamp` — fetch the note fresh (`notes_get`) and retry.

### keytar fails to install on Linux

`keytar` needs `libsecret` at build time. On Debian/Ubuntu:

```bash
sudo apt-get install libsecret-1-dev
```

On Fedora/RHEL:

```bash
sudo dnf install libsecret-devel
```

### Login fails with `Object does not exist at path "/…"` (Linux, SSH / headless)

`keytar` stores the session in the OS keychain via the D-Bus **Secret Service**
(`gnome-keyring`, KWallet, …). On a desktop the *login keyring* is unlocked for
you at graphical login; on a headless box you reach over SSH, nothing unlocks it,
and `gnome-keyring` reports the locked collection with this misleading error.

Check whether it's really locked:

```bash
busctl --user call org.freedesktop.secrets \
  /org/freedesktop/secrets/collection/login \
  org.freedesktop.DBus.Properties Get ss \
  org.freedesktop.Secret.Collection Locked
#  v b true   → locked;  v b false → fine;  an error → daemon in a bad state
```

Also look for leaked daemons from an earlier session and kill them:

```bash
pgrep -au "$USER" gnome-keyring-daemon
pkill -u "$USER" -x gnome-keyring-daemon
```

**Unlock it for the session** (the keyring password is whatever it was created
with — often your account password). The daemon is shared across every session
on the user bus, so this is once per boot, not once per shell:

```bash
eval "$(printf %s 'KEYRING_PASSWORD' | gnome-keyring-daemon \
  --start --daemonize --components=secrets,pkcs11 --unlock)"
```

**Do it automatically.** Drop this into `~/.bash_profile` (source `~/.profile`
from it too, if you don't already have one — bash skips `~/.profile` once
`~/.bash_profile` exists):

```bash
if [[ $- == *i* ]] && command -v gnome-keyring-daemon >/dev/null 2>&1; then
  _kr() { busctl --user call org.freedesktop.secrets \
    /org/freedesktop/secrets/collection/login org.freedesktop.DBus.Properties \
    Get ss org.freedesktop.Secret.Collection Locked 2>/dev/null | grep -q 'b false'; }
  if ! _kr; then
    pkill -u "$USER" -x gnome-keyring-daemon 2>/dev/null
    read -rs -p "Unlock GNOME keyring — password: " _kpw; echo
    eval "$(printf %s "$_kpw" | gnome-keyring-daemon --start --daemonize \
      --components=secrets,pkcs11 --unlock 2>/dev/null)"; unset _kpw
    _kr && echo "  keyring unlocked." >&2 || echo "  still locked." >&2
  fi
  unset -f _kr
fi
```

Run `sudo loginctl enable-linger "$USER"` so the daemon (and the unlock) survive
between logins.

*Fully unattended* (no prompt): put the password in `~/.config/keyring-unlock.pw`
(`chmod 600`) and run a `systemd --user` unit that pipes it into
`gnome-keyring-daemon … --unlock` at startup. The SN secrets stay AES-encrypted
at rest under that password, so it beats a passwordless (unencrypted) keyring —
but anyone who can read the file gets in.

### I want to switch accounts

Wipe the current session from the keychain, then re-login:

```bash
SN_EMAIL=old@example.com npm run logout
SN_EMAIL=new@example.com npm run login
```

### Running two accounts at once (personal + family)

See the [Multiple accounts](../README.md#multiple-accounts-eg-personal--family)
section — one server instance per account, wired up in one step with
`mcp-standardnotes-install --all`.
