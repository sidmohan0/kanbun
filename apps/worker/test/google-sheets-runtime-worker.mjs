import { WorkspaceDO as ApplicationWorkspaceDO } from "../src/index";
export { default, DocumentDO } from "../src/index";

/** Fixture-only schedule fault injection and clock advancement through the actual alarm consumer. */
export class WorkspaceDO extends ApplicationWorkspaceDO {
  constructor(ctx, env) {
    const control = { enabled: false, pending: false, release: null, alarmRunning: false };
    function connectionStatement(statement) {
      return {
        bind(...values) {
          return connectionStatement(statement.bind(...values));
        },
        async run() {
          if (!control.enabled) return statement.run();
          control.pending = true;
          await new Promise((resolve) => {
            control.release = resolve;
          });
          control.enabled = false;
          control.pending = false;
          await statement.run();
          throw new Error("fixture interrupted after Google connection commit");
        },
      };
    }
    const accounts = new Proxy(env.ACCOUNTS, {
      get(database, property) {
        if (property === "prepare")
          return (sql) => {
            const statement = database.prepare(sql);
            return sql.startsWith("INSERT INTO google_sheets_connections ")
              ? connectionStatement(statement)
              : statement;
          };
        const value = Reflect.get(database, property, database);
        return typeof value === "function" ? value.bind(database) : value;
      },
    });
    super(ctx, { ...env, ACCOUNTS: accounts });
    this.connectionControl = control;
  }
  async sheetsTestGateConnection() {
    this.connectionControl.enabled = true;
  }
  async sheetsTestConnectionPending() {
    return this.connectionControl.pending;
  }
  async sheetsTestReleaseConnection() {
    this.connectionControl.release?.();
  }
  async alarm() {
    this.connectionControl.alarmRunning = true;
    try {
      return await super.alarm();
    } finally {
      this.connectionControl.alarmRunning = false;
    }
  }
  async sheetsTestSchedule() {
    return {
      jobs: [...this.ctx.storage.sql.exec("SELECT id,fire_at FROM scheduled_job WHERE kind='google-sheets-sync'")],
      alarm: await this.ctx.storage.getAlarm(),
      activeAlarm: this.connectionControl.alarmRunning,
    };
  }
  async sheetsTestAlarm() {
    await this.ctx.storage.deleteAlarm();
    this.ctx.storage.sql.exec(
      "UPDATE scheduled_job SET fire_at=? WHERE kind='google-sheets-sync'",
      new Date(0).toISOString(),
    );
    await this.alarm();
  }
}
