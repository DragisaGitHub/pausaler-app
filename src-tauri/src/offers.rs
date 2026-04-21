use std::sync::Arc;

use lettre::message::{Mailbox, Message, MultiPart, SinglePart};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    escape_html, format_money, now_iso, read_settings_from_conn, send_email_via_smtp,
    validate_smtp_settings, DbState, Settings,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum OfferStatus {
    Draft,
    Sent,
    Failed,
}

impl OfferStatus {
    fn as_str(&self) -> &'static str {
        match self {
            OfferStatus::Draft => "DRAFT",
            OfferStatus::Sent => "SENT",
            OfferStatus::Failed => "FAILED",
        }
    }
}

fn default_offer_status() -> OfferStatus {
    OfferStatus::Draft
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub id: String,
    pub client_email: String,
    pub client_name: String,
    pub subject: String,
    pub body: String,
    pub amount: f64,
    pub currency: String,
    pub valid_until: String,
    #[serde(default = "default_offer_status")]
    pub status: OfferStatus,
    pub created_at: String,
    #[serde(default)]
    pub sent_at: Option<String>,
    #[serde(default)]
    pub failed_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewOffer {
    pub client_email: String,
    pub client_name: String,
    pub subject: String,
    pub body: String,
    pub amount: f64,
    pub currency: String,
    pub valid_until: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferPatch {
    #[serde(default)]
    pub client_email: Option<String>,
    #[serde(default)]
    pub client_name: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub valid_until: Option<String>,
    #[serde(default)]
    pub status: Option<OfferStatus>,
    #[serde(default)]
    pub sent_at: Option<Option<String>>,
    #[serde(default)]
    pub failed_reason: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendOfferEmailInput {
    pub offer_id: String,
}

fn required_trimmed(value: String, field_name: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(format!("{field_name} is required."));
    }
    Ok(value)
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn validate_offer(offer: &Offer) -> Result<(), String> {
    if offer.client_email.trim().is_empty() {
        return Err("Client email is required.".to_string());
    }
    if offer.client_name.trim().is_empty() {
        return Err("Client name is required.".to_string());
    }
    if offer.subject.trim().is_empty() {
        return Err("Subject is required.".to_string());
    }
    if offer.body.trim().is_empty() {
        return Err("Body is required.".to_string());
    }
    if !offer.amount.is_finite() || offer.amount <= 0.0 {
        return Err("Amount must be greater than 0.".to_string());
    }
    if offer.currency.trim().is_empty() {
        return Err("Currency is required.".to_string());
    }
    if offer.valid_until.trim().is_empty() {
        return Err("Valid until date is required.".to_string());
    }
    Ok(())
}

fn validation_to_sql_error(message: String) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        message,
    )))
}

fn read_offer_from_conn(conn: &Connection, id: &str) -> Result<Option<Offer>, rusqlite::Error> {
    let json: Option<String> = conn
        .query_row(
            "SELECT data_json FROM offers WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;

    Ok(json.and_then(|j| serde_json::from_str::<Offer>(&j).ok()))
}

fn insert_offer(conn: &Connection, offer: &Offer) -> Result<(), rusqlite::Error> {
    let json = serde_json::to_string(offer).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        r#"INSERT INTO offers (
                id, clientEmail, clientName, subject, body, amount, currency, validUntil,
                status, createdAt, sentAt, failedReason, data_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"#,
        params![
            offer.id,
            offer.client_email,
            offer.client_name,
            offer.subject,
            offer.body,
            offer.amount,
            offer.currency,
            offer.valid_until,
            offer.status.as_str(),
            offer.created_at,
            offer.sent_at,
            offer.failed_reason,
            json,
        ],
    )?;
    Ok(())
}

fn persist_offer(conn: &Connection, offer: &Offer) -> Result<(), rusqlite::Error> {
    let json = serde_json::to_string(offer).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        r#"UPDATE offers
           SET clientEmail=?2,
               clientName=?3,
               subject=?4,
               body=?5,
               amount=?6,
               currency=?7,
               validUntil=?8,
               status=?9,
               sentAt=?10,
               failedReason=?11,
               data_json=?12
           WHERE id=?1"#,
        params![
            offer.id,
            offer.client_email,
            offer.client_name,
            offer.subject,
            offer.body,
            offer.amount,
            offer.currency,
            offer.valid_until,
            offer.status.as_str(),
            offer.sent_at,
            offer.failed_reason,
            json,
        ],
    )?;
    Ok(())
}

fn render_offer_email(settings: &Settings, offer: &Offer) -> (String, String) {
    let company_name = if settings.company_name.trim().is_empty() {
        "Pausaler".to_string()
    } else {
        settings.company_name.trim().to_string()
    };

    let safe_company_name = escape_html(&company_name);
    let safe_client_name = escape_html(&offer.client_name);
    let safe_subject = escape_html(&offer.subject);
    let safe_body = escape_html(&offer.body).replace('\n', "<br />");
    let amount = format_money(offer.amount);
    let safe_currency = escape_html(&offer.currency);
    let safe_valid_until = escape_html(&offer.valid_until);

    let html = format!(
        "<!DOCTYPE html><html><body style=\"font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.6;\"><div style=\"max-width:640px;margin:0 auto;padding:24px;\"><p style=\"margin:0 0 16px;\">Poštovani/a {safe_client_name},</p><p style=\"margin:0 0 16px;\">U nastavku je ponuda iz kompanije <strong>{safe_company_name}</strong>.</p><div style=\"border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:0 0 20px;\"><h2 style=\"margin:0 0 12px;font-size:20px;\">{safe_subject}</h2><p style=\"margin:0 0 12px;\">{safe_body}</p><table style=\"width:100%;border-collapse:collapse;\"><tr><td style=\"padding:8px 0;color:#6b7280;\">Iznos</td><td style=\"padding:8px 0;text-align:right;font-weight:600;\">{amount} {safe_currency}</td></tr><tr><td style=\"padding:8px 0;color:#6b7280;\">Važi do</td><td style=\"padding:8px 0;text-align:right;\">{safe_valid_until}</td></tr></table></div><p style=\"margin:0;color:#6b7280;\">Poslato iz aplikacije Pausaler.</p></div></body></html>"
    );

    let text = format!(
        "Poštovani/a {},\n\nU nastavku je ponuda iz kompanije {}.\n\n{}\n\n{}\n\nIznos: {} {}\nVaži do: {}\n\nPoslato iz aplikacije Pausaler.",
        offer.client_name,
        company_name,
        offer.subject,
        offer.body,
        amount,
        offer.currency,
        offer.valid_until,
    );

    (html, text)
}

#[tauri::command]
pub(crate) async fn get_all_offers(state: tauri::State<'_, DbState>) -> Result<Vec<Offer>, String> {
    state
        .with_read("get_all_offers", |conn| {
            let mut stmt = conn.prepare("SELECT data_json FROM offers ORDER BY createdAt DESC")?;
            let mut rows = stmt.query([])?;
            let mut out: Vec<Offer> = Vec::new();
            while let Some(row) = rows.next()? {
                let json: String = row.get(0)?;
                if let Ok(offer) = serde_json::from_str::<Offer>(&json) {
                    out.push(offer);
                }
            }
            Ok(out)
        })
        .await
}

#[tauri::command]
pub(crate) async fn get_offer_by_id(
    state: tauri::State<'_, DbState>,
    id: String,
) -> Result<Option<Offer>, String> {
    state
        .with_read("get_offer_by_id", move |conn| read_offer_from_conn(conn, &id))
        .await
}

#[tauri::command]
pub(crate) async fn create_offer(
    state: tauri::State<'_, DbState>,
    input: NewOffer,
) -> Result<Offer, String> {
    let created = Offer {
        id: Uuid::new_v4().to_string(),
        client_email: required_trimmed(input.client_email, "Client email")?,
        client_name: required_trimmed(input.client_name, "Client name")?,
        subject: required_trimmed(input.subject, "Subject")?,
        body: required_trimmed(input.body, "Body")?,
        amount: input.amount,
        currency: required_trimmed(input.currency, "Currency")?,
        valid_until: required_trimmed(input.valid_until, "Valid until date")?,
        status: OfferStatus::Draft,
        created_at: now_iso(),
        sent_at: None,
        failed_reason: None,
    };

    validate_offer(&created)?;

    state
        .with_write("create_offer", move |conn| {
            insert_offer(conn, &created)?;
            Ok(created)
        })
        .await
}

#[tauri::command]
pub(crate) async fn update_offer(
    state: tauri::State<'_, DbState>,
    id: String,
    patch: OfferPatch,
) -> Result<Option<Offer>, String> {
    if let Some(amount) = patch.amount {
        if !amount.is_finite() || amount <= 0.0 {
            return Err("Amount must be greater than 0.".to_string());
        }
    }

    state
        .with_write("update_offer", move |conn| {
            let mut existing = match read_offer_from_conn(conn, &id)? {
                Some(offer) => offer,
                None => return Ok(None),
            };

            if let Some(value) = patch.client_email {
                existing.client_email = value.trim().to_string();
            }
            if let Some(value) = patch.client_name {
                existing.client_name = value.trim().to_string();
            }
            if let Some(value) = patch.subject {
                existing.subject = value.trim().to_string();
            }
            if let Some(value) = patch.body {
                existing.body = value.trim().to_string();
            }
            if let Some(value) = patch.amount {
                existing.amount = value;
            }
            if let Some(value) = patch.currency {
                existing.currency = value.trim().to_string();
            }
            if let Some(value) = patch.valid_until {
                existing.valid_until = value.trim().to_string();
            }
            if let Some(value) = patch.status {
                existing.status = value;
            }
            if let Some(value) = patch.sent_at {
                existing.sent_at = normalize_optional_string(value);
            }
            if let Some(value) = patch.failed_reason {
                existing.failed_reason = normalize_optional_string(value);
            }

            validate_offer(&existing).map_err(validation_to_sql_error)?;
            persist_offer(conn, &existing)?;
            Ok(Some(existing))
        })
        .await
}

#[tauri::command]
pub(crate) async fn delete_offer(
    state: tauri::State<'_, DbState>,
    id: String,
) -> Result<bool, String> {
    state
        .with_write("delete_offer", move |conn| {
            let affected = conn.execute("DELETE FROM offers WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
        .await
}

#[tauri::command]
pub(crate) async fn send_offer_email(
    state: tauri::State<'_, DbState>,
    input: SendOfferEmailInput,
) -> Result<bool, String> {
    let offer_id = input.offer_id;
    let (settings, offer) = state
        .with_read("send_offer_email_prepare", move |conn| {
            let settings = read_settings_from_conn(conn)?;
            let offer = read_offer_from_conn(conn, &offer_id)?
                .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;
            Ok((settings, offer))
        })
        .await
        .map_err(|e| {
            if e.contains("QueryReturnedNoRows") {
                "Offer not found".to_string()
            } else {
                e
            }
        })?;

    validate_smtp_settings(&settings)?;

    let to = offer.client_email.trim().to_string();
    let subject = offer.subject.trim().to_string();
    if to.is_empty() {
        return Err("Recipient email address is required.".to_string());
    }
    if subject.is_empty() {
        return Err("Email subject is required.".to_string());
    }

    let from_mailbox: Mailbox = settings
        .smtp_from
        .parse()
        .map_err(|_| "Invalid From address in SMTP settings.".to_string())?;
    let to_mailbox: Mailbox = to
        .parse()
        .map_err(|_| "Invalid recipient email address.".to_string())?;

    let (html_body, text_body) = render_offer_email(&settings, &offer);
    let email = Message::builder()
        .from(from_mailbox)
        .to(to_mailbox)
        .subject(subject)
        .multipart(
            MultiPart::alternative()
                .singlepart(SinglePart::plain(text_body))
                .singlepart(SinglePart::html(html_body)),
        )
        .map_err(|e| format!("Failed to build email: {e}"))?;

    let send_result = send_email_via_smtp(Arc::new(settings), email, "offer").await;

    match send_result {
        Ok(()) => {
            let sent_at = now_iso();
            let offer_id = offer.id.clone();
            state
                .with_write("send_offer_email_mark_sent", move |conn| {
                    let mut existing = match read_offer_from_conn(conn, &offer_id)? {
                        Some(offer) => offer,
                        None => return Err(rusqlite::Error::QueryReturnedNoRows),
                    };
                    existing.status = OfferStatus::Sent;
                    existing.sent_at = Some(sent_at);
                    existing.failed_reason = None;
                    persist_offer(conn, &existing)?;
                    Ok(true)
                })
                .await
                .map_err(|e| format!("Email sent, but failed to persist SENT status: {e}"))
        }
        Err(err) => {
            let failure_reason = err.clone();
            let offer_id = offer.id.clone();
            match state
                .with_write("send_offer_email_mark_failed", move |conn| {
                    let mut existing = match read_offer_from_conn(conn, &offer_id)? {
                        Some(offer) => offer,
                        None => return Err(rusqlite::Error::QueryReturnedNoRows),
                    };
                    existing.status = OfferStatus::Failed;
                    existing.sent_at = None;
                    existing.failed_reason = Some(failure_reason);
                    persist_offer(conn, &existing)?;
                    Ok(())
                })
                .await
            {
                Ok(()) => Err(err),
                Err(persist_err) => Err(format!(
                    "{err} (also failed to persist FAILED status: {persist_err})"
                )),
            }
        }
    }
}