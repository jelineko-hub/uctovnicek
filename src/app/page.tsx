import Link from 'next/link';
import { APP_VERSION } from '@/lib/version';

export default function Home() {
  return (
    <main className="wrap">
      <h1>Účtovníček</h1>
      <p>Bločky, prijaté a vydané faktúry, banka a export do MRP-K/S — pre slovenské firmy a ich účtovníkov.</p>
      <p><Link href="/app">Vstúpiť do aplikácie</Link></p>
      <p className="muted">{APP_VERSION}</p>
    </main>
  );
}
