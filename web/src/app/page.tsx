import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { HomeApp } from '@/components/home/HomeApp';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <div className="flex-1">
        <HomeApp />
      </div>
      <Footer />
    </main>
  );
}
