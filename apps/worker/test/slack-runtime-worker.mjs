import { WorkspaceDO as ApplicationWorkspaceDO } from "../src/index";
export { default, DocumentDO } from "../src/index";

/** Test-only durable delivery controls; production uses Cloudflare's ordinary alarm scheduler. */
export class WorkspaceDO extends ApplicationWorkspaceDO {
  constructor(ctx, env) {
    const control = { gate: false, pending: false, release: null, commands: 0, uninstalls: 0 };
    function statement(value) {
      return {
        bind(...parameters) {
          return statement(value.bind(...parameters));
        },
        async first(...parameters) {
          if (control.gate) {
            control.gate = false;
            control.pending = true;
            await new Promise((resolve) => {
              control.release = resolve;
            });
            control.pending = false;
          }
          return value.first(...parameters);
        },
      };
    }
    const accounts = new Proxy(env.ACCOUNTS, {
      get(database, property) {
        if (property === "prepare")
          return (sql) => {
            const value = database.prepare(sql);
            return sql === "SELECT * FROM slack_connections WHERE workspace_id=?" ? statement(value) : value;
          };
        const value = Reflect.get(database, property, database);
        return typeof value === "function" ? value.bind(database) : value;
      },
    });
    super(ctx, { ...env, ACCOUNTS: accounts });
    this.slackControl = control;
  }
  // Each case explicitly consumes durable work after inspecting the acknowledged receipt.
  async alarm() {}
  async slackConnectionCommand(principal, input) {
    this.slackControl.commands++;
    return super.slackConnectionCommand(principal, input);
  }
  async slackUninstalled(...args) {
    this.slackControl.uninstalls++;
    return super.slackUninstalled(...args);
  }
  async slackTestAlarm() {
    await this.ctx.storage.deleteAlarm();
    await super.alarm();
  }
  async slackTestSnapshot() {
    return {
      jobs: [
        ...this.ctx.storage.sql.exec(
          "SELECT * FROM scheduled_job WHERE kind IN ('slack-issue-unfurl','slack-issue-reply')",
        ),
      ],
      deliveries: [...this.ctx.storage.sql.exec("SELECT * FROM slack_delivery")],
      replies: [...this.ctx.storage.sql.exec("SELECT * FROM slack_issue_reply")],
      alarm: await this.ctx.storage.getAlarm(),
      commands: this.slackControl.commands,
      uninstalls: this.slackControl.uninstalls,
    };
  }
  async slackTestGate() {
    this.slackControl.gate = true;
  }
  async slackTestAgeReplies(minutes) {
    this.ctx.storage.sql.exec(
      "UPDATE slack_issue_reply SET last_sent_at=? WHERE last_sent_at IS NOT NULL",
      new Date(Date.now() - minutes * 60_000).toISOString(),
    );
  }
  async slackTestPending() {
    return this.slackControl.pending;
  }
  async slackTestRelease() {
    this.slackControl.release?.();
  }
}
