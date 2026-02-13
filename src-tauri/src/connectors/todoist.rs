use super::*;
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize as DeserializeDerive;

const BASE_URL: &str = "https://api.todoist.com/rest/v2";

/// Todoist connector. Uses their REST API v2.
///
/// Setup: Create an API token at https://todoist.com/app/settings/integrations/developer
/// Pass it as auth_token in ConnectorConfig.
///
/// Todoist data model mapping:
///   Task → ConnectorItem
///   Labels → tags
///   Priority (1-4, where 4=urgent in Todoist) → priority (normalized: 4→1, 3→2, 2→3, 1→4)
///   Section/Project → we flatten for now, project name goes in metadata
pub struct TodoistConnector {
    client: Client,
    token: String,
}

// ── Todoist API response types ──────────────────────────────────────────────

#[derive(Debug, DeserializeDerive)]
struct TodoistTask {
    id: String,
    content: String,     // title
    description: String, // body
    is_completed: bool,
    priority: u8, // 1=normal, 4=urgent (inverted from our model)
    labels: Vec<String>,
    #[serde(default)]
    due: Option<TodoistDue>,
    url: String,
    project_id: String,
    #[serde(default)]
    parent_id: Option<String>,
    created_at: String,
}

#[derive(Debug, DeserializeDerive)]
struct TodoistDue {
    date: String, // "2024-01-15" or "2024-01-15T14:00:00Z"
    #[serde(default)]
    datetime: Option<String>,
    #[serde(default)]
    is_recurring: bool,
}

#[derive(Debug, serde::Serialize)]
struct CreateTaskBody {
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    labels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    due_date: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct UpdateTaskBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    labels: Option<Vec<String>>,
}

// ── Implementation ──────────────────────────────────────────────────────────

impl TodoistConnector {
    pub fn new(token: String) -> Self {
        Self {
            client: Client::new(),
            token,
        }
    }

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.token)
    }

    /// Todoist priority is inverted: 4=urgent, 1=normal
    /// We normalize to: 1=urgent, 4=normal
    fn normalize_priority(todoist_priority: u8) -> u8 {
        match todoist_priority {
            4 => 1,
            3 => 2,
            2 => 3,
            _ => 4,
        }
    }

    fn denormalize_priority(our_priority: u8) -> u8 {
        match our_priority {
            1 => 4,
            2 => 3,
            3 => 2,
            _ => 1,
        }
    }

    fn parse_due(due: &Option<TodoistDue>) -> Option<DateTime<Utc>> {
        due.as_ref().and_then(|d| {
            d.datetime
                .as_ref()
                .and_then(|dt| chrono::DateTime::parse_from_rfc3339(dt).ok())
                .map(|t| t.with_timezone(&Utc))
                .or_else(|| {
                    chrono::NaiveDate::parse_from_str(&d.date, "%Y-%m-%d")
                        .ok()
                        .and_then(|nd| nd.and_hms_opt(0, 0, 0))
                        .map(|ndt| ndt.and_utc())
                })
        })
    }

    fn task_to_item(&self, task: TodoistTask) -> ConnectorItem {
        let mut metadata = HashMap::new();
        metadata.insert("project_id".into(), task.project_id);
        if let Some(ref due) = task.due {
            if due.is_recurring {
                metadata.insert("recurring".into(), "true".into());
            }
        }

        ConnectorItem {
            id: task.id,
            source: "todoist".into(),
            title: task.content,
            content: if task.description.is_empty() {
                None
            } else {
                Some(task.description)
            },
            status: if task.is_completed {
                ItemStatus::Completed
            } else {
                ItemStatus::Active
            },
            priority: Some(Self::normalize_priority(task.priority)),
            tags: task.labels,
            url: Some(task.url),
            parent_id: task.parent_id,
            metadata,
            created_at: chrono::DateTime::parse_from_rfc3339(&task.created_at)
                .ok()
                .map(|t| t.with_timezone(&Utc)),
            updated_at: None, // Todoist REST v2 doesn't return this on tasks
            due_at: Self::parse_due(&task.due),
        }
    }
}

#[async_trait]
impl Connector for TodoistConnector {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "todoist".into(),
            name: "Todoist".into(),
            icon: "✓".into(),
            capabilities: ConnectorCapabilities {
                can_read: true,
                can_write: true,
                can_delete: true,
                can_search: true,
                supports_hierarchy: true,
                supports_due_dates: true,
                supports_priorities: true,
                supports_tags: true,
            },
            auth_type: AuthType::ApiKey,
            status: ConnectorStatus::Connected, // will be updated by health_check
        }
    }

    async fn pull(&self, filter: Option<PullFilter>) -> Result<Vec<ConnectorItem>, ConnectorError> {
        let mut url = format!("{}/tasks", BASE_URL);
        let mut query_params: Vec<(&str, String)> = vec![];

        if let Some(ref f) = filter {
            // Todoist uses their own filter syntax
            if let Some(ref search) = f.search {
                query_params.push(("filter", search.clone()));
            }
            // Labels filter
            if let Some(ref tags) = f.tags {
                if let Some(first_tag) = tags.first() {
                    query_params.push(("label", first_tag.clone()));
                }
            }
        }

        if !query_params.is_empty() {
            url.push('?');
            url.push_str(
                &query_params
                    .iter()
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect::<Vec<_>>()
                    .join("&"),
            );
        }

        let response = self
            .client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| ConnectorError::NetworkError(e.to_string()))?;

        if response.status() == 401 || response.status() == 403 {
            return Err(ConnectorError::AuthFailed(
                "Invalid Todoist API token".into(),
            ));
        }

        if response.status() == 429 {
            return Err(ConnectorError::RateLimited("Todoist rate limit hit".into()));
        }

        if !response.status().is_success() {
            return Err(ConnectorError::Other(format!(
                "Todoist API error: {}",
                response.status()
            )));
        }

        let tasks: Vec<TodoistTask> = response
            .json()
            .await
            .map_err(|e| ConnectorError::ParseError(e.to_string()))?;

        let mut items: Vec<ConnectorItem> =
            tasks.into_iter().map(|t| self.task_to_item(t)).collect();

        // Apply client-side filters that Todoist API doesn't support natively
        if let Some(ref f) = filter {
            if let Some(ref status) = f.status {
                items.retain(|i| &i.status == status);
            }
            if let Some(limit) = f.limit {
                items.truncate(limit);
            }
        }

        Ok(items)
    }

    async fn push(&self, item: &ConnectorItem) -> Result<ConnectorItem, ConnectorError> {
        let body = CreateTaskBody {
            content: item.title.clone(),
            description: item.content.clone(),
            priority: item.priority.map(Self::denormalize_priority),
            labels: if item.tags.is_empty() {
                None
            } else {
                Some(item.tags.clone())
            },
            due_date: item.due_at.map(|d| d.format("%Y-%m-%d").to_string()),
        };

        let response = self
            .client
            .post(&format!("{}/tasks", BASE_URL))
            .header("Authorization", self.auth_header())
            .json(&body)
            .send()
            .await
            .map_err(|e| ConnectorError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            return Err(ConnectorError::Other(format!(
                "Failed to create task: {}",
                response.status()
            )));
        }

        let task: TodoistTask = response
            .json()
            .await
            .map_err(|e| ConnectorError::ParseError(e.to_string()))?;

        Ok(self.task_to_item(task))
    }

    async fn update(&self, item: &ConnectorItem) -> Result<ConnectorItem, ConnectorError> {
        let body = UpdateTaskBody {
            content: Some(item.title.clone()),
            description: item.content.clone(),
            priority: item.priority.map(Self::denormalize_priority),
            labels: if item.tags.is_empty() {
                None
            } else {
                Some(item.tags.clone())
            },
        };

        let response = self
            .client
            .post(&format!("{}/tasks/{}", BASE_URL, item.id))
            .header("Authorization", self.auth_header())
            .json(&body)
            .send()
            .await
            .map_err(|e| ConnectorError::NetworkError(e.to_string()))?;

        if response.status() == 404 {
            return Err(ConnectorError::NotFound(format!(
                "Task {} not found",
                item.id
            )));
        }

        if !response.status().is_success() {
            return Err(ConnectorError::Other(format!(
                "Failed to update task: {}",
                response.status()
            )));
        }

        let task: TodoistTask = response
            .json()
            .await
            .map_err(|e| ConnectorError::ParseError(e.to_string()))?;

        Ok(self.task_to_item(task))
    }

    async fn delete(&self, external_id: &str) -> Result<(), ConnectorError> {
        let response = self
            .client
            .delete(&format!("{}/tasks/{}", BASE_URL, external_id))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| ConnectorError::NetworkError(e.to_string()))?;

        if response.status() == 404 {
            return Err(ConnectorError::NotFound(format!(
                "Task {} not found",
                external_id
            )));
        }

        if !response.status().is_success() {
            return Err(ConnectorError::Other(format!(
                "Failed to delete task: {}",
                response.status()
            )));
        }

        Ok(())
    }

    async fn health_check(&self) -> Result<ConnectorStatus, ConnectorError> {
        let response = self
            .client
            .get(&format!("{}/projects", BASE_URL))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| ConnectorError::NetworkError(e.to_string()))?;

        match response.status().as_u16() {
            200..=299 => Ok(ConnectorStatus::Connected),
            401 | 403 => Ok(ConnectorStatus::NeedsAuth),
            429 => Err(ConnectorError::RateLimited("Rate limited".into())),
            _ => Ok(ConnectorStatus::Error),
        }
    }
}
