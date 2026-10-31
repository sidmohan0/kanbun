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

The current devcontainer policy does not provide a native macOS launch/build workflow. Native Mac
validation, packaged installers, signing, notarization and automatic updates are follow-up work.
This milestone supplies a source-level shell, not a distributable application.

## Sessions and navigation

The `persist:kanbun` Electron partition retains the desktop client's cookies and browser storage
across restarts, independently of Chrome and the web client's session. Users sign in inside the
desktop window. Native email-link sign-in must be confirmed in the requesting desktop session;
links opened from an email client currently open in the system browser. App-protocol/deep-link
handoff and third-party authentication flows that redirect across origins are not implemented.

Same-origin navigation remains inside the window. User-triggered HTTP, HTTPS and mail links to
other origins open in the system browser. Other schemes are denied, and cross-origin redirects are
blocked rather than moving privileged application windows to external sites. Same-origin popups
reuse the current window. Native menus support editing, reload, zoom, fullscreen and window actions.
Closing all windows quits on Linux/Windows; macOS supports reopening through the Dock. A second
application launch focuses the existing window.

## Local capabilities

The renderer has Node integration disabled, context isolation and sandboxing enabled, no preload
bridge, no webviews and no granted browser permissions. This shell does not expose filesystem,
process-execution, browser-control or computer-use tools to web content. Those require a separate
agent process and narrow, authorized operations in a later milestone. Never disable the renderer
sandbox to add local tools.

The desktop smoke test verifies renderer isolation, blocked unsafe navigation/popups, and session
storage/cookie persistence after a real Electron restart against a local HTTP fixture. The full web
verifier covers the existing application. Hosted account login, external OAuth and native macOS UI
behavior need separate validation before distribution.
