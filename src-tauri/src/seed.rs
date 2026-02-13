use crate::db::Database;
use crate::models::*;

/// Pre-populate with Sid's agent portfolio for immediate usefulness
pub fn seed_initial_data(db: &Database) {
    // ── Projects ────────────────────────────────────────────────────────

    let threadfork = Project::new("ThreadFork", "#6366f1"); // indigo
    let datafog = Project::new("DataFog", "#10b981"); // emerald
    let personal = Project::new("Personal", "#f59e0b"); // amber
    let consulting = Project::new("Consulting", "#ec4899"); // pink

    let _ = db.create_project(&threadfork);
    let _ = db.create_project(&datafog);
    let _ = db.create_project(&personal);
    let _ = db.create_project(&consulting);

    // ── ThreadFork agents ───────────────────────────────────────────────

    let agents = vec![
        Agent::new(
            "TF Landing Page",
            &threadfork.id,
            AgentKind::Terminal,
            "landing_page",
        ),
        Agent::new(
            "TF Marketing & Outbound",
            &threadfork.id,
            AgentKind::Script,
            "marketing",
        ),
        Agent::new(
            "TF Core App (Tauri)",
            &threadfork.id,
            AgentKind::Terminal,
            "engineering",
        ),
        Agent::new(
            "TF Speech Pipeline",
            &threadfork.id,
            AgentKind::Terminal,
            "engineering",
        ),
        Agent::new(
            "TF MCP Integrations",
            &threadfork.id,
            AgentKind::Terminal,
            "engineering",
        ),
        // ── DataFog agents ──────────────────────────────────────────────
        Agent::new("DF Python SDK", &datafog.id, AgentKind::Terminal, "sdk"),
        Agent::new(
            "DF Docs & Content",
            &datafog.id,
            AgentKind::Script,
            "marketing",
        ),
        Agent::new(
            "DF Landing Page",
            &datafog.id,
            AgentKind::Terminal,
            "landing_page",
        ),
        // ── Personal agents ─────────────────────────────────────────────
        Agent::new(
            "Golf Improvement Tracker",
            &personal.id,
            AgentKind::Script,
            "personal",
        ),
        Agent::new(
            "Morning Routine Ops",
            &personal.id,
            AgentKind::Script,
            "personal",
        ),
        Agent::new(
            "Research & Learning",
            &personal.id,
            AgentKind::Api,
            "research",
        ),
        // ── Consulting agents ───────────────────────────────────────────
        Agent::new(
            "AI Consulting Outbound",
            &consulting.id,
            AgentKind::Script,
            "marketing",
        ),
        Agent::new(
            "Proposal Generator",
            &consulting.id,
            AgentKind::Api,
            "sales",
        ),
        Agent::new(
            "Client Research",
            &consulting.id,
            AgentKind::Api,
            "research",
        ),
        Agent::new(
            "Deliverable Builder",
            &consulting.id,
            AgentKind::Terminal,
            "engineering",
        ),
    ];

    for agent in &agents {
        let _ = db.create_agent(agent);
        let _ = db.set_adapter_config(
            &agent.id,
            &AdapterConfig {
                adapter_type: AdapterType::Mock,
                session_name: None,
                endpoint: None,
                command: None,
                env: None,
            },
        );
    }

    log::info!("Seeded {} projects and {} agents", 4, agents.len());
}

/// Ensure every existing agent has at least a default adapter config.
/// This lets older local databases keep working when adapter configs were
/// introduced after initial seeding.
pub fn ensure_default_adapter_configs(db: &Database) {
    let agents = match db.list_agents() {
        Ok(agents) => agents,
        Err(error) => {
            log::warn!(
                "Failed to list agents for adapter config backfill: {}",
                error
            );
            return;
        }
    };

    for agent in agents {
        match db.get_adapter_config(&agent.id) {
            Ok(Some(_)) => {}
            Ok(None) => {
                let _ = db.set_adapter_config(
                    &agent.id,
                    &AdapterConfig {
                        adapter_type: AdapterType::Mock,
                        session_name: None,
                        endpoint: None,
                        command: None,
                        env: None,
                    },
                );
            }
            Err(error) => {
                log::warn!("Failed checking adapter config for {}: {}", agent.id, error);
            }
        }
    }
}
