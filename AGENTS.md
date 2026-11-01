# Development environment

Use the repository's devcontainer for package installation, dependency changes, formatting, lint,
typechecking, tests, builds, and seed runs. Local development and all repository-owned CI workflows
use the same configuration in `.devcontainer/devcontainer.json`.

Desktop distribution has one narrow exception: macOS and Windows CI jobs may bootstrap the pinned
Node/pnpm toolchain, install frozen dependencies without lifecycle scripts, and perform native
Electron packaging/signing. They must consume desktop JavaScript compiled by the successful
devcontainer verifier job. Dependency changes, compilation, lint, typechecking, tests, builds of
repository source, and seed runs remain in the devcontainer. Native packaging is not a substitute
for repository verification. Linux desktop packaging also runs in the devcontainer.

```sh
./scripts/devcontainer.sh up
./scripts/devcontainer.sh exec pnpm install --frozen-lockfile
./scripts/devcontainer.sh verify
```

Run repository commands with `./scripts/devcontainer.sh exec <command...>`; it never falls back to
executing them on the host. Host Git operations, Docker lifecycle commands, and Node bootstrapping
for the pinned devcontainer CLI are expected. If Docker is unavailable, start the local runtime or
report the setup failure instead of substituting host verification.

Use descriptive feature branches without the `codex/` prefix, and use pull requests. Run the complete container verifier before publishing a PR;
the separate changelog and spec-lock checks remain required. Keep dependencies in their owning
workspace manifest and commit the single root pnpm lockfile with manifest changes.
