use super::{Adapter, AdapterError, AdapterHealth};
use crate::db::Database;
use crate::models::*;
use chrono::Utc;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

const OUTPUT_RING_MAX_LINES: usize = 240;
const STATUS_TAIL_LINES: usize = 8;
const MAX_CAPTURE_CHARS: usize = 2000;
const RESTART_POLICY_ENV_KEY: &str = "__kanbun_restart_policy";

#[derive(Debug)]
struct OutputRingBuffer {
    lines: VecDeque<String>,
    dropped_lines: usize,
}

impl OutputRingBuffer {
    fn new() -> Self {
        Self {
            lines: VecDeque::with_capacity(OUTPUT_RING_MAX_LINES),
            dropped_lines: 0,
        }
    }

    fn push(&mut self, line: String) {
        if self.lines.len() >= OUTPUT_RING_MAX_LINES {
            let _ = self.lines.pop_front();
            self.dropped_lines = self.dropped_lines.saturating_add(1);
        }
        self.lines.push_back(line);
    }

    fn snapshot_tail(&self, tail_count: usize) -> Option<String> {
        if self.lines.is_empty() && self.dropped_lines == 0 {
            return None;
        }

        let mut rendered = String::new();
        if self.dropped_lines > 0 {
            rendered.push_str(&format!(
                "... [{} earlier lines truncated]\n",
                self.dropped_lines
            ));
        }

        let skip = self.lines.len().saturating_sub(tail_count);
        for line in self.lines.iter().skip(skip) {
            rendered.push_str(line);
            rendered.push('\n');
        }

        Some(rendered.trim_end().to_string())
    }
}

#[derive(Debug)]
struct ProcessSession {
    command: String,
    restart_policy: RestartPolicy,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    output_ring: Mutex<OutputRingBuffer>,
    last_heartbeat: Mutex<Option<String>>,
}

static PROCESS_SESSIONS: OnceLock<Mutex<HashMap<String, Arc<ProcessSession>>>> = OnceLock::new();

fn process_sessions() -> &'static Mutex<HashMap<String, Arc<ProcessSession>>> {
    PROCESS_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_session(agent_id: &str) -> Option<Arc<ProcessSession>> {
    process_sessions()
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(agent_id).cloned())
}

fn insert_session(agent_id: &str, session: Arc<ProcessSession>) -> Result<(), AdapterError> {
    let mut sessions = process_sessions()
        .lock()
        .map_err(|_| AdapterError::Other("process session lock poisoned".to_string()))?;
    sessions.insert(agent_id.to_string(), session);
    Ok(())
}

fn remove_session(agent_id: &str) -> Option<Arc<ProcessSession>> {
    process_sessions()
        .lock()
        .ok()
        .and_then(|mut sessions| sessions.remove(agent_id))
}

#[derive(Clone, Copy)]
enum ProcessState {
    Running,
    Exited(Option<i32>),
}

#[derive(Debug, Clone, Copy)]
enum RestartPolicy {
    Never,
    OnFailure,
    Always,
}

impl RestartPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::OnFailure => "on_failure",
            Self::Always => "always",
        }
    }
}

fn process_state(session: &Arc<ProcessSession>) -> Result<ProcessState, AdapterError> {
    let mut child = session
        .child
        .lock()
        .map_err(|_| AdapterError::Other("process child lock poisoned".to_string()))?;
    match child.try_wait() {
        Ok(Some(status)) => Ok(ProcessState::Exited(status.code())),
        Ok(None) => Ok(ProcessState::Running),
        Err(error) => Err(AdapterError::Other(format!(
            "failed checking child process status: {}",
            error
        ))),
    }
}

fn is_process_like_adapter_type(adapter_type: AdapterType) -> bool {
    matches!(adapter_type, AdapterType::Process | AdapterType::Codex)
}

fn terminate_session(session: &Arc<ProcessSession>) -> Result<(), AdapterError> {
    let mut child = session
        .child
        .lock()
        .map_err(|_| AdapterError::Other("process child lock poisoned".to_string()))?;
    match child.try_wait() {
        Ok(Some(_)) => Ok(()),
        Ok(None) => {
            child.kill().map_err(|error| {
                AdapterError::Other(format!("failed to stop process: {}", error))
            })?;
            let _ = child.wait();
            Ok(())
        }
        Err(error) => Err(AdapterError::Other(format!(
            "failed checking process status before stop: {}",
            error
        ))),
    }
}

fn parse_env(config: &AdapterConfig) -> Vec<(String, String)> {
    let mut parsed = Vec::new();
    let Some(env) = &config.env else {
        return parsed;
    };
    let Some(map) = env.as_object() else {
        return parsed;
    };

    for (key, value) in map {
        if key.trim().is_empty() || key.starts_with("__kanbun_") {
            continue;
        }
        let resolved = value
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| value.to_string());
        parsed.push((key.clone(), resolved));
    }

    parsed
}

fn parse_restart_policy(config: &AdapterConfig) -> RestartPolicy {
    let policy = config
        .env
        .as_ref()
        .and_then(|env| env.as_object())
        .and_then(|map| map.get(RESTART_POLICY_ENV_KEY))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_ascii_lowercase());

    match policy.as_deref() {
        Some("never") => RestartPolicy::Never,
        Some("always") => RestartPolicy::Always,
        Some("on_failure") => RestartPolicy::OnFailure,
        _ => RestartPolicy::OnFailure,
    }
}

fn should_suppress_auto_restart(policy: RestartPolicy, code: Option<i32>) -> bool {
    match policy {
        RestartPolicy::Never => true,
        RestartPolicy::OnFailure => code.unwrap_or(0) == 0,
        RestartPolicy::Always => false,
    }
}

fn resolve_agent_working_directory(db: &Arc<Database>, agent_id: &str) -> Option<String> {
    db.list_agents()
        .ok()
        .and_then(|agents| agents.into_iter().find(|agent| agent.id == agent_id))
        .and_then(|agent| agent.working_directory)
        .map(|path| shellexpand::tilde(path.trim()).to_string())
        .filter(|path| !path.trim().is_empty())
}

fn truncate_output(input: &str) -> String {
    let length = input.chars().count();
    if length <= MAX_CAPTURE_CHARS {
        return input.to_string();
    }
    let clipped: String = input.chars().take(MAX_CAPTURE_CHARS).collect();
    format!(
        "{} ... [line truncated: {} chars omitted]",
        clipped,
        length.saturating_sub(MAX_CAPTURE_CHARS)
    )
}

fn stream_output(
    db: Arc<Database>,
    agent_id: String,
    session: Arc<ProcessSession>,
    reader: impl BufRead,
    stream_kind: &'static str,
) {
    for line in reader.lines() {
        let Ok(line) = line else {
            break;
        };
        let text = line.trim();
        if text.is_empty() {
            continue;
        }

        let rendered = if stream_kind == "stderr" {
            format!("[stderr] {}", text)
        } else {
            text.to_string()
        };
        let rendered = truncate_output(&rendered);

        if let Ok(mut output_ring) = session.output_ring.lock() {
            output_ring.push(rendered.clone());
        }
        if let Ok(mut last_heartbeat) = session.last_heartbeat.lock() {
            *last_heartbeat = Some(Utc::now().to_rfc3339());
        }

        let message = Message::from_agent(&agent_id, MessageKind::Output, &rendered);
        let _ = db.insert_message(&message);
        let _ = db.append_run_output(&agent_id, stream_kind, &rendered);
        let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);
    }
}

fn spawn_output_threads(
    db: Arc<Database>,
    agent_id: String,
    session: Arc<ProcessSession>,
    stdout: ChildStdout,
    stderr: ChildStderr,
) {
    let db_stdout = db.clone();
    let session_stdout = session.clone();
    let agent_stdout = agent_id.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        stream_output(db_stdout, agent_stdout, session_stdout, reader, "stdout");
    });

    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        stream_output(db, agent_id, session, reader, "stderr");
    });
}

fn write_instruction(
    session: &Arc<ProcessSession>,
    content: &str,
    with_newline: bool,
) -> Result<(), AdapterError> {
    let mut stdin = session
        .stdin
        .lock()
        .map_err(|_| AdapterError::Other("process stdin lock poisoned".to_string()))?;

    stdin.write_all(content.as_bytes()).map_err(|error| {
        AdapterError::DeliveryFailed(format!("failed writing to stdin: {}", error))
    })?;

    if with_newline {
        stdin.write_all(b"\n").map_err(|error| {
            AdapterError::DeliveryFailed(format!("failed writing newline: {}", error))
        })?;
    }

    stdin.flush().map_err(|error| {
        AdapterError::DeliveryFailed(format!("failed flushing stdin: {}", error))
    })?;
    Ok(())
}

fn emit_status_message(db: &Arc<Database>, agent_id: &str, content: &str) {
    let message = Message::from_agent(agent_id, MessageKind::StatusUpdate, content);
    let _ = db.insert_message(&message);
    let _ = db.append_run_output(agent_id, "status_update", content);
}

pub struct ProcessAdapter {
    command: String,
    env: Vec<(String, String)>,
    restart_policy: RestartPolicy,
}

impl ProcessAdapter {
    pub fn new(config: &AdapterConfig) -> Self {
        Self {
            command: config.command.clone().unwrap_or_default(),
            env: parse_env(config),
            restart_policy: parse_restart_policy(config),
        }
    }

    fn spawn_session(
        &self,
        agent_id: &str,
        db: Arc<Database>,
    ) -> Result<Arc<ProcessSession>, AdapterError> {
        if self.command.trim().is_empty() {
            return Err(AdapterError::SpawnFailed(
                "Process adapter command is empty. Set adapter command in workstream settings."
                    .to_string(),
            ));
        }

        let mut command = if cfg!(target_os = "windows") {
            let mut command = Command::new("cmd");
            command.args(["/C", self.command.trim()]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-lc", self.command.trim()]);
            command
        };

        if let Some(cwd) = resolve_agent_working_directory(&db, agent_id) {
            command.current_dir(cwd);
        }

        for (key, value) in &self.env {
            command.env(key, value);
        }

        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|error| {
            AdapterError::SpawnFailed(format!("failed spawning process: {}", error))
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AdapterError::SpawnFailed("child stdin unavailable".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AdapterError::SpawnFailed("child stdout unavailable".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AdapterError::SpawnFailed("child stderr unavailable".to_string()))?;

        let session = Arc::new(ProcessSession {
            command: self.command.clone(),
            restart_policy: self.restart_policy,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            output_ring: Mutex::new(OutputRingBuffer::new()),
            last_heartbeat: Mutex::new(Some(Utc::now().to_rfc3339())),
        });

        insert_session(agent_id, session.clone())?;
        spawn_output_threads(db, agent_id.to_string(), session.clone(), stdout, stderr);

        Ok(session)
    }

    fn ensure_session(
        &self,
        agent_id: &str,
        db: Arc<Database>,
    ) -> Result<Arc<ProcessSession>, AdapterError> {
        if let Some(session) = get_session(agent_id) {
            if matches!(process_state(&session)?, ProcessState::Running) {
                return Ok(session);
            }
            remove_session(agent_id);
        }

        self.spawn_session(agent_id, db)
    }
}

impl Adapter for ProcessAdapter {
    fn deliver(&self, message: &Message) -> Result<(), AdapterError> {
        let Some(session) = get_session(&message.agent_id) else {
            return Err(AdapterError::NotConnected(
                "process session is not running".to_string(),
            ));
        };

        match message.kind {
            MessageKind::Instruction | MessageKind::Resume => {
                write_instruction(&session, &message.content, true)?;
            }
            MessageKind::Pause => {
                let _ = write_instruction(&session, "\u{3}", false);
            }
            MessageKind::Cancel => {
                terminate_session(&session)?;
                remove_session(&message.agent_id);
            }
            MessageKind::StatusRequest => {}
            _ => {}
        }
        Ok(())
    }

    fn start(&self, agent_id: &str, db: Arc<Database>) -> Result<(), AdapterError> {
        let agent_id = agent_id.to_string();
        let session = self.ensure_session(&agent_id, db.clone())?;
        let _ = db.update_agent_status(&agent_id, &AgentStatus::Idle);

        thread::spawn(move || loop {
            match db.get_adapter_config(&agent_id) {
                Ok(Some(config)) => {
                    if is_process_like_adapter_type(config.adapter_type) {
                        ()
                    } else {
                        break;
                    }
                }
                Ok(_) => break,
                Err(_) => break,
            }

            let state = process_state(&session).unwrap_or(ProcessState::Exited(None));
            if let ProcessState::Exited(code) = state {
                let suppress_auto_restart =
                    should_suppress_auto_restart(session.restart_policy, code);
                if !suppress_auto_restart {
                    remove_session(&agent_id);
                }
                let (kind, status, note, agent_status) = if code.unwrap_or(0) == 0 {
                    (
                        MessageKind::Completed,
                        RunStatus::Completed,
                        format!(
                            "Process exited normally{}.",
                            code.map(|c| format!(" (code {})", c)).unwrap_or_default()
                        ),
                        AgentStatus::Completed,
                    )
                } else {
                    (
                        MessageKind::Error,
                        RunStatus::Failed,
                        format!(
                            "Process exited with failure{}.",
                            code.map(|c| format!(" (code {})", c)).unwrap_or_default()
                        ),
                        AgentStatus::Errored,
                    )
                };
                let note = if suppress_auto_restart {
                    format!("{} Auto-restart paused by policy.", note)
                } else {
                    note
                };
                let message = Message::from_agent(&agent_id, kind, &note);
                let _ = db.insert_message(&message);
                let _ = db.append_run_output(&agent_id, "process_exit", &note);
                let _ = db.finalize_latest_run(&agent_id, status, Some(note.clone()));
                let _ = db.update_agent_status(&agent_id, &agent_status);
                break;
            }

            let mut cancel_requested = false;
            if let Ok(pending) = db.get_pending_messages(&agent_id) {
                for message in pending {
                    match message.kind {
                        MessageKind::Instruction | MessageKind::Resume => {
                            let _ = db.start_instruction_run(&agent_id, &message.content);
                            let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);
                            if let Err(error) = write_instruction(&session, &message.content, true)
                            {
                                let text = format!("failed to send instruction: {}", error);
                                let error_message =
                                    Message::from_agent(&agent_id, MessageKind::Error, &text);
                                let _ = db.insert_message(&error_message);
                                let _ = db.append_run_output(&agent_id, "error", &text);
                                let _ = db.finalize_latest_run(
                                    &agent_id,
                                    RunStatus::Failed,
                                    Some("Process instruction delivery failed".to_string()),
                                );
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Errored);
                            }
                        }
                        MessageKind::Pause => {
                            let _ = write_instruction(&session, "\u{3}", false);
                            let _ = db.update_agent_status(&agent_id, &AgentStatus::Blocked);
                            emit_status_message(
                                &db,
                                &agent_id,
                                "Pause signal sent to process stdin.",
                            );
                        }
                        MessageKind::Cancel => {
                            let _ = terminate_session(&session);
                            remove_session(&agent_id);
                            let _ = db.append_run_output(&agent_id, "cancel", &message.content);
                            let _ = db.finalize_latest_run(
                                &agent_id,
                                RunStatus::Failed,
                                Some("Cancelled by operator".to_string()),
                            );
                            let _ = db.update_agent_status(&agent_id, &AgentStatus::Idle);
                            emit_status_message(&db, &agent_id, "Process terminated.");
                            cancel_requested = true;
                        }
                        MessageKind::StatusRequest => {
                            let last_output = session
                                .output_ring
                                .lock()
                                .ok()
                                .and_then(|ring| ring.snapshot_tail(STATUS_TAIL_LINES))
                                .unwrap_or_else(|| "No output captured yet.".to_string());
                            let details = format!(
                                "Process command `{}` is running.\nLast output: {}",
                                session.command, last_output
                            );
                            emit_status_message(&db, &agent_id, &details);
                        }
                        _ => {}
                    }
                    let _ = db.mark_delivered(&message.id);
                }
            }

            if cancel_requested {
                break;
            }

            thread::sleep(Duration::from_millis(400));
        });

        Ok(())
    }

    fn stop(&self, agent_id: &str) -> Result<(), AdapterError> {
        if let Some(session) = remove_session(agent_id) {
            terminate_session(&session)?;
        }
        Ok(())
    }

    fn health_check(&self, agent_id: &str) -> Result<AdapterHealth, AdapterError> {
        let Some(session) = get_session(agent_id) else {
            return Ok(AdapterHealth {
                connected: false,
                session_active: false,
                last_heartbeat: None,
                details: Some("Process session not running.".to_string()),
                retry_after_seconds: None,
                consecutive_failures: None,
                last_error: None,
                suppress_auto_restart: None,
            });
        };

        let state = process_state(&session)?;
        let exit_code = match state {
            ProcessState::Running => None,
            ProcessState::Exited(code) => code,
        };
        let active = matches!(state, ProcessState::Running);
        let suppress_auto_restart =
            !active && should_suppress_auto_restart(session.restart_policy, exit_code);
        if !active && !suppress_auto_restart {
            remove_session(agent_id);
        }

        let last_output = session
            .output_ring
            .lock()
            .ok()
            .and_then(|ring| ring.snapshot_tail(STATUS_TAIL_LINES))
            .unwrap_or_else(|| "No output captured yet.".to_string());
        let heartbeat = session
            .last_heartbeat
            .lock()
            .ok()
            .and_then(|value| value.clone());

        Ok(AdapterHealth {
            connected: active,
            session_active: active,
            last_heartbeat: heartbeat,
            details: Some(format!(
                "Process command: {}\nRestart policy: {}\nState: {}\nLast output: {}",
                session.command,
                session.restart_policy.as_str(),
                match state {
                    ProcessState::Running => "running".to_string(),
                    ProcessState::Exited(code) => code
                        .map(|value| format!("exited (code {})", value))
                        .unwrap_or_else(|| "exited".to_string()),
                },
                last_output
            )),
            retry_after_seconds: None,
            consecutive_failures: None,
            last_error: if !active && exit_code.unwrap_or(0) != 0 {
                Some(
                    exit_code
                        .map(|code| format!("process exited with code {}", code))
                        .unwrap_or_else(|| "process exited with failure".to_string()),
                )
            } else {
                None
            },
            suppress_auto_restart: Some(suppress_auto_restart),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn process_config_with_env(env: Option<serde_json::Value>) -> AdapterConfig {
        AdapterConfig {
            adapter_type: AdapterType::Process,
            session_name: None,
            endpoint: None,
            command: Some("echo test".to_string()),
            env,
        }
    }

    #[test]
    fn restart_policy_defaults_to_on_failure() {
        let config = process_config_with_env(None);
        assert!(matches!(
            parse_restart_policy(&config),
            RestartPolicy::OnFailure
        ));
    }

    #[test]
    fn restart_policy_parses_supported_values() {
        let cases = [
            ("never", RestartPolicy::Never),
            ("on_failure", RestartPolicy::OnFailure),
            ("always", RestartPolicy::Always),
            ("ALWAYS", RestartPolicy::Always),
            ("  never  ", RestartPolicy::Never),
        ];

        for (raw, expected) in cases {
            let config = process_config_with_env(Some(json!({
                RESTART_POLICY_ENV_KEY: raw
            })));
            assert_eq!(parse_restart_policy(&config).as_str(), expected.as_str());
        }
    }

    #[test]
    fn restart_policy_falls_back_to_on_failure_for_unknown_values() {
        let config = process_config_with_env(Some(json!({
            RESTART_POLICY_ENV_KEY: "sometimes"
        })));
        assert!(matches!(
            parse_restart_policy(&config),
            RestartPolicy::OnFailure
        ));
    }

    #[test]
    fn suppress_auto_restart_matrix_matches_policy() {
        assert!(should_suppress_auto_restart(RestartPolicy::Never, Some(0)));
        assert!(should_suppress_auto_restart(RestartPolicy::Never, Some(1)));
        assert!(should_suppress_auto_restart(RestartPolicy::Never, None));

        assert!(should_suppress_auto_restart(
            RestartPolicy::OnFailure,
            Some(0)
        ));
        assert!(!should_suppress_auto_restart(
            RestartPolicy::OnFailure,
            Some(2)
        ));
        assert!(should_suppress_auto_restart(RestartPolicy::OnFailure, None));

        assert!(!should_suppress_auto_restart(
            RestartPolicy::Always,
            Some(0)
        ));
        assert!(!should_suppress_auto_restart(
            RestartPolicy::Always,
            Some(2)
        ));
        assert!(!should_suppress_auto_restart(RestartPolicy::Always, None));
    }

    #[test]
    fn parse_env_strips_internal_control_keys() {
        let config = process_config_with_env(Some(json!({
            "USER_VISIBLE": "value",
            "__kanbun_internal": "secret",
            "__kanbun_restart_policy": "always",
            "NUMERIC": 42
        })));

        let parsed = parse_env(&config);
        assert_eq!(parsed.len(), 2);
        assert!(parsed.contains(&("USER_VISIBLE".to_string(), "value".to_string())));
        assert!(parsed.contains(&("NUMERIC".to_string(), "42".to_string())));
        assert!(!parsed.iter().any(|(key, _)| key.starts_with("__kanbun_")));
    }
}
