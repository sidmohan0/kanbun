import { WorkspaceDO as ApplicationWorkspaceDO } from "../src/index";
export { default, DocumentDO } from "../src/index";

/** Fixture-only alarm fault injection; never part of the deployment entrypoint. */
export class WorkspaceDO extends ApplicationWorkspaceDO {
  async dropBackupAlarmForTest() {
    await this.ctx.storage.deleteAlarm();
    return this.ctx.storage.getAlarm();
  }
}
