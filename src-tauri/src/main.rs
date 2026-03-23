// Prevents additional console window on Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

/// Fetch a URL's HTML content with timeout
/// This bypasses CORS restrictions that browser fetch has
#[tauri::command]
async fn fetch_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Mozilla/5.0 (compatible; Karakeep/1.0)")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| format!("Fetch failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    // Limit response size to 5MB
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if bytes.len() > 5 * 1024 * 1024 {
        return Err("Response too large (>5MB)".to_string());
    }

    String::from_utf8(bytes.to_vec())
        .or_else(|_| {
            // Try lossy conversion for non-UTF8 pages
            Ok(String::from_utf8_lossy(&bytes).to_string())
        })
}

/// Call Anthropic API from Rust side (keeps API key out of browser devtools)
#[tauri::command]
async fn call_anthropic(
    api_key: String,
    prompt: String,
    model: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 300,
        "messages": [{
            "role": "user",
            "content": prompt
        }]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("Content-Type", "application/json")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Extract text from content array
    if let Some(content) = data.get("content") {
        if let Some(arr) = content.as_array() {
            for item in arr {
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        return Ok(text.to_string());
                    }
                }
            }
        }
    }

    Err("No text content in API response".to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:karakeep.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "create_initial_tables",
                            sql: "
                                CREATE TABLE IF NOT EXISTS bookmarks (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    type TEXT NOT NULL DEFAULT 'link',
                                    url TEXT,
                                    title TEXT NOT NULL,
                                    description TEXT,
                                    content TEXT,
                                    image_url TEXT,
                                    tags TEXT DEFAULT '[]',
                                    summary TEXT,
                                    ai_processed INTEGER DEFAULT 0,
                                    ai_failed INTEGER DEFAULT 0,
                                    created_at TEXT DEFAULT (datetime('now')),
                                    updated_at TEXT DEFAULT (datetime('now'))
                                );

                                CREATE TABLE IF NOT EXISTS settings (
                                    key TEXT PRIMARY KEY,
                                    value TEXT
                                );

                                CREATE INDEX IF NOT EXISTS idx_bookmarks_type ON bookmarks(type);
                                CREATE INDEX IF NOT EXISTS idx_bookmarks_created ON bookmarks(created_at DESC);
                            ",
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![fetch_url, call_anthropic])
        .setup(|app| {
            // Set window properties
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Karakeep");
                #[cfg(debug_assertions)]
                {
                    let _ = window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Karakeep");
}
