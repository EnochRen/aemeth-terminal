//! Health‑check logic — a blocking HTTP GET per configured URL every 15 seconds.

use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::pty::{self, PtyManager};

pub const EVENT_HEALTH: &str = "aemeth://health";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthEvent {
    pub session_id: String,
    pub app_id: String,
    pub healthy: bool,
}

/// Called by the manager’s background thread every 15 seconds.
pub fn poll_sessions(
    manager: &PtyManager,
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    last: &mut HashMap<String, bool>,
) {
    let targets = pty::sessions_snapshot(manager);
    if targets.is_empty() {
        return;
    }
    for (session_id, app_id, url) in targets {
        if url.is_empty() {
            continue;
        }
        let healthy = match client.get(&url).send() {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    tracing::warn!(%session_id, %app_id, %status, "health check returned an unhealthy status");
                }
                status.is_success()
            }
            Err(error) => {
                tracing::warn!(%session_id, %app_id, %error, "health check request failed");
                false
            }
        };
        let prev = last.insert(session_id.clone(), healthy);
        if prev != Some(healthy) {
            tracing::info!(
                %session_id,
                %app_id,
                healthy,
                "health status changed"
            );
            let _ = app.emit(
                EVENT_HEALTH,
                HealthEvent {
                    session_id,
                    app_id,
                    healthy,
                },
            );
        }
    }
}