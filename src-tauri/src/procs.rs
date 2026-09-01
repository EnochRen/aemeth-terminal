//! Process-manager backend: snapshot every system process (with command line
//! and listening ports) and force-kill whole process trees.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::ports;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub name: String,
    /// Full command line, arguments joined by spaces.
    pub cmd: String,
    pub exe: Option<String>,
    /// Resident memory in bytes.
    pub memory: u64,
    pub cpu: f32,
    /// Start time, seconds since the epoch.
    pub start_time: u64,
    pub ports: Vec<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDetail {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub name: String,
    pub cmd: String,
    pub exe: Option<String>,
    pub memory: u64,
    pub cpu: f32,
    pub start_time: u64,
    pub ports: Vec<u16>,
    /// Number of threads (not available via sysinfo on all platforms).
    pub threads: Option<u32>,
    /// Environment variables (KEY=VALUE).
    pub environ: Vec<String>,
    /// Total bytes read (disk I/O).
    pub disk_read_bytes: u64,
    /// Total bytes written (disk I/O).
    pub disk_write_bytes: u64,
}

/// Reused between snapshots so CPU usage is measured over the poll interval.
static SYSTEM: Mutex<Option<System>> = Mutex::new(None);

fn lock_system() -> std::sync::MutexGuard<'static, Option<System>> {
    SYSTEM.lock().unwrap_or_else(|e| e.into_inner())
}

/// Number of logical CPU cores, cached once.
fn cpu_cores() -> f32 {
    use std::sync::OnceLock;
    static CORES: OnceLock<f32> = OnceLock::new();
    *CORES.get_or_init(|| {
        // Use a fresh System to query CPU count so we don't deadlock
        // with the caller that already holds the SYSTEM mutex.
        System::new_all().cpus().len() as f32
    })
}

/// Snapshot of all processes, sorted by pid.
pub fn snapshot() -> Vec<ProcessInfo> {
    let mut slot = lock_system();
    let system = slot.get_or_insert_with(System::new_all);
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new()
            .with_cmd(UpdateKind::Always)
            .with_memory()
            .with_cpu()
            .with_exe(UpdateKind::OnlyIfNotSet),
    );

    let listeners = ports::listening_ports();
    let mut infos: Vec<ProcessInfo> = system
        .processes()
        .iter()
        .map(|(pid, p)| ProcessInfo {
            pid: pid.as_u32(),
            ppid: p.parent().map(|x| x.as_u32()),
            name: p.name().to_string_lossy().into_owned(),
            cmd: p
                .cmd()
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" "),
            exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
            memory: p.memory(),
            cpu: p.cpu_usage() / cpu_cores(),
            start_time: p.start_time(),
            ports: listeners.get(&pid.as_u32()).cloned().unwrap_or_default(),
        })
        .collect();
    infos.sort_by_key(|i| i.pid);
    infos
}

/// In‑depth information for a single process (includes environment variables
/// and disk I/O).
pub fn detail(pid: u32) -> Option<ProcessDetail> {
    let mut slot = lock_system();
    let system = slot.get_or_insert_with(System::new_all);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
        false,
        ProcessRefreshKind::everything(),
    );
    let p = system.processes().get(&Pid::from_u32(pid))?;
    let listeners = ports::listening_ports();
    let disk = p.disk_usage();
    Some(ProcessDetail {
        pid: p.pid().as_u32(),
        ppid: p.parent().map(|x| x.as_u32()),
        name: p.name().to_string_lossy().into_owned(),
        cmd: p
            .cmd()
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(" "),
        exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
        memory: p.memory(),
        cpu: p.cpu_usage() / cpu_cores(),
        start_time: p.start_time(),
        ports: listeners.get(&pid).cloned().unwrap_or_default(),
        threads: None,
        environ: p
            .environ()
            .iter()
            .map(|e| e.to_string_lossy().into_owned())
            .collect(),
        disk_read_bytes: disk.total_read_bytes,
        disk_write_bytes: disk.total_written_bytes,
    })
}

/// Force-kill `root` and every descendant (children first). Returns the number
/// of processes terminated.
pub fn kill_tree(root: u32) -> Result<usize, String> {
    let mut slot = lock_system();
    let system = slot.get_or_insert_with(System::new_all);
    system.refresh_processes(ProcessesToUpdate::All, true);

    if system.processes().get(&Pid::from_u32(root)).is_none() {
        return Err("process not found".into());
    }

    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, p) in system.processes() {
        if let Some(parent) = p.parent() {
            children.entry(parent.as_u32()).or_default().push(pid.as_u32());
        }
    }

    // BFS from root; reversed, children are killed before their parent.
    let mut order = Vec::new();
    let mut seen = HashSet::from([root]);
    let mut stack = vec![root];
    while let Some(pid) = stack.pop() {
        order.push(pid);
        if let Some(kids) = children.get(&pid) {
            for &kid in kids {
                if seen.insert(kid) {
                    stack.push(kid);
                }
            }
        }
    }

    let mut killed = 0;
    for pid in order.iter().rev() {
        if let Some(p) = system.processes().get(&Pid::from_u32(*pid)) {
            if p.kill() {
                killed += 1;
            }
        }
    }
    if killed == 0 {
        return Err("permission denied".into());
    }
    Ok(killed)
}
