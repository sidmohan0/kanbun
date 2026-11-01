# Electron desktop shell

The desktop client lives in `apps/desktop` and loads `https://kanbun.ai`. It uses the same deployed
React UI, Worker API, sync engine and authentication routes as the web client. Web development and
deployment remain unchanged. The shell does not bundle the Worker or provide independent offline
startup; once loaded, the existing web client's caching and recovery behavior still applies.

## Development and verification

Use the repository devcontainer for installation, compilation and verification:

```sh
./scripts/devcontainer.sh up
./scripts/devcontainer.sh exec pnpm install --frozen-lockfile
./scripts/devcontainer.sh exec pnpm --filter @kanbun/desktop build
./scripts/devcontainer.sh exec pnpm --filter @kanbun/desktop test
./scripts/devcontainer.sh verify
```

Rebuild an existing container after pulling the added GTK and `xauth` system dependencies. The desktop tests
launch real Electron windows on a virtual X display; they do not require a host GUI. The full verifier
discovers the workspace's build, typecheck and tests through the existing recursive pnpm commands.
Electron is pinned in the desktop workspace; its binary downloads on first use and is cached locally.
For linked Git worktrees, `devcontainer.sh up`/`rebuild` also mounts the shared Git metadata at its
original absolute path so the verifier and separate changelog/spec checks can inspect real refs.

`pnpm --filter @kanbun/desktop start` is the shell entry point in a graphical environment after
building. `KANBUN_DESKTOP_URL` overrides the application URL for development or a test deployment;
HTTPS is required except for loopback HTTP. The regular `pnpm dev` command continues to start only
the web and Worker development servers: the desktop workspace intentionally has no `dev` script.

## Distribution targets

`electron-builder.json` defines the following targets. Architecture-specific filenames prevent
uploads from overwriting each other.

| Platform policy                         | Architectures                      | Downloads                   |
| --------------------------------------- | ---------------------------------- | --------------------------- |
| macOS 15 and newer                      | Apple Silicon (arm64), Intel (x64) | DMG and ZIP                 |
| Windows 11                              | x64, ARM64                         | NSIS installer              |
| Linux, initially Ubuntu 24.04 and newer | x64, ARM64                         | AppImage and Debian package |

The Mac bundle declares `LSMinimumSystemVersion=15.0.0`, excluding macOS 14 and earlier. This is a
Kanbun product policy, separate from Electron's broader runtime compatibility. Windows 11 and
Ubuntu 24.04 are support targets, not installer-enforced minimums; other systems may run the app
but are not yet validated. No 32-bit builds are produced.

Linux packages can be built in the shared devcontainer:

```sh
./scripts/devcontainer.sh exec pnpm --filter @kanbun/desktop dist:linux
```

Artifacts are written to the ignored `apps/desktop/release/` directory. Packaging includes only
compiled desktop JavaScript and application metadata, alongside the Electron runtime; the UI
continues to load from the hosted app. `dist:mac` and `dist:windows` select the other packaging
targets. Publishing is disabled in the build configuration and commands.

CI first runs the full devcontainer verifier and uploads its compiled desktop JavaScript. Linux
packaging runs in the same devcontainer; native Mac and Windows jobs download that verified output,
install frozen dependencies without lifecycle scripts, and package without recompiling repository
source. This narrow exception is recorded in `AGENTS.md`. Mac jobs use macOS 15; Windows jobs use
Windows Server 2025. CI uploads the packages as workflow artifacts, with no release publication.

Native jobs disable automatic signing-identity discovery. Unsigned artifacts are development
builds, not public releases: Mac users will encounter Gatekeeper restrictions and Windows users
may encounter publisher/reputation warnings. Public Mac distribution needs a Developer ID
certificate and Apple notarization credentials; public Windows distribution needs a signing
identity. No signing credentials are stored in the repository. Automatic updates, public download
hosting and store distribution remain separate work.

## Sessions and navigation

The `persist:kanbun` Electron partition retains the desktop client's cookies and browser storage
across restarts, independently of Chrome and the web client's session. Users sign in inside the
desktop window. Email links remain HTTPS links and may open in the default browser. When a valid
callback cannot be inspected in that browser's session, **Open in Kanbun** sends it through the
registered `kanbun://signin/...` protocol to the requesting desktop app. The app handles both cold
launches and callbacks delivered to an existing instance, then shows the usual explicit email
confirmation. The original HttpOnly request cookie must still match; browser sessions and cookies
are never imported into the desktop app.

The browser button requires deployment of the updated web UI and installation of a desktop build
with protocol support. The desktop **File → Open sign-in link from clipboard** command also accepts
the complete original HTTPS email link, so it works before the browser UI deploys. Clipboard access
occurs only when that command is invoked; invalid contents are never echoed. Custom protocol and
clipboard callbacks accept only valid sign-in tokens and known issue/invitation return hashes, and
always navigate to the configured app origin. Expired, used or mismatched links remain unavailable.
Integration settings offer **Manage in browser** before starting third-party authorization.
An explicit settings-only link opens the configured app's integration page in the system browser;
sign in there and start the connection in that browser. OAuth state and callbacks then remain in
one browser session. Reload the desktop app after changing a connection. This requires an updated
desktop build; older builds can open the integration page directly in a browser instead. No OAuth
codes, credentials or session cookies are handed between the desktop app and browser.

Other same-origin navigation remains inside the window. User-triggered HTTP, HTTPS and mail links to
other origins open in the system browser. Other schemes are denied, and cross-origin redirects are
blocked rather than moving privileged application windows to external sites. Same-origin popups
reuse the current window. Native menus support editing, reload, zoom, fullscreen and window actions.
Closing the window hides it to the Kanbun-logo tray on all platforms. A second application launch reopens the window.

## Local capabilities

The renderer has Node integration disabled, context isolation and sandboxing enabled, no preload
bridge, no webviews and no granted browser permissions. This shell does not expose filesystem,
process-execution, browser-control or computer-use tools to web content. The read-only collector
runs in the main process and launches Codex as a child. Never disable the renderer sandbox to add
local tools.

The desktop smoke test verifies renderer isolation, blocked unsafe navigation/popups, callback
delivery through macOS/second-instance events and launch arguments, clipboard handoff, and session
storage/cookie persistence after a real Electron restart against a local HTTP fixture. The full web
verifier covers the existing application. Hosted account login, external OAuth and native macOS UI
behavior need separate validation before distribution.

## Local agent session prototype

The Kanbun-logo tray menu opens the window, displays the 30 most recently changed local sessions,
and refreshes immediately. The collector also refreshes every 30 seconds while Kanbun runs. It
uses the Claude Agent SDK to list local Claude Code history and a separate `codex app-server` to
list local Codex threads. Codex must be available on the desktop process PATH (the collector also
checks common local, Homebrew, nvm, and installed ChatGPT app locations). The tray shows provider errors
when collection fails. Session titles may contain sensitive text; they stay in process memory and
are not uploaded. This prototype does not add a web dashboard, remote sync, or agent control.

Choose **Live status hooks** from the tray to enable or disable each provider. Kanbun merges its
handlers into `~/.codex/hooks.json` and `~/.claude/settings.json` without removing existing hooks.
Codex requires reviewing and trusting the added hooks with `/hooks`; provider sessions may need to
restart before changes apply. Removing or moving the app requires disabling and re-enabling hooks.
Malformed settings are left untouched and reported as an error.

Hooks store only provider, session identifier, event name, optional notification type, and local
observation time in a user-private `kanbun-session-observer` directory under the desktop app's user
data. They do not store prompts or tool inputs. The tray updates every three seconds. Status is
`unknown` without evidence, becomes `stale` five minutes after the last event, and returns to
`unknown` after events expire at 24 hours. A quiet but still-running agent can be stale; a crash,
disabled or untrusted hook, or a missing event cannot prove that work ended. Stopping a turn does
not assert task success. Cloud-orchestrated sessions may not emit local hooks. A sleeping, logged-out,
or powered-off computer cannot collect. Hook files may accumulate while the desktop app is stopped;
they are pruned when the app resumes.

Packaged builds enable start-at-login on first launch, launching hidden with the tray available.
The tray checkbox allows opting out; explicit Quit stops collection until the next login or launch.
macOS and Windows use Electron's login-item API. Linux creates a user-owned XDG autostart entry at
`$XDG_CONFIG_HOME/autostart/ai.kanbun.desktop.desktop` (or `~/.config/autostart/`), with `TryExec`
so a removed executable is not launched. Linux requires a desktop environment with a system tray.
A moved AppImage requires toggling Start at login to update its path.

Before uninstalling, disable both provider hooks in **Live status hooks**, then choose **Disable startup and quit** from the tray. This removes the Linux
autostart file or unregisters the macOS/Windows login item. Alternatively, run the installed
executable with `--remove-startup` as the same user. The Windows NSIS uninstaller additionally
removes the per-user login registry entry. Deleting a macOS app or Linux AppImage cannot run an
uninstaller: if removed without disabling startup first, remove the Kanbun entry in system login
settings or delete the Linux autostart file. Debian package removal cannot safely edit every user's
home directory; each user should disable startup before removal. The shell's normal browser data is
retained according to the platform installer; hook event metadata remains locally until expiry.
