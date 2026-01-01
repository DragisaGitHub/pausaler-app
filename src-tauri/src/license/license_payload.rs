use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LicenseType {
    Yearly,
    Lifetime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct LicensePayload {
    pub license_type: LicenseType,
    pub valid_from: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_until: Option<String>,
    pub pib_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifiedLicenseInfo {
    pub license_type: Option<String>,
    pub valid_until: Option<String>,
    pub is_valid: bool,
    pub reason: Option<String>,
}
