use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

use lettre::message::{header::ContentType, Attachment, Mailbox, Message, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{SmtpTransport, Transport};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoicePdfCompany {
    pub company_name: String,
    pub pib: String,
    pub address: String,
    pub bank_account: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoicePdfClient {
    pub name: String,
    pub pib: Option<String>,
    pub address: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoicePdfItem {
    pub description: String,
    pub quantity: f64,
    pub unit_price: f64,
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

fn generate_pdf_bytes(payload: &InvoicePdfPayload) -> Result<Vec<u8>, String> {
    use printpdf::{BuiltinFont, Mm, PdfDocument};

    let lang = payload
        .language
        .as_deref()
        .unwrap_or("sr")
        .to_ascii_lowercase();
    let tr = |sr: &'static str, en: &'static str| if lang.starts_with("en") { en } else { sr };

    let (doc, page1, layer1) = PdfDocument::new(
        tr("Faktura", "Invoice"),
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );
    let layer = doc.get_page(page1).get_layer(layer1);

    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| e.to_string())?;

    let mut y: f32 = 285.0;

    // Header: Company (left)
    push_line(&layer, &font_bold, &payload.company.company_name, 16.0, 15.0, y);
    y -= 7.0;
    push_line(&layer, &font, &format!("{}: {}", tr("PIB", "VAT ID"), payload.company.pib), 10.0, 15.0, y);
    y -= 5.0;
    push_line(&layer, &font, &payload.company.address, 10.0, 15.0, y);
    y -= 5.0;
    push_line(
        &layer,
        &font,
        &format!("{}: {}", tr("Tekući račun", "Bank account"), payload.company.bank_account),
        10.0,
        15.0,
        y,
    );

    // Header: Title (right)
    push_line(&layer, &font_bold, tr("FAKTURA", "INVOICE"), 24.0, 145.0, 285.0);
    push_line(&layer, &font_bold, &payload.invoice_number, 12.0, 145.0, 277.0);

    // Divider
    y = 265.0;
    layer.add_line(
        printpdf::Line {
            points: vec![
                (printpdf::Point::new(Mm(15.0), Mm(y)), false),
                (printpdf::Point::new(Mm(195.0), Mm(y)), false),
            ],
            is_closed: false,
        },
    );

    // Buyer + invoice details
    y -= 10.0;
    push_line(&layer, &font_bold, tr("Kupac:", "Buyer:"), 12.0, 15.0, y);
    push_line(&layer, &font_bold, tr("Detalji:", "Details:"), 12.0, 120.0, y);

    y -= 7.0;
    push_line(&layer, &font, &payload.client.name, 10.0, 15.0, y);
    push_line(
        &layer,
        &font,
        &format!("{}: {}", tr("Datum izdavanja", "Issue date"), payload.issue_date),
        10.0,
        120.0,
        y,
    );

    y -= 5.0;
    if let Some(pib) = &payload.client.pib {
        push_line(&layer, &font, &format!("{}: {}", tr("PIB", "VAT ID"), pib), 10.0, 15.0, y);
    }
    push_line(
        &layer,
        &font,
        &format!("{}: {}", tr("Datum prometa", "Service date"), payload.service_date),
        10.0,
        120.0,
        y,
    );

    y -= 5.0;
    if let Some(addr) = &payload.client.address {
        push_line(&layer, &font, addr, 10.0, 15.0, y);
    }
    push_line(
        &layer,
        &font,
        &format!("{}: {}", tr("Valuta", "Currency"), payload.currency),
        10.0,
        120.0,
        y,
    );

    y -= 12.0;

    // Items table header
    push_line(&layer, &font_bold, tr("Stavke", "Items"), 12.0, 15.0, y);
    y -= 6.0;

    // Table columns (x positions)
    let x_desc = 15.0;
    let x_qty = 120.0;
    let x_unit = 145.0;
    let x_total = 175.0;

    push_line(&layer, &font_bold, tr("Opis", "Description"), 10.0, x_desc, y);
    push_line(&layer, &font_bold, tr("Kol.", "Qty"), 10.0, x_qty, y);
    push_line(&layer, &font_bold, tr("Cena", "Price"), 10.0, x_unit, y);
    push_line(&layer, &font_bold, tr("Ukupno", "Total"), 10.0, x_total, y);

    y -= 3.5;
    layer.add_line(
        printpdf::Line {
            points: vec![
                (printpdf::Point::new(Mm(15.0), Mm(y)), false),
                (printpdf::Point::new(Mm(195.0), Mm(y)), false),
            ],
            is_closed: false,
        },
    );
    y -= 7.0;

    // Rows
    for (idx, it) in payload.items.iter().enumerate() {
        if y < 40.0 {
            return Err("Previše stavki za jednu stranu (za sad).".to_string());
        }

        let desc = format!("{}. {}", idx + 1, it.description);
        push_line(&layer, &font, &desc, 10.0, x_desc, y);
        push_line(&layer, &font, &format!("{:.2}", it.quantity), 10.0, x_qty, y);
        push_line(&layer, &font, &format_money(it.unit_price), 10.0, x_unit, y);
        push_line(&layer, &font_bold, &format_money(it.total), 10.0, x_total, y);

        y -= 6.0;
    }

    y -= 4.0;
    layer.add_line(
        printpdf::Line {
            points: vec![
                (printpdf::Point::new(Mm(15.0), Mm(y)), false),
                (printpdf::Point::new(Mm(195.0), Mm(y)), false),
            ],
            is_closed: false,
        },
    );

    // Totals
    y -= 10.0;
    push_line(&layer, &font, &format!("{}:", tr("Osnovica", "Subtotal")), 11.0, 145.0, y);
    push_line(&layer, &font_bold, &format_money(payload.subtotal), 11.0, 175.0, y);

    y -= 7.0;
    push_line(&layer, &font_bold, &format!("{}:", tr("UKUPNO", "TOTAL")), 13.0, 145.0, y);
    push_line(&layer, &font_bold, &format!("{} {}", format_money(payload.total), payload.currency), 13.0, 165.0, y);

    // Notes
    if let Some(notes) = &payload.notes {
        if !notes.trim().is_empty() {
            y -= 14.0;
            push_line(&layer, &font_bold, &format!("{}:", tr("Napomene", "Notes")), 11.0, 15.0, y);
            y -= 6.0;

            let mut current_y = y;
            for line in notes.lines() {
                if current_y < 20.0 { break; }
                push_line(&layer, &font, line, 10.0, 15.0, current_y);
                current_y -= 5.0;
            }
        }
    }

    // Footer
    push_line(&layer, &font, tr("Generisano iz Pausaler aplikacije.", "Generated from Pausaler app."), 9.0, 15.0, 12.0);

    let mut writer = std::io::BufWriter::new(Vec::<u8>::new());
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    writer
        .into_inner()
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub is_configured: Option<bool>,
    pub company_name: String,
    pub pib: String,
    pub address: String,
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
}

fn default_smtp_use_tls() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub is_configured: Option<bool>,
    pub company_name: Option<String>,
    pub pib: Option<String>,
    pub address: Option<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub id: String,
    pub name: String,
    pub pib: String,
    pub address: String,
    pub email: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewClient {
    pub name: String,
    pub pib: String,
    pub address: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceItem {
    pub id: String,
    pub description: String,
    pub quantity: f64,
    pub unit_price: f64,
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
        pib: "".to_string(),
        address: "".to_string(),
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
            pib TEXT NOT NULL,
            address TEXT NOT NULL,
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
            data_json TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
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

        CREATE INDEX IF NOT EXISTS idx_invoices_invoiceNumber ON invoices(invoiceNumber);
        CREATE INDEX IF NOT EXISTS idx_invoices_clientId ON invoices(clientId);
        CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
        "#,
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
        conn.execute_batch("PRAGMA user_version = 4;")?;
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
            id, isConfigured, companyName, pib, address, bankAccount, logoUrl,
            invoicePrefix, nextInvoiceNumber, defaultCurrency, language,
            smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom, smtpUseTls,
            data_json, updatedAt
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15, ?16, ?17,
            ?18, ?19
        )"#,
        params![
            SETTINGS_ID,
            s.is_configured.unwrap_or(false) as i32,
            s.company_name,
            s.pib,
            s.address,
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
            "SELECT data_json, isConfigured, companyName, pib, address, bankAccount, logoUrl, invoicePrefix, nextInvoiceNumber, defaultCurrency, language, smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom, smtpUseTls FROM settings WHERE id = ?1",
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
                    r.get::<_, i64>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, String>(10)?,
                    r.get::<_, String>(11)?,
                    r.get::<_, i64>(12)?,
                    r.get::<_, String>(13)?,
                    r.get::<_, String>(14)?,
                    r.get::<_, String>(15)?,
                    r.get::<_, i64>(16)?,
                ))
            },
        )
        .optional()?;

    if let Some((data_json, is_cfg, company, pib, addr, bank, logo, prefix, next, currency, lang, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from, smtp_use_tls)) = row {
        if let Ok(mut parsed) = serde_json::from_str::<Settings>(&data_json) {
            if let Some(v) = is_cfg {
                parsed.is_configured = Some(v != 0);
            }
            parsed.smtp_host = smtp_host;
            parsed.smtp_port = smtp_port;
            parsed.smtp_user = smtp_user;
            parsed.smtp_password = smtp_password;
            parsed.smtp_from = smtp_from;
            parsed.smtp_use_tls = smtp_use_tls != 0;
            return Ok(parsed);
        }

        return Ok(Settings {
            is_configured: is_cfg.map(|v| v != 0),
            company_name: company,
            pib,
            address: addr,
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
            if let Some(v) = patch.pib {
                current.pib = v;
            }
            if let Some(v) = patch.address {
                current.address = v;
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
            if let Some(v) = patch.smtp_port {
                current.smtp_port = v;
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

            let now = now_iso();
            let json = serde_json::to_string(&current).unwrap_or_else(|_| "{}".to_string());
            let is_cfg = current.is_configured.unwrap_or(false);

            conn.execute(
                r#"UPDATE settings SET
                    isConfigured = ?2,
                    companyName = ?3,
                    pib = ?4,
                    address = ?5,
                    bankAccount = ?6,
                    logoUrl = ?7,
                    invoicePrefix = ?8,
                    nextInvoiceNumber = ?9,
                    defaultCurrency = ?10,
                    language = ?11,
                    smtpHost = ?12,
                    smtpPort = ?13,
                    smtpUser = ?14,
                    smtpPassword = ?15,
                    smtpFrom = ?16,
                    smtpUseTls = ?17,
                    data_json = ?18,
                    updatedAt = ?19
                   WHERE id = ?1"#,
                params![
                    SETTINGS_ID,
                    is_cfg as i32,
                    current.company_name,
                    current.pib,
                    current.address,
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
                pib: input.pib,
                address: input.address,
                email: input.email,
                created_at: now_iso(),
            };
            let json = serde_json::to_string(&created).unwrap_or_else(|_| "{}".to_string());
            conn.execute(
                r#"INSERT INTO clients (id, name, pib, address, email, phone, createdAt, data_json)
                   VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)"#,
                params![
                    created.id,
                    created.name,
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
            if let Some(v) = patch.get("pib").and_then(|v| v.as_str()) {
                existing.pib = v.to_string();
            }
            if let Some(v) = patch.get("address").and_then(|v| v.as_str()) {
                existing.address = v.to_string();
            }
            if let Some(v) = patch.get("email").and_then(|v| v.as_str()) {
                existing.email = v.to_string();
            }

            let json = serde_json::to_string(&existing).unwrap_or_else(|_| "{}".to_string());
            conn.execute(
                r#"UPDATE clients SET name=?2, pib=?3, address=?4, email=?5, data_json=?6 WHERE id=?1"#,
                params![id, existing.name, existing.pib, existing.address, existing.email, json],
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

    let body_text = body.unwrap_or_default();

    let email = if include_pdf {
        let payload = build_invoice_pdf_payload_from_db(&invoice, client.as_ref(), &settings);
        let pdf_bytes = generate_pdf_bytes(&payload)?;
        let filename = sanitize_filename(&format!("{}.pdf", invoice.invoice_number));

        let attachment = Attachment::new(filename)
            .body(pdf_bytes, ContentType::parse("application/pdf").unwrap());

        Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(subject)
            .multipart(
                MultiPart::mixed()
                    .singlepart(SinglePart::plain(body_text))
                    .singlepart(attachment),
            )
            .map_err(|e| format!("Failed to build email: {e}"))?
    } else {
        Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(subject)
            .body(body_text)
            .map_err(|e| format!("Failed to build email: {e}"))?
    };

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
fn export_invoice_pdf_to_downloads(app: tauri::AppHandle, payload: InvoicePdfPayload) -> Result<String, String> {
    let bytes = generate_pdf_bytes(&payload)?;

    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;

    let filename = sanitize_filename(&format!("{}-{}.pdf", payload.invoice_number, payload.client.name));
    let full_path = downloads_dir.join(filename);

    std::fs::write(&full_path, bytes).map_err(|e| e.to_string())?;

    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let db = DbState::new(&handle)?;
            app.manage(db);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            export_invoice_pdf_to_downloads,
            get_settings,
            update_settings,
            generate_invoice_number,
            get_all_clients,
            get_client_by_id,
            create_client,
            update_client,
            delete_client,
            get_all_invoices,
            get_invoice_by_id,
            create_invoice,
            update_invoice,
            delete_invoice,
            send_invoice_email
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
    Ok(())
}

fn build_smtp_transport(s: &Settings) -> Result<SmtpTransport, String> {
    validate_smtp_settings(s)?;
    let port: u16 = s.smtp_port as u16;

    let mut builder = if s.smtp_use_tls {
        SmtpTransport::relay(&s.smtp_host)
            .map_err(|e| format!("Invalid SMTP host: {e}"))?
            .port(port)
    } else {
        SmtpTransport::builder_dangerous(&s.smtp_host).port(port)
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
    InvoicePdfPayload {
        language: Some(settings.language.clone()),
        invoice_number: invoice.invoice_number.clone(),
        issue_date: invoice.issue_date.clone(),
        service_date: invoice.service_date.clone(),
        currency: invoice.currency.clone(),
        subtotal: invoice.subtotal,
        total: invoice.total,
        notes: Some(invoice.notes.clone()),
        company: InvoicePdfCompany {
            company_name: settings.company_name.clone(),
            pib: settings.pib.clone(),
            address: settings.address.clone(),
            bank_account: settings.bank_account.clone(),
        },
        client: InvoicePdfClient {
            name: invoice.client_name.clone(),
            pib: client.map(|c| c.pib.clone()).filter(|s| !s.trim().is_empty()),
            address: client.map(|c| c.address.clone()).filter(|s| !s.trim().is_empty()),
            email: client.map(|c| c.email.clone()).filter(|s| !s.trim().is_empty()),
        },
        items: invoice
            .items
            .iter()
            .map(|it| InvoicePdfItem {
                description: it.description.clone(),
                quantity: it.quantity,
                unit_price: it.unit_price,
                total: it.total,
            })
            .collect(),
    }
}