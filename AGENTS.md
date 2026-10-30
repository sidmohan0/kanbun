# Development environment

Use the repository's devcontainer for package installation, dependency changes, formatting, lint,
typechecking, tests, builds, and seed runs. Local development and all repository-owned CI workflows
use the same configuration in `.devcontainer/devcontainer.json`.

```sh
./scripts/devcontainer.sh up
./scripts/devcontainer.sh exec pnpm install --frozen-lockfile
./scripts/devcontainer.sh verify
```

Run repository commands with `./scripts/devcontainer.sh exec <command...>`; it never falls back to
executing them on the host. Host Git operations, Docker lifecycle commands, and Node bootstrapping
for the pinned devcontainer CLI are expected. If Docker is unavailable, start the local runtime or
report the setup failure instead of substituting host verification.

Use feature branches and pull requests. Run the complete container verifier before publishing a PR;
the separate changelog and spec-lock checks remain required. Keep dependencies in their owning
workspace manifest and commit the single root pnpm lockfile with manifest changes.
