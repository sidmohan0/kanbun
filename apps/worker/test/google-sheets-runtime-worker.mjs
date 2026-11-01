import { WorkspaceDO as ApplicationWorkspaceDO } from "../src/index";
export { default, DocumentDO } from "../src/index";

/** Fixture-only clock advancement through the actual alarm consumer. */
export class WorkspaceDO extends ApplicationWorkspaceDO {
  async sheetsTestAlarm() {
    await this.ctx.storage.deleteAlarm();
    this.ctx.storage.sql.exec(
      "UPDATE scheduled_job SET fire_at=? WHERE kind='google-sheets-sync'",
      new Date(0).toISOString(),
    );
    await this.alarm();
  }
}
