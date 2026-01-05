use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::path::BaseDirectory;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use std::io::Cursor;
use std::sync::OnceLock;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

use lettre::message::{header::ContentType, Attachment, Mailbox, Message, MultiPart, SinglePart};
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{SmtpTransport, Transport};

mod license;

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
struct InvoiceEmailLabelsLocale {
    your_company: String,
    invoice: String,
    intro_with_pdf: String,
    intro_without_pdf: String,
    #[allow(dead_code)]
    company: String,
    #[allow(dead_code)]
    company_registration_number: String,
    #[allow(dead_code)]
    client: String,
    #[allow(dead_code)]
    client_registration_number: String,
    vat_id: String,
    invoice_number: String,
    issue_date: String,
    due_date: String,
    total: String,
    personal_note: String,
    personal_note_with_colon: String,
    bank_account: String,
    generated_from_app: String,
}

#[derive(Debug, Clone, Deserialize)]
struct InvoiceEmailLabelsFile {
    sr: InvoiceEmailLabelsLocale,
    en: InvoiceEmailLabelsLocale,
}

static INVOICE_EMAIL_LABELS: OnceLock<Result<InvoiceEmailLabelsFile, String>> = OnceLock::new();

fn invoice_email_labels(lang: &str) -> Result<InvoiceEmailLabelsLocale, String> {
    let file = INVOICE_EMAIL_LABELS.get_or_init(|| {
        let json = include_str!("../../src/shared/invoiceEmailLabels.json");
        serde_json::from_str::<InvoiceEmailLabelsFile>(json)
            .map_err(|e| format!("Failed to parse embedded src/shared/invoiceEmailLabels.json: {e}"))
    });

    let file = file.as_ref().map_err(|e| e.clone())?;

    let l = lang.to_ascii_lowercase();
    if l.starts_with("en") {
        Ok(file.en.clone())
    } else {
        Ok(file.sr.clone())
    }
}

fn sanity_check_embedded_invoice_email_labels() {
    for lang in ["sr", "en"] {
        if let Err(e) = invoice_email_labels(lang) {
            eprintln!("[labels] invoiceEmailLabels.json unavailable ({lang}): {e}");
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoicePdfCompany {
    pub company_name: String,
    #[serde(alias = "maticni_broj")]
    pub registration_number: String,
    pub pib: String,
    pub address: String,
    #[serde(default, alias = "addressLine")]
    pub address_line: Option<String>,
    #[serde(default, alias = "postalCode")]
    pub postal_code: Option<String>,
    #[serde(default)]
    pub city: Option<String>,
    pub bank_account: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoicePdfClient {
    pub name: String,
    #[serde(alias = "maticni_broj")]
    pub registration_number: Option<String>,
    pub pib: Option<String>,
    pub address: Option<String>,
    #[serde(default, alias = "addressLine")]
    pub address_line: Option<String>,
    #[serde(default, alias = "postalCode")]
    pub postal_code: Option<String>,
    #[serde(default)]
    pub city: Option<String>,
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoicePdfItem {
    pub description: String,
    #[serde(default)]
    pub unit: Option<String>,
    pub quantity: f64,
    pub unit_price: f64,
    #[serde(default, alias = "discountAmount")]
    pub discount_amount: Option<f64>,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoicePdfPayload {
    #[serde(default)]
    pub language: Option<String>,
    pub invoice_number: String,
    pub issue_date: String,
    pub service_date: String,
    pub currency: String,
    pub subtotal: f64,
    #[serde(default)]
    pub discount_total: f64,
    pub total: f64,
    pub notes: Option<String>,
    pub company: InvoicePdfCompany,
    pub client: InvoicePdfClient,
    pub items: Vec<InvoicePdfItem>,
}

fn sanitize_filename(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        let ok = ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' || ch == ' ';
        out.push(if ok { ch } else { '_' });
    }
    let trimmed = out.trim().to_string();
    if trimmed.is_empty() { "invoice".to_string() } else { trimmed }
}

fn format_money(v: f64) -> String {
    let s = format!("{:.2}", v);
    let parts = s.split('.').collect::<Vec<_>>();
    let int_part = parts[0];
    let dec_part = parts.get(1).copied().unwrap_or("00");

    let mut out = String::new();
    let chars: Vec<char> = int_part.chars().collect();
    let mut cnt = 0;
    for i in (0..chars.len()).rev() {
        if cnt == 3 {
            out.push(',');
            cnt = 0;
        }
        out.push(chars[i]);
        cnt += 1;
    }
    let int_with_sep: String = out.chars().rev().collect();
    format!("{}.{}", int_with_sep, dec_part)
}

fn escape_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum SerbiaZipCodeId {
    Num(i64),
    Str(String),
}

impl SerbiaZipCodeId {
    fn as_string(&self) -> String {
        match self {
            SerbiaZipCodeId::Num(n) => n.to_string(),
            SerbiaZipCodeId::Str(s) => s.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct SerbiaZipCodeRaw {
    city: String,
    #[serde(rename = "_id")]
    id: SerbiaZipCodeId,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerbiaCityDto {
    pub city: String,
    pub postal_code: String,
}

static SERBIA_ZIP_CODES_CACHE: OnceLock<Result<Vec<SerbiaCityDto>, String>> = OnceLock::new();

fn normalize_serbian_latin(input: &str) -> String {
    let lower = input.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    for ch in lower.chars() {
        match ch {
            'č' | 'ć' => out.push('c'),
            'š' => out.push('s'),
            'ž' => out.push('z'),
            'đ' => out.push_str("dj"),
            _ => out.push(ch),
        }
    }
    out
}

fn resolve_serbia_zip_codes_path(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(p) = app
        .path()
        .resolve("assets/data/serbia_zip_codes.json", BaseDirectory::Resource)
    {
        candidates.push(p);
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("assets").join("data").join("serbia_zip_codes.json"));
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("assets").join("data").join("serbia_zip_codes.json"));
        candidates.push(
            cwd.join("src-tauri")
                .join("assets")
                .join("data")
                .join("serbia_zip_codes.json"),
        );
    }

    candidates
}

fn load_serbia_zip_codes_from_disk(app: &tauri::AppHandle) -> Result<Vec<SerbiaCityDto>, String> {
    let candidates = resolve_serbia_zip_codes_path(app);
    let path = candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "Unable to locate serbia_zip_codes.json (bundle resource missing?)".to_string())?;

    let json = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read serbia_zip_codes.json at {}: {e}", path.display()))?;

    let mut rows = serde_json::from_str::<Vec<SerbiaZipCodeRaw>>(&json)
        .map_err(|e| format!("Failed to parse serbia_zip_codes.json: {e}"))?
        .into_iter()
        .map(|r| SerbiaCityDto {
            city: r.city.trim().to_string(),
            postal_code: r.id.as_string().trim().to_string(),
        })
        .filter(|r| !r.city.trim().is_empty() && !r.postal_code.trim().is_empty())
        .collect::<Vec<_>>();

    rows.sort_by(|a, b| a.city.cmp(&b.city).then_with(|| a.postal_code.cmp(&b.postal_code)));
    Ok(rows)
}

fn serbia_zip_codes(app: &tauri::AppHandle) -> Result<&'static Vec<SerbiaCityDto>, String> {
    match SERBIA_ZIP_CODES_CACHE.get_or_init(|| load_serbia_zip_codes_from_disk(app)) {
        Ok(v) => Ok(v),
        Err(e) => Err(e.clone()),
    }
}

#[tauri::command]
fn list_serbia_cities(app: tauri::AppHandle, search: Option<String>) -> Result<Vec<SerbiaCityDto>, String> {
    let rows = serbia_zip_codes(&app)?;
    let q = search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_serbian_latin);

    if let Some(q) = q {
        Ok(rows
            .iter()
            .cloned()
            .filter(|r| normalize_serbian_latin(&r.city).contains(&q))
            .collect())
    } else {
        Ok(rows.clone())
    }
}

/// Renders the invoice email body as (html, text).
///
/// - Clean business-style layout, email-client-safe (tables + inline CSS).
/// - Localized (sr/en) based on Settings.language.
/// - User-provided message is rendered as an optional "personal note" section.
fn render_invoice_email(
    settings: &Settings,
    invoice: &Invoice,
    _client: Option<&Client>,
    include_pdf: bool,
    personal_note: Option<&str>,
) -> Result<(String, String), String> {
    let lang = settings.language.to_ascii_lowercase();
    let labels = invoice_email_labels(&lang)?;

    // Fail fast if required labels are missing/empty (no silent fallbacks).
    let require_label = |key: &str, value: &str| -> Result<(), String> {
        if value.trim().is_empty() {
            return Err(format!("Missing required email label: {key}"));
        }
        Ok(())
    };
    require_label("vatId", &labels.vat_id)?;
    require_label("invoiceNumber", &labels.invoice_number)?;
    require_label("issueDate", &labels.issue_date)?;
    require_label("total", &labels.total)?;
    require_label("bankAccount", &labels.bank_account)?;

    // NOTE: Email summary is intentionally issuer-focused.
    // We do not include any buyer/client identifiers in the email body.

    let invoice_number = invoice.invoice_number.trim();
    let issue_date = invoice.issue_date.trim();
    let due_date = invoice.due_date.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let total = format_money(invoice.total);
    let currency = invoice.currency.trim();

    let company_name = settings.company_name.trim();
    let company_name = if company_name.is_empty() { "-" } else { company_name };

    let company_address_line = settings.company_address_line.trim();
    let company_postal_code = settings.company_postal_code.trim();
    let company_city = settings.company_city.trim();
    let company_postal_and_city = [company_postal_code, company_city]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let company_address = if !company_address_line.is_empty() && !company_postal_and_city.is_empty() {
        Some(format!("{}, {}", company_address_line, company_postal_and_city))
    } else if !company_address_line.is_empty() {
        Some(company_address_line.to_string())
    } else if !company_postal_and_city.is_empty() {
        Some(company_postal_and_city)
    } else {
        None
    };

    let vat_id = settings.pib.trim();
    if vat_id.is_empty() {
        return Err("Issuer VAT ID (PIB) is missing in Settings.".to_string());
    }
    let note = personal_note.map(str::trim).filter(|s| !s.is_empty());

    let intro_line = if include_pdf {
        labels.intro_with_pdf.as_str()
    } else {
        labels.intro_without_pdf.as_str()
    };

    let bank_account = settings.bank_account.trim();
    let bank_account = if bank_account.is_empty() {
        None
    } else {
        Some(bank_account)
    };

    // Mandatory global invoice note (always)
    let mandatory_note_text = mandatory_invoice_note_text(&lang, invoice_number);
    let mandatory_note_html = mandatory_invoice_note_html(&lang, invoice_number);

    // ---- Plain-text fallback ----
    let mut text = String::new();
    text.push_str(&labels.invoice);
    text.push_str("\n\n");

    fn push_kv_text(text: &mut String, label: &str, value: &str) {
        let v = value.trim();
        if !v.is_empty() {
            text.push_str(&format!("{}: {}\n", label, v));
        }
    }

    // A) INVOICE / ISSUER DETAILS (TOP BLOCK) — exact order
    push_kv_text(&mut text, &labels.company, company_name);
    if let Some(addr) = company_address.as_deref() {
        let a = addr.trim();
        if !a.is_empty() {
            text.push_str(&format!("  {}\n", a));
        }
    }
    push_kv_text(&mut text, &labels.vat_id, vat_id);
    push_kv_text(&mut text, &labels.invoice_number, invoice_number);
    push_kv_text(&mut text, &labels.issue_date, issue_date);
    if let Some(d) = due_date {
        require_label("dueDate", &labels.due_date)?;
        push_kv_text(&mut text, &labels.due_date, d);
    }

    text.push('\n');
    text.push_str("--------------------------------\n");
    text.push_str("\n");

    // B) PAYMENT DETAILS (SECOND BLOCK) — exact order
    // Total row (currency is appended only if present)
    if !total.trim().is_empty() {
        let cur = currency.trim();
        if cur.is_empty() {
            push_kv_text(&mut text, &labels.total, &total);
        } else {
            push_kv_text(&mut text, &labels.total, &format!("{} {}", total, cur));
        }
    }
    if let Some(b) = bank_account {
        push_kv_text(&mut text, &labels.bank_account, b);
    }

    text.push('\n');
    // Keep the intro line short and below the summary blocks.
    text.push_str(intro_line);
    text.push('\n');
    if let Some(n) = note {
        text.push_str(&format!("\n{}\n", labels.personal_note_with_colon));
        text.push_str(n);
        text.push('\n');
    }

    text.push_str("\n--------------------------------\n");
    text.push_str(&mandatory_note_text);
    text.push('\n');

    // ---- HTML ----
    let html_total = escape_html(&total);
    let html_currency = escape_html(currency);
    let html_due_date = due_date.map(escape_html);
    let html_note = note.map(escape_html);
    let html_bank_account = bank_account.map(escape_html);
    let html_vat_id = escape_html(vat_id);
    let html_company_name = escape_html(company_name);
    let html_company_address = company_address.as_deref().map(escape_html);

    fn push_detail_row(html: &mut String, label: &str, value: &str) {
        let v = value.trim();
        if v.is_empty() {
            return;
        }
        html.push_str(&format!(
            "<tr><td style=\"padding:6px 0;font-size:13px;color:#4b5563;\">{}</td><td align=\"right\" style=\"padding:6px 0;font-size:13px;color:#111827;font-weight:600;\">{}</td></tr>",
            escape_html(label),
            escape_html(v)
        ));
    }

    let mut html = String::new();
    html.push_str("<!doctype html><html><head><meta charset=\"utf-8\"></head>");
    html.push_str("<body style=\"margin:0;padding:0;background-color:#f6f7f9;font-family:Arial,Helvetica,sans-serif;\">");
    html.push_str("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background-color:#f6f7f9;padding:24px 0;\">\
<tr><td align=\"center\">\
<table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e6e8ec;border-radius:10px;overflow:hidden;\">\
");

    // Header
    html.push_str("<tr><td style=\"padding:20px 24px;\">");
    html.push_str(&format!(
        "<div style=\"font-size:18px;font-weight:700;color:#111827;\">{}</div>",
        escape_html(labels.invoice.as_str())
    ));
    html.push_str("</td></tr>");

    // Body
    html.push_str("<tr><td style=\"padding:0 24px 20px 24px;\">");

    // A) INVOICE / ISSUER DETAILS (TOP BLOCK) — exact order
    html.push_str("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"margin-top:16px;border:1px solid #e6e8ec;border-radius:10px;\">\
<tr><td style=\"padding:14px;\">\
<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\">\
");

    html.push_str(&format!(
        "<tr><td style=\"padding:6px 0;font-size:13px;color:#4b5563;\">{}</td><td align=\"right\" style=\"padding:6px 0;font-size:13px;color:#111827;font-weight:600;\"><div>{}</div>{}</td></tr>",
        escape_html(labels.company.as_str()),
        html_company_name,
        html_company_address
            .as_deref()
            .map(|a| format!("<div style=\\\"margin-top:2px;font-size:12px;color:#6b7280;font-weight:500;\\\">{}</div>", a))
            .unwrap_or_else(|| "".to_string())
    ));

    push_detail_row(&mut html, labels.vat_id.as_str(), &html_vat_id);
    push_detail_row(&mut html, labels.invoice_number.as_str(), invoice_number);
    push_detail_row(&mut html, labels.issue_date.as_str(), issue_date);
    if let Some(d) = html_due_date.as_deref() {
        push_detail_row(&mut html, labels.due_date.as_str(), d);
    }

    html.push_str("</table></td></tr></table>");

    // Visual divider after top block
    html.push_str("<div style=\"height:1px;background-color:#e6e8ec;margin:16px 0;\"></div>");

    // B) PAYMENT DETAILS (SECOND BLOCK) — exact order
    html.push_str("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border:1px solid #e6e8ec;border-radius:10px;\">\
<tr><td style=\"padding:14px;\">\
<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\">\
");

    // Total (bold / strong) — first row in payment block
    if !total.trim().is_empty() {
        let cur = currency.trim();
        if cur.is_empty() {
            html.push_str(&format!(
                "<tr><td style=\"padding:6px 0;font-size:13px;color:#4b5563;\">{}</td><td align=\"right\" style=\"padding:6px 0;font-size:16px;color:#111827;font-weight:800;\">{}</td></tr>",
                escape_html(labels.total.as_str()),
                html_total
            ));
        } else {
            html.push_str(&format!(
                "<tr><td style=\"padding:6px 0;font-size:13px;color:#4b5563;\">{}</td><td align=\"right\" style=\"padding:6px 0;font-size:16px;color:#111827;font-weight:800;\">{} {}</td></tr>",
                escape_html(labels.total.as_str()),
                html_total,
                html_currency
            ));
        }
    }

    // Bank account — second row in payment block (only if present)
    if let Some(b) = html_bank_account.as_deref() {
        push_detail_row(&mut html, labels.bank_account.as_str(), b);
    }

    html.push_str("</table></td></tr></table>");

    // Keep the intro line short and below the summary blocks.
    html.push_str(&format!(
        "<p style=\"margin:16px 0 0 0;font-size:14px;line-height:20px;color:#111827;\">{}</p>",
        escape_html(intro_line)
    ));

    // Personal note
    if let Some(n) = html_note {
        html.push_str("<div style=\"margin-top:16px;\">");
        html.push_str(&format!(
            "<div style=\"font-size:12px;color:#4b5563;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;\">{}</div>",
            escape_html(labels.personal_note.as_str())
        ));
        html.push_str(&format!(
            "<div style=\"margin-top:8px;padding:12px 14px;border:1px solid #e6e8ec;border-radius:10px;background-color:#ffffff;font-size:14px;line-height:20px;color:#111827;white-space:pre-wrap;\">{}</div>",
            n
        ));
        html.push_str("</div>");
    }

    html.push_str("</td></tr>");

    // Footer
    html.push_str("<tr><td style=\"padding:16px 24px 22px 24px;\">");

    html.push_str("<div style=\"margin-top:12px;padding-top:12px;border-top:1px solid #e6e8ec;font-size:12px;line-height:18px;color:#6b7280;\">");
    html.push_str(&mandatory_note_html);
    html.push_str("</div>");
    html.push_str(&format!(
        "<div style=\"margin-top:8px;font-size:12px;color:#6b7280;\">{}</div>",
        escape_html(labels.generated_from_app.as_str())
    ));
    html.push_str("</td></tr>");

    html.push_str("</table></td></tr></table></body></html>");

    Ok((html, text))
}

fn push_line(
    layer: &printpdf::PdfLayerReference,
    font: &printpdf::IndirectFontRef,
    text: &str,
    font_size: f32,
    x: f32,
    y: f32,
) {
    use printpdf::Mm;
    layer.use_text(text, font_size, Mm(x), Mm(y), font);
}

fn wrap_text_lines(input: &str, max_chars: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();

    for word in input.split_whitespace() {
        if current.is_empty() {
            current.push_str(word);
            continue;
        }

        if current.len() + 1 + word.len() <= max_chars {
            current.push(' ');
            current.push_str(word);
        } else {
            out.push(current);
            current = word.to_string();
        }
    }

    if !current.is_empty() {
        out.push(current);
    }

    out
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct PdfLabels {
    doc_title: String,
    invoice_title: String,
    invoice_title_service_invoice_no: String,

    issuer_title: String,
    buyer_title: String,
    details_title: String,

    vat_id: String,
    registration_number: String,
    address: String,
    bank_account: String,
    email: String,
    phone: String,

    invoice_number: String,
    issue_date: String,
    service_date: String,
    place_of_service: String,
    place_of_issue: String,
    currency: String,

    items_title: String,
    col_description: String,
    col_unit: String,
    col_qty: String,
    col_unit_price: String,
    col_discount: String,
    col_amount: String,

    totals_title: String,
    subtotal: String,
    discount: String,
    vat: String,
    total_for_payment: String,

    payment_terms_title: String,
    payment_deadline: String,
    reference_number: String,
    payment_method: String,

    notes: String,
    legal_notes_title: String,

    err_company_registration_number_missing: String,
    err_client_registration_number_missing: String,
    err_not_enough_space_header_and_footer: String,
    err_not_enough_space_content_and_footer: String,
    err_too_many_items: String,
    err_missing_language: String,
    err_invalid_language: String,

    footer_generated: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfLabelsLocale {
    doc_title: String,
    invoice_title: String,
    invoice_title_service_invoice_no: String,

    issuer_title: String,
    buyer_title: String,
    details_title: String,

    vat_id: String,
    registration_number: String,
    address: String,
    bank_account: String,
    email: String,
    phone: String,

    invoice_number: String,
    issue_date: String,
    service_date: String,
    place_of_service: String,
    place_of_issue: String,
    currency: String,

    items_title: String,
    col_description: String,
    col_unit: String,
    col_qty: String,
    col_unit_price: String,
    col_discount: String,
    col_amount: String,

    totals_title: String,
    subtotal: String,
    discount: String,
    vat: String,
    total_for_payment: String,

    payment_terms_title: String,
    payment_deadline: String,
    reference_number: String,
    payment_method: String,

    notes: String,
    legal_notes_title: String,

    err_company_registration_number_missing: String,
    err_client_registration_number_missing: String,
    err_not_enough_space_header_and_footer: String,
    err_not_enough_space_content_and_footer: String,
    err_too_many_items: String,
    err_missing_language: String,
    err_invalid_language: String,

    footer_generated: String,
}

#[derive(Debug, Clone, Deserialize)]
struct PdfLabelsFile {
    sr: PdfLabelsLocale,
    en: PdfLabelsLocale,
}

static PDF_LABELS: OnceLock<PdfLabelsFile> = OnceLock::new();

fn pdf_labels(lang: &str) -> PdfLabels {
    let file = PDF_LABELS.get_or_init(|| {
        let json = include_str!("../../src/shared/pdfLabels.json");
        serde_json::from_str::<PdfLabelsFile>(json).unwrap_or_else(|_| PdfLabelsFile {
            sr: PdfLabelsLocale {
                doc_title: String::new(),
                invoice_title: String::new(),
                invoice_title_service_invoice_no: String::new(),
                issuer_title: String::new(),
                buyer_title: String::new(),
                details_title: String::new(),
                vat_id: String::new(),
                registration_number: String::new(),
                address: String::new(),
                bank_account: String::new(),
                email: String::new(),
                phone: String::new(),
                invoice_number: String::new(),
                issue_date: String::new(),
                service_date: String::new(),
                place_of_service: String::new(),
                place_of_issue: String::new(),
                currency: String::new(),
                items_title: String::new(),
                col_description: String::new(),
                col_unit: String::new(),
                col_qty: String::new(),
                col_unit_price: String::new(),
                col_discount: String::new(),
                col_amount: String::new(),
                totals_title: String::new(),
                subtotal: String::new(),
                discount: String::new(),
                vat: String::new(),
                total_for_payment: String::new(),
                payment_terms_title: String::new(),
                payment_deadline: String::new(),
                reference_number: String::new(),
                payment_method: String::new(),
                notes: String::new(),
                legal_notes_title: String::new(),
                err_company_registration_number_missing: String::new(),
                err_client_registration_number_missing: String::new(),
                err_not_enough_space_header_and_footer: String::new(),
                err_not_enough_space_content_and_footer: String::new(),
                err_too_many_items: String::new(),
                err_missing_language: String::new(),
                err_invalid_language: String::new(),
                footer_generated: String::new(),
            },
            en: PdfLabelsLocale {
                doc_title: String::new(),
                invoice_title: String::new(),
                invoice_title_service_invoice_no: String::new(),
                issuer_title: String::new(),
                buyer_title: String::new(),
                details_title: String::new(),
                vat_id: String::new(),
                registration_number: String::new(),
                address: String::new(),
                bank_account: String::new(),
                email: String::new(),
                phone: String::new(),
                invoice_number: String::new(),
                issue_date: String::new(),
                service_date: String::new(),
                place_of_service: String::new(),
                place_of_issue: String::new(),
                currency: String::new(),
                items_title: String::new(),
                col_description: String::new(),
                col_unit: String::new(),
                col_qty: String::new(),
                col_unit_price: String::new(),
                col_discount: String::new(),
                col_amount: String::new(),
                totals_title: String::new(),
                subtotal: String::new(),
                discount: String::new(),
                vat: String::new(),
                total_for_payment: String::new(),
                payment_terms_title: String::new(),
                payment_deadline: String::new(),
                reference_number: String::new(),
                payment_method: String::new(),
                notes: String::new(),
                legal_notes_title: String::new(),
                err_company_registration_number_missing: String::new(),
                err_client_registration_number_missing: String::new(),
                err_not_enough_space_header_and_footer: String::new(),
                err_not_enough_space_content_and_footer: String::new(),
                err_too_many_items: String::new(),
                err_missing_language: String::new(),
                err_invalid_language: String::new(),
                footer_generated: String::new(),
            },
        })
    });

    let l = lang.to_ascii_lowercase();
    let loc = if l.starts_with("en") { &file.en } else { &file.sr };

    PdfLabels {
        doc_title: loc.doc_title.clone(),
        invoice_title: loc.invoice_title.clone(),
        invoice_title_service_invoice_no: loc.invoice_title_service_invoice_no.clone(),
        issuer_title: loc.issuer_title.clone(),
        buyer_title: loc.buyer_title.clone(),
        details_title: loc.details_title.clone(),
        vat_id: loc.vat_id.clone(),
        registration_number: loc.registration_number.clone(),
        address: loc.address.clone(),
        bank_account: loc.bank_account.clone(),
        email: loc.email.clone(),
        phone: loc.phone.clone(),
        invoice_number: loc.invoice_number.clone(),
        issue_date: loc.issue_date.clone(),
        service_date: loc.service_date.clone(),
        place_of_service: loc.place_of_service.clone(),
        place_of_issue: loc.place_of_issue.clone(),
        currency: loc.currency.clone(),
        items_title: loc.items_title.clone(),
        col_description: loc.col_description.clone(),
        col_unit: loc.col_unit.clone(),
        col_qty: loc.col_qty.clone(),
        col_unit_price: loc.col_unit_price.clone(),
        col_discount: loc.col_discount.clone(),
        col_amount: loc.col_amount.clone(),
        totals_title: loc.totals_title.clone(),
        subtotal: loc.subtotal.clone(),
        discount: loc.discount.clone(),
        vat: loc.vat.clone(),
        total_for_payment: loc.total_for_payment.clone(),
        payment_terms_title: loc.payment_terms_title.clone(),
        payment_deadline: loc.payment_deadline.clone(),
        reference_number: loc.reference_number.clone(),
        payment_method: loc.payment_method.clone(),
        notes: loc.notes.clone(),
        legal_notes_title: loc.legal_notes_title.clone(),
        err_company_registration_number_missing: loc.err_company_registration_number_missing.clone(),
        err_client_registration_number_missing: loc.err_client_registration_number_missing.clone(),
        err_not_enough_space_header_and_footer: loc.err_not_enough_space_header_and_footer.clone(),
        err_not_enough_space_content_and_footer: loc.err_not_enough_space_content_and_footer.clone(),
        err_too_many_items: loc.err_too_many_items.clone(),
        err_missing_language: loc.err_missing_language.clone(),
        err_invalid_language: loc.err_invalid_language.clone(),
        footer_generated: loc.footer_generated.clone(),
    }
}

#[allow(dead_code)]
fn draw_rule(layer: &printpdf::PdfLayerReference, x1: f32, x2: f32, y: f32) {
    use printpdf::Mm;
    layer.add_line(printpdf::Line {
        points: vec![
            (printpdf::Point::new(Mm(x1), Mm(y)), false),
            (printpdf::Point::new(Mm(x2), Mm(y)), false),
        ],
        is_closed: false,
    });
}

fn draw_rule_with_thickness(
    layer: &printpdf::PdfLayerReference,
    x1: f32,
    x2: f32,
    y: f32,
    thickness: f32,
) {
    use printpdf::Mm;
    layer.set_outline_thickness(thickness);
    layer.add_line(printpdf::Line {
        points: vec![
            (printpdf::Point::new(Mm(x1), Mm(y)), false),
            (printpdf::Point::new(Mm(x2), Mm(y)), false),
        ],
        is_closed: false,
    });
}

#[allow(dead_code)]
fn push_line_right(
    layer: &printpdf::PdfLayerReference,
    font: &printpdf::IndirectFontRef,
    text: &str,
    font_size: f32,
    x_right: f32,
    y: f32,
) {
    // printpdf doesn't expose reliable text metrics; use a pragmatic estimate.
    // This is good enough for numeric columns and matches the reference visually.
    let width_est = (text.chars().count() as f32) * font_size * 0.42;
    let x = (x_right - width_est).max(0.0);
    push_line(layer, font, text, font_size, x, y);
}

fn text_width_mm_ttf(face: &ttf_parser::Face<'_>, text: &str, font_size_pt: f32) -> f32 {
    // PDF font sizes are in points; our coordinates are in millimeters.
    const PT_TO_MM: f32 = 25.4 / 72.0;
    let units_per_em = face.units_per_em() as f32;
    if units_per_em <= 0.0 {
        return 0.0;
    }

    let mut width_units: i32 = 0;

    for ch in text.chars() {
        let Some(gid) = face.glyph_index(ch) else {
            continue;
        };

        width_units += face.glyph_hor_advance(gid).unwrap_or(0) as i32;
    }

    let width_pt = (width_units as f32 / units_per_em) * font_size_pt;
    width_pt * PT_TO_MM
}

fn font_ascent_mm(face: &ttf_parser::Face<'_>, font_size_pt: f32) -> f32 {
    const PT_TO_MM: f32 = 25.4 / 72.0;
    let units_per_em = face.units_per_em() as f32;
    if units_per_em <= 0.0 {
        return font_size_pt * PT_TO_MM * 0.80;
    }

    let asc_units = face.ascender() as f32;
    (asc_units / units_per_em) * font_size_pt * PT_TO_MM
}

fn font_descent_mm(face: &ttf_parser::Face<'_>, font_size_pt: f32) -> f32 {
    const PT_TO_MM: f32 = 25.4 / 72.0;
    let units_per_em = face.units_per_em() as f32;
    if units_per_em <= 0.0 {
        return font_size_pt * PT_TO_MM * 0.20;
    }

    // descender is typically negative; convert to a positive magnitude in mm.
    let desc_units = face.descender() as f32;
    ((-desc_units).max(0.0) / units_per_em) * font_size_pt * PT_TO_MM
}

fn push_line_right_measured(
    layer: &printpdf::PdfLayerReference,
    font: &printpdf::IndirectFontRef,
    ttf_face: &ttf_parser::Face<'_>,
    text: &str,
    font_size: f32,
    x_right: f32,
    y: f32,
) {
    let width_mm = text_width_mm_ttf(ttf_face, text, font_size);
    let x = (x_right - width_mm).max(0.0);
    push_line(layer, font, text, font_size, x, y);
}

fn split_and_wrap_lines(input: &str, max_chars: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in input.lines() {
        let s = raw.trim();
        if s.is_empty() {
            continue;
        }
        for line in wrap_text_lines(s, max_chars) {
            out.push(line);
        }
    }
    out
}

fn format_money_sr(v: f64) -> String {
    // Serbian style: thousands '.', decimals ',' (e.g., 16.200,00)
    let s = format!("{:.2}", v);
    let parts = s.split('.').collect::<Vec<_>>();
    let int_part = parts[0];
    let dec_part = parts.get(1).copied().unwrap_or("00");

    let mut out = String::new();
    let chars: Vec<char> = int_part.chars().collect();
    let mut cnt = 0;
    for i in (0..chars.len()).rev() {
        if cnt == 3 {
            out.push('.');
            cnt = 0;
        }
        out.push(chars[i]);
        cnt += 1;
    }
    let int_with_sep: String = out.chars().rev().collect();
    format!("{},{}", int_with_sep, dec_part)
}

fn format_qty_sr(v: f64) -> String {
    // Match reference (2 decimals, decimal comma)
    let s = format!("{:.2}", v);
    s.replace('.', ",")
}

#[allow(dead_code)]
fn fill_rect_gray(
    layer: &printpdf::PdfLayerReference,
    x: f32,
    y_top: f32,
    w: f32,
    h: f32,
    gray: f32,
) {
    use printpdf::{path::PaintMode, Color, Mm, Rect, Rgb};

    layer.set_fill_color(Color::Rgb(Rgb::new(gray, gray, gray, None)));
    // printpdf uses bottom-left origin; our y coordinates are already in that space.
    let rect = Rect::new(Mm(x), Mm(y_top - h), Mm(x + w), Mm(y_top)).with_mode(PaintMode::Fill);
    layer.add_rect(rect);
    // reset fill to black
    layer.set_fill_color(Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None)));
}

#[allow(dead_code)]
fn push_kv_wrapped(
    layer: &printpdf::PdfLayerReference,
    font: &printpdf::IndirectFontRef,
    label: &str,
    value: &str,
    font_size: f32,
    x_label: f32,
    x_value: f32,
    y: f32,
    max_value_chars: usize,
    line_gap: f32,
) -> f32 {
    let value = value.trim();
    let value_lines = if value.is_empty() {
        vec![String::new()]
    } else {
        wrap_text_lines(value, max_value_chars)
    };

    // First line: label + first value line
    push_line(layer, font, &format!("{}:", label), font_size, x_label, y);
    push_line(layer, font, &value_lines[0], font_size, x_value, y);

    // Continuation lines: value only, aligned to value column
    let mut current_y = y;
    for line in value_lines.iter().skip(1) {
        current_y -= line_gap;
        push_line(layer, font, line, font_size, x_value, current_y);
    }

    current_y
}

fn wrap_text_by_width_mm(
    ttf_face: &ttf_parser::Face<'_>,
    input: &str,
    font_size: f32,
    max_width_mm: f32,
) -> Vec<String> {
    let s = input.trim();
    if s.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();

    for word in s.split_whitespace() {
        if current.is_empty() {
            if text_width_mm_ttf(ttf_face, word, font_size) <= max_width_mm {
                current.push_str(word);
                continue;
            }

            // Split a single too-long word into chunks.
            let mut chunk = String::new();
            for ch in word.chars() {
                let candidate = format!("{}{}", chunk, ch);
                if text_width_mm_ttf(ttf_face, &candidate, font_size) <= max_width_mm {
                    chunk = candidate;
                } else {
                    if !chunk.is_empty() {
                        out.push(chunk);
                    }
                    chunk = ch.to_string();
                }
            }
            if !chunk.is_empty() {
                out.push(chunk);
            }
            continue;
        }

        let candidate = format!("{} {}", current, word);
        if text_width_mm_ttf(ttf_face, &candidate, font_size) <= max_width_mm {
            current = candidate;
        } else {
            out.push(std::mem::take(&mut current));

            if text_width_mm_ttf(ttf_face, word, font_size) <= max_width_mm {
                current.push_str(word);
            } else {
                let mut chunk = String::new();
                for ch in word.chars() {
                    let cand = format!("{}{}", chunk, ch);
                    if text_width_mm_ttf(ttf_face, &cand, font_size) <= max_width_mm {
                        chunk = cand;
                    } else {
                        if !chunk.is_empty() {
                            out.push(chunk);
                        }
                        chunk = ch.to_string();
                    }
                }
                current = chunk;
            }
        }
    }

    if !current.is_empty() {
        out.push(current);
    }

    out
}

fn draw_value_only_wrapped(
    layer: &printpdf::PdfLayerReference,
    font: &printpdf::IndirectFontRef,
    ttf_face: &ttf_parser::Face<'_>,
    value: &str,
    font_size: f32,
    x_value: f32,
    y: f32,
    max_width_value: f32,
    line_height: f32,
    row_gap: f32,
) -> f32 {
    let value_lines = wrap_text_by_width_mm(ttf_face, value, font_size, max_width_value);
    if value_lines.is_empty() {
        return y;
    }

    for (idx, line) in value_lines.iter().enumerate() {
        let yy = y - (idx as f32) * line_height;
        push_line(layer, font, line, font_size, x_value, yy);
    }

    y - (value_lines.len() as f32) * line_height - row_gap
}

fn generate_pdf_bytes(payload: &InvoicePdfPayload, logo_url: Option<&str>) -> Result<Vec<u8>, String> {
    use printpdf::{Image, ImageTransform, Mm, PdfDocument};
    use base64::Engine as _;

    // Language selection must be explicit (no implicit Serbian fallback).
    let lang_raw = payload.language.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let lang_key = match lang_raw {
        Some(l) => {
            let lower = l.to_ascii_lowercase();
            if lower.starts_with("en") {
                "en"
            } else if lower.starts_with("sr") {
                "sr"
            } else {
                return Err(pdf_labels("en").err_invalid_language.clone());
            }
        }
        None => {
            return Err(pdf_labels("en").err_missing_language.clone());
        }
    };

    let labels = pdf_labels(lang_key);

    if payload.company.registration_number.trim().is_empty() {
        return Err(labels.err_company_registration_number_missing.clone());
    }

    let client_mb = payload
        .client
        .registration_number
        .as_deref()
        .unwrap_or("")
        .trim();
    if client_mb.is_empty() {
        return Err(labels.err_client_registration_number_missing.clone());
    }

    let (doc, page1, layer1) = PdfDocument::new(
        &labels.doc_title,
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );
    let layer = doc.get_page(page1).get_layer(layer1);

    // Embed a Unicode font to support Cyrillic (ћирилица) and other non-ASCII characters.
    static FONT_BYTES: &[u8] = include_bytes!("../assets/DejaVuSans.ttf");
    let font = doc
        .add_external_font(Cursor::new(FONT_BYTES as &[u8]))
        .map_err(|e| e.to_string())?;
    // Use the same embedded font for all text to ensure consistent Unicode rendering.
    let font_bold = font.clone();

    // Parse the same embedded font for deterministic text width measurement (used for true right-alignment).
    let ttf_face = ttf_parser::Face::parse(FONT_BYTES, 0)
        .map_err(|_| "Failed to parse embedded font for measurement".to_string())?;

    // Layout constants (language-agnostic)
    const PAGE_W: f32 = 210.0;
    const PAGE_H: f32 = 297.0;
    const PAGE_MARGIN_X: f32 = 15.0;
    const PAGE_MARGIN_TOP: f32 = 12.0;
    const PAGE_MARGIN_BOTTOM: f32 = 12.0;

    #[allow(unused)]
    const SECTION_GAP: f32 = 10.0;
    #[allow(unused)]
    const LINE_GAP: f32 = 5.0;
    #[allow(unused)]
    const HEADER_LINE_GAP: f32 = 5.0;
    #[allow(unused)]
    const HEADER_TITLE_GAP: f32 = 8.0;

    #[allow(unused)]
    const COLUMN_GAP: f32 = 10.0;
    #[allow(unused)]
    const LABEL_COL_W: f32 = 36.0;
    #[allow(unused)]
    const HEADER_LABEL_COL_W: f32 = 38.0;
    const HEADER_ROW_GAP: f32 = 0.8;

    // Cell padding (avoid scattered magic numbers)
    const CELL_PAD_X: f32 = 1.2;
    const CELL_PAD_Y: f32 = 3.0;

    // Debug-only visual verification switch (make padding changes obvious in generated PDFs).
    const DEBUG_PDF_LAYOUT_EXAGGERATE: bool = cfg!(debug_assertions) && false;
    const DEBUG_CELL_PAD_X: f32 = 8.0;
    const DEBUG_CELL_PAD_Y: f32 = 6.0;

    let cell_pad_x = if DEBUG_PDF_LAYOUT_EXAGGERATE {
        DEBUG_CELL_PAD_X
    } else {
        CELL_PAD_X
    };
    let cell_pad_y = if DEBUG_PDF_LAYOUT_EXAGGERATE {
        DEBUG_CELL_PAD_Y
    } else {
        CELL_PAD_Y
    };

    let content_left_x = PAGE_MARGIN_X;
    let content_right_x = PAGE_W - PAGE_MARGIN_X;
    let content_width = content_right_x - content_left_x;

    // Reserve footer area for the mandatory legal note and footer line.
    let footer_y = PAGE_MARGIN_BOTTOM;
    let footer_text_y = footer_y;
    // Reserve space for: (1) footer line, (2) place-of-issue line.
    let footer_note_bottom_y = footer_text_y + 10.0;
    let footer_note_max_chars = 95;

    // ----- Template A – Classic Serbian Invoice (reference-driven) -----

    // Language-dependent numeric formatting
    let is_sr = lang_key == "sr";
    let fmt_money = |v: f64| if is_sr { format_money_sr(v) } else { format_money(v) };
    let fmt_qty = |v: f64| if is_sr { format_qty_sr(v) } else { format!("{:.2}", v) };

    // Build legal-note lines from templates (already localized, with placeholders resolved)
    let legal_note_text = mandatory_invoice_note_text(lang_key, &payload.invoice_number);
    let legal_note_lines = split_and_wrap_lines(&legal_note_text, footer_note_max_chars);

    // Flowing cursor
    let mut y = PAGE_H - PAGE_MARGIN_TOP;

    // Document title block (ABOVE the top rule).
    // Keep this as a single tunable constant so we can shift the entire header down
    // without changing the internal alignment of the issuer/buyer columns.
    const TITLE_BLOCK_H: f32 = 14.0;
    const TITLE_TOP_PAD: f32 = 1.5;
    let title_prefix = labels.invoice_title_service_invoice_no.as_str();
    let title_text = format!("{}{}", title_prefix, payload.invoice_number.trim());
    let doc_title_size: f32 = 14.0;
    let doc_title_w = text_width_mm_ttf(&ttf_face, title_text.as_str(), doc_title_size);
    let doc_title_x = content_left_x + (content_width - doc_title_w) / 2.0;
    let doc_title_y = y - TITLE_TOP_PAD;
    push_line(&layer, &font_bold, title_text.as_str(), doc_title_size, doc_title_x, doc_title_y);

    // Shift the header block down; the top rule becomes the separator UNDER the title.
    y -= TITLE_BLOCK_H;

    // Top horizontal rule (as in reference)
    draw_rule_with_thickness(&layer, content_left_x, content_right_x, y, 0.85);
    y -= 8.5;

    // A) Parties header (two rows)
    // Row 1: issuer/company (left) + logo (right reserved area)
    // Row 2: buyer/client (full width)
    // IMPORTANT: Remove the "Od:" and "Komitent:" labels (do not render section titles).
    const LOGO_DPI: f32 = 300.0;
    // Reserved area on the right for the logo (Row 1 only). Applied ONLY when a logo exists.
    // Slightly wider to let the logo feel less cramped.
    const LOGO_AREA_W: f32 = 52.0;
    // Gap between issuer text area and logo box.
    const LOGO_GAP: f32 = 6.0;
    const HEADER_ROWS_GAP_Y: f32 = 8.0;

    let name_size = 11.0;
    let text_size = 8.3;
    let line_h = 4.0;

    // Decode a data URL logo (as stored from the UI: data:image/*;base64,...) into an image.
    let decoded_logo = logo_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| {
            let lower = s.to_ascii_lowercase();
            if !lower.starts_with("data:") {
                return None;
            }
            let comma = s.find(',')?;
            let (meta, data) = s.split_at(comma);
            if !meta.to_ascii_lowercase().contains(";base64") {
                return None;
            }
            let b64 = &data[1..];
            let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
            let img = printpdf::image_crate::load_from_memory(&bytes).ok()?;
            Some(img)
        });

    let has_logo = decoded_logo.is_some();
    let row1_top_y = y;
    let row1_text_right_x = if has_logo {
        (content_right_x - LOGO_AREA_W).max(content_left_x + 20.0)
    } else {
        content_right_x
    };
    let row1_text_w_mm = (row1_text_right_x - content_left_x).max(10.0);

    let company_address_line = payload.company.address_line.as_deref().unwrap_or("").trim();
    let company_postal_code = payload.company.postal_code.as_deref().unwrap_or("").trim();
    let company_city = payload.company.city.as_deref().unwrap_or("").trim();
    let company_postal_and_city = [company_postal_code, company_city]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let company_address_value = if !company_address_line.is_empty() && !company_postal_and_city.is_empty() {
        format!("{}, {}", company_address_line, company_postal_and_city)
    } else if !company_address_line.is_empty() {
        company_address_line.to_string()
    } else {
        payload
            .company
            .address
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(", ")
    };

    #[derive(Clone)]
    struct HeaderRow {
        label: Option<String>,
        value: String,
    }

    // --- Row 1: issuer/company (wrapped to avoid the reserved logo area) ---
    let mut y_issuer = row1_top_y;
    push_line(
        &layer,
        &font_bold,
        &payload.company.company_name,
        name_size,
        content_left_x,
        y_issuer,
    );
    y_issuer -= 4.6;

    // Use font metrics to align the logo to the company-name line (top edge), not lower issuer rows.
    // `push_line` uses a baseline Y; ascent gets us to the visual top of the glyphs.
    let issuer_top_y = row1_top_y + font_ascent_mm(&ttf_face, name_size);

    let issuer_x_label = content_left_x;
    let issuer_full_w_mm = row1_text_w_mm;

    let mut issuer_rows: Vec<HeaderRow> = Vec::new();
    let vat_value = payload.company.pib.trim();
    if !vat_value.is_empty() {
        issuer_rows.push(HeaderRow {
            label: Some(labels.vat_id.clone()),
            value: vat_value.to_string(),
        });
    }
    let reg_value = payload.company.registration_number.trim();
    if !reg_value.is_empty() {
        issuer_rows.push(HeaderRow {
            label: Some(labels.registration_number.clone()),
            value: reg_value.to_string(),
        });
    }
    let addr_value = company_address_value.trim();
    if !addr_value.is_empty() {
        issuer_rows.push(HeaderRow {
            label: None, // address is unlabeled in PDF
            value: addr_value.to_string(),
        });
    }
    let email_value = payload.company.email.as_deref().unwrap_or("").trim();
    if !email_value.is_empty() {
        issuer_rows.push(HeaderRow {
            label: Some(labels.email.clone()),
            value: email_value.to_string(),
        });
    }
    let phone_value = payload.company.phone.as_deref().unwrap_or("").trim();
    if !phone_value.is_empty() {
        issuer_rows.push(HeaderRow {
            label: Some(labels.phone.clone()),
            value: phone_value.to_string(),
        });
    }
    let bank_value = payload.company.bank_account.trim();
    if !bank_value.is_empty() {
        issuer_rows.push(HeaderRow {
            label: Some(labels.bank_account.clone()),
            value: bank_value.to_string(),
        });
    }

    let issuer_row_count = issuer_rows.len();

    // Render issuer rows: labeled rows inline ("{label}: {value}"); address is unlabeled starting at labelX.
    for row in issuer_rows {
        if let Some(label) = row.label {
            y_issuer = draw_inline_labeled_row(
                &layer,
                &font,
                &ttf_face,
                &label,
                &row.value,
                text_size,
                issuer_x_label,
                y_issuer,
                issuer_full_w_mm,
                line_h,
                HEADER_ROW_GAP,
            );
        } else {
            y_issuer = draw_value_only_wrapped(
                &layer,
                &font,
                &ttf_face,
                &row.value,
                text_size,
                issuer_x_label,
                y_issuer,
                issuer_full_w_mm,
                line_h,
                HEADER_ROW_GAP,
            );
        }
    }

    let issuer_block_h = (row1_top_y - y_issuer).max(0.0);

    // Baseline of the last issuer line (e.g. "Tekući račun") is one line-height above the returned y,
    // because the draw_* helpers return y advanced by (lines * line_height + row_gap).
    let issuer_last_baseline_y = if issuer_row_count > 0 {
        y_issuer + line_h + HEADER_ROW_GAP
    } else {
        // If no rows exist, treat the company name as the only issuer line.
        row1_top_y
    };
    // Bottom of the issuer block as the visual bottom of the last line.
    let issuer_bottom_y = issuer_last_baseline_y - font_descent_mm(&ttf_face, text_size);

    // --- Row 1: logo (top-right within reserved area) ---
    let mut logo_h_mm: f32 = 0.0;
    if let Some(img) = decoded_logo {
        let px_w = img.width().max(1) as f32;
        let px_h = img.height().max(1) as f32;

        let natural_w_mm = px_w / LOGO_DPI * 25.4;
        let natural_h_mm = px_h / LOGO_DPI * 25.4;

        let logo_box_left = (row1_text_right_x + LOGO_GAP).min(content_right_x);
        let logo_box_right = content_right_x;
        let logo_box_w = (logo_box_right - logo_box_left).max(1.0);

        // Scale to visually match the issuer block height, but still contain within the logo box width.
        // This keeps the logo prominent and vertically aligned with issuer content.
        let target_h = issuer_block_h.max(0.0);
        let scale_w = logo_box_w / natural_w_mm.max(1.0);
        let scale_h = target_h / natural_h_mm.max(1.0);
        let scale = scale_w.min(scale_h).max(0.01);

        let scaled_w_mm = natural_w_mm * scale;
        let scaled_h_mm = natural_h_mm * scale;
        logo_h_mm = scaled_h_mm;

        // Right-align within the reserved box; top-align with the company name line.
        let logo_x = (logo_box_right - scaled_w_mm).max(logo_box_left);
        // Place the logo so its top edge aligns with the company name, and clamp so the bottom
        // doesn't extend below the issuer block.
        let logo_bottom_y = (issuer_top_y - scaled_h_mm).max(issuer_bottom_y);

        let image = Image::from_dynamic_image(&img);
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

    // --- Row 2: buyer/client (full width, below the tallest Row 1 element) ---
    let row1_h = issuer_block_h.max(logo_h_mm);
    let row2_top_y = row1_top_y - row1_h - HEADER_ROWS_GAP_Y;

    let mut y_buyer = row2_top_y;
    push_line(
        &layer,
        &font_bold,
        &payload.client.name,
        name_size,
        content_left_x,
        y_buyer,
    );
    y_buyer -= 4.6;

    let buyer_x_label = content_left_x;
    let buyer_full_w_mm = (content_right_x - content_left_x).max(10.0);

    let buyer_address_line = payload
        .client
        .address_line
        .as_deref()
        .or_else(|| payload.client.address.as_deref())
        .unwrap_or("")
        .trim();
    let buyer_postal_code = payload.client.postal_code.as_deref().unwrap_or("").trim();
    let buyer_city = payload.client.city.as_deref().unwrap_or("").trim();
    let buyer_postal_and_city = [buyer_postal_code, buyer_city]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let buyer_address_value = if !buyer_postal_code.is_empty() && !buyer_city.is_empty() {
        // Full combined address
        if buyer_address_line.is_empty() {
            buyer_postal_and_city
        } else {
            format!("{}, {}", buyer_address_line, buyer_postal_and_city)
        }
    } else {
        // Fallback: street-only (as requested), or legacy multiline collapsed if street is empty.
        if !buyer_address_line.is_empty() {
            buyer_address_line.to_string()
        } else {
            payload
                .client
                .address
                .as_deref()
                .unwrap_or("")
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
                .join(", ")
        }
    };

    let mut buyer_rows: Vec<HeaderRow> = Vec::new();
    let buyer_pib = payload.client.pib.as_deref().unwrap_or("").trim();
    if !buyer_pib.is_empty() {
        buyer_rows.push(HeaderRow {
            label: Some(labels.vat_id.clone()),
            value: buyer_pib.to_string(),
        });
    }
    if !client_mb.is_empty() {
        buyer_rows.push(HeaderRow {
            label: Some(labels.registration_number.clone()),
            value: client_mb.to_string(),
        });
    }
    let buyer_addr_value = buyer_address_value.trim();
    if !buyer_addr_value.is_empty() {
        buyer_rows.push(HeaderRow {
            label: None, // address is unlabeled in PDF
            value: buyer_addr_value.to_string(),
        });
    }
    let buyer_email = payload.client.email.as_deref().unwrap_or("").trim();
    if !buyer_email.is_empty() {
        buyer_rows.push(HeaderRow {
            label: Some(labels.email.clone()),
            value: buyer_email.to_string(),
        });
    }
    let buyer_phone = payload.client.phone.as_deref().unwrap_or("").trim();
    if !buyer_phone.is_empty() {
        buyer_rows.push(HeaderRow {
            label: Some(labels.phone.clone()),
            value: buyer_phone.to_string(),
        });
    }
    // Tekući račun for buyer: omit when empty (currently always empty in payload).

    for row in buyer_rows {
        if let Some(label) = row.label {
            y_buyer = draw_inline_labeled_row(
                &layer,
                &font,
                &ttf_face,
                &label,
                &row.value,
                text_size,
                buyer_x_label,
                y_buyer,
                buyer_full_w_mm,
                line_h,
                HEADER_ROW_GAP,
            );
        } else {
            y_buyer = draw_value_only_wrapped(
                &layer,
                &font,
                &ttf_face,
                &row.value,
                text_size,
                buyer_x_label,
                y_buyer,
                buyer_full_w_mm,
                line_h,
                HEADER_ROW_GAP,
            );
        }
    }

    // After parties block, keep the existing divider below the WHOLE header.
    y = y_buyer - 3.2;
    // This rule is the TOP separator framing the items-table header band.
    // We draw it after painting the header background so the rule stays crisp on top.
    let items_header_top_rule_y = y;
    y -= 6.8;

    // B) Items table
    // Column grid (fixed widths + explicit anchors to avoid numeric overlap)
    let table_left = content_left_x;
    let table_right = content_right_x;
    let col_gap = 3.0;
    let col_unit_w = 16.0;
    let col_qty_w = 18.0;
    let col_price_w_base = 24.0;
    let col_disc_w_base = 20.0;
    let col_total_w_base = 26.0;

    // RABAT is almost always 0,00 -> keep it compact, but ensure header + a typical value fit.
    // Also ensure CENA and TOTAL can comfortably render large values (e.g., 200.000,00 / 200,000.00).
    let sample_discount = fmt_money(0.0);
    let sample_big_money = fmt_money(200000.0);

    let header_size_measure: f32 = 8.6;

    let min_disc_w = text_width_mm_ttf(&ttf_face, &labels.col_discount, header_size_measure)
        .max(text_width_mm_ttf(&ttf_face, &sample_discount, text_size))
        + 2.0 * cell_pad_x;

    let min_price_w = text_width_mm_ttf(&ttf_face, &labels.col_unit_price, header_size_measure)
        .max(text_width_mm_ttf(&ttf_face, &sample_big_money, text_size))
        + 2.0 * cell_pad_x;

    let min_total_w = text_width_mm_ttf(&ttf_face, &labels.col_amount, header_size_measure)
        .max(text_width_mm_ttf(&ttf_face, &sample_big_money, text_size))
        + 2.0 * cell_pad_x;

    // Apply requested reallocation:
    // - shrink RABAT to its minimum
    // - use the freed width primarily for CENA
    // - allow TOTAL to grow if needed to fit the large-value sample
    let col_disc_w = min_disc_w;
    let freed_from_disc = (col_disc_w_base - col_disc_w).max(0.0);
    let available_for_price_total = col_price_w_base + col_total_w_base + freed_from_disc;

    let col_total_w = col_total_w_base.max(min_total_w);
    let mut col_price_w = col_price_w_base.max(min_price_w);
    let used_by_price_total = col_price_w + col_total_w;
    if used_by_price_total < available_for_price_total {
        // Give any remaining width to CENA (primary beneficiary).
        col_price_w += available_for_price_total - used_by_price_total;
    }

    let col_total_right = table_right - 0.5;
    let col_total_left = col_total_right - col_total_w;
    let col_disc_right = col_total_left - col_gap;
    let col_disc_left = col_disc_right - col_disc_w;
    let col_price_right = col_disc_left - col_gap;
    let col_price_left = col_price_right - col_price_w;
    let col_qty_right = col_price_left - col_gap;
    let col_qty_left = col_qty_right - col_qty_w;
    let col_unit_right = col_qty_left - col_gap;
    let col_unit_left = col_unit_right - col_unit_w;
    let col_service_left = table_left;

    // Header row (authority) — anchor to the same grid as row values
    let header_size = 8.6;
    let service_header_x = col_service_left;
    let unit_header_x = col_unit_left;
    let qty_right_x = col_qty_right - cell_pad_x;
    let price_right_x = col_price_right - cell_pad_x;
    let disc_right_x = col_disc_right - cell_pad_x;
    let numeric_right_x = col_total_right - cell_pad_x;

    // Header background: fill the entire band BETWEEN the two framing rules.
    // Top rule Y is recorded right after the parties block; bottom rule Y is the line drawn after the header labels.
    const HEADER_ROW_ADVANCE: f32 = 6.0; // must match the y-step immediately after drawing header labels
    let header_band_top_y = items_header_top_rule_y;
    let header_band_bottom_y = y - HEADER_ROW_ADVANCE;
    let header_band_h = (header_band_top_y - header_band_bottom_y).max(0.0);
    let header_band_w = (table_right - table_left).max(0.0);
    fill_rect_gray(&layer, table_left, header_band_top_y, header_band_w, header_band_h, 0.92);

    push_line(&layer, &font_bold, &labels.col_description, header_size, service_header_x, y);
    push_line(&layer, &font_bold, &labels.col_unit, header_size, unit_header_x, y);
    push_line_right_measured(&layer, &font_bold, &ttf_face, &labels.col_qty, header_size, qty_right_x, y);
    push_line_right_measured(
        &layer,
        &font_bold,
        &ttf_face,
        &labels.col_unit_price,
        header_size,
        price_right_x,
        y,
    );
    push_line_right_measured(&layer, &font_bold, &ttf_face, &labels.col_discount, header_size, disc_right_x, y);
    push_line_right_measured(&layer, &font_bold, &ttf_face, &labels.col_amount, header_size, numeric_right_x, y);

    // Draw the top separator rule on top of the gray band.
    draw_rule_with_thickness(&layer, content_left_x, content_right_x, items_header_top_rule_y, 0.45);

    y -= HEADER_ROW_ADVANCE;
    draw_rule_with_thickness(&layer, table_left, table_right, y, 0.60);
    y -= 7.8;

    // Rows
    // Reduce vertical spacing between rows (~50%) without affecting header spacing
    // or the last-row → totals spacing.
    let row_advance_base: f32 = 10.6;
    let row_advance_tight: f32 = row_advance_base * 0.5;

    for (row_idx, it) in payload.items.iter().enumerate() {
        // Keep some reserved space for totals + blocks below.
        if y < footer_note_bottom_y + 75.0 {
            return Err(labels.err_too_many_items.clone());
        }

        // Description wraps in the first column
        // Description wraps; keep it comfortably inside the service column.
        let desc_lines = split_and_wrap_lines(&it.description, 44);
        let row_top_y = y;

        // Render first line at row_y, continuation lines below (only in service column)
        if let Some(first) = desc_lines.first() {
            push_line(&layer, &font, first, text_size, col_service_left, row_top_y);
        }

        // Unit (fallback for old invoices; always render a valid value)
        let unit_display: &'static str = {
            let raw = it.unit.as_deref().unwrap_or("").trim();
            if raw.is_empty() {
                "kom"
            } else {
                let lower = raw.to_ascii_lowercase();
                match lower.as_str() {
                    "kom" => "kom",
                    "sat" | "h" => "sat",
                    "m2" | "m²" | "m^2" => "m²",
                    "usluga" => "usluga",
                    _ => "usluga",
                }
            }
        };
        push_line(&layer, &font, unit_display, text_size, col_unit_left, row_top_y);

        // Qty/Price/Discount/Total
        push_line_right_measured(&layer, &font, &ttf_face, &fmt_qty(it.quantity), text_size, qty_right_x, row_top_y);
        push_line_right_measured(&layer, &font, &ttf_face, &fmt_money(it.unit_price), text_size, price_right_x, row_top_y);
        let line_subtotal = it.quantity * it.unit_price;
        let line_discount = it.discount_amount.unwrap_or(0.0).clamp(0.0, line_subtotal);
        let line_total = line_subtotal - line_discount;
        push_line_right_measured(&layer, &font, &ttf_face, &fmt_money(line_discount), text_size, disc_right_x, row_top_y);
        push_line_right_measured(&layer, &font_bold, &ttf_face, &fmt_money(line_total), text_size, numeric_right_x, row_top_y);

        let mut row_h_used = 0.0;
        for extra in desc_lines.iter().skip(1) {
            row_h_used += line_h;
            push_line(&layer, &font, extra, text_size, col_service_left, row_top_y - row_h_used);
        }

        // Advance to next row (tighten only between rows)
        let is_last_row = row_idx + 1 == payload.items.len();
        let row_advance = if is_last_row { row_advance_base } else { row_advance_tight };
        y = row_top_y - row_advance - row_h_used;
    }

    // Table bottom rule (end-of-items separator)
    y += 1.2;
    draw_rule_with_thickness(&layer, table_left, table_right, y, 0.40);
    y -= 7.2;

    // C) Totals area (3-row, boxed/striped like reference)
    let totals_left = table_left;
    // Single explicit padding between the numeric right edge (TOTAL column) and the totals box border.
    // Keep it grid-driven: col_total_right is anchored to the table; the box is a fixed pad away.
    let totals_pad: f32 = 0.5;
    let totals_box_right = col_total_right + totals_pad;
    let totals_row_h = 7.6;
    let _totals_w = totals_box_right - totals_left;

    // Totals background: plain white (no stripe fills)
    let totals_top_y = y + 3.0;

    // Vertically centered baselines inside each row
    // Tie labels to the left-most table grid boundary (description column left) with existing grid spacing.
    let label_x = col_service_left + col_gap;
    // IMPORTANT: use the exact same numeric right edge as the table TOTAL column, with cell padding.
    let value_right = numeric_right_x;
    let row1_top_y = totals_top_y;
    let row2_top_y = totals_top_y - totals_row_h;
    let row3_top_y = totals_top_y - 2.0 * totals_row_h;
    let row1_y = row1_top_y - cell_pad_y;
    let row2_y = row2_top_y - cell_pad_y;
    let row3_y = row3_top_y - cell_pad_y;

    let totals_label_size = 8.8;
    let totals_value_size = 9.3;
    let totals_emph_label_size = 10.0;
    let totals_emph_value_size = 10.5;

    push_line(
        &layer,
        &font,
        &format!("{} ({})", &labels.subtotal, &payload.currency),
        totals_label_size,
        label_x,
        row1_y,
    );
    push_line_right_measured(
        &layer,
        &font_bold,
        &ttf_face,
        &fmt_money(payload.subtotal),
        totals_value_size,
        value_right,
        row1_y,
    );

    push_line(
        &layer,
        &font,
        &format!("{} ({})", &labels.discount, &payload.currency),
        totals_label_size,
        label_x,
        row2_y,
    );
    push_line_right_measured(
        &layer,
        &font_bold,
        &ttf_face,
        &fmt_money(payload.discount_total),
        totals_value_size,
        value_right,
        row2_y,
    );

    push_line(
        &layer,
        &font_bold,
        &format!("{} ({})", &labels.total_for_payment, &payload.currency),
        totals_emph_label_size,
        label_x,
        row3_y,
    );
    let total_due = payload.subtotal - payload.discount_total;
    push_line_right_measured(
        &layer,
        &font_bold,
        &ttf_face,
        &fmt_money(total_due),
        totals_emph_value_size,
        value_right,
        row3_y,
    );

    // Box lines
    // Remove the totals top border to avoid a rule visually sticking to the first totals row.
    draw_rule_with_thickness(&layer, totals_left, totals_box_right, totals_top_y - 3.0 * totals_row_h, 0.85);

    y = totals_top_y - 3.0 * totals_row_h - 7.0;

    // Add a bit of air between the rule above and the notes title.
    let section_gap_after_rule: f32 = 3.0;
    y -= section_gap_after_rule;

    // D) Comment / service description block
    push_line(&layer, &font_bold, &labels.notes, 10.0, content_left_x, y);
    y -= 4.6;

    // Map available fields:
    // - Issue date, Service date
    push_line(
        &layer,
        &font,
        &format!("{}: {}", &labels.issue_date, &payload.issue_date),
        8.5,
        content_left_x,
        y,
    );
    y -= 4.4;
    push_line(
        &layer,
        &font,
        &format!("{}: {}", &labels.service_date, &payload.service_date),
        8.5,
        content_left_x,
        y,
    );
    y -= 4.4;

    // - Reference number (invoice number)
    push_line(
        &layer,
        &font,
        &format!("{}: {}", &labels.reference_number, &payload.invoice_number),
        8.5,
        content_left_x,
        y,
    );
    y -= 6.0;

    // - User notes (if present)
    if let Some(notes) = &payload.notes {
        let notes = notes.trim();
        if !notes.is_empty() {
            for line in split_and_wrap_lines(notes, 95) {
                if y < footer_note_bottom_y + 35.0 {
                    break;
                }
                push_line(&layer, &font, &line, 8.5, content_left_x, y);
                y -= 4.4;
            }
        }
    }

    y -= 5.0;

    // E) Legal/tax note block (title + localized template lines)
    push_line(&layer, &font_bold, &labels.legal_notes_title, 10.0, content_left_x, y);
    y -= 4.6;
    for line in legal_note_lines {
        if y < footer_note_bottom_y + 12.0 {
            break;
        }
        push_line(&layer, &font, &line, 8.5, content_left_x, y);
        y -= 4.4;
    }

    // F) Footer / branding (tiny or omitted)
    if !labels.footer_generated.trim().is_empty() {
        push_line(&layer, &font, &labels.footer_generated, 6.0, content_left_x, 4.0);
    }

    let mut writer = std::io::BufWriter::new(Vec::<u8>::new());
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    let bytes = writer.into_inner().map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SmtpTlsMode {
    Implicit,
    Starttls,
}

impl SmtpTlsMode {
    fn as_str(&self) -> &'static str {
        match self {
            SmtpTlsMode::Implicit => "implicit",
            SmtpTlsMode::Starttls => "starttls",
        }
    }
}

fn default_smtp_tls_mode_for_port(port: i64) -> SmtpTlsMode {
    match port {
        465 => SmtpTlsMode::Implicit,
        587 => SmtpTlsMode::Starttls,
        _ => SmtpTlsMode::Starttls,
    }
}

fn parse_smtp_tls_mode_str(v: &str) -> Option<SmtpTlsMode> {
    let s = v.trim();
    if s.eq_ignore_ascii_case("implicit") {
        Some(SmtpTlsMode::Implicit)
    } else if s.eq_ignore_ascii_case("starttls") {
        Some(SmtpTlsMode::Starttls)
    } else {
        None
    }
}

fn resolved_smtp_tls_mode(mode: Option<SmtpTlsMode>, port: i64) -> SmtpTlsMode {
    mode.unwrap_or_else(|| default_smtp_tls_mode_for_port(port))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub is_configured: Option<bool>,
    pub company_name: String,
    #[serde(default, alias = "maticniBroj")]
    pub registration_number: String,
    pub pib: String,
    #[serde(default, alias = "address")]
    pub company_address_line: String,
    #[serde(default)]
    pub company_city: String,
    #[serde(default)]
    pub company_postal_code: String,
    #[serde(default)]
    pub company_email: String,
    #[serde(default)]
    pub company_phone: String,
    pub bank_account: String,
    pub logo_url: String,
    pub invoice_prefix: String,
    pub next_invoice_number: i64,
    pub default_currency: String,
    pub language: String,
    #[serde(default)]
    pub smtp_host: String,
    #[serde(default)]
    pub smtp_port: i64,
    #[serde(default)]
    pub smtp_user: String,
    #[serde(default)]
    pub smtp_password: String,
    #[serde(default)]
    pub smtp_from: String,
    #[serde(default = "default_smtp_use_tls")]
    pub smtp_use_tls: bool,
    #[serde(default)]
    pub smtp_tls_mode: Option<SmtpTlsMode>,
}

fn default_smtp_use_tls() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub is_configured: Option<bool>,
    pub company_name: Option<String>,
    #[serde(default, alias = "maticniBroj")]
    pub registration_number: Option<String>,
    pub pib: Option<String>,
    pub company_address_line: Option<String>,
    pub company_city: Option<String>,
    pub company_postal_code: Option<String>,
    pub company_email: Option<String>,
    pub company_phone: Option<String>,
    pub bank_account: Option<String>,
    pub logo_url: Option<String>,
    pub invoice_prefix: Option<String>,
    pub next_invoice_number: Option<i64>,
    pub default_currency: Option<String>,
    pub language: Option<String>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<i64>,
    pub smtp_user: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
    pub smtp_use_tls: Option<bool>,
    pub smtp_tls_mode: Option<SmtpTlsMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub id: String,
    pub name: String,
    #[serde(default, alias = "maticniBroj")]
    pub registration_number: String,
    pub pib: String,
    pub address: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub postal_code: String,
    pub email: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewClient {
    pub name: String,
    #[serde(default, alias = "maticniBroj")]
    pub registration_number: String,
    pub pib: String,
    pub address: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub postal_code: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceItem {
    pub id: String,
    pub description: String,
    #[serde(default)]
    pub unit: Option<String>,
    pub quantity: f64,
    pub unit_price: f64,
    #[serde(default)]
    pub discount_amount: Option<f64>,
    pub total: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InvoiceStatus {
    Draft,
    Sent,
    Paid,
    Cancelled,
}

impl InvoiceStatus {
    fn as_str(&self) -> &'static str {
        match self {
            InvoiceStatus::Draft => "DRAFT",
            InvoiceStatus::Sent => "SENT",
            InvoiceStatus::Paid => "PAID",
            InvoiceStatus::Cancelled => "CANCELLED",
        }
    }
}

fn default_invoice_status() -> InvoiceStatus {
    InvoiceStatus::Draft
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invoice {
    pub id: String,
    pub invoice_number: String,
    pub client_id: String,
    pub client_name: String,
    pub issue_date: String,
    pub service_date: String,
    #[serde(default = "default_invoice_status")]
    pub status: InvoiceStatus,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub paid_at: Option<String>,
    pub currency: String,
    pub items: Vec<InvoiceItem>,
    pub subtotal: f64,
    pub total: f64,
    pub notes: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewInvoice {
    pub client_id: String,
    pub client_name: String,
    pub issue_date: String,
    pub service_date: String,
    #[serde(default)]
    pub status: Option<InvoiceStatus>,
    #[serde(default)]
    pub due_date: Option<String>,
    pub currency: String,
    pub items: Vec<InvoiceItem>,
    pub subtotal: f64,
    pub total: f64,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoicePatch {
    pub invoice_number: Option<String>,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub issue_date: Option<String>,
    pub service_date: Option<String>,
    pub status: Option<InvoiceStatus>,
    pub due_date: Option<Option<String>>,
    pub currency: Option<String>,
    pub items: Option<Vec<InvoiceItem>>,
    pub subtotal: Option<f64>,
    pub total: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Expense {
    pub id: String,
    pub title: String,
    pub amount: f64,
    pub currency: String,
    pub date: String, // YYYY-MM-DD
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewExpense {
    pub title: String,
    pub amount: f64,
    pub currency: String,
    pub date: String, // YYYY-MM-DD
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpensePatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub category: Option<Option<String>>,
    #[serde(default)]
    pub notes: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseRange {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

const SETTINGS_ID: &str = "default";

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn today_ymd() -> String {
    let d = OffsetDateTime::now_utc().date();
    format!("{:04}-{:02}-{:02}", d.year(), u8::from(d.month()), d.day())
}

fn default_settings() -> Settings {
    Settings {
        is_configured: Some(false),
        company_name: "".to_string(),
        registration_number: "".to_string(),
        pib: "".to_string(),
        company_address_line: "".to_string(),
        company_city: "".to_string(),
        company_postal_code: "".to_string(),
        company_email: "".to_string(),
        company_phone: "".to_string(),
        bank_account: "".to_string(),
        logo_url: "".to_string(),
        invoice_prefix: "INV".to_string(),
        next_invoice_number: 1,
        default_currency: "RSD".to_string(),
        language: "sr".to_string(),
        smtp_host: "".to_string(),
        smtp_port: 587,
        smtp_user: "".to_string(),
        smtp_password: "".to_string(),
        smtp_from: "".to_string(),
        smtp_use_tls: true,
        smtp_tls_mode: Some(SmtpTlsMode::Starttls),
    }
}

fn format_invoice_number(prefix: &str, next: i64) -> String {
    format!("{}-{:0>4}", prefix, next)
}

fn sqlite_error_string(err: &rusqlite::Error) -> String {
    match err {
        rusqlite::Error::SqliteFailure(code, msg) => {
            let message = msg.clone().unwrap_or_else(|| "".to_string());
            format!(
                "sqlite(code={:?}, extended_code={}, msg={})",
                code.code, code.extended_code, message
            )
        }
        other => other.to_string(),
    }
}

fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(dir) = app.path().app_data_dir() {
        candidates.push(dir.join("pausaler.db"));
    }
    if let Ok(dir) = app.path().app_local_data_dir() {
        candidates.push(dir.join("pausaler.db"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("pausaler.db"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("pausaler.db"));
    }

    for p in &candidates {
        if p.exists() {
            return Ok(p.clone());
        }
    }

    candidates
        .into_iter()
        .next()
        .ok_or_else(|| "Unable to resolve database path".to_string())
}

fn configure_sqlite(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Apply PRAGMAs on init (outside any transaction).
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;\n\
         PRAGMA synchronous = NORMAL;\n\
         PRAGMA foreign_keys = ON;\n\
         PRAGMA temp_store = MEMORY;\n\
         PRAGMA busy_timeout = 5000;\n",
    )?;
    conn.busy_timeout(Duration::from_millis(5000))?;
    Ok(())
}

fn init_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            id TEXT PRIMARY KEY NOT NULL,
            isConfigured INTEGER,
            companyName TEXT NOT NULL,
            maticniBroj TEXT NOT NULL DEFAULT '',
            pib TEXT NOT NULL,
            address TEXT NOT NULL,
            companyAddressLine TEXT NOT NULL DEFAULT '',
            companyCity TEXT NOT NULL DEFAULT '',
            companyPostalCode TEXT NOT NULL DEFAULT '',
            companyEmail TEXT NOT NULL DEFAULT '',
            companyPhone TEXT NOT NULL DEFAULT '',
            bankAccount TEXT NOT NULL,
            logoUrl TEXT NOT NULL,
            invoicePrefix TEXT NOT NULL,
            nextInvoiceNumber INTEGER NOT NULL,
            defaultCurrency TEXT NOT NULL,
            language TEXT NOT NULL,
            smtpHost TEXT NOT NULL DEFAULT '',
            smtpPort INTEGER NOT NULL DEFAULT 587,
            smtpUser TEXT NOT NULL DEFAULT '',
            smtpPassword TEXT NOT NULL DEFAULT '',
            smtpFrom TEXT NOT NULL DEFAULT '',
            smtpUseTls INTEGER NOT NULL DEFAULT 1,
            smtpTlsMode TEXT NOT NULL DEFAULT '',
            data_json TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            maticniBroj TEXT NOT NULL DEFAULT '',
            pib TEXT NOT NULL,
            address TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            createdAt TEXT NOT NULL,
            data_json TEXT
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY NOT NULL,
            invoiceNumber TEXT NOT NULL,
            clientId TEXT NOT NULL,
            issueDate TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'DRAFT',
            dueDate TEXT,
            paidAt TEXT,
            currency TEXT NOT NULL,
            totalAmount REAL NOT NULL,
            createdAt TEXT NOT NULL,
            data_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS expenses (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            date TEXT NOT NULL,
            category TEXT,
            notes TEXT,
            createdAt TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_invoices_invoiceNumber ON invoices(invoiceNumber);
        CREATE INDEX IF NOT EXISTS idx_invoices_clientId ON invoices(clientId);
        CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
        "#,
    )?;
    Ok(())
}

fn app_meta_get(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .optional()
}

fn app_meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO app_meta(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn apply_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    let mut v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    // Legacy baseline version was 2.
    if v > 0 && v < 2 {
        conn.execute_batch("PRAGMA user_version = 2;")?;
        v = 2;
    }

    // v=0 typically means a fresh DB (init_schema created the latest tables).
    if v == 0 {
        conn.execute_batch("PRAGMA user_version = 8;")?;
        return Ok(());
    }

    if v < 3 {
        conn.execute_batch(
            "ALTER TABLE invoices ADD COLUMN status TEXT NOT NULL DEFAULT 'DRAFT';\n\
             ALTER TABLE invoices ADD COLUMN dueDate TEXT;\n\
             ALTER TABLE invoices ADD COLUMN paidAt TEXT;\n\
             PRAGMA user_version = 3;\n",
        )?;
        v = 3;
    }

    if v < 4 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN smtpHost TEXT NOT NULL DEFAULT '';\n\
             ALTER TABLE settings ADD COLUMN smtpPort INTEGER NOT NULL DEFAULT 587;\n\
             ALTER TABLE settings ADD COLUMN smtpUser TEXT NOT NULL DEFAULT '';\n\
             ALTER TABLE settings ADD COLUMN smtpPassword TEXT NOT NULL DEFAULT '';\n\
             ALTER TABLE settings ADD COLUMN smtpFrom TEXT NOT NULL DEFAULT '';\n\
             ALTER TABLE settings ADD COLUMN smtpUseTls INTEGER NOT NULL DEFAULT 1;\n\
             PRAGMA user_version = 4;\n",
        )?;
        v = 4;
    }

    if v < 5 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN smtpTlsMode TEXT NOT NULL DEFAULT '';\n\
             PRAGMA user_version = 5;\n",
        )?;
        v = 5;
    }

    if v < 6 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS expenses (\n\
                id TEXT PRIMARY KEY NOT NULL,\n\
                title TEXT NOT NULL,\n\
                amount REAL NOT NULL,\n\
                currency TEXT NOT NULL,\n\
                date TEXT NOT NULL,\n\
                category TEXT,\n\
                notes TEXT,\n\
                createdAt TEXT NOT NULL\n\
            );\n\
             CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);\n\
             PRAGMA user_version = 6;\n",
        )?;
        v = 6;
    }

    if v < 7 {
        // Nullable columns for older DBs; UI + PDF validation enforce that MB is filled.
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN maticniBroj TEXT;\n\
             ALTER TABLE clients ADD COLUMN maticniBroj TEXT;\n\
             PRAGMA user_version = 7;\n",
        )?;
        v = 7;
    }

    if v < 8 {
        conn.execute_batch(
            "ALTER TABLE settings ADD COLUMN companyAddressLine TEXT NOT NULL DEFAULT '';\n\
             ALTER TABLE settings ADD COLUMN companyCity TEXT NOT NULL DEFAULT '';\n\
             ALTER TABLE settings ADD COLUMN companyPostalCode TEXT NOT NULL DEFAULT '';\n\
             ALTER TABLE settings ADD COLUMN companyEmail TEXT NOT NULL DEFAULT '';\n\
             ALTER TABLE settings ADD COLUMN companyPhone TEXT NOT NULL DEFAULT '';\n\
             UPDATE settings SET companyAddressLine = CASE\n\
                 WHEN TRIM(COALESCE(companyAddressLine,'')) = '' THEN COALESCE(address,'')\n\
                 ELSE companyAddressLine\n\
             END;\n\
             PRAGMA user_version = 8;\n",
        )?;
    }

    Ok(())
}

fn ensure_settings_row(conn: &Connection) -> Result<(), rusqlite::Error> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM settings WHERE id = ?1",
            params![SETTINGS_ID],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if count > 0 {
        return Ok(());
    }

    let now = now_iso();
    let s = default_settings();
    let data_json = serde_json::to_string(&s).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        r#"INSERT INTO settings (
            id, isConfigured, companyName, maticniBroj, pib, address,
            companyAddressLine, companyCity, companyPostalCode, companyEmail, companyPhone,
            bankAccount, logoUrl,
            invoicePrefix, nextInvoiceNumber, defaultCurrency, language,
            smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom, smtpUseTls, smtpTlsMode,
            data_json, updatedAt
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11,
            ?12, ?13,
            ?14, ?15, ?16, ?17,
            ?18, ?19, ?20, ?21, ?22, ?23, ?24,
            ?25, ?26
        )"#,
        params![
            SETTINGS_ID,
            s.is_configured.unwrap_or(false) as i32,
            s.company_name,
            s.registration_number,
            s.pib,
            s.company_address_line.clone(),
            s.company_address_line,
            s.company_city,
            s.company_postal_code,
            s.company_email,
            s.company_phone,
            s.bank_account,
            s.logo_url,
            s.invoice_prefix,
            s.next_invoice_number,
            s.default_currency,
            s.language,
            s.smtp_host,
            s.smtp_port,
            s.smtp_user,
            s.smtp_password,
            s.smtp_from,
            s.smtp_use_tls as i32,
            resolved_smtp_tls_mode(s.smtp_tls_mode, s.smtp_port).as_str(),
            data_json,
            now,
        ],
    )?;
    Ok(())
}

#[derive(Clone)]
struct DbState {
    conn: Arc<Mutex<Connection>>,
    write_lock: Arc<Mutex<()>>,
}

impl DbState {
    fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let path = resolve_db_path(app)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        configure_sqlite(&conn).map_err(|e| e.to_string())?;
        init_schema(&conn).map_err(|e| e.to_string())?;
        apply_migrations(&conn).map_err(|e| e.to_string())?;
        ensure_settings_row(&conn).map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            write_lock: Arc::new(Mutex::new(())),
        })
    }

    async fn with_read<T, F>(&self, op_name: &'static str, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error> + Send + 'static,
    {
        let conn = self.conn.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let guard = conn.lock().map_err(|_| "db mutex poisoned".to_string())?;
            f(&guard).map_err(|e| {
                let msg = sqlite_error_string(&e);
                eprintln!("[sqlite] {{ op: {:?}, error: {:?} }}", op_name, msg);
                msg
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }

    async fn with_write<T, F>(&self, op_name: &'static str, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, rusqlite::Error> + Send + 'static,
    {
        let conn = self.conn.clone();
        let write_lock = self.write_lock.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _wg = write_lock.lock().map_err(|_| "write mutex poisoned".to_string())?;
            let mut guard = conn.lock().map_err(|_| "db mutex poisoned".to_string())?;
            f(&mut guard).map_err(|e| {
                let msg = sqlite_error_string(&e);
                eprintln!("[sqlite] {{ op: {:?}, error: {:?} }}", op_name, msg);
                msg
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

fn read_settings_from_conn(conn: &Connection) -> Result<Settings, rusqlite::Error> {
    let row = conn
        .query_row(
            "SELECT data_json, isConfigured, companyName, COALESCE(maticniBroj,''), pib, address, companyAddressLine, companyCity, companyPostalCode, companyEmail, companyPhone, bankAccount, logoUrl, invoicePrefix, nextInvoiceNumber, defaultCurrency, language, smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom, smtpUseTls, smtpTlsMode FROM settings WHERE id = ?1",
            params![SETTINGS_ID],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, String>(10)?,
                    r.get::<_, String>(11)?,
                    r.get::<_, String>(12)?,
                    r.get::<_, String>(13)?,
                    r.get::<_, i64>(14)?,
                    r.get::<_, String>(15)?,
                    r.get::<_, String>(16)?,
                    r.get::<_, String>(17)?,
                    r.get::<_, i64>(18)?,
                    r.get::<_, String>(19)?,
                    r.get::<_, String>(20)?,
                    r.get::<_, String>(21)?,
                    r.get::<_, i64>(22)?,
                    r.get::<_, String>(23)?,
                ))
            },
        )
        .optional()?;

    if let Some((
        data_json,
        is_cfg,
        company,
        maticni_broj,
        pib,
        legacy_addr,
        company_address_line,
        company_city,
        company_postal_code,
        company_email,
        company_phone,
        bank,
        logo,
        prefix,
        next,
        currency,
        lang,
        smtp_host,
        smtp_port,
        smtp_user,
        smtp_password,
        smtp_from,
        smtp_use_tls,
        smtp_tls_mode,
    )) = row {
        if let Ok(mut parsed) = serde_json::from_str::<Settings>(&data_json) {
            if let Some(v) = is_cfg {
                parsed.is_configured = Some(v != 0);
            }
            parsed.registration_number = maticni_broj;

            // Keep these fields authoritative from the dedicated columns.
            // NOTE: `create_invoice` increments `nextInvoiceNumber` in the settings row, but does not
            // update `data_json`, so relying on JSON here would return stale values.
            parsed.invoice_prefix = prefix.clone();
            parsed.next_invoice_number = next;
            parsed.default_currency = currency.clone();
            parsed.language = lang.clone();

            if !company_address_line.trim().is_empty() {
                parsed.company_address_line = company_address_line;
            } else if parsed.company_address_line.trim().is_empty() && !legacy_addr.trim().is_empty() {
                parsed.company_address_line = legacy_addr;
            }
            if !company_city.trim().is_empty() {
                parsed.company_city = company_city;
            }
            if !company_postal_code.trim().is_empty() {
                parsed.company_postal_code = company_postal_code;
            }
            if !company_email.trim().is_empty() {
                parsed.company_email = company_email;
            }
            if !company_phone.trim().is_empty() {
                parsed.company_phone = company_phone;
            }

            parsed.smtp_host = smtp_host;
            parsed.smtp_port = smtp_port;
            parsed.smtp_user = smtp_user;
            parsed.smtp_password = smtp_password;
            parsed.smtp_from = smtp_from;
            parsed.smtp_use_tls = smtp_use_tls != 0;
            if parsed.smtp_tls_mode.is_none() {
                parsed.smtp_tls_mode = parse_smtp_tls_mode_str(&smtp_tls_mode);
            }
            if parsed.smtp_tls_mode.is_none() {
                parsed.smtp_tls_mode = Some(default_smtp_tls_mode_for_port(parsed.smtp_port));
            }
            return Ok(parsed);
        }

        let mode = parse_smtp_tls_mode_str(&smtp_tls_mode).unwrap_or_else(|| default_smtp_tls_mode_for_port(smtp_port));
        let effective_address_line = if !company_address_line.trim().is_empty() {
            company_address_line
        } else {
            legacy_addr
        };
        return Ok(Settings {
            is_configured: is_cfg.map(|v| v != 0),
            company_name: company,
            registration_number: maticni_broj,
            pib,
            company_address_line: effective_address_line,
            company_city,
            company_postal_code,
            company_email,
            company_phone,
            bank_account: bank,
            logo_url: logo,
            invoice_prefix: prefix,
            next_invoice_number: next,
            default_currency: currency,
            language: lang,
            smtp_host,
            smtp_port,
            smtp_user,
            smtp_password,
            smtp_from,
            smtp_use_tls: smtp_use_tls != 0,
            smtp_tls_mode: Some(mode),
        });
    }

    Ok(default_settings())
}

#[tauri::command]
async fn get_settings(state: tauri::State<'_, DbState>) -> Result<Settings, String> {
    state.with_read("get_settings", |conn| read_settings_from_conn(conn)).await
}

#[tauri::command]
async fn update_settings(state: tauri::State<'_, DbState>, patch: SettingsPatch) -> Result<Settings, String> {
    state
        .with_write("update_settings", move |conn| {
            let mut current = read_settings_from_conn(conn)?;

            if let Some(v) = patch.is_configured {
                current.is_configured = Some(v);
            }
            if let Some(v) = patch.company_name {
                current.company_name = v;
            }
            if let Some(v) = patch.registration_number {
                current.registration_number = v;
            }
            if let Some(v) = patch.pib {
                current.pib = v;
            }
            if let Some(v) = patch.company_address_line {
                current.company_address_line = v;
            }
            if let Some(v) = patch.company_city {
                current.company_city = v;
            }
            if let Some(v) = patch.company_postal_code {
                current.company_postal_code = v;
            }
            if let Some(v) = patch.company_email {
                current.company_email = v;
            }
            if let Some(v) = patch.company_phone {
                current.company_phone = v;
            }
            if let Some(v) = patch.bank_account {
                current.bank_account = v;
            }
            if let Some(v) = patch.logo_url {
                current.logo_url = v;
            }
            if let Some(v) = patch.invoice_prefix {
                current.invoice_prefix = v;
            }
            if let Some(v) = patch.next_invoice_number {
                current.next_invoice_number = v;
            }
            if let Some(v) = patch.default_currency {
                current.default_currency = v;
            }
            if let Some(v) = patch.language {
                current.language = v;
            }
            if let Some(v) = patch.smtp_host {
                current.smtp_host = v;
            }

            let mut smtp_port_changed = false;
            if let Some(v) = patch.smtp_port {
                current.smtp_port = v;
                smtp_port_changed = true;
            }
            if let Some(v) = patch.smtp_user {
                current.smtp_user = v;
            }
            if let Some(v) = patch.smtp_password {
                current.smtp_password = v;
            }
            if let Some(v) = patch.smtp_from {
                current.smtp_from = v;
            }
            if let Some(v) = patch.smtp_use_tls {
                current.smtp_use_tls = v;
            }

            let smtp_tls_mode_changed = patch.smtp_tls_mode.is_some();
            if let Some(v) = patch.smtp_tls_mode {
                current.smtp_tls_mode = Some(v);
            }

            // Apply defaults based on well-known ports if the user didn't explicitly set the TLS mode.
            if smtp_port_changed && !smtp_tls_mode_changed {
                if current.smtp_port == 465 {
                    current.smtp_tls_mode = Some(SmtpTlsMode::Implicit);
                }
                if current.smtp_port == 587 {
                    current.smtp_tls_mode = Some(SmtpTlsMode::Starttls);
                }
            }
            if current.smtp_tls_mode.is_none() {
                current.smtp_tls_mode = Some(default_smtp_tls_mode_for_port(current.smtp_port));
            }

            let now = now_iso();
            let json = serde_json::to_string(&current).unwrap_or_else(|_| "{}".to_string());
            let is_cfg = current.is_configured.unwrap_or(false);

            conn.execute(
                r#"UPDATE settings SET
                    isConfigured = ?2,
                    companyName = ?3,
                    maticniBroj = ?4,
                    pib = ?5,
                    address = ?6,
                    companyAddressLine = ?7,
                    companyCity = ?8,
                    companyPostalCode = ?9,
                    companyEmail = ?10,
                    companyPhone = ?11,
                    bankAccount = ?12,
                    logoUrl = ?13,
                    invoicePrefix = ?14,
                    nextInvoiceNumber = ?15,
                    defaultCurrency = ?16,
                    language = ?17,
                    smtpHost = ?18,
                    smtpPort = ?19,
                    smtpUser = ?20,
                    smtpPassword = ?21,
                    smtpFrom = ?22,
                    smtpUseTls = ?23,
                    smtpTlsMode = ?24,
                    data_json = ?25,
                    updatedAt = ?26
                   WHERE id = ?1"#,
                params![
                    SETTINGS_ID,
                    is_cfg as i32,
                    current.company_name,
                    current.registration_number,
                    current.pib,
                    current.company_address_line.clone(),
                    current.company_address_line,
                    current.company_city,
                    current.company_postal_code,
                    current.company_email,
                    current.company_phone,
                    current.bank_account,
                    current.logo_url,
                    current.invoice_prefix,
                    current.next_invoice_number,
                    current.default_currency,
                    current.language,
                    current.smtp_host,
                    current.smtp_port,
                    current.smtp_user,
                    current.smtp_password,
                    current.smtp_from,
                    current.smtp_use_tls as i32,
                    resolved_smtp_tls_mode(current.smtp_tls_mode, current.smtp_port).as_str(),
                    json,
                    now,
                ],
            )?;

            Ok(current)
        })
        .await
}

#[tauri::command]
async fn generate_invoice_number(state: tauri::State<'_, DbState>) -> Result<String, String> {
    state
        .with_read("generate_invoice_number", |conn| {
            let s = read_settings_from_conn(conn)?;
            Ok(format_invoice_number(&s.invoice_prefix, s.next_invoice_number))
        })
        .await
}

#[tauri::command]
async fn preview_next_invoice_number(state: tauri::State<'_, DbState>) -> Result<String, String> {
    // Must match the real atomic assignment logic used in `create_invoice`.
    state
        .with_read("preview_next_invoice_number", |conn| {
            let (prefix, next_num): (String, i64) = conn.query_row(
                "SELECT invoicePrefix, nextInvoiceNumber FROM settings WHERE id = ?1",
                params![SETTINGS_ID],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            Ok(format_invoice_number(&prefix, next_num))
        })
        .await
}

#[tauri::command]
async fn get_all_clients(state: tauri::State<'_, DbState>) -> Result<Vec<Client>, String> {
    state
        .with_read("get_all_clients", |conn| {
            let mut stmt = conn.prepare("SELECT data_json FROM clients ORDER BY createdAt DESC")?;
            let mut rows = stmt.query([])?;
            let mut out: Vec<Client> = Vec::new();
            while let Some(row) = rows.next()? {
                let json: Option<String> = row.get(0)?;
                if let Some(j) = json {
                    if let Ok(c) = serde_json::from_str::<Client>(&j) {
                        out.push(c);
                    }
                }
            }
            Ok(out)
        })
        .await
}

#[tauri::command]
async fn get_client_by_id(state: tauri::State<'_, DbState>, id: String) -> Result<Option<Client>, String> {
    state
        .with_read("get_client_by_id", move |conn| {
            let json: Option<String> = conn
                .query_row(
                    "SELECT data_json FROM clients WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(j) = json {
                Ok(serde_json::from_str::<Client>(&j).ok())
            } else {
                Ok(None)
            }
        })
        .await
}

#[tauri::command]
async fn create_client(state: tauri::State<'_, DbState>, input: NewClient) -> Result<Client, String> {
    state
        .with_write("create_client", move |conn| {
            let created = Client {
                id: Uuid::new_v4().to_string(),
                name: input.name,
                registration_number: input.registration_number,
                pib: input.pib,
                address: input.address,
                city: input.city,
                postal_code: input.postal_code,
                email: input.email,
                created_at: now_iso(),
            };
            let json = serde_json::to_string(&created).unwrap_or_else(|_| "{}".to_string());
            conn.execute(
                r#"INSERT INTO clients (id, name, maticniBroj, pib, address, email, phone, createdAt, data_json)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8)"#,
                params![
                    created.id,
                    created.name,
                    created.registration_number,
                    created.pib,
                    created.address,
                    created.email,
                    created.created_at,
                    json,
                ],
            )?;
            Ok(created)
        })
        .await
}

#[tauri::command]
async fn update_client(
    state: tauri::State<'_, DbState>,
    id: String,
    patch: serde_json::Value,
) -> Result<Option<Client>, String> {
    state
        .with_write("update_client", move |conn| {
            let existing_json: Option<String> = conn
                .query_row(
                    "SELECT data_json FROM clients WHERE id = ?1",
                    params![&id],
                    |r| r.get(0),
                )
                .optional()?;
            let Some(j) = existing_json else { return Ok(None); };
            let mut existing: Client = match serde_json::from_str(&j) {
                Ok(v) => v,
                Err(_) => return Ok(None),
            };

            if let Some(v) = patch.get("name").and_then(|v| v.as_str()) {
                existing.name = v.to_string();
            }
            if let Some(v) = patch
                .get("registrationNumber")
                .and_then(|v| v.as_str())
                .or_else(|| patch.get("maticniBroj").and_then(|v| v.as_str()))
            {
                existing.registration_number = v.to_string();
            }
            if let Some(v) = patch.get("pib").and_then(|v| v.as_str()) {
                existing.pib = v.to_string();
            }
            if let Some(v) = patch.get("address").and_then(|v| v.as_str()) {
                existing.address = v.to_string();
            }
            if let Some(v) = patch.get("city").and_then(|v| v.as_str()) {
                existing.city = v.to_string();
            }
            if let Some(v) = patch
                .get("postalCode")
                .and_then(|v| v.as_str())
                .or_else(|| patch.get("postal_code").and_then(|v| v.as_str()))
            {
                existing.postal_code = v.to_string();
            }
            if let Some(v) = patch.get("email").and_then(|v| v.as_str()) {
                existing.email = v.to_string();
            }

            let json = serde_json::to_string(&existing).unwrap_or_else(|_| "{}".to_string());
            conn.execute(
                r#"UPDATE clients SET name=?2, maticniBroj=?3, pib=?4, address=?5, email=?6, data_json=?7 WHERE id=?1"#,
                params![id, existing.name, existing.registration_number, existing.pib, existing.address, existing.email, json],
            )?;

            Ok(Some(existing))
        })
        .await
}

#[tauri::command]
async fn delete_client(state: tauri::State<'_, DbState>, id: String) -> Result<bool, String> {
    state
        .with_write("delete_client", move |conn| {
            conn.execute("DELETE FROM clients WHERE id = ?1", params![id])?;
            Ok(true)
        })
        .await
}

#[tauri::command]
async fn get_all_invoices(state: tauri::State<'_, DbState>) -> Result<Vec<Invoice>, String> {
    state
        .with_read("get_all_invoices", |conn| {
            let mut stmt = conn.prepare("SELECT data_json FROM invoices ORDER BY createdAt DESC")?;
            let mut rows = stmt.query([])?;
            let mut out: Vec<Invoice> = Vec::new();
            while let Some(row) = rows.next()? {
                let json: String = row.get(0)?;
                if let Ok(inv) = serde_json::from_str::<Invoice>(&json) {
                    out.push(inv);
                }
            }
            Ok(out)
        })
        .await
}

#[tauri::command]
async fn list_invoices_range(
    state: tauri::State<'_, DbState>,
    from: String,
    to: String,
) -> Result<Vec<Invoice>, String> {
    state
        .with_read("list_invoices_range", move |conn| {
            let mut stmt = conn.prepare(
                r#"SELECT data_json
                   FROM invoices
                   WHERE (issueDate >= ?1 AND issueDate <= ?2)
                      OR (paidAt IS NOT NULL AND paidAt >= ?1 AND paidAt <= ?2)
                   ORDER BY createdAt DESC"#,
            )?;
            let mut rows = stmt.query(params![from, to])?;
            let mut out: Vec<Invoice> = Vec::new();
            while let Some(row) = rows.next()? {
                let json: String = row.get(0)?;
                if let Ok(inv) = serde_json::from_str::<Invoice>(&json) {
                    out.push(inv);
                }
            }
            Ok(out)
        })
        .await
}

#[tauri::command]
async fn get_invoice_by_id(state: tauri::State<'_, DbState>, id: String) -> Result<Option<Invoice>, String> {
    state
        .with_read("get_invoice_by_id", move |conn| {
            let json: Option<String> = conn
                .query_row(
                    "SELECT data_json FROM invoices WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(j) = json {
                Ok(serde_json::from_str::<Invoice>(&j).ok())
            } else {
                Ok(None)
            }
        })
        .await
}

#[tauri::command]
async fn create_invoice(state: tauri::State<'_, DbState>, input: NewInvoice) -> Result<Invoice, String> {
    state
        .with_write("create_invoice", move |conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

            let (prefix, next_num): (String, i64) = tx.query_row(
                "SELECT invoicePrefix, nextInvoiceNumber FROM settings WHERE id = ?1",
                params![SETTINGS_ID],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;

            let invoice_number = format_invoice_number(&prefix, next_num);

            let status = input.status.unwrap_or(InvoiceStatus::Draft);
            let paid_at = if status == InvoiceStatus::Paid {
                Some(today_ymd())
            } else {
                None
            };

            let created = Invoice {
                id: Uuid::new_v4().to_string(),
                invoice_number: invoice_number,
                client_id: input.client_id,
                client_name: input.client_name,
                issue_date: input.issue_date,
                service_date: input.service_date,
                status,
                due_date: input.due_date,
                paid_at,
                currency: input.currency,
                items: input.items,
                subtotal: input.subtotal,
                total: input.total,
                notes: input.notes,
                created_at: now_iso(),
            };

            let json = serde_json::to_string(&created).unwrap_or_else(|_| "{}".to_string());
            tx.execute(
                r#"INSERT INTO invoices (
                    id, invoiceNumber, clientId, issueDate, status, dueDate, paidAt, currency, totalAmount, createdAt, data_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"#,
                params![
                    created.id,
                    created.invoice_number,
                    created.client_id,
                    created.issue_date,
                    created.status.as_str(),
                    created.due_date,
                    created.paid_at,
                    created.currency,
                    created.total,
                    created.created_at,
                    json,
                ],
            )?;

            tx.execute(
                "UPDATE settings SET nextInvoiceNumber = nextInvoiceNumber + 1, updatedAt = ?2 WHERE id = ?1",
                params![SETTINGS_ID, now_iso()],
            )?;

            tx.commit()?;
            Ok(created)
        })
        .await
}

#[tauri::command]
async fn update_invoice(
    state: tauri::State<'_, DbState>,
    id: String,
    patch: InvoicePatch,
) -> Result<Option<Invoice>, String> {
    state
        .with_write("update_invoice", move |conn| {
            let json: Option<String> = conn
                .query_row(
                    "SELECT data_json FROM invoices WHERE id = ?1",
                    params![&id],
                    |r| r.get(0),
                )
                .optional()?;
            let Some(j) = json else { return Ok(None); };
            let mut existing: Invoice = match serde_json::from_str(&j) {
                Ok(v) => v,
                Err(_) => return Ok(None),
            };

            if let Some(v) = patch.invoice_number {
                existing.invoice_number = v;
            }
            if let Some(v) = patch.client_id {
                existing.client_id = v;
            }
            if let Some(v) = patch.client_name {
                existing.client_name = v;
            }
            if let Some(v) = patch.issue_date {
                existing.issue_date = v;
            }
            if let Some(v) = patch.service_date {
                existing.service_date = v;
            }
            if let Some(v) = patch.status {
                existing.status = v;
            }
            if let Some(v) = patch.due_date {
                existing.due_date = v;
            }
            if let Some(v) = patch.currency {
                existing.currency = v;
            }
            if let Some(v) = patch.items {
                existing.items = v;
            }
            if let Some(v) = patch.subtotal {
                existing.subtotal = v;
            }
            if let Some(v) = patch.total {
                existing.total = v;
            }
            if let Some(v) = patch.notes {
                existing.notes = v;
            }

            // Enforce PAID <-> paidAt invariant.
            if existing.status == InvoiceStatus::Paid {
                if existing.paid_at.is_none() {
                    existing.paid_at = Some(today_ymd());
                }
            } else {
                existing.paid_at = None;
            }

            let json2 = serde_json::to_string(&existing).unwrap_or_else(|_| "{}".to_string());
            conn.execute(
                r#"UPDATE invoices SET invoiceNumber=?2, clientId=?3, issueDate=?4, status=?5, dueDate=?6, paidAt=?7, currency=?8, totalAmount=?9, data_json=?10 WHERE id=?1"#,
                params![
                    id,
                    existing.invoice_number,
                    existing.client_id,
                    existing.issue_date,
                    existing.status.as_str(),
                    existing.due_date,
                    existing.paid_at,
                    existing.currency,
                    existing.total,
                    json2,
                ],
            )?;

            Ok(Some(existing))
        })
        .await
}

#[tauri::command]
async fn delete_invoice(state: tauri::State<'_, DbState>, id: String) -> Result<bool, String> {
    state
        .with_write("delete_invoice", move |conn| {
            conn.execute("DELETE FROM invoices WHERE id = ?1", params![id])?;
            Ok(true)
        })
        .await
}

#[tauri::command]
async fn list_expenses(
    state: tauri::State<'_, DbState>,
    range: Option<ExpenseRange>,
) -> Result<Vec<Expense>, String> {
    state
        .with_read("list_expenses", move |conn| {
            let (from, to) = match range {
                Some(r) => (r.from, r.to),
                None => (None, None),
            };

            let mut stmt = conn.prepare(
                r#"SELECT id, title, amount, currency, date, category, notes, createdAt
                   FROM expenses
                   WHERE (?1 IS NULL OR date >= ?1)
                     AND (?2 IS NULL OR date <= ?2)
                   ORDER BY date DESC, createdAt DESC"#,
            )?;

            let rows = stmt.query_map(params![from, to], |r| {
                Ok(Expense {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    amount: r.get(2)?,
                    currency: r.get(3)?,
                    date: r.get(4)?,
                    category: r.get(5)?,
                    notes: r.get(6)?,
                    created_at: r.get(7)?,
                })
            })?;

            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            Ok(out)
        })
        .await
}

#[tauri::command]
async fn create_expense(
    state: tauri::State<'_, DbState>,
    input: NewExpense,
) -> Result<Expense, String> {
    let NewExpense {
        title,
        amount,
        currency,
        date,
        category,
        notes,
    } = input;

    let title = title.trim().to_string();
    let currency = currency.trim().to_string();
    let date = date.trim().to_string();
    let category = category.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });
    let notes = notes.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });

    if title.is_empty() {
        return Err("Title is required.".to_string());
    }
    if !amount.is_finite() || amount <= 0.0 {
        return Err("Amount must be greater than 0.".to_string());
    }
    if currency.is_empty() {
        return Err("Currency is required.".to_string());
    }
    if date.is_empty() {
        return Err("Date is required.".to_string());
    }

    state
        .with_write("create_expense", move |conn| {
            let id = Uuid::new_v4().to_string();
            let created_at = now_iso();

            conn.execute(
                r#"INSERT INTO expenses (id, title, amount, currency, date, category, notes, createdAt)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
                params![
                    id,
                    title,
                    amount,
                    currency,
                    date,
                    category,
                    notes,
                    created_at,
                ],
            )?;

            Ok(Expense {
                id,
                title,
                amount,
                currency,
                date,
                category,
                notes,
                created_at,
            })
        })
        .await
}

#[tauri::command]
async fn update_expense(
    state: tauri::State<'_, DbState>,
    id: String,
    patch: ExpensePatch,
) -> Result<Option<Expense>, String> {
    if let Some(t) = patch.title.as_deref() {
        if t.trim().is_empty() {
            return Err("Title is required.".to_string());
        }
    }
    if let Some(a) = patch.amount {
        if !a.is_finite() || a <= 0.0 {
            return Err("Amount must be greater than 0.".to_string());
        }
    }
    if let Some(c) = patch.currency.as_deref() {
        if c.trim().is_empty() {
            return Err("Currency is required.".to_string());
        }
    }
    if let Some(d) = patch.date.as_deref() {
        if d.trim().is_empty() {
            return Err("Date is required.".to_string());
        }
    }

    state
        .with_write("update_expense", move |conn| {
            let mut existing = match read_expense_from_conn(conn, &id)? {
                Some(e) => e,
                None => return Ok(None),
            };

            if let Some(v) = patch.title {
                existing.title = v;
            }
            if let Some(v) = patch.amount {
                existing.amount = v;
            }
            if let Some(v) = patch.currency {
                existing.currency = v;
            }
            if let Some(v) = patch.date {
                existing.date = v;
            }
            if let Some(v) = patch.category {
                existing.category = v;
            }
            if let Some(v) = patch.notes {
                existing.notes = v;
            }

            existing.title = existing.title.trim().to_string();
            existing.currency = existing.currency.trim().to_string();
            existing.date = existing.date.trim().to_string();
            existing.category = existing
                .category
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            existing.notes = existing
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            conn.execute(
                r#"UPDATE expenses
                   SET title=?2, amount=?3, currency=?4, date=?5, category=?6, notes=?7
                   WHERE id=?1"#,
                params![
                    id,
                    existing.title,
                    existing.amount,
                    existing.currency,
                    existing.date,
                    existing.category,
                    existing.notes,
                ],
            )?;

            Ok(Some(existing))
        })
        .await
}

#[tauri::command]
async fn delete_expense(state: tauri::State<'_, DbState>, id: String) -> Result<bool, String> {
    state
        .with_write("delete_expense", move |conn| {
            let affected = conn.execute("DELETE FROM expenses WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
        .await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendInvoiceEmailInput {
    pub invoice_id: String,
    pub to: String,
    pub subject: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default = "default_true")]
    pub include_pdf: bool,
}

fn default_true() -> bool {
    true
}

#[tauri::command]
async fn send_invoice_email(
    state: tauri::State<'_, DbState>,
    input: SendInvoiceEmailInput,
) -> Result<bool, String> {
    let (settings, invoice, client, to, subject, body, include_pdf) = state
        .with_read("send_invoice_email_prepare", move |conn| {
            let settings = read_settings_from_conn(conn)?;
            let invoice = read_invoice_from_conn(conn, &input.invoice_id)?
                .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;
            let client = read_client_from_conn(conn, &invoice.client_id)?;

            Ok((
                settings,
                invoice,
                client,
                input.to,
                input.subject,
                input.body,
                input.include_pdf,
            ))
        })
        .await
        .map_err(|e| {
            if e.contains("QueryReturnedNoRows") {
                "Invoice not found".to_string()
            } else {
                e
            }
        })?;

    validate_smtp_settings(&settings)?;

    if to.trim().is_empty() {
        return Err("Recipient email address is required.".to_string());
    }
    if subject.trim().is_empty() {
        return Err("Email subject is required.".to_string());
    }

    let from_mailbox: Mailbox = settings
        .smtp_from
        .parse()
        .map_err(|_| "Invalid From address in SMTP settings.".to_string())?;
    let to_mailbox: Mailbox = to
        .parse()
        .map_err(|_| "Invalid recipient email address.".to_string())?;

    let (html_body, text_body) =
        render_invoice_email(&settings, &invoice, client.as_ref(), include_pdf, body.as_deref())?;
    let alternative = MultiPart::alternative()
        .singlepart(SinglePart::plain(text_body))
        .singlepart(SinglePart::html(html_body));

    let email = if include_pdf {
        let payload = build_invoice_pdf_payload_from_db(&invoice, client.as_ref(), &settings);
        let pdf_bytes = generate_pdf_bytes(&payload, Some(settings.logo_url.as_str()))?;
        let filename = sanitize_filename(&format!("{}.pdf", invoice.invoice_number));

        let content_type = ContentType::parse("application/pdf")
            .map_err(|e| format!("Failed to build PDF attachment content type: {e}"))?;
        let attachment = Attachment::new(filename).body(pdf_bytes, content_type);

        Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(subject)
            .multipart(MultiPart::mixed().multipart(alternative).singlepart(attachment))
            .map_err(|e| format!("Failed to build email: {e}"))?
    } else {
        Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(subject)
            .multipart(alternative)
            .map_err(|e| format!("Failed to build email: {e}"))?
    };

    let settings = std::sync::Arc::new(settings);

    tauri::async_runtime::spawn_blocking(move || {
        let transport = build_smtp_transport(&settings)?;
        transport.send(&email).map_err(|e| {
            eprintln!("[email] send failed: {e}");
            format!("Failed to send email: {e}")
        })?;
        Ok::<(), String>(())
    })
        .await
    .map_err(|e| e.to_string())??;

    Ok(true)
}

#[tauri::command]
async fn send_test_email(state: tauri::State<'_, DbState>) -> Result<bool, String> {
    let settings = state
        .with_read("send_test_email_settings", move |conn| read_settings_from_conn(conn))
        .await?;

    validate_smtp_settings(&settings)?;

    let to_raw = settings.company_email.trim().to_string();
    if to_raw.is_empty() {
        return Err("Company email is missing (Settings → Company → Email).".to_string());
    }

    let from_mailbox: Mailbox = settings
        .smtp_from
        .parse()
        .map_err(|_| "Invalid From address in SMTP settings.".to_string())?;
    let to_mailbox: Mailbox = to_raw
        .parse()
        .map_err(|_| "Invalid company email address.".to_string())?;

    let is_en = settings.language.to_ascii_lowercase().starts_with("en");
    let subject = if is_en {
        "Pausaler: Test email"
    } else {
        "Pausaler: Test email poruka"
    };

    let text_body: String = if is_en {
        "This is a test email. Your SMTP settings are working.".to_string()
    } else {
        "Ovo je test email poruka. Vaša SMTP podešavanja rade.".to_string()
    };
    let html_body: String = if is_en {
        "<p><strong>This is a test email.</strong></p><p>Your SMTP settings are working.</p>".to_string()
    } else {
        "<p><strong>Ovo je test email poruka.</strong></p><p>Vaša SMTP podešavanja rade.</p>".to_string()
    };

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

    let settings = std::sync::Arc::new(settings);

    tauri::async_runtime::spawn_blocking(move || {
        let transport = build_smtp_transport(&settings)?;
        transport.send(&email).map_err(|e| {
            eprintln!("[email] test send failed: {e}");
            format!("Failed to send email: {e}")
        })?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(true)
}

#[tauri::command]
async fn export_invoice_pdf_to_downloads(
    state: tauri::State<'_, DbState>,
    app: tauri::AppHandle,
    payload: InvoicePdfPayload,
) -> Result<String, String> {
    let logo_url = state
        .with_read("export_invoice_pdf_to_downloads_settings", move |conn| {
            let settings = read_settings_from_conn(conn)?;
            Ok(settings.logo_url)
        })
        .await?;
    let logo_url = logo_url.trim().to_string();
    let bytes = generate_pdf_bytes(&payload, if logo_url.is_empty() { None } else { Some(logo_url.as_str()) })?;

    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;

    let client_part = payload.client.name.trim();
    let client_part = if client_part.is_empty() { "client" } else { client_part };
    // NOTE: in debug builds, add a timestamp suffix to avoid PDF viewer caching false negatives.
    // (Safe to revert later; release builds keep the stable name.)
    let mut filename_stem = format!("{}-{}", payload.invoice_number, client_part);
    if cfg!(debug_assertions) {
        let ts_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        filename_stem.push_str(&format!("-{}", ts_ms));
    }
    let filename = sanitize_filename(&format!("{}.pdf", filename_stem));
    let full_path = downloads_dir.join(filename);

    std::fs::write(&full_path, bytes).map_err(|e| e.to_string())?;

    Ok(full_path.to_string_lossy().to_string())
}

fn csv_escape_field(input: &str) -> String {
    let needs_quotes = input.contains(',') || input.contains('"') || input.contains('\n') || input.contains('\r');
    if !needs_quotes {
        return input.to_string();
    }
    let escaped = input.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

fn csv_join_row(fields: &[String]) -> String {
    let mut out = String::new();
    for (i, f) in fields.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&csv_escape_field(f));
    }
    out
}

fn format_money_csv(v: f64) -> String {
    // Raw decimal, dot separator, deterministic 2 decimals.
    format!("{:.2}", v)
}

fn format_quantity_csv(v: f64) -> String {
    // Keep quantities readable without scientific notation for typical invoice values.
    // Trim trailing zeros for determinism.
    let s = format!("{:.6}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() { "0".to_string() } else { s.to_string() }
}

fn write_text_file(path: &std::path::Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_invoices_csv(
    state: tauri::State<'_, DbState>,
    from: String,
    to: String,
    output_path: String,
) -> Result<String, String> {
    let (default_currency, invoices) = state
        .with_read("export_invoices_csv", move |conn| {
            let settings = read_settings_from_conn(conn)?;
            let mut stmt = conn.prepare(
                r#"SELECT data_json
                   FROM invoices
                   WHERE issueDate >= ?1 AND issueDate <= ?2
                   ORDER BY issueDate ASC, createdAt ASC"#,
            )?;
            let mut rows = stmt.query(params![from, to])?;
            let mut out: Vec<Invoice> = Vec::new();
            while let Some(row) = rows.next()? {
                let json: String = row.get(0)?;
                if let Ok(inv) = serde_json::from_str::<Invoice>(&json) {
                    out.push(inv);
                }
            }
            Ok((settings.default_currency, out))
        })
        .await?;

    let header = [
        "invoiceId",
        "invoiceNumber",
        "issueDate",
        "serviceDate",
        "dueDate",
        "paidAt",
        "status",
        "clientId",
        "clientName",
        "currency",
        "isDefaultCurrency",
        "subtotal",
        "total",
        "itemId",
        "itemDescription",
        "itemQuantity",
        "itemUnitPrice",
        "itemTotal",
        "notes",
        "createdAt",
    ];

    let mut lines: Vec<String> = Vec::new();
    lines.push(csv_join_row(&header.iter().map(|s| s.to_string()).collect::<Vec<_>>()));

    for inv in invoices {
        let is_default = inv.currency.trim() == default_currency.trim();
        let due = inv.due_date.clone().unwrap_or_default();
        let paid = inv.paid_at.clone().unwrap_or_default();

        for item in inv.items.iter() {
            let row = vec![
                inv.id.clone(),
                inv.invoice_number.clone(),
                inv.issue_date.clone(),
                inv.service_date.clone(),
                due.clone(),
                paid.clone(),
                inv.status.as_str().to_string(),
                inv.client_id.clone(),
                inv.client_name.clone(),
                inv.currency.clone(),
                if is_default { "true".to_string() } else { "false".to_string() },
                format_money_csv(inv.subtotal),
                format_money_csv(inv.total),
                item.id.clone(),
                item.description.clone(),
                format_quantity_csv(item.quantity),
                format_money_csv(item.unit_price),
                format_money_csv(item.total),
                inv.notes.clone(),
                inv.created_at.clone(),
            ];
            lines.push(csv_join_row(&row));
        }
    }

    let csv = lines.join("\r\n") + "\r\n";
    let path = std::path::PathBuf::from(&output_path);
    write_text_file(&path, &csv)?;
    Ok(output_path)
}

#[tauri::command]
async fn export_expenses_csv(
    state: tauri::State<'_, DbState>,
    from: String,
    to: String,
    output_path: String,
) -> Result<String, String> {
    let (default_currency, expenses) = state
        .with_read("export_expenses_csv", move |conn| {
            let settings = read_settings_from_conn(conn)?;
            let mut stmt = conn.prepare(
                r#"SELECT id, title, amount, currency, date, category, notes, createdAt
                   FROM expenses
                   WHERE date >= ?1 AND date <= ?2
                   ORDER BY date ASC, createdAt ASC"#,
            )?;

            let rows = stmt.query_map(params![from, to], |r| {
                Ok(Expense {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    amount: r.get(2)?,
                    currency: r.get(3)?,
                    date: r.get(4)?,
                    category: r.get(5)?,
                    notes: r.get(6)?,
                    created_at: r.get(7)?,
                })
            })?;

            let mut out: Vec<Expense> = Vec::new();
            for row in rows {
                out.push(row?);
            }
            Ok((settings.default_currency, out))
        })
        .await?;

    let header = [
        "expenseId",
        "date",
        "title",
        "category",
        "amount",
        "currency",
        "isDefaultCurrency",
        "notes",
        "createdAt",
    ];

    let mut lines: Vec<String> = Vec::new();
    lines.push(csv_join_row(&header.iter().map(|s| s.to_string()).collect::<Vec<_>>()));

    for exp in expenses {
        let is_default = exp.currency.trim() == default_currency.trim();
        let row = vec![
            exp.id,
            exp.date,
            exp.title,
            exp.category.unwrap_or_default(),
            format_money_csv(exp.amount),
            exp.currency,
            if is_default { "true".to_string() } else { "false".to_string() },
            exp.notes.unwrap_or_default(),
            exp.created_at,
        ];
        lines.push(csv_join_row(&row));
    }

    let csv = lines.join("\r\n") + "\r\n";
    let path = std::path::PathBuf::from(&output_path);
    write_text_file(&path, &csv)?;
    Ok(output_path)
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let db = DbState::new(&handle)?;
            app.manage(db);

            // Best-effort sanity check: never panic/crash if embedded labels are invalid.
            sanity_check_embedded_invoice_email_labels();
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            quit_app,
            list_serbia_cities,
            export_invoice_pdf_to_downloads,
            export_invoices_csv,
            export_expenses_csv,
            get_app_meta,
            set_app_meta,
            hash_pib,
            get_force_locked_env,
            get_force_lock_level_env,
            generate_activation_code,
            verify_license,
            get_settings,
            update_settings,
            generate_invoice_number,
            preview_next_invoice_number,
            get_all_clients,
            get_client_by_id,
            create_client,
            update_client,
            delete_client,
            get_all_invoices,
            list_invoices_range,
            get_invoice_by_id,
            create_invoice,
            update_invoice,
            delete_invoice,
            list_expenses,
            create_expense,
            update_expense,
            delete_expense,
            send_invoice_email,
            send_test_email
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn validate_smtp_settings(s: &Settings) -> Result<(), String> {
    if s.smtp_host.trim().is_empty() {
        return Err("SMTP is not configured: missing host (Settings → Email).".to_string());
    }
    if s.smtp_port <= 0 || s.smtp_port > 65535 {
        return Err("SMTP is not configured: invalid port (Settings → Email).".to_string());
    }
    if s.smtp_from.trim().is_empty() {
        return Err("SMTP is not configured: missing From address (Settings → Email).".to_string());
    }
    let user_empty = s.smtp_user.trim().is_empty();
    let pass_empty = s.smtp_password.trim().is_empty();
    if user_empty ^ pass_empty {
        return Err("SMTP auth is not configured correctly: set both user and password, or leave both empty.".to_string());
    }

    if s.smtp_use_tls {
        let mode = resolved_smtp_tls_mode(s.smtp_tls_mode, s.smtp_port);
        if s.smtp_port == 465 && mode != SmtpTlsMode::Implicit {
            return Err("SMTP TLS mode mismatch: port 465 requires Implicit TLS (SMTPS).".to_string());
        }
        if s.smtp_port == 587 && mode != SmtpTlsMode::Starttls {
            return Err("SMTP TLS mode mismatch: port 587 requires STARTTLS.".to_string());
        }
    }
    Ok(())
}

fn build_smtp_transport(s: &Settings) -> Result<SmtpTransport, String> {
    validate_smtp_settings(s)?;
    let port: u16 = u16::try_from(s.smtp_port)
        .map_err(|_| "SMTP is not configured: invalid port (Settings → Email).".to_string())?;

    let host = s.smtp_host.trim();
    if host.is_empty() {
        return Err("SMTP is not configured: missing host (Settings → Email).".to_string());
    }

    let mut builder = if s.smtp_use_tls {
        match resolved_smtp_tls_mode(s.smtp_tls_mode, s.smtp_port) {
            SmtpTlsMode::Implicit => {
                let tls_params = TlsParameters::new(host.to_string())
                    .map_err(|e| format!("Failed to configure TLS parameters: {e}"))?;
                SmtpTransport::builder_dangerous(host)
                    .port(port)
                    .tls(Tls::Wrapper(tls_params))
            }
            SmtpTlsMode::Starttls => SmtpTransport::starttls_relay(host)
                .map_err(|e| format!("Invalid SMTP host: {e}"))?
                .port(port),
        }
    } else {
        SmtpTransport::builder_dangerous(host).port(port)
    };

    if !s.smtp_user.trim().is_empty() {
        builder = builder.credentials(Credentials::new(
            s.smtp_user.clone(),
            s.smtp_password.clone(),
        ));
    }

    Ok(builder.build())
}

fn read_invoice_from_conn(conn: &Connection, id: &str) -> Result<Option<Invoice>, rusqlite::Error> {
    let json: Option<String> = conn
        .query_row(
            "SELECT data_json FROM invoices WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;

    Ok(json.and_then(|j| serde_json::from_str::<Invoice>(&j).ok()))
}

fn read_expense_from_conn(conn: &Connection, id: &str) -> Result<Option<Expense>, rusqlite::Error> {
    conn.query_row(
        "SELECT id, title, amount, currency, date, category, notes, createdAt FROM expenses WHERE id = ?1",
        params![id],
        |r| {
            Ok(Expense {
                id: r.get(0)?,
                title: r.get(1)?,
                amount: r.get(2)?,
                currency: r.get(3)?,
                date: r.get(4)?,
                category: r.get(5)?,
                notes: r.get(6)?,
                created_at: r.get(7)?,
            })
        },
    )
    .optional()
}

fn read_client_from_conn(conn: &Connection, id: &str) -> Result<Option<Client>, rusqlite::Error> {
    let json: Option<String> = conn
        .query_row(
            "SELECT data_json FROM clients WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;

    Ok(json.and_then(|j| serde_json::from_str::<Client>(&j).ok()))
}

fn build_invoice_pdf_payload_from_db(invoice: &Invoice, client: Option<&Client>, settings: &Settings) -> InvoicePdfPayload {
    let mut computed_subtotal: f64 = 0.0;
    let mut computed_discount_total: f64 = 0.0;
    let mut computed_total: f64 = 0.0;

    let items: Vec<InvoicePdfItem> = invoice
        .items
        .iter()
        .map(|it| {
            let line_subtotal = it.quantity * it.unit_price;
            let raw_discount = it.discount_amount.unwrap_or(0.0);
            let line_discount = raw_discount.clamp(0.0, line_subtotal);
            let line_total = line_subtotal - line_discount;

            computed_subtotal += line_subtotal;
            computed_discount_total += line_discount;
            computed_total += line_total;

            InvoicePdfItem {
                description: it.description.clone(),
                unit: it.unit.clone().filter(|s| !s.trim().is_empty()),
                quantity: it.quantity,
                unit_price: it.unit_price,
                discount_amount: if line_discount > 0.0 { Some(line_discount) } else { None },
                total: line_total,
            }
        })
        .collect();

    InvoicePdfPayload {
        language: Some(settings.language.clone()),
        invoice_number: invoice.invoice_number.clone(),
        issue_date: invoice.issue_date.clone(),
        service_date: invoice.service_date.clone(),
        currency: invoice.currency.clone(),
        subtotal: computed_subtotal,
        discount_total: computed_discount_total,
        total: computed_total,
        notes: Some(invoice.notes.clone()),
        company: InvoicePdfCompany {
            company_name: settings.company_name.clone(),
            registration_number: settings.registration_number.clone(),
            pib: settings.pib.clone(),
            address: {
                let line1 = settings.company_address_line.trim();
                let postal = settings.company_postal_code.trim();
                let city = settings.company_city.trim();
                let mut line2 = String::new();
                if !postal.is_empty() {
                    line2.push_str(postal);
                }
                if !city.is_empty() {
                    if !line2.is_empty() {
                        line2.push(' ');
                    }
                    line2.push_str(city);
                }
                [line1.to_string(), line2].into_iter().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>().join("\n")
            },
            address_line: Some(settings.company_address_line.clone()).filter(|s| !s.trim().is_empty()),
            postal_code: Some(settings.company_postal_code.clone()).filter(|s| !s.trim().is_empty()),
            city: Some(settings.company_city.clone()).filter(|s| !s.trim().is_empty()),
            bank_account: settings.bank_account.clone(),
            email: Some(settings.company_email.clone()).filter(|s| !s.trim().is_empty()),
            phone: Some(settings.company_phone.clone()).filter(|s| !s.trim().is_empty()),
        },
        client: InvoicePdfClient {
            name: invoice.client_name.clone(),
            registration_number: client
                .map(|c| c.registration_number.clone())
                .filter(|s| !s.trim().is_empty()),
            pib: client.map(|c| c.pib.clone()).filter(|s| !s.trim().is_empty()),
            address: client.map(|c| c.address.clone()).filter(|s| !s.trim().is_empty()),
            address_line: client.map(|c| c.address.clone()).filter(|s| !s.trim().is_empty()),
            postal_code: client.map(|c| c.postal_code.clone()).filter(|s| !s.trim().is_empty()),
            city: client.map(|c| c.city.clone()).filter(|s| !s.trim().is_empty()),
            email: client.map(|c| c.email.clone()).filter(|s| !s.trim().is_empty()),
            phone: None,
        },
        items,
    }
}

#[derive(Debug, Clone, Deserialize)]
struct MandatoryInvoiceNoteLocale {
    lines: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct MandatoryInvoiceNoteTemplates {
    sr: MandatoryInvoiceNoteLocale,
    en: MandatoryInvoiceNoteLocale,
}

static MANDATORY_NOTE_TEMPLATES: OnceLock<MandatoryInvoiceNoteTemplates> = OnceLock::new();

fn mandatory_invoice_note_templates() -> &'static MandatoryInvoiceNoteTemplates {
    MANDATORY_NOTE_TEMPLATES.get_or_init(|| {
        let json = include_str!("../../src/shared/mandatoryInvoiceNote.json");
        serde_json::from_str::<MandatoryInvoiceNoteTemplates>(json)
            .unwrap_or_else(|_| MandatoryInvoiceNoteTemplates {
                sr: MandatoryInvoiceNoteLocale { lines: vec![] },
                en: MandatoryInvoiceNoteLocale { lines: vec![] },
            })
    })
}

fn mandatory_invoice_note_lines(lang: &str, invoice_number: &str) -> Vec<String> {
    let l = lang.to_ascii_lowercase();
    let templates = mandatory_invoice_note_templates();
    let lines = if l.starts_with("en") {
        &templates.en.lines
    } else {
        &templates.sr.lines
    };

    lines
        .iter()
        .map(|line| line.replace("{INVOICE_NUMBER}", invoice_number))
        .collect()
}

fn mandatory_invoice_note_text(lang: &str, invoice_number: &str) -> String {
    mandatory_invoice_note_lines(lang, invoice_number).join("\n")
}

fn mandatory_invoice_note_html(lang: &str, invoice_number: &str) -> String {
    mandatory_invoice_note_lines(lang, invoice_number)
        .into_iter()
        .map(|l| escape_html(&l))
        .collect::<Vec<_>>()
        .join("<br/>")
}

fn draw_inline_labeled_row(
    layer: &printpdf::PdfLayerReference,
    font: &printpdf::IndirectFontRef,
    ttf_face: &ttf_parser::Face<'_>,
    label: &str,
    value: &str,
    font_size: f32,
    x: f32,
    y: f32,
    max_width_total: f32,
    line_height: f32,
    row_gap: f32,
) -> f32 {
    let v = value.trim();
    if v.is_empty() {
        return y;
    }

    // Exactly ONE space after the colon.
    let prefix = format!("{}: ", label);
    let prefix_w = text_width_mm_ttf(ttf_face, &prefix, font_size);
    let value_x = x + prefix_w;
    let value_w = (max_width_total - prefix_w).max(6.0);

    let value_lines = wrap_text_by_width_mm(ttf_face, v, font_size, value_w);
    if value_lines.is_empty() {
        return y;
    }

    push_line(layer, font, &prefix, font_size, x, y);
    push_line(layer, font, &value_lines[0], font_size, value_x, y);

    for (idx, line) in value_lines.iter().enumerate().skip(1) {
        let yy = y - (idx as f32) * line_height;
        push_line(layer, font, line, font_size, value_x, yy);
    }

    y - (value_lines.len() as f32) * line_height - row_gap
}

#[tauri::command]
async fn get_app_meta(state: tauri::State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    state.with_read("get_app_meta", move |conn| app_meta_get(conn, &key)).await
}

#[tauri::command]
async fn set_app_meta(state: tauri::State<'_, DbState>, key: String, value: String) -> Result<bool, String> {
    state
        .with_write("set_app_meta", move |conn| {
            app_meta_set(conn, &key, &value)?;
            Ok(true)
        })
        .await
}

#[tauri::command]
fn hash_pib(pib: String) -> String {
    license::crypto::sha256_hex(pib.trim())
}

#[tauri::command]
fn get_force_locked_env() -> bool {
    if !cfg!(debug_assertions) {
        return false;
    }

    let raw = match std::env::var("PAUSALER_FORCE_LOCKED") {
        Ok(v) => v,
        Err(_) => return false,
    };

    matches!(
        raw.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "y" | "on"
    )
}

#[tauri::command]
fn get_force_lock_level_env() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }

    // New multi-level override.
    if let Ok(raw) = std::env::var("PAUSALER_FORCE_LOCK_LEVEL") {
        let v = raw.trim().to_ascii_lowercase();
        let normalized = match v.as_str() {
            "view_only" | "view-only" | "viewonly" => Some("VIEW_ONLY"),
            "hard" | "locked" | "lock" => Some("HARD"),
            "none" | "off" | "0" | "false" | "no" => None,
            _ => None,
        };
        if let Some(level) = normalized {
            return Some(level.to_string());
        }
    }

    // Backward-compatible boolean override => HARD.
    if get_force_locked_env() {
        return Some("HARD".to_string());
    }

    None
}

#[tauri::command]
fn generate_activation_code(pib: String) -> Result<String, String> {
    let pib_hash = license::crypto::sha256_hex(pib.trim());
    let app_id = "com.dstankovski.pausaler-app".to_string();
    let issued_at = OffsetDateTime::now_utc().unix_timestamp();
    license::activation_code::generate_activation_code(pib_hash, app_id, issued_at)
}

#[tauri::command]
fn verify_license(license: String, pib: String) -> Result<license::license_payload::VerifiedLicenseInfo, String> {
    let public_key_pem = include_str!("../assets/public_key.pem");
    let pib_hash = license::crypto::sha256_hex(pib.trim());
    let now = OffsetDateTime::now_utc();
    license::license_validator::verify_license(&license, &pib_hash, public_key_pem, now)
}