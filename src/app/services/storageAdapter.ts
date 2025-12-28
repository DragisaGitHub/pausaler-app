import type { Client, Expense, ExpenseRange, Invoice, Settings } from '../types';

/**
 * Thin async abstraction over the persistence layer.
 *
 * P1-A scope: this interface matches the existing operations in `services/storage.ts`,
 * but uses Promise-based signatures to allow future storage implementations.
 */
export interface StorageAdapter {
  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  generateInvoiceNumber(): Promise<string>;

  // Clients
  getAllClients(): Promise<Client[]>;
  getClientById(id: string): Promise<Client | undefined>;
  createClient(data: Omit<Client, 'id' | 'createdAt'>): Promise<Client>;
  updateClient(id: string, patch: Partial<Client>): Promise<Client | null>;
  deleteClient(id: string): Promise<boolean>;

  // Invoices
  getAllInvoices(): Promise<Invoice[]>;
  getInvoiceById(id: string): Promise<Invoice | undefined>;
  createInvoice(data: Omit<Invoice, 'id' | 'createdAt'>): Promise<Invoice>;
  updateInvoice(id: string, patch: Partial<Invoice>): Promise<Invoice | null>;
  deleteInvoice(id: string): Promise<boolean>;

  // Expenses
  listExpenses(range?: ExpenseRange): Promise<Expense[]>;
  createExpense(data: Omit<Expense, 'id' | 'createdAt'>): Promise<Expense>;
  updateExpense(
    id: string,
    patch: Partial<Omit<Expense, 'id' | 'createdAt'>>
  ): Promise<Expense | null>;
  deleteExpense(id: string): Promise<boolean>;

  // Email
  sendInvoiceEmail(input: {
    invoiceId: string;
    to: string;
    subject: string;
    body?: string;
    includePdf: boolean;
  }): Promise<boolean>;
}
