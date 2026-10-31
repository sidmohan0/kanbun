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
General third-party OAuth redirect handoff remains separate work.

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

The desktop smoke test verifies renderer isolation, blocked unsafe navigation/popups, callback
delivery through macOS/second-instance events and launch arguments, clipboard handoff, and session
storage/cookie persistence after a real Electron restart against a local HTTP fixture. The full web
verifier covers the existing application. Hosted account login, external OAuth and native macOS UI
behavior need separate validation before distribution.
