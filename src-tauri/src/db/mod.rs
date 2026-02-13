use crate::models::*;
use rusqlite::{params, Connection, Result};
use std::sync::Mutex;
use uuid::Uuid;

pub struct Database {
    conn: Mutex<Connection>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db_with_agent() -> (Database, String) {
        let db = Database::new(":memory:").expect("in-memory db should initialize");
        let project = Project::new("Test Project", "#123456");
        db.create_project(&project).expect("project should insert");
        let agent = Agent::new(
            "Test Agent",
            &project.id,
            AgentKind::Terminal,
            "engineering",
        );
        db.create_agent(&agent).expect("agent should insert");
        (db, agent.id)
    }

    #[test]
    fn start_instruction_run_creates_and_reuses_active_run() {
        let (db, agent_id) = setup_db_with_agent();

        let first = db
            .start_instruction_run(&agent_id, "Implement feature A")
            .expect("first instruction should create run");
        let second = db
            .start_instruction_run(&agent_id, "Apply follow-up fix")
            .expect("second instruction should reuse active run");

        assert_eq!(first.id, second.id);
        let latest = db
            .get_latest_run_for_agent(&agent_id)
            .expect("query should succeed")
            .expect("run should exist");
        assert_eq!(latest.status, RunStatus::InProgress);
        assert!(latest.ended_at.is_none());
        assert_eq!(latest.outputs.len(), 2);
    }

    #[test]
    fn finalize_latest_run_marks_completed() {
        let (db, agent_id) = setup_db_with_agent();

        db.start_instruction_run(&agent_id, "Ship update")
            .expect("instruction should create run");
        db.append_run_output(&agent_id, "output", "Generated patch")
            .expect("output should append");
        db.finalize_latest_run(
            &agent_id,
            RunStatus::Completed,
            Some("Ship complete".to_string()),
        )
        .expect("finalize should succeed");

        let latest = db
            .get_latest_run_for_agent(&agent_id)
            .expect("query should succeed")
            .expect("run should exist");
        assert_eq!(latest.status, RunStatus::Completed);
        assert!(latest.ended_at.is_some());
        assert_eq!(latest.summary.as_deref(), Some("Ship complete"));
    }

    #[test]
    fn append_run_output_creates_run_when_missing() {
        let (db, agent_id) = setup_db_with_agent();

        db.append_run_output(&agent_id, "output", "Initial output without instruction")
            .expect("append should create run");

        let latest = db
            .get_latest_run_for_agent(&agent_id)
            .expect("query should succeed")
            .expect("run should exist");
        assert_eq!(latest.status, RunStatus::InProgress);
        assert_eq!(latest.outputs.len(), 1);
        assert_eq!(latest.outputs[0].kind, "output");
    }

    #[test]
    fn project_context_docs_round_trip() {
        let (db, agent_id) = setup_db_with_agent();
        let project_id = db
            .list_agents()
            .expect("agents should list")
            .into_iter()
            .find(|agent| agent.id == agent_id)
            .expect("agent should exist")
            .project_id;

        let mut doc =
            ProjectContextDocument::new(&project_id, "Engineering Brief", "Initial context");
        db.save_project_context_doc(&doc)
            .expect("context doc should save");

        doc.content = "Updated context".to_string();
        doc.updated_at = chrono::Utc::now();
        db.save_project_context_doc(&doc)
            .expect("context doc update should save");

        let docs = db
            .list_project_context_docs(&project_id)
            .expect("context docs should list");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].title, "Engineering Brief");
        assert_eq!(docs[0].content, "Updated context");

        db.delete_project_context_doc(&doc.id)
            .expect("context doc should delete");
        let docs_after_delete = db
            .list_project_context_docs(&project_id)
            .expect("context docs should list after delete");
        assert!(docs_after_delete.is_empty());
    }
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.initialize()?;
        Ok(db)
    }

    fn initialize(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#6366f1',
                repo_paths TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_context_docs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id),
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_project_context_docs_project
                ON project_context_docs(project_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                project_id TEXT NOT NULL REFERENCES projects(id),
                kind TEXT NOT NULL,
                function_tag TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                working_directory TEXT,
                last_active_at TEXT,
                created_at TEXT NOT NULL,
                config TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL REFERENCES agents(id),
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                summary TEXT,
                outputs TEXT NOT NULL DEFAULT '[]',
                file_changes TEXT NOT NULL DEFAULT '[]'
            );

            CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
            CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
            CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL REFERENCES agents(id),
                direction TEXT NOT NULL,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT,
                reply_to TEXT,
                created_at TEXT NOT NULL,
                delivered_at TEXT,
                acknowledged_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);
            CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
            CREATE INDEX IF NOT EXISTS idx_messages_pending ON messages(direction, delivered_at)
                WHERE delivered_at IS NULL;

            CREATE TABLE IF NOT EXISTS adapter_configs (
                agent_id TEXT PRIMARY KEY REFERENCES agents(id),
                adapter_type TEXT NOT NULL,
                session_name TEXT,
                endpoint TEXT,
                command TEXT,
                env TEXT
            );

            CREATE TABLE IF NOT EXISTS connector_configs (
                id TEXT PRIMARY KEY,
                connector_type TEXT NOT NULL,
                auth_token TEXT,
                settings TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_synced_at TEXT
            );

            CREATE TABLE IF NOT EXISTS connector_items (
                id TEXT NOT NULL,
                connector_id TEXT NOT NULL REFERENCES connector_configs(id),
                source TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                priority INTEGER,
                tags TEXT NOT NULL DEFAULT '[]',
                url TEXT,
                parent_id TEXT,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT,
                updated_at TEXT,
                due_at TEXT,
                synced_at TEXT NOT NULL,
                PRIMARY KEY (id, connector_id)
            );

            CREATE INDEX IF NOT EXISTS idx_connector_items_source
                ON connector_items(connector_id);
            CREATE INDEX IF NOT EXISTS idx_connector_items_status
                ON connector_items(status);
            CREATE INDEX IF NOT EXISTS idx_connector_items_due
                ON connector_items(due_at) WHERE due_at IS NOT NULL;
        ",
        )?;
        Ok(())
    }

    // ── Projects ────────────────────────────────────────────────────────

    pub fn create_project(&self, project: &Project) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, color, repo_paths, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                project.id,
                project.name,
                project.color,
                serde_json::to_string(&project.repo_paths).unwrap(),
                project.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, color, repo_paths, created_at FROM projects ORDER BY name",
        )?;
        let projects = stmt
            .query_map([], |row| {
                let repo_paths_str: String = row.get(3)?;
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    repo_paths: serde_json::from_str(&repo_paths_str).unwrap_or_default(),
                    created_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                        .unwrap()
                        .with_timezone(&chrono::Utc),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(projects)
    }

    pub fn save_project_context_doc(&self, doc: &ProjectContextDocument) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO project_context_docs (id, project_id, title, content, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                doc.id,
                doc.project_id,
                doc.title,
                doc.content,
                doc.created_at.to_rfc3339(),
                doc.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get_project_context_doc(&self, doc_id: &str) -> Result<Option<ProjectContextDocument>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, title, content, created_at, updated_at
             FROM project_context_docs WHERE id = ?1 LIMIT 1",
        )?;

        let mut rows = stmt.query_map(params![doc_id], |row| {
            Ok(ProjectContextDocument {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                created_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                    .unwrap()
                    .with_timezone(&chrono::Utc),
                updated_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(5)?)
                    .unwrap()
                    .with_timezone(&chrono::Utc),
            })
        })?;

        Ok(rows.next().transpose()?)
    }

    pub fn list_project_context_docs(
        &self,
        project_id: &str,
    ) -> Result<Vec<ProjectContextDocument>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, title, content, created_at, updated_at
             FROM project_context_docs
             WHERE project_id = ?1
             ORDER BY updated_at DESC",
        )?;

        let docs = stmt
            .query_map(params![project_id], |row| {
                Ok(ProjectContextDocument {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    content: row.get(3)?,
                    created_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                        .unwrap()
                        .with_timezone(&chrono::Utc),
                    updated_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(5)?)
                        .unwrap()
                        .with_timezone(&chrono::Utc),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(docs)
    }

    pub fn delete_project_context_doc(&self, doc_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM project_context_docs WHERE id = ?1",
            params![doc_id],
        )?;
        Ok(())
    }

    // ── Agents ──────────────────────────────────────────────────────────

    pub fn create_agent(&self, agent: &Agent) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO agents (id, name, project_id, kind, function_tag, status, working_directory, last_active_at, created_at, config)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                agent.id,
                agent.name,
                agent.project_id,
                serde_json::to_string(&agent.kind).unwrap(),
                agent.function_tag,
                serde_json::to_string(&agent.status).unwrap(),
                agent.working_directory,
                agent.last_active_at.map(|t| t.to_rfc3339()),
                agent.created_at.to_rfc3339(),
                serde_json::to_string(&agent.config).unwrap(),
            ],
        )?;
        Ok(())
    }

    pub fn list_agents(&self) -> Result<Vec<Agent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, project_id, kind, function_tag, status, working_directory, last_active_at, created_at, config
             FROM agents ORDER BY name"
        )?;
        let agents = stmt
            .query_map([], |row| {
                Ok(Agent {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    project_id: row.get(2)?,
                    kind: serde_json::from_str(&row.get::<_, String>(3)?).unwrap(),
                    function_tag: row.get(4)?,
                    status: serde_json::from_str(&row.get::<_, String>(5)?).unwrap(),
                    working_directory: row.get(6)?,
                    last_active_at: row
                        .get::<_, Option<String>>(7)?
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                        .map(|t| t.with_timezone(&chrono::Utc)),
                    created_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(8)?)
                        .unwrap()
                        .with_timezone(&chrono::Utc),
                    config: serde_json::from_str(&row.get::<_, String>(9)?).unwrap(),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(agents)
    }

    pub fn update_agent_status(&self, agent_id: &str, status: &AgentStatus) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE agents SET status = ?1, last_active_at = ?2 WHERE id = ?3",
            params![
                serde_json::to_string(status).unwrap(),
                chrono::Utc::now().to_rfc3339(),
                agent_id,
            ],
        )?;
        Ok(())
    }

    // ── Runs ────────────────────────────────────────────────────────────

    pub fn create_run(&self, run: &Run) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO runs (id, agent_id, status, started_at, ended_at, summary, outputs, file_changes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                run.id,
                run.agent_id,
                serde_json::to_string(&run.status).unwrap(),
                run.started_at.to_rfc3339(),
                run.ended_at.map(|t| t.to_rfc3339()),
                run.summary,
                serde_json::to_string(&run.outputs).unwrap(),
                serde_json::to_string(&run.file_changes).unwrap(),
            ],
        )?;
        Ok(())
    }

    pub fn update_run(&self, run: &Run) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE runs
             SET status = ?1, started_at = ?2, ended_at = ?3, summary = ?4, outputs = ?5, file_changes = ?6
             WHERE id = ?7",
            params![
                serde_json::to_string(&run.status).unwrap(),
                run.started_at.to_rfc3339(),
                run.ended_at.map(|t| t.to_rfc3339()),
                run.summary,
                serde_json::to_string(&run.outputs).unwrap(),
                serde_json::to_string(&run.file_changes).unwrap(),
                run.id,
            ],
        )?;
        Ok(())
    }

    fn summarize_instruction(instruction: &str) -> String {
        let trimmed = instruction.trim();
        if trimmed.is_empty() {
            return "Running instruction".to_string();
        }
        let mut preview = trimmed.chars().take(96).collect::<String>();
        if trimmed.chars().count() > 96 {
            preview.push_str("...");
        }
        format!("Running: {}", preview)
    }

    fn ensure_in_progress_run(&self, agent_id: &str, summary: Option<String>) -> Result<Run> {
        if let Some(run) = self.get_latest_run_for_agent(agent_id)? {
            if run.status == RunStatus::InProgress && run.ended_at.is_none() {
                return Ok(run);
            }
        }

        let run = Run {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            status: RunStatus::InProgress,
            started_at: chrono::Utc::now(),
            ended_at: None,
            summary,
            outputs: vec![],
            file_changes: vec![],
        };
        self.create_run(&run)?;
        Ok(run)
    }

    pub fn start_instruction_run(&self, agent_id: &str, instruction: &str) -> Result<Run> {
        let mut run =
            self.ensure_in_progress_run(agent_id, Some(Self::summarize_instruction(instruction)))?;
        run.outputs.push(RunOutput {
            kind: "instruction".to_string(),
            content: instruction.to_string(),
            timestamp: chrono::Utc::now(),
        });
        run.summary = Some(Self::summarize_instruction(instruction));
        self.update_run(&run)?;
        Ok(run)
    }

    pub fn append_run_output(&self, agent_id: &str, kind: &str, content: &str) -> Result<Run> {
        let mut run = self.ensure_in_progress_run(agent_id, Some("Agent activity".to_string()))?;
        run.outputs.push(RunOutput {
            kind: kind.to_string(),
            content: content.to_string(),
            timestamp: chrono::Utc::now(),
        });
        if run.summary.is_none() {
            run.summary = Some("Agent activity".to_string());
        }
        self.update_run(&run)?;
        Ok(run)
    }

    pub fn finalize_latest_run(
        &self,
        agent_id: &str,
        status: RunStatus,
        summary: Option<String>,
    ) -> Result<Option<Run>> {
        if let Some(mut run) = self.get_latest_run_for_agent(agent_id)? {
            if run.status == RunStatus::InProgress && run.ended_at.is_none() {
                run.status = status;
                run.ended_at = Some(chrono::Utc::now());
                if let Some(summary) = summary {
                    if !summary.trim().is_empty() {
                        run.summary = Some(summary);
                    }
                }
                self.update_run(&run)?;
                return Ok(Some(run));
            }
            return Ok(Some(run));
        }

        // If no run exists yet, create a terminal run entry to preserve traceability.
        let run = Run {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            status,
            started_at: chrono::Utc::now(),
            ended_at: Some(chrono::Utc::now()),
            summary,
            outputs: vec![],
            file_changes: vec![],
        };
        self.create_run(&run)?;
        Ok(Some(run))
    }

    pub fn get_latest_run_for_agent(&self, agent_id: &str) -> Result<Option<Run>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, status, started_at, ended_at, summary, outputs, file_changes
             FROM runs WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT 1",
        )?;
        let mut runs = stmt.query_map(params![agent_id], |row| {
            Ok(Run {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                status: serde_json::from_str(&row.get::<_, String>(2)?).unwrap(),
                started_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(3)?)
                    .unwrap()
                    .with_timezone(&chrono::Utc),
                ended_at: row
                    .get::<_, Option<String>>(4)?
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                    .map(|t| t.with_timezone(&chrono::Utc)),
                summary: row.get(5)?,
                outputs: serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default(),
                file_changes: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default(),
            })
        })?;
        Ok(runs.next().transpose()?)
    }

    pub fn get_runs_for_agent(&self, agent_id: &str, limit: usize) -> Result<Vec<Run>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, status, started_at, ended_at, summary, outputs, file_changes
             FROM runs WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT ?2",
        )?;
        let runs = stmt
            .query_map(params![agent_id, limit], |row| {
                Ok(Run {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    status: serde_json::from_str(&row.get::<_, String>(2)?).unwrap(),
                    started_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(3)?)
                        .unwrap()
                        .with_timezone(&chrono::Utc),
                    ended_at: row
                        .get::<_, Option<String>>(4)?
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                        .map(|t| t.with_timezone(&chrono::Utc)),
                    summary: row.get(5)?,
                    outputs: serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default(),
                    file_changes: serde_json::from_str(&row.get::<_, String>(7)?)
                        .unwrap_or_default(),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(runs)
    }

    pub fn record_file_change(&self, agent_id: &str, change: FileChange) -> Result<Run> {
        if let Some(mut run) = self.get_latest_run_for_agent(agent_id)? {
            if run.status == RunStatus::InProgress && run.ended_at.is_none() {
                run.file_changes.push(change);
                run.summary = Some(format!("{} file changes detected", run.file_changes.len()));
                self.update_run(&run)?;
                return Ok(run);
            }
        }

        let run = Run {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            status: RunStatus::InProgress,
            started_at: chrono::Utc::now(),
            ended_at: None,
            summary: Some("File changes detected".to_string()),
            outputs: vec![],
            file_changes: vec![change],
        };
        self.create_run(&run)?;
        Ok(run)
    }

    // ── Messages (the bus) ──────────────────────────────────────────────

    fn row_to_message(row: &rusqlite::Row) -> rusqlite::Result<Message> {
        Ok(Message {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            direction: serde_json::from_str(&row.get::<_, String>(2)?).unwrap(),
            kind: serde_json::from_str(&row.get::<_, String>(3)?).unwrap(),
            content: row.get(4)?,
            metadata: row
                .get::<_, Option<String>>(5)?
                .and_then(|s| serde_json::from_str(&s).ok()),
            reply_to: row.get(6)?,
            created_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(7)?)
                .unwrap()
                .with_timezone(&chrono::Utc),
            delivered_at: row
                .get::<_, Option<String>>(8)?
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                .map(|t| t.with_timezone(&chrono::Utc)),
            acknowledged_at: row
                .get::<_, Option<String>>(9)?
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                .map(|t| t.with_timezone(&chrono::Utc)),
        })
    }

    pub fn insert_message(&self, msg: &Message) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, agent_id, direction, kind, content, metadata, reply_to, created_at, delivered_at, acknowledged_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                msg.id,
                msg.agent_id,
                serde_json::to_string(&msg.direction).unwrap(),
                serde_json::to_string(&msg.kind).unwrap(),
                msg.content,
                msg.metadata.as_ref().map(|m| serde_json::to_string(m).unwrap()),
                msg.reply_to,
                msg.created_at.to_rfc3339(),
                msg.delivered_at.map(|t| t.to_rfc3339()),
                msg.acknowledged_at.map(|t| t.to_rfc3339()),
            ],
        )?;
        Ok(())
    }

    /// Get conversation thread for an agent (most recent messages first)
    pub fn get_messages_for_agent(&self, agent_id: &str, limit: usize) -> Result<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, direction, kind, content, metadata, reply_to, created_at, delivered_at, acknowledged_at
             FROM messages WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        )?;
        let messages = stmt
            .query_map(params![agent_id, limit], Self::row_to_message)?
            .collect::<Result<Vec<_>>>()?;
        Ok(messages)
    }

    /// Get pending outbound messages that haven't been delivered to the agent yet.
    /// Adapters poll this to pick up new instructions.
    pub fn get_pending_messages(&self, agent_id: &str) -> Result<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, direction, kind, content, metadata, reply_to, created_at, delivered_at, acknowledged_at
             FROM messages
             WHERE agent_id = ?1 AND direction = '\"to_agent\"' AND delivered_at IS NULL
             ORDER BY created_at ASC"
        )?;
        let messages = stmt
            .query_map(params![agent_id], Self::row_to_message)?
            .collect::<Result<Vec<_>>>()?;
        Ok(messages)
    }

    /// Mark a message as delivered (adapter picked it up)
    pub fn mark_delivered(&self, message_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE messages SET delivered_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().to_rfc3339(), message_id],
        )?;
        Ok(())
    }

    /// Mark a message as acknowledged (agent confirmed receipt)
    pub fn mark_acknowledged(&self, message_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE messages SET acknowledged_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().to_rfc3339(), message_id],
        )?;
        Ok(())
    }

    // ── Adapter Configs ─────────────────────────────────────────────────

    pub fn set_adapter_config(&self, agent_id: &str, config: &AdapterConfig) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO adapter_configs (agent_id, adapter_type, session_name, endpoint, command, env)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                agent_id,
                serde_json::to_string(&config.adapter_type).unwrap(),
                config.session_name,
                config.endpoint,
                config.command,
                config.env.as_ref().map(|e| serde_json::to_string(e).unwrap()),
            ],
        )?;
        Ok(())
    }

    pub fn get_adapter_config(&self, agent_id: &str) -> Result<Option<AdapterConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT adapter_type, session_name, endpoint, command, env
             FROM adapter_configs WHERE agent_id = ?1",
        )?;
        let mut configs = stmt.query_map(params![agent_id], |row| {
            Ok(AdapterConfig {
                adapter_type: serde_json::from_str(&row.get::<_, String>(0)?).unwrap(),
                session_name: row.get(1)?,
                endpoint: row.get(2)?,
                command: row.get(3)?,
                env: row
                    .get::<_, Option<String>>(4)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
            })
        })?;
        Ok(configs.next().transpose()?)
    }

    // ── Connector Configs ───────────────────────────────────────────────

    pub fn save_connector_config(&self, config: &crate::connectors::ConnectorConfig) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO connector_configs (id, connector_type, auth_token, settings, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                config.connector_type, // use type as ID for simplicity
                config.connector_type,
                config.auth_token,
                serde_json::to_string(&config.settings).unwrap(),
                config.enabled,
            ],
        )?;
        Ok(())
    }

    pub fn list_connector_configs(&self) -> Result<Vec<crate::connectors::ConnectorConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT connector_type, auth_token, settings, enabled FROM connector_configs",
        )?;
        let configs = stmt
            .query_map([], |row| {
                Ok(crate::connectors::ConnectorConfig {
                    connector_type: row.get(0)?,
                    auth_token: row.get(1)?,
                    settings: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or_default(),
                    enabled: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(configs)
    }

    pub fn get_connector_config(
        &self,
        connector_type: &str,
    ) -> Result<Option<crate::connectors::ConnectorConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT connector_type, auth_token, settings, enabled
             FROM connector_configs WHERE connector_type = ?1",
        )?;
        let mut configs = stmt.query_map(params![connector_type], |row| {
            Ok(crate::connectors::ConnectorConfig {
                connector_type: row.get(0)?,
                auth_token: row.get(1)?,
                settings: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or_default(),
                enabled: row.get(3)?,
            })
        })?;
        Ok(configs.next().transpose()?)
    }

    // ── Connector Items (cached) ────────────────────────────────────────

    pub fn upsert_connector_items(
        &self,
        connector_id: &str,
        items: &[crate::connectors::ConnectorItem],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        for item in items {
            conn.execute(
                "INSERT OR REPLACE INTO connector_items
                 (id, connector_id, source, title, content, status, priority, tags, url, parent_id, metadata, created_at, updated_at, due_at, synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    item.id,
                    connector_id,
                    item.source,
                    item.title,
                    item.content,
                    serde_json::to_string(&item.status).unwrap(),
                    item.priority,
                    serde_json::to_string(&item.tags).unwrap(),
                    item.url,
                    item.parent_id,
                    serde_json::to_string(&item.metadata).unwrap(),
                    item.created_at.map(|t| t.to_rfc3339()),
                    item.updated_at.map(|t| t.to_rfc3339()),
                    item.due_at.map(|t| t.to_rfc3339()),
                    now,
                ],
            )?;
        }

        // Update last_synced_at on the config
        conn.execute(
            "UPDATE connector_configs SET last_synced_at = ?1 WHERE id = ?2",
            params![now, connector_id],
        )?;

        Ok(())
    }

    pub fn get_connector_items(
        &self,
        connector_id: &str,
    ) -> Result<Vec<crate::connectors::ConnectorItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, source, title, content, status, priority, tags, url, parent_id, metadata, created_at, updated_at, due_at
             FROM connector_items WHERE connector_id = ?1 ORDER BY due_at ASC NULLS LAST, updated_at DESC"
        )?;
        let items = stmt
            .query_map(params![connector_id], |row| {
                Ok(crate::connectors::ConnectorItem {
                    id: row.get(0)?,
                    source: row.get(1)?,
                    title: row.get(2)?,
                    content: row.get(3)?,
                    status: serde_json::from_str(&row.get::<_, String>(4)?)
                        .unwrap_or(crate::connectors::ItemStatus::Active),
                    priority: row.get(5)?,
                    tags: serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default(),
                    url: row.get(7)?,
                    parent_id: row.get(8)?,
                    metadata: serde_json::from_str(&row.get::<_, String>(9)?).unwrap_or_default(),
                    created_at: row
                        .get::<_, Option<String>>(10)?
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                        .map(|t| t.with_timezone(&chrono::Utc)),
                    updated_at: row
                        .get::<_, Option<String>>(11)?
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                        .map(|t| t.with_timezone(&chrono::Utc)),
                    due_at: row
                        .get::<_, Option<String>>(12)?
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                        .map(|t| t.with_timezone(&chrono::Utc)),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(items)
    }

    pub fn delete_connector_item(&self, connector_id: &str, item_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM connector_items WHERE connector_id = ?1 AND id = ?2",
            params![connector_id, item_id],
        )?;
        Ok(())
    }
}
