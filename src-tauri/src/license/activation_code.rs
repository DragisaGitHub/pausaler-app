use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};

use super::crypto::base64url_encode;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivationCodePayload {
    pub pib_hash: String,
    pub issued_at: i64,
    pub nonce: String,
    pub app_id: String,
}

pub fn generate_activation_code(pib_hash: String, app_id: String, issued_at: i64) -> Result<String, String> {
    let mut nonce_bytes = [0u8; 16];
    OsRng.fill_bytes(&mut nonce_bytes);

    let payload = ActivationCodePayload {
        pib_hash,
        issued_at,
        nonce: base64url_encode(&nonce_bytes),
        app_id,
    };

    let json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    Ok(base64url_encode(&json))
}
