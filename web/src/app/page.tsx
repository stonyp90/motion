import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { HomeApp } from '@/components/home/HomeApp';
import { auth } from '@/lib/auth';

/**
 * The home is the app. Server-side we resolve the session so the
 * prompt input, cast, voice, and Generate button are only rendered
 * for authenticated users — anonymous visitors see the brand H1 +
 * KPI strip + a sign-in CTA. This stops anyone from posting a
 * prompt to the engine (which burns compute credits) without auth.
 */
export default async function Home() {
  const session = await auth();
  const isAuthenticated = !!session?.user;

  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <div className="flex-1">
        <HomeApp isAuthenticated={isAuthenticated} />
      </div>
      <Footer />
    </main>
  );
}
