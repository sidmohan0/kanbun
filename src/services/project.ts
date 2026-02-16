import type Database from "better-sqlite3";
import type { Project, GtmConfig } from "../shared/types.js";

function parseProject(row: any): Project {
  return {
    ...row,
    pipeline_stages: JSON.parse(row.pipeline_stages),
    follow_up_cadence: JSON.parse(row.follow_up_cadence),
    gtm_config: row.gtm_config ? JSON.parse(row.gtm_config) : null,
  };
}

export class ProjectService {
  constructor(private db: Database.Database) {}

  create(name: string, description?: string): Project {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO projects (name, description, pipeline_stages, follow_up_cadence, created_at, updated_at)
         VALUES (?, ?, '[]', '[]', ?, ?)`
      )
      .run(name, description ?? null, now, now);
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Project | undefined {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as any;
    return row ? parseProject(row) : undefined;
  }

  list(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY id").all();
    return rows.map(parseProject);
  }

  setStages(id: number, stages: string[]): void {
    this.db
      .prepare("UPDATE projects SET pipeline_stages = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(stages), new Date().toISOString(), id);
  }

  setCadence(id: number, cadence: number[]): void {
    this.db
      .prepare("UPDATE projects SET follow_up_cadence = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(cadence), new Date().toISOString(), id);
  }

  setAccount(id: number, accountId: number): void {
    this.db
      .prepare("UPDATE projects SET default_send_account_id = ?, updated_at = ? WHERE id = ?")
      .run(accountId, new Date().toISOString(), id);
  }

  getGtmConfig(id: number): GtmConfig | null {
    const row = this.db
      .prepare("SELECT gtm_config FROM projects WHERE id = ?")
      .get(id) as any;
    return row?.gtm_config ? JSON.parse(row.gtm_config) : null;
  }

  setGtmConfig(id: number, config: GtmConfig): void {
    this.db
      .prepare("UPDATE projects SET gtm_config = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(config), new Date().toISOString(), id);
  }
}
