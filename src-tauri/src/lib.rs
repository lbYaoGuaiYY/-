#[cfg(all(desktop, feature = "processor"))]
use std::{fs, path::PathBuf, sync::Mutex};
#[cfg(all(desktop, feature = "processor"))]
use tauri::{
  menu::{Menu, MenuItem, MenuItemBuilder, PredefinedMenuItem},
  tray::TrayIconBuilder,
  AppHandle, Emitter, Manager, RunEvent,
};
#[cfg(all(desktop, feature = "processor"))]
use tauri_plugin_shell::{process::CommandChild, process::CommandEvent, ShellExt};
#[cfg(all(desktop, feature = "processor"))]
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg(all(desktop, feature = "processor"))]
const PROCESSOR_WINDOW_LABEL: &str = "processor";
#[cfg(all(desktop, feature = "processor"))]
const PROCESSOR_DEEP_LINK_PREFIX: &str = "qingshe-processor://open?";

#[cfg(all(desktop, feature = "processor"))]
fn is_uuid(value: &str) -> bool {
  value.len() == 36
    && value
      .bytes()
      .enumerate()
      .all(|(index, byte)| match index {
        8 | 13 | 18 | 23 => byte == b'-',
        _ => byte.is_ascii_hexdigit(),
      })
}

#[cfg(all(desktop, feature = "processor"))]
fn processor_client_id_from_url(value: &str) -> Option<String> {
  let query = value.strip_prefix(PROCESSOR_DEEP_LINK_PREFIX)?;
  query.split('&').find_map(|pair| {
    let (key, client_id) = pair.split_once('=')?;
    (key == "client_id" && is_uuid(client_id)).then(|| client_id.to_ascii_lowercase())
  })
}

#[cfg(all(desktop, feature = "processor"))]
fn processor_panel_client_path() -> Result<PathBuf, String> {
  #[cfg(target_os = "macos")]
  let directory = std::env::var_os("HOME")
    .map(PathBuf::from)
    .map(|home| home.join("Library/Application Support/轻抠"));
  #[cfg(target_os = "windows")]
  let directory = std::env::var_os("APPDATA")
    .map(PathBuf::from)
    .map(|app_data| app_data.join("轻抠"));
  #[cfg(target_os = "linux")]
  let directory = std::env::var_os("XDG_CONFIG_HOME")
    .map(PathBuf::from)
    .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    .map(|config| config.join("qingshe-processor"));
  directory
    .map(|path| path.join("panel-client.json"))
    .ok_or_else(|| "无法确定轻抠配置目录".to_string())
}

#[cfg(all(desktop, feature = "processor"))]
fn associate_processor_with_panel(value: &str) -> Result<(), String> {
  let client_id = processor_client_id_from_url(value)
    .ok_or_else(|| "轻抠启动链接无效".to_string())?;
  let path = processor_panel_client_path()?;
  let parent = path
    .parent()
    .ok_or_else(|| "轻抠配置目录无效".to_string())?;
  fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  let temporary = path.with_extension("tmp");
  let payload = serde_json::to_vec(&serde_json::json!({ "client_id": client_id }))
    .map_err(|error| error.to_string())?;
  fs::write(&temporary, payload).map_err(|error| error.to_string())?;
  fs::rename(temporary, path).map_err(|error| error.to_string())?;
  Ok(())
}

#[cfg(all(desktop, feature = "processor"))]
fn setup_processor_deep_links(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  if let Some(urls) = app.deep_link().get_current()? {
    for url in urls {
      let _ = associate_processor_with_panel(url.as_str());
    }
  }
  app.deep_link().on_open_url(|event| {
    for url in event.urls() {
      let _ = associate_processor_with_panel(url.as_str());
    }
  });
  Ok(())
}

#[cfg(all(desktop, feature = "processor"))]
#[derive(Default)]
struct ProcessorState(Mutex<Option<CommandChild>>);

#[cfg(all(desktop, feature = "processor"))]
struct ProcessorTray {
  status_item: MenuItem<tauri::Wry>,
  tray_id: String,
}

#[cfg(all(desktop, feature = "processor"))]
fn status_label(state: &str, detail: &str) -> String {
  match state {
    "ready" => "状态：已连接".into(),
    "processing" => {
      let name = detail.strip_prefix("正在处理：").unwrap_or(detail);
      if name.is_empty() {
        "状态：正在抠图".into()
      } else {
        format!("状态：正在抠图 · {name}")
      }
    }
    "pairing" => "状态：正在启动".into(),
    "error" => format!("状态：异常 · {detail}"),
    "stopped" => "状态：已停止".into(),
    _ => "状态：正在启动".into(),
  }
}

#[cfg(all(desktop, feature = "processor"))]
fn tooltip_label(state: &str, detail: &str) -> String {
  match state {
    "ready" => "轻抠 · 已连接".into(),
    "processing" => {
      let name = detail.strip_prefix("正在处理：").unwrap_or(detail);
      if name.is_empty() {
        "轻抠 · 正在抠图".into()
      } else {
        format!("轻抠 · 正在抠图 · {name}")
      }
    }
    "pairing" => "轻抠 · 正在启动".into(),
    "error" => format!("轻抠 · 异常：{detail}"),
    "stopped" => "轻抠 · 已停止".into(),
    _ => "轻抠 · 正在启动".into(),
  }
}

#[cfg(all(desktop, feature = "processor"))]
fn apply_processor_status(app: &AppHandle, state: &str, detail: &str) {
  let label = status_label(state, detail);
  let tip = tooltip_label(state, detail);
  if let Some(ui) = app.try_state::<ProcessorTray>() {
    let _ = ui.status_item.set_text(label);
    if let Some(tray) = app.tray_by_id(&ui.tray_id) {
      let _ = tray.set_tooltip(Some(tip));
    }
  }
}

#[cfg(all(desktop, feature = "processor"))]
fn handle_sidecar_line(app: &AppHandle, line: &str) {
  let trimmed = line.trim();
  if trimmed.is_empty() {
    return;
  }
  let _ = app.emit("processor://event", trimmed);
  if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
    if value.get("type").and_then(|v| v.as_str()) == Some("status") {
      let state = value
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("connecting");
      let detail = value.get("detail").and_then(|v| v.as_str()).unwrap_or("");
      apply_processor_status(app, state, detail);
      return;
    }
    if value.get("type").and_then(|v| v.as_str()) == Some("completed") {
      let name = value
        .get("task_name")
        .and_then(|v| v.as_str())
        .unwrap_or("任务");
      apply_processor_status(app, "ready", &format!("刚完成：{name}"));
    }
  }
}

#[cfg(all(desktop, feature = "processor"))]
fn processor_start(app: AppHandle, state: tauri::State<'_, ProcessorState>) -> Result<(), String> {
  let mut child_slot = state
    .0
    .lock()
    .map_err(|_| "轻抠状态锁定失败".to_string())?;
  if child_slot.is_some() {
    return Ok(());
  }
  let command = app
    .shell()
    .sidecar("qingshe-processing-agent")
    .map_err(|error| format!("本地抠图引擎不可用：{error}"))?;
  let (mut events, child) = command
    .spawn()
    .map_err(|error| format!("本地抠图引擎启动失败：{error}"))?;
  *child_slot = Some(child);
  drop(child_slot);

  apply_processor_status(&app, "connecting", "正在启动本地处理…");
  let handle = app.clone();
  tauri::async_runtime::spawn(async move {
    while let Some(event) = events.recv().await {
      match event {
        CommandEvent::Stdout(line) => {
          let payload = String::from_utf8_lossy(&line).trim().to_string();
          handle_sidecar_line(&handle, &payload);
        }
        CommandEvent::Stderr(_) => {
          apply_processor_status(&handle, "error", "本地抠图引擎运行异常");
          let _ = handle.emit(
            "processor://event",
            r#"{"type":"status","state":"error","detail":"本地抠图引擎运行异常"}"#,
          );
        }
        CommandEvent::Terminated(_) => {
          if let Ok(mut slot) = handle.state::<ProcessorState>().0.lock() {
            slot.take();
          }
          apply_processor_status(&handle, "stopped", "本地抠图引擎已停止");
          let _ = handle.emit(
            "processor://event",
            r#"{"type":"status","state":"stopped","detail":"本地抠图引擎已停止"}"#,
          );
        }
        _ => {}
      }
    }
  });
  Ok(())
}

#[cfg(all(desktop, feature = "processor"))]
fn processor_exit(app: &AppHandle) -> Result<(), String> {
  if let Some(child) = app
    .state::<ProcessorState>()
    .0
    .lock()
    .map_err(|_| "轻抠状态锁定失败".to_string())?
    .take()
  {
    child.kill().map_err(|error| error.to_string())?;
  }
  app.exit(0);
  Ok(())
}

#[cfg(all(desktop, feature = "processor"))]

#[tauri::command]
#[cfg(all(desktop, feature = "processor"))]
fn processor_open_panel(app: tauri::AppHandle) {
  let _ = app.shell().open("https://assets.xiduoduo.top/admin/asset-admin.html", None);
}

#[tauri::command]
#[cfg(all(desktop, feature = "processor"))]
fn processor_minimize(app: tauri::AppHandle) {
  if let Some(window) = tauri::Manager::get_webview_window(&app, PROCESSOR_WINDOW_LABEL) {
    let _ = window.hide();
  }
}

#[tauri::command]
#[cfg(all(desktop, feature = "processor"))]
fn processor_exit_command(app: tauri::AppHandle) -> Result<(), String> {
  processor_exit(&app)
}

#[cfg(all(desktop, feature = "processor"))]
fn setup_processor_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  #[cfg(target_os = "macos")]
  app.set_activation_policy(tauri::ActivationPolicy::Accessory);

  if let Some(window) = app.get_webview_window(PROCESSOR_WINDOW_LABEL) {
    let _ = window.hide();
  }

  let status_item = MenuItemBuilder::with_id("status", "状态：正在启动…")
    .enabled(false)
    .build(app)?;
  let quit = MenuItemBuilder::with_id("quit", "退出轻抠").build(app)?;
  let separator = PredefinedMenuItem::separator(app)?;
  let menu = Menu::with_items(app, &[&status_item, &separator, &quit])?;

  let icon = app
    .default_window_icon()
    .cloned()
    .ok_or_else(|| "缺少轻抠托盘图标".to_string())?;
  let tray_id = "qingkou".to_string();
  TrayIconBuilder::with_id(tray_id.clone())
    .icon(icon)
    .tooltip("轻抠 · 正在启动")
    .menu(&menu)
    .show_menu_on_left_click(true)
    .on_menu_event(|app, event| match event.id().as_ref() {
      "quit" => {
        let _ = processor_exit(app);
      }
      _ => {}
    })
    .build(app)?;

  app.manage(ProcessorTray {
    status_item,
    tray_id,
  });
  app.manage(ProcessorState::default());

  let handle = app.handle().clone();
  processor_start(handle.clone(), handle.state::<ProcessorState>())?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
  let builder = tauri::Builder::default();

  #[cfg(all(desktop, feature = "processor"))]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
    for argument in argv {
      let _ = associate_processor_with_panel(&argument);
    }
  }));

  let builder = builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init());

  #[cfg(all(desktop, feature = "processor"))]
  {
    let app = builder
      .plugin(tauri_plugin_deep_link::init())
      .plugin(tauri_plugin_shell::init())
      .invoke_handler(tauri::generate_handler![
        processor_open_panel,
        processor_minimize,
        processor_exit_command
      ])
      .setup(|app| {
        setup_processor_deep_links(app).map_err(|error| -> Box<dyn std::error::Error> {
          Box::new(std::io::Error::other(error.to_string()))
        })?;
        setup_processor_tray(app).map_err(|error| -> Box<dyn std::error::Error> {
          Box::new(std::io::Error::other(error.to_string()))
        })?;
        Ok(())
      })
      .build(tauri::generate_context!())?;

    app.run(|app_handle, event| {
      if let RunEvent::WindowEvent {
        label,
        event: tauri::WindowEvent::CloseRequested { api, .. },
        ..
      } = &event
      {
        if label == PROCESSOR_WINDOW_LABEL {
          api.prevent_close();
          if let Some(window) = app_handle.get_webview_window(PROCESSOR_WINDOW_LABEL) {
            let _ = window.hide();
          }
        }
      }
    });
    return Ok(());
  }

  #[cfg(not(all(desktop, feature = "processor")))]
  {
    builder.run(tauri::generate_context!())?;
    Ok(())
  }
}
