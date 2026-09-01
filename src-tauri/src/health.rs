//! Health‑check logic — a blocking HTTP GET per configured URL every 15 seconds.

use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::pty::{self, PtyManager};

pub const EVENT_HEALTH: &str = "aemeth://health";

#[derive(Debug, Clone, Serialize)]
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
        let healthy = client
            .get(&url)
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        let prev = last.insert(session_id.clone(), healthy);
        if prev != Some(healthy) {
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