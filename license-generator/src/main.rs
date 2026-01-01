use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use clap::{Parser, Subcommand, ValueEnum};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime};

const EXPECTED_APP_ID: &str = "com.dstankovski.pausaler-app";

const DEV_PRIVATE_KEY_SEED_HEX: &str =
  "c590af4308cc0f6a1a4faccf7c05ff00b3d7d4d38a9ad52b1af10f0c6b3a3f10";

#[derive(Parser, Debug)]
#[command(name = "license-generator")]
struct Cli {
  #[command(subcommand)]
  command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
  Generate {
    #[arg(long)]
    activation_code: String,

    #[arg(long, value_enum)]
    r#type: LicenseKind,
  },

  PublicKey,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum LicenseKind {
  Yearly,
  Lifetime,
}

#[derive(Debug, Deserialize)]
struct ActivationCodePayload {
  pib_hash: String,
  issued_at: i64,
  nonce: String,
  app_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum LicenseType {
  Yearly,
  Lifetime,
}

#[derive(Debug, Serialize)]
struct LicensePayload {
  license_type: LicenseType,
  valid_from: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  valid_until: Option<String>,
  pib_hash: String,
}

fn main() -> anyhow::Result<()> {
  let cli = Cli::parse();

  match cli.command {
    Command::Generate {
      activation_code,
      r#type,
    } => {
      let activation = decode_activation_code(&activation_code)?;
      if activation.app_id != EXPECTED_APP_ID {
        anyhow::bail!(
          "activation code app_id mismatch: expected {}, got {}",
          EXPECTED_APP_ID,
          activation.app_id
        );
      }

      let now = OffsetDateTime::now_utc().replace_nanosecond(0)?;
      let valid_from = now.format(&time::format_description::well_known::Rfc3339)?;

      let (license_type, valid_until) = match r#type {
        LicenseKind::Yearly => {
          let until = (now + Duration::days(365))
            .replace_nanosecond(0)?
            .format(&time::format_description::well_known::Rfc3339)?;
          (LicenseType::Yearly, Some(until))
        }
        LicenseKind::Lifetime => (LicenseType::Lifetime, None),
      };

      let payload = LicensePayload {
        license_type,
        valid_from,
        valid_until,
        pib_hash: activation.pib_hash,
      };

      let payload_bytes = serde_json::to_vec(&payload)?;
      let signature_bytes = signing_key_from_dev_seed()?.sign(&payload_bytes).to_bytes();

      let payload_b64 = URL_SAFE_NO_PAD.encode(payload_bytes);
      let sig_b64 = URL_SAFE_NO_PAD.encode(signature_bytes);

      println!("{}.{}", payload_b64, sig_b64);
    }

    Command::PublicKey => {
      let sk = signing_key_from_dev_seed()?;
      let vk = sk.verifying_key();

      let prefix: [u8; 12] = [
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
      ];

      let mut der = Vec::with_capacity(44);
      der.extend_from_slice(&prefix);
      der.extend_from_slice(&vk.to_bytes());

      let b64 = base64::engine::general_purpose::STANDARD.encode(der);
      println!("-----BEGIN PUBLIC KEY-----");
      for chunk in b64.as_bytes().chunks(64) {
        println!("{}", std::str::from_utf8(chunk)?);
      }
      println!("-----END PUBLIC KEY-----");
    }
  }

  Ok(())
}

fn decode_activation_code(code: &str) -> anyhow::Result<ActivationCodePayload> {
  let bytes = URL_SAFE_NO_PAD
    .decode(code.trim())
    .map_err(|e| anyhow::anyhow!("invalid activation code base64url: {e}"))?;
  let payload: ActivationCodePayload = serde_json::from_slice(&bytes)
    .map_err(|e| anyhow::anyhow!("invalid activation code json: {e}"))?;

  if payload.pib_hash.is_empty() {
    anyhow::bail!("activation code missing pib_hash");
  }
  if payload.issued_at <= 0 {
    anyhow::bail!("activation code has invalid issued_at");
  }
  if payload.nonce.is_empty() {
    anyhow::bail!("activation code missing nonce");
  }

  Ok(payload)
}

fn signing_key_from_dev_seed() -> anyhow::Result<SigningKey> {
  let seed = hex::decode(DEV_PRIVATE_KEY_SEED_HEX)?;
  if seed.len() != 32 {
    anyhow::bail!("dev seed must be 32 bytes");
  }
  let mut seed_bytes = [0u8; 32];
  seed_bytes.copy_from_slice(&seed);
  Ok(SigningKey::from_bytes(&seed_bytes))
}
