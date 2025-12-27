import dayjs from 'dayjs';

import type { Invoice } from '../types';

type InvoiceOverdueInput = Pick<Invoice, 'status' | 'paidAt' | 'dueDate'>;

type ReferenceDate = dayjs.Dayjs | string | Date;

function startOfDay(d: ReferenceDate): dayjs.Dayjs {
  return dayjs(d).startOf('day');
}

/**
 * Overdue is a derived UI-only state:
 * - status === 'SENT'
 * - paidAt == null
 * - dueDate < today
 */
export function isInvoiceOverdue(invoice: InvoiceOverdueInput, referenceDate: ReferenceDate = dayjs()): boolean {
  if (invoice.status !== 'SENT') return false;
  if (invoice.paidAt != null) return false;
  if (!invoice.dueDate) return false;

  const due = startOfDay(invoice.dueDate);
  const today = startOfDay(referenceDate);

  return due.isBefore(today);
}

/**
 * Returns overdue days (>= 1) when overdue, otherwise null.
 */
export function getInvoiceOverdueDays(
  invoice: InvoiceOverdueInput,
  referenceDate: ReferenceDate = dayjs(),
): number | null {
  if (!isInvoiceOverdue(invoice, referenceDate)) return null;

  const due = startOfDay(invoice.dueDate as string);
  const today = startOfDay(referenceDate);

  const days = today.diff(due, 'day');
  return days > 0 ? days : null;
}
