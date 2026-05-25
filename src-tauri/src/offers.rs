use std::{io::Cursor, sync::Arc};

use lettre::message::{header::ContentType, Attachment, Mailbox, Message, MultiPart, SinglePart};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    draw_inline_labeled_row, draw_rule_with_thickness, draw_value_only_wrapped, escape_html,
    font_ascent_mm, format_money, now_iso, push_line, read_settings_from_conn, sanitize_filename,
    send_email_via_smtp, validate_smtp_settings, wrap_text_by_width_mm, DbState, Settings,
};

#[derive(Clone, Copy)]
struct OfferPdfLabels {
    document_title: &'static str,
    continuation_title: &'static str,
    body_title: &'static str,
    client_label: &'static str,
    created_at_label: &'static str,
    valid_until_label: &'static str,
    amount_label: &'static str,
    registration_number_label: &'static str,
    vat_id_label: &'static str,
    email_label: &'static str,
    phone_label: &'static str,
    bank_account_label: &'static str,
    footer_generated: &'static str,
}

fn offer_pdf_labels(language: &str) -> OfferPdfLabels {
    if language.to_ascii_lowercase().starts_with("en") {
        OfferPdfLabels {
            document_title: "Offer",
            continuation_title: "Offer continuation",
            body_title: "Offer details",
            client_label: "Client",
            created_at_label: "Created",
            valid_until_label: "Valid until",
            amount_label: "Amount",
            registration_number_label: "Registration no.",
            vat_id_label: "VAT ID",
            email_label: "Email",
            phone_label: "Phone",
            bank_account_label: "Bank account",
            footer_generated: "Generated from Pausaler.",
        }
    } else {
        OfferPdfLabels {
            document_title: "Ponuda",
            continuation_title: "Nastavak ponude",
            body_title: "Sadržaj ponude",
            client_label: "Klijent",
            created_at_label: "Kreirano",
            valid_until_label: "Važi do",
            amount_label: "Iznos",
            registration_number_label: "Matični broj",
            vat_id_label: "PIB",
            email_label: "Email",
            phone_label: "Telefon",
            bank_account_label: "Tekući račun",
            footer_generated: "Generisano iz aplikacije Pausaler.",
        }
    }
}

fn company_name_or_default(settings: &Settings) -> String {
    let company_name = settings.company_name.trim();
    if company_name.is_empty() {
        "Pausaler".to_string()
    } else {
        company_name.to_string()
    }
}

fn display_date_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "-".to_string();
    }
    trimmed
        .split_once('T')
        .map(|(date, _)| date.trim().to_string())
        .filter(|date| !date.is_empty())
        .unwrap_or_else(|| trimmed.to_string())
}

fn build_offer_attachment_filename(offer: &Offer) -> String {
    let client_name = offer.client_name.trim();
    let subject = offer.subject.trim();

    let mut parts: Vec<String> = vec!["ponuda".to_string()];
    if !client_name.is_empty() {
        parts.push(client_name.to_string());
    }
    if !subject.is_empty() {
        parts.push(subject.to_string());
    }

    sanitize_filename(&format!("{}.pdf", parts.join("-")))
}

fn render_offer_email(settings: &Settings) -> (String, String) {
    let company_name = escape_html(&company_name_or_default(settings));
    let is_en = settings.language.to_ascii_lowercase().starts_with("en");

    if is_en {
        let html = format!(
            "<!DOCTYPE html><html><body style=\"font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.6;\"><div style=\"max-width:640px;margin:0 auto;padding:24px;\"><p style=\"margin:0 0 16px;\">Hello,</p><p style=\"margin:0 0 16px;\">Please find the offer attached in PDF format.</p><p style=\"margin:0;\">Best regards,<br />{company_name}</p></div></body></html>"
        );
        let text = format!(
            "Hello,\n\nPlease find the offer attached in PDF format.\n\nBest regards,\n{}",
            company_name_or_default(settings)
        );
        (html, text)
    } else {
        let html = format!(
            "<!DOCTYPE html><html><body style=\"font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.6;\"><div style=\"max-width:640px;margin:0 auto;padding:24px;\"><p style=\"margin:0 0 16px;\">Poštovani,</p><p style=\"margin:0 0 16px;\">u prilogu se nalazi ponuda u PDF formatu.</p><p style=\"margin:0;\">Srdačan pozdrav,<br />{company_name}</p></div></body></html>"
        );
        let text = format!(
            "Poštovani,\n\nu prilogu se nalazi ponuda u PDF formatu.\n\nSrdačan pozdrav,\n{}",
            company_name_or_default(settings)
        );
        (html, text)
    }
}

fn generate_offer_pdf_bytes(settings: &Settings, offer: &Offer) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    use printpdf::{Image, ImageTransform, Mm, PdfDocument};

    static FONT_BYTES: &[u8] = include_bytes!("../assets/DejaVuSans.ttf");

    const PAGE_W: f32 = 210.0;
    const PAGE_H: f32 = 297.0;
    const PAGE_MARGIN_X: f32 = 15.0;
    const PAGE_MARGIN_TOP: f32 = 16.0;
    const PAGE_MARGIN_BOTTOM: f32 = 14.0;
    const FOOTER_RESERVED_Y: f32 = PAGE_MARGIN_BOTTOM + 12.0;
    const BODY_FONT_SIZE: f32 = 10.0;
    const BODY_LINE_HEIGHT: f32 = 5.2;
    const BODY_PARAGRAPH_GAP: f32 = 2.4;
    const BODY_BLANK_LINE_GAP: f32 = 4.2;
    const LOGO_DPI: f32 = 300.0;
    const LOGO_AREA_W: f32 = 52.0;
    const LOGO_GAP: f32 = 6.0;
    const HEADER_ROW_GAP: f32 = 0.8;
    const HEADER_LINE_HEIGHT: f32 = 4.0;

    let labels = offer_pdf_labels(&settings.language);
    let company_name = company_name_or_default(settings);
    let created_at = display_date_value(&offer.created_at);
    let valid_until = display_date_value(&offer.valid_until);
    let amount_display = format!("{} {}", format_money(offer.amount), offer.currency.trim());

    let decoded_logo = settings
        .logo_url
        .trim()
        .strip_prefix("data:")
        .and_then(|_| {
            let raw = settings.logo_url.trim();
            let comma = raw.find(',')?;
            let (meta, data) = raw.split_at(comma);
            if !meta.to_ascii_lowercase().contains(";base64") {
                return None;
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&data[1..])
                .ok()?;
            printpdf::image_crate::load_from_memory(&bytes).ok()
        });

    let (doc, first_page, first_layer) =
        PdfDocument::new(labels.document_title, Mm(PAGE_W), Mm(PAGE_H), "Layer 1");

    let font = doc
        .add_external_font(Cursor::new(FONT_BYTES as &[u8]))
        .map_err(|e| e.to_string())?;
    let font_bold = font.clone();
    let ttf_face = ttf_parser::Face::parse(FONT_BYTES, 0)
        .map_err(|_| "Failed to parse embedded font for measurement".to_string())?;

    let content_left_x = PAGE_MARGIN_X;
    let content_right_x = PAGE_W - PAGE_MARGIN_X;
    let content_width = content_right_x - content_left_x;

    let render_page_header =
        |layer: &printpdf::PdfLayerReference, is_first_page: bool| -> Result<f32, String> {
            let mut y = PAGE_H - PAGE_MARGIN_TOP;

            push_line(layer, &font_bold, &company_name, 13.5, content_left_x, y);
            let issuer_top_y = y + font_ascent_mm(&ttf_face, 13.5);
            y -= 5.0;

            let row1_text_right_x = if decoded_logo.is_some() {
                (content_right_x - LOGO_AREA_W - LOGO_GAP).max(content_left_x)
            } else {
                content_right_x
            };
            let issuer_text_width = (row1_text_right_x - content_left_x).max(10.0);

            let company_address_line = settings.company_address_line.trim();
            let company_postal_code = settings.company_postal_code.trim();
            let company_city = settings.company_city.trim();
            let company_postal_and_city = [company_postal_code, company_city]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            let company_address =
                if !company_address_line.is_empty() && !company_postal_and_city.is_empty() {
                    format!("{}, {}", company_address_line, company_postal_and_city)
                } else if !company_address_line.is_empty() {
                    company_address_line.to_string()
                } else {
                    company_postal_and_city
                };

            #[derive(Clone)]
            struct HeaderRow {
                label: Option<String>,
                value: String,
            }

            let mut issuer_rows: Vec<HeaderRow> = Vec::new();
            if !settings.registration_number.trim().is_empty() {
                issuer_rows.push(HeaderRow {
                    label: Some(labels.registration_number_label.to_string()),
                    value: settings.registration_number.trim().to_string(),
                });
            }
            if !settings.pib.trim().is_empty() {
                issuer_rows.push(HeaderRow {
                    label: Some(labels.vat_id_label.to_string()),
                    value: settings.pib.trim().to_string(),
                });
            }
            if !company_address.trim().is_empty() {
                issuer_rows.push(HeaderRow {
                    label: None,
                    value: company_address,
                });
            }
            if !settings.company_email.trim().is_empty() {
                issuer_rows.push(HeaderRow {
                    label: Some(labels.email_label.to_string()),
                    value: settings.company_email.trim().to_string(),
                });
            }
            if !settings.company_phone.trim().is_empty() {
                issuer_rows.push(HeaderRow {
                    label: Some(labels.phone_label.to_string()),
                    value: settings.company_phone.trim().to_string(),
                });
            }
            if !settings.bank_account.trim().is_empty() {
                issuer_rows.push(HeaderRow {
                    label: Some(labels.bank_account_label.to_string()),
                    value: settings.bank_account.trim().to_string(),
                });
            }

            let mut issuer_y = y;
            for row in issuer_rows {
                if let Some(label) = row.label {
                    issuer_y = draw_inline_labeled_row(
                        layer,
                        &font,
                        &ttf_face,
                        &label,
                        &row.value,
                        8.8,
                        content_left_x,
                        issuer_y,
                        issuer_text_width,
                        HEADER_LINE_HEIGHT,
                        HEADER_ROW_GAP,
                    );
                } else {
                    issuer_y = draw_value_only_wrapped(
                        layer,
                        &font,
                        &ttf_face,
                        &row.value,
                        8.8,
                        content_left_x,
                        issuer_y,
                        issuer_text_width,
                        HEADER_LINE_HEIGHT,
                        HEADER_ROW_GAP,
                    );
                }
            }

            let issuer_block_height = ((PAGE_H - PAGE_MARGIN_TOP - 5.0) - issuer_y).max(0.0);
            let mut logo_height = 0.0;

            if let Some(img) = decoded_logo.as_ref() {
                let px_w = img.width().max(1) as f32;
                let px_h = img.height().max(1) as f32;
                let natural_w_mm = px_w / LOGO_DPI * 25.4;
                let natural_h_mm = px_h / LOGO_DPI * 25.4;
                let logo_box_left = (row1_text_right_x + LOGO_GAP).min(content_right_x);
                let logo_box_right = content_right_x;
                let logo_box_w = (logo_box_right - logo_box_left).max(1.0);
                let target_h = issuer_block_height.max(18.0);
                let scale = (logo_box_w / natural_w_mm.max(1.0))
                    .min(target_h / natural_h_mm.max(1.0))
                    .max(0.01);
                let scaled_w_mm = natural_w_mm * scale;
                let scaled_h_mm = natural_h_mm * scale;
                logo_height = scaled_h_mm;

                let logo_x = (logo_box_right - scaled_w_mm).max(logo_box_left);
                let logo_bottom_y = (issuer_top_y - scaled_h_mm).max(issuer_y + 2.0);
                let image = Image::from_dynamic_image(img);
                image.add_to_layer(
                    layer.clone(),
                    ImageTransform {
                        translate_x: Some(Mm(logo_x)),
                        translate_y: Some(Mm(logo_bottom_y)),
                        rotate: None,
                        scale_x: Some(scale),
                        scale_y: Some(scale),
                        dpi: Some(LOGO_DPI),
                    },
                );
            }

            y = y - issuer_block_height.max(logo_height) - 6.0;
            draw_rule_with_thickness(layer, content_left_x, content_right_x, y, 0.55);
            y -= 10.0;

            let title = if is_first_page {
                labels.document_title
            } else {
                labels.continuation_title
            };
            push_line(layer, &font_bold, title, 18.0, content_left_x, y);
            y -= 7.0;

            if is_first_page {
                let subject = offer.subject.trim();
                if !subject.is_empty() {
                    for line in wrap_text_by_width_mm(&ttf_face, subject, 11.0, content_width) {
                        push_line(layer, &font, &line, 11.0, content_left_x, y);
                        y -= 5.2;
                    }
                    y -= 1.5;
                }

                let column_gap = 10.0;
                let column_width = ((content_width - column_gap) / 2.0).max(20.0);
                let right_column_x = content_left_x + column_width + column_gap;
                let mut left_y = y;
                let mut right_y = y;

                left_y = draw_inline_labeled_row(
                    layer,
                    &font,
                    &ttf_face,
                    labels.client_label,
                    offer.client_name.trim(),
                    9.0,
                    content_left_x,
                    left_y,
                    column_width,
                    4.2,
                    1.0,
                );
                left_y = draw_inline_labeled_row(
                    layer,
                    &font,
                    &ttf_face,
                    labels.created_at_label,
                    &created_at,
                    9.0,
                    content_left_x,
                    left_y,
                    column_width,
                    4.2,
                    1.0,
                );

                right_y = draw_inline_labeled_row(
                    layer,
                    &font,
                    &ttf_face,
                    labels.amount_label,
                    &amount_display,
                    9.0,
                    right_column_x,
                    right_y,
                    column_width,
                    4.2,
                    1.0,
                );
                right_y = draw_inline_labeled_row(
                    layer,
                    &font,
                    &ttf_face,
                    labels.valid_until_label,
                    &valid_until,
                    9.0,
                    right_column_x,
                    right_y,
                    column_width,
                    4.2,
                    1.0,
                );

                y = left_y.min(right_y) - 2.5;
                draw_rule_with_thickness(layer, content_left_x, content_right_x, y, 0.35);
                y -= 8.0;
            } else {
                y -= 2.0;
            }

            push_line(
                layer,
                &font_bold,
                labels.body_title,
                10.5,
                content_left_x,
                y,
            );
            y -= 3.6;
            draw_rule_with_thickness(layer, content_left_x, content_right_x, y, 0.35);
            y -= 7.0;

            let footer_rule_y = PAGE_MARGIN_BOTTOM + 8.0;
            draw_rule_with_thickness(layer, content_left_x, content_right_x, footer_rule_y, 0.25);
            push_line(
                layer,
                &font,
                labels.footer_generated,
                6.2,
                content_left_x,
                PAGE_MARGIN_BOTTOM + 2.0,
            );

            Ok(y)
        };

    let mut layer = doc.get_page(first_page).get_layer(first_layer);
    let mut y = render_page_header(&layer, true)?;

    let body = offer.body.trim();
    if body.is_empty() {
        push_line(&layer, &font, "-", BODY_FONT_SIZE, content_left_x, y);
    } else {
        for raw_line in body.lines() {
            let line = raw_line.trim_end();
            if line.trim().is_empty() {
                if y - BODY_BLANK_LINE_GAP <= FOOTER_RESERVED_Y {
                    let (page, layer_id) = doc.add_page(Mm(PAGE_W), Mm(PAGE_H), "Layer");
                    layer = doc.get_page(page).get_layer(layer_id);
                    y = render_page_header(&layer, false)?;
                } else {
                    y -= BODY_BLANK_LINE_GAP;
                }
                continue;
            }

            let wrapped_lines =
                wrap_text_by_width_mm(&ttf_face, line, BODY_FONT_SIZE, content_width);
            for wrapped_line in wrapped_lines {
                if y - BODY_LINE_HEIGHT <= FOOTER_RESERVED_Y {
                    let (page, layer_id) = doc.add_page(Mm(PAGE_W), Mm(PAGE_H), "Layer");
                    layer = doc.get_page(page).get_layer(layer_id);
                    y = render_page_header(&layer, false)?;
                }

                push_line(
                    &layer,
                    &font,
                    &wrapped_line,
                    BODY_FONT_SIZE,
                    content_left_x,
                    y,
                );
                y -= BODY_LINE_HEIGHT;
            }

            if y - BODY_PARAGRAPH_GAP <= FOOTER_RESERVED_Y {
                let (page, layer_id) = doc.add_page(Mm(PAGE_W), Mm(PAGE_H), "Layer");
                layer = doc.get_page(page).get_layer(layer_id);
                y = render_page_header(&layer, false)?;
            } else {
                y -= BODY_PARAGRAPH_GAP;
            }
        }
    }

    let mut writer = std::io::BufWriter::new(Vec::<u8>::new());
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    writer.into_inner().map_err(|e| e.to_string())
}

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
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
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
        .with_read("get_offer_by_id", move |conn| {
            read_offer_from_conn(conn, &id)
        })
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

    let (html_body, text_body) = render_offer_email(&settings);
    let alternative = MultiPart::alternative()
        .singlepart(SinglePart::plain(text_body))
        .singlepart(SinglePart::html(html_body));

    let pdf_bytes = generate_offer_pdf_bytes(&settings, &offer)?;
    let filename = build_offer_attachment_filename(&offer);
    let content_type = ContentType::parse("application/pdf")
        .map_err(|e| format!("Failed to build PDF attachment content type: {e}"))?;
    let attachment = Attachment::new(filename).body(pdf_bytes, content_type);

    let email = Message::builder()
        .from(from_mailbox)
        .to(to_mailbox)
        .subject(subject)
        .multipart(
            MultiPart::mixed()
                .multipart(alternative)
                .singlepart(attachment),
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
