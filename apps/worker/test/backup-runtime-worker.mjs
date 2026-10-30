import { WorkspaceDO as ApplicationWorkspaceDO } from "../src/index";
export { default, DocumentDO } from "../src/index";

/** Fixture-only alarm fault injection; never part of the deployment entrypoint. */
export class WorkspaceDO extends ApplicationWorkspaceDO {
  async backup(workspaceId) {
    if (await this.ctx.storage.get("notification-test-backup-failure"))
      throw new Error("fixture-private-backup-detail");
    return super.backup(workspaceId);
  }
  async setNotificationTestBackupFailure(enabled) {
    await this.ctx.storage.put("notification-test-backup-failure", enabled);
  }
  async notificationTestAlarm() {
    // The platform consumes its scheduled alarm before invoking the handler.
    await this.ctx.storage.deleteAlarm();
    try {
      await this.alarm();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async dropBackupAlarmForTest() {
    await this.ctx.storage.deleteAlarm();
    return this.ctx.storage.getAlarm();
  }
}
