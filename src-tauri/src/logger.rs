//! File-based logging with daily rotation, size capping, and retention policy.
//!
//! Logs are written to `{user_data_dir}/aemeth-terminal/logs/`:
//! - Daily rolled: `aemeth.YYYY-MM-DD.log`
//! - Max 10 MiB per file — when exceeded, the current file is renamed with a
//!   `.1` / `.2` / … suffix and a new daily file is opened.
//! - Max 30 daily files retained (older files are deleted on init and on
//!   rollover).
//!
//! Console output is only attached in debug builds; release builds go to file
//! only (no stdout/stderr noise on Windows).

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use tracing_subscriber::filter::EnvFilter;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Registry;

// ── tunables ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MiB
const MAX_FILE_COUNT: usize = 30; // keep at most 30 log files
const FILE_PREFIX: &str = "aemeth";

// ── directory resolution ───────────────────────────────────────────────────

pub(crate) fn logs_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aemeth-terminal")
        .join("logs")
}

fn today_stamp() -> String {
    // UTC so the rotation boundary is independent of local time zone shenanigans.
    let now = chrono::Utc::now();
    now.format("%Y-%m-%d").to_string()
}

// ── size-rolling writer ────────────────────────────────────────────────────

/// A [`Write`] impl that wraps a file in the logs directory.
///
/// On every `write()` it checks whether the current file has exceeded
/// `MAX_FILE_SIZE`.  If it has, the file is closed, renamed to
/// `{prefix}.{date}.{n}.log` (where `n` is the smallest free integer ≥ 1),
/// and a fresh file is opened.  After renaming, old files beyond
/// `MAX_FILE_COUNT` are pruned.
///
/// A date change (midnight UTC) also triggers a rollover so the filename
/// always carries the current day.
struct RollingWriter {
    logs_dir: PathBuf,
    current_date: String,
    file: File,
    bytes_written: u64,
}

impl RollingWriter {
    fn new(logs_dir: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&logs_dir)?;
        let date = today_stamp();
        let file = create_log_file(&logs_dir, &date)?;
        Ok(Self {
            logs_dir,
            current_date: date,
            file,
            bytes_written: 0,
        })
    }

    fn rollover(&mut self) -> io::Result<()> {
        // Close the current file first (on Windows we can't rename an open file).
        self.file.flush()?;

        let old_date = self.current_date.clone();
        let _old_path = log_path(&self.logs_dir, &old_date);

        // Rotate: rename `aemeth.2025-01-15.log` → `aemeth.2025-01-15.1.log`,
        // bumping existing numbered files up.
        rotate_archive(&self.logs_dir, &old_date)?;

        // Prune old files.
        prune_old_files(&self.logs_dir, MAX_FILE_COUNT)?;

        // Open a new file for today.
        self.current_date = today_stamp();
        self.file = create_log_file(&self.logs_dir, &self.current_date)?;
        self.bytes_written = 0;

        Ok(())
    }
}

impl Write for RollingWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let today = today_stamp();
        let would_exceed = self.bytes_written.saturating_add(buf.len() as u64) > MAX_FILE_SIZE;

        if would_exceed || today != self.current_date {
            self.rollover()?;
        }

        let n = self.file.write(buf)?;
        self.bytes_written += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn log_path(dir: &Path, date: &str) -> PathBuf {
    dir.join(format!("{}.{}.log", FILE_PREFIX, date))
}

fn create_log_file(dir: &Path, date: &str) -> io::Result<File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path(dir, date))
}

/// Rename `{prefix}.{date}.log` → `{prefix}.{date}.1.log`, shifting
/// existing numbered files up: `1→2, 2→3, …`.
///
/// We scan for existing numbered files to find the highest index, then rename
/// in descending order so we never overwrite.
fn rotate_archive(dir: &Path, date: &str) -> io::Result<()> {
    let base = log_path(dir, date);
    if !base.exists() {
        return Ok(());
    }

    // Find the highest existing index.
    let mut highest = 0usize;
    for entry in fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(&format!("{}.{}.", FILE_PREFIX, date)) && name.ends_with(".log") {
            // Extract index: "aemeth.2025-01-15.3.log" → 3
            let middle = &name[format!("{}.{}.", FILE_PREFIX, date).len()..];
            let middle = middle.strip_suffix(".log").unwrap_or(middle);
            if let Ok(n) = middle.parse::<usize>() {
                highest = highest.max(n);
            }
        }
    }

    // Shift up from highest down to 1.
    for idx in (1..=highest).rev() {
        let from = dir.join(format!("{}.{}.{}.log", FILE_PREFIX, date, idx));
        let to = dir.join(format!("{}.{}.{}.log", FILE_PREFIX, date, idx + 1));
        if from.exists() {
            let _ = fs::remove_file(&to);
            fs::rename(&from, &to)?;
        }
    }

    // Move the base file to .1
    let archive1 = dir.join(format!("{}.{}.1.log", FILE_PREFIX, date));
    fs::rename(&base, &archive1)?;

    Ok(())
}

/// Delete the oldest log files until at most `max` remain.
///
/// Files are identified by their date in the filename; oldest dates go first.
fn prune_old_files(dir: &Path, max: usize) -> io::Result<()> {
    let mut files: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(FILE_PREFIX) && name.ends_with(".log") {
            files.push(entry.path());
        }
    }
    if files.len() <= max {
        return Ok(());
    }
    // Sort by name (which encodes date) ascending = oldest first.
    files.sort();
    let to_delete = files.len() - max;
    for path in files.iter().take(to_delete) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

/// Purge log files whose encoded date is older than `MAX_FILE_COUNT` days.
/// Called once at startup as a secondary safety net.
fn purge_old_files_by_age(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(MAX_FILE_COUNT as u64 * 86400));

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "log").unwrap_or(false) {
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if let Some(cutoff) = cutoff {
                        if modified < cutoff {
                            let _ = fs::remove_file(&path);
                        }
                    }
                }
            }
        }
    }
}

// ── public init ─────────────────────────────────────────────────────────────

/// Initialize the logging system.
///
/// # Panics
/// Panics if the log directory or initial log file cannot be created.
pub fn init() {
    let logs_dir = logs_dir();
    fs::create_dir_all(&logs_dir).expect("failed to create log directory");

    // Clean up ancient log files on startup.
    purge_old_files_by_age(&logs_dir);

    let writer = RollingWriter::new(logs_dir.clone())
        .expect("failed to create rolling log writer");

    // Default filter: info for our crate, warn for dependencies.
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("aemeth_terminal_lib=info,warn"));

    #[cfg(debug_assertions)]
    {
        let console_layer = fmt::layer()
            .with_target(true)
            .with_thread_ids(true)
            .with_file(true)
            .with_line_number(true)
            .compact();

        let file_layer = fmt::layer()
            .json()
            .with_writer(Mutex::new(writer));

        Registry::default()
            .with(env_filter)
            .with(console_layer)
            .with(file_layer)
            .init();
    }

    #[cfg(not(debug_assertions))]
    {
        let file_layer = fmt::layer()
            .json()
            .with_writer(Mutex::new(writer));

        Registry::default()
            .with(env_filter)
            .with(file_layer)
            .init();
    }

    tracing::info!(
        logs_dir = %logs_dir.display(),
        version = env!("CARGO_PKG_VERSION"),
        "logging initialized",
    );
}