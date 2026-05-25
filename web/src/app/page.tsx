import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { HomeApp } from '@/components/home/HomeApp';

/**
 * The home is the app. Auth state is now read client-side from the
 * zustand store (`@/stores/auth-store`) — populated by `/login`,
 * `/signup`, or restored from `localStorage` on mount. The SSR pass
 * always renders the anonymous surface; the hydrated client flips to
 * the authenticated surface once the store says so. This avoids
 * passing a cookie-derived flag down the tree just to drive a single
 * branch — and keeps the server pass cacheable.
 */
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
