import { PublicApp } from "@/components/PublicApp";

export default function Home() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="center-screen">
        <section className="setup-card">
          <p className="eyebrow">SETUP REQUIRED</p>
          <h1>Connect Convex to begin.</h1>
          <p>Run <code>npm run dev:backend</code>, then restart the app.</p>
        </section>
      </main>
    );
  }

  return <PublicApp />;
}
