import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";

function AboutPage() {
  return (
    <div className="page-shell">
      <SiteHeader />

      <main className="container">
        <div className="page-stack">
          <div className="about-intro">
            <p className="eyebrow">Utah Home Values</p>
            <h1>Data/Methodology</h1>
            <p>Data sources and methodology for Utah Home Values.</p>
          </div>

          <section className="page-section">
            <div className="method-grid">
              <article className="copy-card">
                <h3>Data Pipeline</h3>
                <p>
                  The Utah Housing Unit Inventory dataset, which includes
                  reliable data for seven primarily urban counties in Utah, is
                  the initial source of truth. Outlier records and
                  non-single-family units are filtered out; some townhomes and
                  condos are kept if there is evidence that they are single-unit
                  dwellings. The original assessed values are adjusted to
                  estimated real market values based on actual sales data.
                </p>
              </article>
              <article className="copy-card">
                <h3>Geography</h3>
                <p>
                  To summarize by Place / CDP, all parcels are projected onto
                  Census place shapefile coordinate system, converted to a
                  representative point, and spatially joined to the place
                  polygon that contains it. This method is superior to the CITY
                  attribute in the Housing Unit Inventory dataset because it is
                  immune to misclassification errors and adds Census-Designated
                  Places (unincorporated communities) that would not otherwise
                  appear.
                </p>
              </article>
              <article className="copy-card sources-card">
                <h3>Sources</h3>
                <p>
                  All parcel-level/value data are provided for public use by
                  Utah Open Data as part of the{" "}
                  <a href="https://gis.utah.gov/products/sgid/planning/housing-unit-inventory/">
                    Utah Housing Unit Inventory
                  </a>{" "}
                  dataset. Parcels which correspond to single- and multi-family
                  housing units are aggregated by county assessors and submitted
                  to the dataset. The dataset currenty includes the core Wasatch
                  Front — Salt Lake, Utah, Davis, and Weber counties — along
                  with Tooele, Morgan, and Washington counties.
                </p>
                <p>
                  Assessment/Sales Ratios are provided by the Utah State Tax
                  Commission. The reference year depends on the year that the
                  assessed value is associated with.{" "}
                  <a href="https://files.tax.utah.gov/propertytax/srs/srs2025.pdf">
                    Davis, Morgan, Salt Lake, Tooele, and Weber Counties (2024
                    data)
                  </a>
                  ,{" "}
                  <a href="https://files.tax.utah.gov/propertytax/srs/srs2024.pdf">
                    Utah County (2023 data)
                  </a>
                  ,{" "}
                  <a href="https://files.tax.utah.gov/propertytax/srs/srs2023.pdf">
                    Washington County (2022 data)
                  </a>
                  .
                </p>
                <p>
                  Place names and boundaries are provided by the U.S. Census
                  Bureau from the{" "}
                  <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2024.html">
                    2024 Census TIGER/Line Shapefiles
                  </a>
                  .
                </p>
              </article>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

export default AboutPage;
