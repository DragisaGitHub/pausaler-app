import { clientService, invoiceService } from './storage';

export const seedDemoData = () => {
  // Seed only on empty store (avoid corrupting real user data)
  const existingClients = clientService.getAll();
  const existingInvoices = invoiceService.getAll();
  if (existingClients.length > 0 || existingInvoices.length > 0) {
    return;
  }

  // Create demo clients
  const client1 = clientService.create({
    name: 'Tech Solutions DOO',
    pib: '987654321',
    address: 'Kneza Miloša 10, 11000 Beograd',
    email: 'info@techsolutions.rs',
  });

  const client2 = clientService.create({
    name: 'Digital Marketing Agency',
    pib: '123987456',
    address: 'Terazije 5, 11000 Beograd',
    email: 'kontakt@digitalmarketing.rs',
  });

  const client3 = clientService.create({
    name: 'Consulting Group',
    pib: '456123789',
    address: 'Bulevar kralja Aleksandra 15, 11000 Beograd',
    email: 'office@consulting.rs',
  });

  // Create demo invoices
  invoiceService.create({
    invoiceNumber: 'INV-0001',
    clientId: client1.id,
    clientName: client1.name,
    issueDate: '2024-12-01',
    serviceDate: '2024-12-01',
    currency: 'RSD',
    items: [
      {
        id: '1',
        description: 'Izrada web sajta',
        quantity: 1,
        unitPrice: 120000,
        total: 120000,
      },
      {
        id: '2',
        description: 'Godišnje održavanje',
        quantity: 1,
        unitPrice: 30000,
        total: 30000,
      },
    ],
    subtotal: 150000,
    total: 150000,
    notes: 'Rok plaćanja: 15 dana od datuma izdavanja fakture.',
  });

  invoiceService.create({
    invoiceNumber: 'INV-0002',
    clientId: client2.id,
    clientName: client2.name,
    issueDate: '2024-12-10',
    serviceDate: '2024-12-10',
    currency: 'EUR',
    items: [
      {
        id: '1',
        description: 'SEO optimizacija',
        quantity: 1,
        unitPrice: 800,
        total: 800,
      },
      {
        id: '2',
        description: 'Google Ads kampanja',
        quantity: 3,
        unitPrice: 500,
        total: 1500,
      },
    ],
    subtotal: 2300,
    total: 2300,
    notes: 'Mesečna usluga za period januar-mart 2025.',
  });

  invoiceService.create({
    invoiceNumber: 'INV-0003',
    clientId: client3.id,
    clientName: client3.name,
    issueDate: '2024-12-15',
    serviceDate: '2024-12-15',
    currency: 'RSD',
    items: [
      {
        id: '1',
        description: 'Konsultantske usluge',
        quantity: 40,
        unitPrice: 5000,
        total: 200000,
      },
    ],
    subtotal: 200000,
    total: 200000,
    notes: 'Konsultantske usluge za projekat optimizacije poslovnih procesa.',
  });

  console.log('Demo data seeded successfully!');
};

const ENABLE_DEMO_SEED = import.meta.env.VITE_DEMO_SEED === 'true';

if (ENABLE_DEMO_SEED) {
  seedDemoData();
}