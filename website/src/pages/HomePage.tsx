import { useEffect, useState } from "react";
import CoverageCards from "../components/CoverageCards";
import GeographyExplorer from "../components/GeographyExplorer";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import { loadData, type DataBundle } from "../data/loadData";
import { withBaseUrl } from "../lib/baseUrl";
import PageTitle from "../components/PageTitle";

function HeroSection() {
  return (
    <>
      <PageTitle title="Utah Home Value Explorer" />
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
          <p>
            Assessed values are{" "}
            <strong>reported on a county-by-county basis</strong> and may not
            reflect the same year; cross-county comparisons of assessed values
            are not supported at this time.
          </p>
          <p>
            Interested in how much your home is worth? The most reliable
            estimate besides contacting a real estate agent is to look up your
            home in your county's <strong>parcel search</strong> tool (Google "X
            County Parcel Search".) Choose the assessed value for the year shown
            next to the Assessed button for your county. In the assessed view,
            find the percentile closest to that value, then switch to
            Market-adjusted (2025) and read the value at the same percentile.
          </p>
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
          <HeroSection />

          {dataBundle ? (
            <>
              <GeographyExplorer dataBundle={dataBundle} />
              <CoverageCards data={dataBundle.datasets.market} />
            </>
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
