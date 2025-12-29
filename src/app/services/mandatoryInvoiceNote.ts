import templates from '../../shared/mandatoryInvoiceNote.json';

type Templates = typeof templates;

type Lang = 'sr' | 'en';

function normalizeLang(lang: string): Lang {
  return lang.toLowerCase().startsWith('en') ? 'en' : 'sr';
}

export function mandatoryInvoiceNoteLines(args: {
  language: string;
  invoiceNumber: string;
}): string[] {
  const lang = normalizeLang(args.language);
  const lines = (templates as Templates)[lang].lines as string[];
  return lines.map((l) => l.replace('{INVOICE_NUMBER}', args.invoiceNumber));
}

export function mandatoryInvoiceNoteText(args: {
  language: string;
  invoiceNumber: string;
}): string {
  return mandatoryInvoiceNoteLines(args).join('\n');
}
