use super::*;
use async_trait::async_trait;
use std::fs;
use std::path::{Path, PathBuf};

/// Obsidian connector. Reads markdown files from a local vault directory.
///
/// This is the "local-first" connector — no API calls, no auth, just the
/// file system. A good stress test for the abstraction since it proves
/// connectors aren't just HTTP wrappers.
///
/// Setup: Set vault_path in ConnectorConfig settings to your vault directory.
/// e.g., "~/Documents/ObsidianVault" or "/Users/sid/vault"
///
/// Mapping:
///   .md file → ConnectorItem
///   filename (minus .md) → title
///   file contents → content
///   YAML frontmatter tags → tags
///   frontmatter status → status
///   subdirectory → metadata["folder"]
pub struct ObsidianConnector {
    vault_path: PathBuf,
}

impl ObsidianConnector {
    pub fn new(vault_path: &str) -> Self {
        let expanded = shellexpand::tilde(vault_path).to_string();
        Self {
            vault_path: PathBuf::from(expanded),
        }
    }

    /// Walk the vault and collect all .md files
    fn collect_files(&self, filter: &Option<PullFilter>) -> Result<Vec<PathBuf>, ConnectorError> {
        if !self.vault_path.exists() {
            return Err(ConnectorError::FileSystemError(format!(
                "Vault not found: {}",
                self.vault_path.display()
            )));
        }

        let mut files = Vec::new();
        self.walk_dir(&self.vault_path, &mut files)?;

        // Sort by modified time, most recent first
        files.sort_by(|a, b| {
            let a_time = fs::metadata(a).and_then(|m| m.modified()).ok();
            let b_time = fs::metadata(b).and_then(|m| m.modified()).ok();
            b_time.cmp(&a_time)
        });

        if let Some(ref f) = filter {
            if let Some(limit) = f.limit {
                files.truncate(limit);
            }
        }

        Ok(files)
    }

    fn walk_dir(&self, dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), ConnectorError> {
        let entries =
            fs::read_dir(dir).map_err(|e| ConnectorError::FileSystemError(e.to_string()))?;

        for entry in entries {
            let entry = entry.map_err(|e| ConnectorError::FileSystemError(e.to_string()))?;
            let path = entry.path();

            // Skip hidden directories and common non-content dirs
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == ".obsidian"
                    || name == ".trash"
                {
                    continue;
                }
            }

            if path.is_dir() {
                self.walk_dir(&path, files)?;
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                files.push(path);
            }
        }
        Ok(())
    }

    /// Parse a markdown file into a ConnectorItem
    fn file_to_item(&self, path: &Path) -> Result<ConnectorItem, ConnectorError> {
        let content =
            fs::read_to_string(path).map_err(|e| ConnectorError::FileSystemError(e.to_string()))?;

        let metadata_fs =
            fs::metadata(path).map_err(|e| ConnectorError::FileSystemError(e.to_string()))?;

        let title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("untitled")
            .to_string();

        // Relative path from vault root for the ID
        let rel_path = path
            .strip_prefix(&self.vault_path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        let folder = path
            .parent()
            .and_then(|p| p.strip_prefix(&self.vault_path).ok())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        // Parse YAML frontmatter if present
        let (frontmatter, body) = parse_frontmatter(&content);

        let tags = frontmatter
            .get("tags")
            .map(|t| parse_yaml_list(t))
            .unwrap_or_default();

        let status = frontmatter
            .get("status")
            .map(|s| match s.trim().to_lowercase().as_str() {
                "done" | "completed" | "complete" => ItemStatus::Completed,
                "in-progress" | "in_progress" | "wip" => ItemStatus::InProgress,
                "archived" | "archive" => ItemStatus::Archived,
                _ => ItemStatus::Active,
            })
            .unwrap_or(ItemStatus::Active);

        let mut item_metadata = HashMap::new();
        item_metadata.insert("folder".into(), folder);
        item_metadata.insert("file_path".into(), rel_path.clone());

        // Add any extra frontmatter fields
        for (key, value) in &frontmatter {
            if key != "tags" && key != "status" {
                item_metadata.insert(key.clone(), value.clone());
            }
        }

        let created_at = metadata_fs.created().ok().map(|t| DateTime::<Utc>::from(t));
        let updated_at = metadata_fs
            .modified()
            .ok()
            .map(|t| DateTime::<Utc>::from(t));

        // Parse due date from frontmatter
        let due_at = frontmatter
            .get("due")
            .and_then(|d| chrono::NaiveDate::parse_from_str(d.trim(), "%Y-%m-%d").ok())
            .and_then(|nd| nd.and_hms_opt(0, 0, 0))
            .map(|ndt| ndt.and_utc());

        Ok(ConnectorItem {
            id: rel_path,
            source: "obsidian".into(),
            title,
            content: if body.trim().is_empty() {
                None
            } else {
                Some(body)
            },
            status,
            priority: frontmatter
                .get("priority")
                .and_then(|p| p.trim().parse::<u8>().ok()),
            tags,
            url: None, // Could generate obsidian:// URI
            parent_id: None,
            metadata: item_metadata,
            created_at,
            updated_at,
            due_at,
        })
    }

    fn item_to_file_content(&self, item: &ConnectorItem) -> String {
        let mut output = String::new();

        // Build frontmatter
        let mut fm_lines = Vec::new();
        if !item.tags.is_empty() {
            fm_lines.push(format!("tags: [{}]", item.tags.join(", ")));
        }
        match item.status {
            ItemStatus::Active => {} // default, don't write
            ItemStatus::Completed => fm_lines.push("status: done".into()),
            ItemStatus::InProgress => fm_lines.push("status: in-progress".into()),
            ItemStatus::Archived => fm_lines.push("status: archived".into()),
        }
        if let Some(p) = item.priority {
            fm_lines.push(format!("priority: {}", p));
        }
        if let Some(due) = item.due_at {
            fm_lines.push(format!("due: {}", due.format("%Y-%m-%d")));
        }

        if !fm_lines.is_empty() {
            output.push_str("---\n");
            for line in fm_lines {
                output.push_str(&line);
                output.push('\n');
            }
            output.push_str("---\n\n");
        }

        if let Some(ref content) = item.content {
            output.push_str(content);
        }

        output
    }
}

#[async_trait]
impl Connector for ObsidianConnector {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "obsidian".into(),
            name: "Obsidian".into(),
            icon: "📝".into(),
            capabilities: ConnectorCapabilities {
                can_read: true,
                can_write: true,
                can_delete: true,
                can_search: true,
                supports_hierarchy: false, // we flatten folders
                supports_due_dates: true,  // via frontmatter
                supports_priorities: true, // via frontmatter
                supports_tags: true,       // via frontmatter
            },
            auth_type: AuthType::Local,
            status: ConnectorStatus::Connected,
        }
    }

    async fn pull(&self, filter: Option<PullFilter>) -> Result<Vec<ConnectorItem>, ConnectorError> {
        let files = self.collect_files(&filter)?;
        let mut items = Vec::new();

        for path in files {
            match self.file_to_item(&path) {
                Ok(item) => {
                    // Apply filters
                    if let Some(ref f) = filter {
                        if let Some(ref status) = f.status {
                            if &item.status != status {
                                continue;
                            }
                        }
                        if let Some(ref tags) = f.tags {
                            if !tags.iter().any(|t| item.tags.contains(t)) {
                                continue;
                            }
                        }
                        if let Some(ref search) = f.search {
                            let search_lower = search.to_lowercase();
                            let matches = item.title.to_lowercase().contains(&search_lower)
                                || item
                                    .content
                                    .as_ref()
                                    .map(|c| c.to_lowercase().contains(&search_lower))
                                    .unwrap_or(false);
                            if !matches {
                                continue;
                            }
                        }
                        if let Some(since) = f.since {
                            if let Some(updated) = item.updated_at {
                                if updated < since {
                                    continue;
                                }
                            }
                        }
                    }
                    items.push(item);
                }
                Err(e) => {
                    log::warn!("Failed to parse {}: {}", path.display(), e);
                }
            }
        }

        Ok(items)
    }

    async fn push(&self, item: &ConnectorItem) -> Result<ConnectorItem, ConnectorError> {
        // Sanitize title for filename
        let safe_title = item
            .title
            .replace('/', "-")
            .replace('\\', "-")
            .replace(':', "-");

        let file_path = self.vault_path.join(format!("{}.md", safe_title));

        if file_path.exists() {
            return Err(ConnectorError::Other(format!(
                "Note '{}' already exists",
                safe_title
            )));
        }

        let content = self.item_to_file_content(item);
        fs::write(&file_path, &content)
            .map_err(|e| ConnectorError::FileSystemError(e.to_string()))?;

        self.file_to_item(&file_path)
    }

    async fn update(&self, item: &ConnectorItem) -> Result<ConnectorItem, ConnectorError> {
        let file_path = self.vault_path.join(&item.id);

        if !file_path.exists() {
            return Err(ConnectorError::NotFound(format!(
                "Note not found: {}",
                item.id
            )));
        }

        let content = self.item_to_file_content(item);
        fs::write(&file_path, &content)
            .map_err(|e| ConnectorError::FileSystemError(e.to_string()))?;

        self.file_to_item(&file_path)
    }

    async fn delete(&self, external_id: &str) -> Result<(), ConnectorError> {
        let file_path = self.vault_path.join(external_id);

        if !file_path.exists() {
            return Err(ConnectorError::NotFound(format!(
                "Note not found: {}",
                external_id
            )));
        }

        // Move to .trash instead of hard delete (matches Obsidian behavior)
        let trash_dir = self.vault_path.join(".trash");
        if !trash_dir.exists() {
            fs::create_dir_all(&trash_dir)
                .map_err(|e| ConnectorError::FileSystemError(e.to_string()))?;
        }

        let filename = file_path
            .file_name()
            .ok_or_else(|| ConnectorError::Other("Invalid path".into()))?;
        let trash_path = trash_dir.join(filename);

        fs::rename(&file_path, &trash_path)
            .map_err(|e| ConnectorError::FileSystemError(e.to_string()))?;

        Ok(())
    }

    async fn health_check(&self) -> Result<ConnectorStatus, ConnectorError> {
        if self.vault_path.exists() && self.vault_path.is_dir() {
            Ok(ConnectorStatus::Connected)
        } else {
            Ok(ConnectorStatus::Error)
        }
    }
}

// ── YAML frontmatter parsing ────────────────────────────────────────────────
// Minimal parser — we don't pull in a full YAML crate for just frontmatter.

fn parse_frontmatter(content: &str) -> (HashMap<String, String>, String) {
    let mut frontmatter = HashMap::new();

    if !content.starts_with("---") {
        return (frontmatter, content.to_string());
    }

    let after_first = &content[3..];
    if let Some(end_idx) = after_first.find("\n---") {
        let fm_block = &after_first[..end_idx];
        let body = &after_first[end_idx + 4..]; // skip "\n---"

        for line in fm_block.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some(colon_pos) = line.find(':') {
                let key = line[..colon_pos].trim().to_string();
                let value = line[colon_pos + 1..].trim().to_string();
                frontmatter.insert(key, value);
            }
        }

        // Trim leading newlines from body
        let body = body.trim_start_matches('\n').to_string();
        (frontmatter, body)
    } else {
        (frontmatter, content.to_string())
    }
}

fn parse_yaml_list(value: &str) -> Vec<String> {
    let trimmed = value.trim();

    // Handle [tag1, tag2] format
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return trimmed[1..trimmed.len() - 1]
            .split(',')
            .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }

    // Handle single value
    if !trimmed.contains(',') && !trimmed.contains('\n') {
        return vec![trimmed.to_string()];
    }

    // Handle comma-separated
    trimmed
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}
