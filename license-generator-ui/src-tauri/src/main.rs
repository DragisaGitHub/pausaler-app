#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod licensing;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct GenerateLicenseArgs {
  #[serde(alias = "activationCode")]
  activation_code: String,
  #[serde(alias = "licenseType")]
  license_type: String,
}

#[tauri::command]
fn generate_license(args: GenerateLicenseArgs) -> Result<String, String> {
  licensing::generate_license(&args.activation_code, &args.license_type).map_err(|e| e.to_string())
}

#[tauri::command]
fn public_key_pem() -> Result<String, String> {
  licensing::public_key_pem().map_err(|e| e.to_string())
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![generate_license, public_key_pem])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
