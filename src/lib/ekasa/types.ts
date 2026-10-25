/** Odpoveď eKasa „Over doklad" (`opd/receipt/find`) — len polia, ktoré používame. Tvar overený na reálnom bločku (PD). */
export interface EkasaItem {
  name: string;
  itemType: string | null;      // K = bežná položka; ďalšie typy [neoverené]
  quantity: number;
  vatRate: number | null;
  price: number;                // cena celého riadku S DPH (3 ks × 3,40 = 10,20)
}

export interface EkasaAddress {
  name?: string | null;
  ico?: string | null;
  dic?: string | null;
  icDph?: string | null;
  streetName?: string | null;
  buildingNumber?: string | null;
  propertyRegistrationNumber?: string | null;
  municipality?: string | null;
  postalCode?: string | null;
  country?: string | null;
  vatPayer?: boolean | null;
}

export interface EkasaReceipt {
  receiptId: string;
  ico: string | null;
  dic: string | null;
  icDph: string | null;
  cashRegisterCode: string | null;
  issueDate: string;            // 'dd.MM.yyyy HH:mm:ss'
  receiptNumber: number | null;
  invoiceNumber: string | null;
  paragon: boolean;
  paragonNumber: number | null;
  type: string;                 // PD = pokladničný doklad; ďalšie typy [neoverené]
  totalPrice: number;
  exemption: boolean;
  items: EkasaItem[];
  organization: EkasaAddress | null;
  unit: EkasaAddress | null;
  vatSummary: { vatBase: number; vatAmount: number; vat: { vatRate: number } }[] | null;
}

export interface EkasaResponse {
  returnValue: number;
  receipt: EkasaReceipt | null;
}
