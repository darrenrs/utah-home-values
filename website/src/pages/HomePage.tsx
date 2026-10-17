import { useEffect, useState } from "react";
import GeographyExplorer from "../components/GeographyExplorer";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import {
  loadData,
  type AttributeData,
  type DataBundle,
} from "../data/loadData";
import { formatNumber } from "../lib/format";
import { withBaseUrl } from "../lib/baseUrl";
import PageTitle from "../components/PageTitle";
import { HOME_VALUE_LOOKUP_ID } from "../components/HomeValueLookup";

// The URL hash holds the selected geography, so this scrolls to the lookup
// instead of linking to it.
function focusHomeValueLookup() {
  const lookup = document.getElementById(HOME_VALUE_LOOKUP_ID);
  if (!lookup) {
    return;
  }

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  lookup.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
  lookup.querySelector("input")?.focus({ preventScroll: true });
}

function CoverageStats({ data }: { data: AttributeData }) {
  const homes = Object.values(data.County).reduce(
    (total, row) => total + row.n,
    0,
  );
  const stats = [
    { value: homes, label: "Homes" },
    { value: Object.keys(data.County).length, label: "Counties" },
    { value: Object.keys(data.Place).length, label: "Cities & CDPs" },
    { value: Object.keys(data.ZCTA5).length, label: "ZIP Codes" },
  ];

  return (
    <dl className="hero-stats">
      {stats.map((stat) => (
        <div key={stat.label} className="hero-stat">
          <dt>{stat.label}</dt>
          <dd>{formatNumber(stat.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function HeroSection({ dataBundle }: { dataBundle?: DataBundle }) {
  return (
    <>
      <PageTitle title="Utah Home Values Explorer" />
      <section className="hero hero-split hero-split-main-page">
        <div className="stack hero-main-copy">
          <div className="hero-main-title-row">
            <h1>Utah Home Values Explorer</h1>
            <div className="hero-image-frame hero-image-frame-mobile">
              <img
                src={withBaseUrl("image.png")}
                alt=""
                className="hero-image"
              />
            </div>
          </div>
          <p>
            Browse and compare estimated single-family home values across{" "}
            <strong>Utah cities, counties, ZIP codes, and regions</strong>.
          </p>
          {dataBundle && <CoverageStats data={dataBundle.datasets.market} />}
          {dataBundle && (
            <button
              type="button"
              className="hero-link"
              onClick={focusHomeValueLookup}
            >
              Look up a home value <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
        <div
          className="hero-image-frame hero-image-frame-desktop"
          aria-hidden="true"
        >
          <img src={withBaseUrl("image.png")} alt="" className="hero-image" />
        </div>
      </section>
    </>
  );
}

function DataStatus({ errorMessage }: { errorMessage?: string }) {
  return (
    <section className="explorer-shell data-status" id="explorer">
      {errorMessage ? (
        <>
          <h2>Unable to load home values</h2>
          <p role="alert">{errorMessage}</p>
        </>
      ) : (
        <p role="status">Loading home values...</p>
      )}
    </section>
  );
}

function HomePage() {
  const [dataBundle, setDataBundle] = useState<DataBundle>();
  const [errorMessage, setErrorMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    loadData()
      .then((data) => {
        if (!cancelled) {
          setDataBundle(data);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : "Unknown data error",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-shell">
      <SiteHeader />

      <main className="container">
        <div className="page-stack">
          <HeroSection dataBundle={dataBundle} />

          {dataBundle ? (
            <GeographyExplorer dataBundle={dataBundle} />
          ) : (
            <DataStatus errorMessage={errorMessage} />
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

export default HomePage;
