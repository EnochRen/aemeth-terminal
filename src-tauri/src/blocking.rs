//! Keep blocking OS work off both the window event loop and async workers.

pub async fn run<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("background task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn slow_work_does_not_block_other_commands() {
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let slow = tauri::async_runtime::spawn(run(move || {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            Ok(())
        }));
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();

        let (responsive_tx, responsive_rx) = mpsc::channel();
        tauri::async_runtime::spawn(async move {
            responsive_tx.send(run(|| Ok(42)).await).unwrap();
        });
        let result = responsive_rx.recv_timeout(Duration::from_secs(2));
        release_tx.send(()).unwrap();
        tauri::async_runtime::block_on(slow).unwrap().unwrap();
        assert_eq!(result.unwrap().unwrap(), 42);
    }

    #[test]
    fn errors_and_worker_panics_reach_the_caller() {
        assert_eq!(
            tauri::async_runtime::block_on(run(|| Err::<(), _>("denied".into()))),
            Err("denied".into())
        );
        let result = tauri::async_runtime::block_on(run(|| -> Result<(), String> {
            panic!("worker panic")
        }));
        assert!(result.unwrap_err().contains("background task failed"));
    }
}
