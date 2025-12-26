use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

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
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: r#"
                PRAGMA foreign_keys = ON;

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
                    currency TEXT NOT NULL,
                    totalAmount REAL NOT NULL,
                    createdAt TEXT NOT NULL,
                    data_json TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_invoices_invoiceNumber ON invoices(invoiceNumber);
                CREATE INDEX IF NOT EXISTS idx_invoices_clientId ON invoices(clientId);
                CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

                PRAGMA user_version = 1;
            "#,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pausaler.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, export_invoice_pdf_to_downloads])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}