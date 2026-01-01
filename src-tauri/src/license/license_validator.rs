use ed25519_dalek::VerifyingKey;
use base64::Engine as _;
use serde::Deserialize;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use super::crypto::base64url_decode;
use super::license_payload::{LicenseType, VerifiedLicenseInfo};

fn parse_time_rfc3339(s: &str) -> Result<OffsetDateTime, String> {
    OffsetDateTime::parse(s, &Rfc3339).map_err(|e| format!("invalid datetime: {e}"))
}

fn parse_ed25519_public_key_from_spki_pem(public_key_pem: &str) -> Result<VerifyingKey, String> {
    let mut b64 = String::new();
    for line in public_key_pem.lines() {
        let l = line.trim();
        if l.is_empty() {
            continue;
        }
        if l.starts_with("-----BEGIN") || l.starts_with("-----END") {
            continue;
        }
        b64.push_str(l);
    }

    let der = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| format!("invalid public key pem base64: {e}"))?;

    let prefix: [u8; 12] = [
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    if der.len() != 44 || der[..12] != prefix {
        return Err("unsupported public key format".to_string());
    }

    let mut pk = [0u8; 32];
    pk.copy_from_slice(&der[12..44]);
    VerifyingKey::from_bytes(&pk).map_err(|e| format!("invalid public key bytes: {e}"))
}

fn verify_ed25519_signature(public_key_pem: &str, payload_bytes: &[u8], signature_bytes: &[u8]) -> Result<(), String> {
    let vk = parse_ed25519_public_key_from_spki_pem(public_key_pem)?;

    let sig: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| "invalid signature length".to_string())?;

    vk.verify_strict(payload_bytes, &ed25519_dalek::Signature::from(sig))
        .map_err(|_| "signature verification failed".to_string())
}

#[derive(Debug, Clone, Deserialize)]
struct IncomingLicensePayload {
    pub license_type: LicenseType,
    pub valid_from: String,
    pub valid_until: Option<String>,
    pub pib_hash: String,
}

pub fn verify_license(license_str: &str, expected_pib_hash: &str, public_key_pem: &str, now: OffsetDateTime) -> Result<VerifiedLicenseInfo, String> {
    let parts: Vec<&str> = license_str.split('.').collect();
    if parts.len() != 2 {
        return Ok(VerifiedLicenseInfo {
            license_type: None,
            valid_until: None,
            is_valid: false,
            reason: Some("invalid_format".to_string()),
        });
    }

    let payload_bytes = base64url_decode(parts[0])?;
    let signature_bytes = base64url_decode(parts[1])?;

    let payload: IncomingLicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|e| format!("invalid payload json: {e}"))?;

    if payload.pib_hash != expected_pib_hash {
        return Ok(VerifiedLicenseInfo {
            license_type: Some(format!("{:?}", payload.license_type).to_ascii_uppercase()),
            valid_until: payload.valid_until.clone(),
            is_valid: false,
            reason: Some("pib_mismatch".to_string()),
        });
    }

    verify_ed25519_signature(public_key_pem, &payload_bytes, &signature_bytes)?;

    let valid_from = parse_time_rfc3339(&payload.valid_from)?;
    if now < valid_from {
        return Ok(VerifiedLicenseInfo {
            license_type: Some(format!("{:?}", payload.license_type).to_ascii_uppercase()),
            valid_until: payload.valid_until.clone(),
            is_valid: false,
            reason: Some("not_yet_valid".to_string()),
        });
    }

    match payload.license_type {
        LicenseType::Lifetime => {
            Ok(VerifiedLicenseInfo {
                license_type: Some("LIFETIME".to_string()),
                valid_until: None,
                is_valid: true,
                reason: None,
            })
        }
        LicenseType::Yearly => {
            let until = payload.valid_until.clone().ok_or_else(|| "missing valid_until".to_string())?;
            let valid_until = parse_time_rfc3339(&until)?;
            if now > valid_until {
                return Ok(VerifiedLicenseInfo {
                    license_type: Some("YEARLY".to_string()),
                    valid_until: Some(until),
                    is_valid: false,
                    reason: Some("expired".to_string()),
                });
            }

            Ok(VerifiedLicenseInfo {
                license_type: Some("YEARLY".to_string()),
                valid_until: Some(until),
                is_valid: true,
                reason: None,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::license::license_payload::LicensePayload;
    use crate::license::crypto::base64url_encode;
    use ed25519_dalek::{SigningKey, Signer};

    fn public_key_pem_from_verifying_key(vk: &VerifyingKey) -> String {
        let prefix: [u8; 12] = [
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ];
        let pk = vk.to_bytes();
        let mut der = Vec::with_capacity(44);
        der.extend_from_slice(&prefix);
        der.extend_from_slice(&pk);

        let b64 = base64::engine::general_purpose::STANDARD.encode(der);
        let mut out = String::new();
        out.push_str("-----BEGIN PUBLIC KEY-----\n");
        for chunk in b64.as_bytes().chunks(64) {
            out.push_str(std::str::from_utf8(chunk).unwrap());
            out.push('\n');
        }
        out.push_str("-----END PUBLIC KEY-----\n");
        out
    }

    fn keypair_from_seed(seed: [u8; 32]) -> SigningKey {
        SigningKey::from_bytes(&seed)
    }

    #[test]
    fn verify_fails_on_wrong_pib() {
        let seed = [7u8; 32];
        let sk = keypair_from_seed(seed);
        let vk_pem = public_key_pem_from_verifying_key(&sk.verifying_key());

        let payload = LicensePayload {
            license_type: LicenseType::Lifetime,
            valid_from: "2025-01-01T00:00:00Z".to_string(),
            valid_until: None,
            pib_hash: "aaa".to_string(),
        };

        let payload_bytes = serde_json::to_vec(&payload).unwrap();
        let sig = sk.sign(&payload_bytes);
        let license = format!(
            "{}.{}",
            base64url_encode(&payload_bytes),
            base64url_encode(&sig.to_bytes())
        );

        let now = OffsetDateTime::parse("2025-01-02T00:00:00Z", &Rfc3339).unwrap();
        let res = verify_license(&license, "bbb", &vk_pem, now).unwrap();
        assert!(!res.is_valid);
        assert_eq!(res.reason.as_deref(), Some("pib_mismatch"));
    }

    #[test]
    fn verify_fails_on_expired_yearly() {
        let seed = [9u8; 32];
        let sk = keypair_from_seed(seed);
        let vk_pem = public_key_pem_from_verifying_key(&sk.verifying_key());

        let payload = LicensePayload {
            license_type: LicenseType::Yearly,
            valid_from: "2024-01-01T00:00:00Z".to_string(),
            valid_until: Some("2024-12-31T23:59:59Z".to_string()),
            pib_hash: "hash".to_string(),
        };

        let payload_bytes = serde_json::to_vec(&payload).unwrap();
        let sig = sk.sign(&payload_bytes);
        let license = format!(
            "{}.{}",
            base64url_encode(&payload_bytes),
            base64url_encode(&sig.to_bytes())
        );

        let now = OffsetDateTime::parse("2025-01-01T00:00:00Z", &Rfc3339).unwrap();
        let res = verify_license(&license, "hash", &vk_pem, now).unwrap();
        assert!(!res.is_valid);
        assert_eq!(res.reason.as_deref(), Some("expired"));
    }

    #[test]
    fn verify_fails_on_invalid_signature() {
        let seed = [11u8; 32];
        let sk = keypair_from_seed(seed);
        let vk_pem = public_key_pem_from_verifying_key(&sk.verifying_key());

        let payload = LicensePayload {
            license_type: LicenseType::Lifetime,
            valid_from: "2025-01-01T00:00:00Z".to_string(),
            valid_until: None,
            pib_hash: "hash".to_string(),
        };

        let payload_bytes = serde_json::to_vec(&payload).unwrap();
        let mut bad_sig = [0u8; 64];
        bad_sig[0] = 1;

        let license = format!(
            "{}.{}",
            base64url_encode(&payload_bytes),
            base64url_encode(&bad_sig)
        );

        let now = OffsetDateTime::parse("2025-01-01T00:00:01Z", &Rfc3339).unwrap();
        let res = verify_license(&license, "hash", &vk_pem, now);
        assert!(res.is_err());
    }

    #[test]
    fn verify_succeeds_for_lifetime() {
        let seed = [13u8; 32];
        let sk = keypair_from_seed(seed);
        let vk_pem = public_key_pem_from_verifying_key(&sk.verifying_key());

        let payload = LicensePayload {
            license_type: LicenseType::Lifetime,
            valid_from: "2025-01-01T00:00:00Z".to_string(),
            valid_until: None,
            pib_hash: "hash".to_string(),
        };

        let payload_bytes = serde_json::to_vec(&payload).unwrap();
        let sig = sk.sign(&payload_bytes);

        let license = format!(
            "{}.{}",
            base64url_encode(&payload_bytes),
            base64url_encode(&sig.to_bytes())
        );

        let now = OffsetDateTime::parse("2025-01-01T00:00:01Z", &Rfc3339).unwrap();
        let res = verify_license(&license, "hash", &vk_pem, now).unwrap();
        assert!(res.is_valid);
        assert_eq!(res.license_type.as_deref(), Some("LIFETIME"));
    }
}
