use crate::models::{FileChange, FileChangeType};
use chrono::Utc;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

pub struct FileSystemWatcher {
    _watcher: RecommendedWatcher,
    /// Maps watched directory -> agent_ids
    path_agent_map: Arc<Mutex<HashMap<String, Vec<String>>>>,
    /// Channel receiver for file change events
    pub receiver: mpsc::UnboundedReceiver<AgentFileEvent>,
}

#[derive(Debug, Clone)]
pub struct AgentFileEvent {
    pub agent_id: String,
    pub change: FileChange,
}

impl FileSystemWatcher {
    fn normalize_existing_path(path: &Path) -> PathBuf {
        std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
    }

    fn normalize_event_path(path: &Path) -> PathBuf {
        if let Ok(canonical) = std::fs::canonicalize(path) {
            return canonical;
        }

        if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
            if let Ok(canonical_parent) = std::fs::canonicalize(parent) {
                return canonical_parent.join(name);
            }
        }

        path.to_path_buf()
    }

    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let (tx, rx) = mpsc::unbounded_channel();
        let path_agent_map: Arc<Mutex<HashMap<String, Vec<String>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let map_clone = path_agent_map.clone();

        let watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                if let Ok(event) = result {
                    let change_type = match event.kind {
                        EventKind::Create(_) => Some(FileChangeType::Created),
                        EventKind::Modify(_) => Some(FileChangeType::Modified),
                        EventKind::Remove(_) => Some(FileChangeType::Deleted),
                        _ => None,
                    };

                    if let Some(change_type) = change_type {
                        for path in &event.paths {
                            let normalized_path = Self::normalize_event_path(path);

                            // Skip hidden files, node_modules, build output, and OS artifacts.
                            let path_str = normalized_path.to_string_lossy();
                            if path_str.contains("/.git/")
                                || path_str.contains("/node_modules/")
                                || path_str.contains("/target/")
                                || path_str.contains("/.next/")
                                || path_str.contains("/.DS_Store")
                            {
                                continue;
                            }

                            // Find all agents that own this path (supports overlapping paths).
                            let map = map_clone.lock().unwrap();
                            let mut matching_agents = HashSet::<String>::new();
                            for (watched_path, agent_ids) in map.iter() {
                                if normalized_path.starts_with(Path::new(watched_path)) {
                                    for agent_id in agent_ids {
                                        matching_agents.insert(agent_id.clone());
                                    }
                                }
                            }

                            for agent_id in matching_agents {
                                let _ = tx.send(AgentFileEvent {
                                    agent_id,
                                    change: FileChange {
                                        path: path_str.to_string(),
                                        change_type: change_type.clone(),
                                        timestamp: Utc::now(),
                                    },
                                });
                            }
                        }
                    }
                } else if let Err(error) = result {
                    log::warn!("Watcher error: {}", error);
                }
            },
            Config::default(),
        )?;

        Ok(Self {
            _watcher: watcher,
            path_agent_map,
            receiver: rx,
        })
    }

    /// Register a directory to watch, associated with an agent
    pub fn watch_path(
        &mut self,
        path: &str,
        agent_id: &str,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let input_path = PathBuf::from(path);
        if input_path.exists() {
            let canonical_path = Self::normalize_existing_path(&input_path);
            let canonical_key = canonical_path.to_string_lossy().to_string();

            let mut map = self.path_agent_map.lock().unwrap();
            if let Some(agent_ids) = map.get_mut(&canonical_key) {
                if !agent_ids.iter().any(|existing| existing == agent_id) {
                    agent_ids.push(agent_id.to_string());
                    log::info!(
                        "Registered additional agent {} for watched path {}",
                        agent_id,
                        canonical_path.display()
                    );
                }
                return Ok(true);
            }

            drop(map);
            self._watcher
                .watch(&canonical_path, RecursiveMode::Recursive)?;
            self.path_agent_map
                .lock()
                .unwrap()
                .insert(canonical_key, vec![agent_id.to_string()]);
            log::info!(
                "Watching {} for agent {}",
                canonical_path.display(),
                agent_id
            );
            Ok(true)
        } else {
            log::warn!("Path does not exist, skipping watch: {}", path);
            Ok(false)
        }
    }

    /// Unwatch a path
    pub fn unwatch_path(&mut self, path: &str) -> Result<(), Box<dyn std::error::Error>> {
        let canonical_path = Self::normalize_existing_path(Path::new(path));
        self._watcher.unwatch(&canonical_path)?;
        self.path_agent_map
            .lock()
            .unwrap()
            .remove(canonical_path.to_string_lossy().as_ref());
        Ok(())
    }
}
