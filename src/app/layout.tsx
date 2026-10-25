import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Účtovníček',
  description: 'Doklady, faktúry a banka na jednom mieste — export do MRP-K/S.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body>{children}</body>
    </html>
  );
}
