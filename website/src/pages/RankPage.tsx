import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";

function RankPage() {
  return (
    <div className="page-shell">
      <SiteHeader />

      <main className="container">
        <div className="page-stack">
          <section className="page-section">
            <h2>Rankings</h2>
            <p>Coming soon!</p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

export default RankPage;
