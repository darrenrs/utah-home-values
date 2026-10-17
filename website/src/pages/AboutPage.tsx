import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import PageTitle from "../components/PageTitle";

function AboutPage() {
  return (
    <>
      <PageTitle title="About | Utah Home Value Explorer" />
      <div className="page-shell">
        <SiteHeader />

        <main className="container">
          <div className="page-stack">
            <div className="about-intro">
              <p className="eyebrow">Utah Home Values</p>
              <h1>Data/Methodology</h1>
              <p>Data sources and methodology for Utah Home Values Explorer.</p>
            </div>

            <section className="page-section">
              <h2>Data Pipeline</h2>
              <div className="method-grid">
                <article className="copy-card">
                  <h3 className="copy-card-title">Source Data</h3>
                  <p>
                    The Utah Housing Unit Inventory dataset, which includes
                    reliable data for seven primarily urban counties in Utah, is
                    the initial source of truth. Outlier records and all
                    non-single-family units are filtered out. Townhomes and
                    condos are excluded because counties report them
                    inconsistently, which would make cross-county comparisons
                    unreliable. Lots under 0.05 acres built since 2000 and
                    parcels whose footprint is shared with another record are
                    also excluded, since these are usually attached units. The original assessed values are
                    adjusted to estimated 2025 market values based on
                    county-level assessment/sales ratios and the federal House
                    Price Index.
                  </p>
                </article>
                <article className="copy-card">
                  <h3 className="copy-card-title">Geographic Assignment</h3>
                  <p>
                    To summarize by Place / CDP, all parcels are projected onto
                    a Census place shapefile coordinate system, converted to a
                    representative point, and spatially joined to the place
                    polygon that contains it. This method is superior to the
                    CITY attribute in the Housing Unit Inventory dataset because
                    it is immune to misclassification errors and adds
                    census-designated places (CDPs), which are unincorporated
                    communities that would not otherwise appear.
                  </p>
                </article>
                <article className="copy-card copy-card-full">
                  <h3 className="copy-card-title">Housing Context</h3>
                  <p>
                    Data from the American Community Survey are also used for a
                    simple housing affordability analysis. The figures for
                    median household income and percentage of occupied housing
                    units that are owner occupied are collected for Utah's
                    counties, cities, and ZIP Code Tabulation Areas (ZCTAs) and
                    presented in the website.
                  </p>
                </article>
              </div>
            </section>

            <section className="page-section">
              <h2>Sources</h2>
              <div className="method-grid">
                <article className="copy-card">
                  <h3 className="copy-card-title">Housing Unit Inventory</h3>
                  <p>
                    All parcel-level/value data are provided for public use by
                    Utah Open Data as part of the{" "}
                    <a href="https://gis.utah.gov/products/sgid/planning/housing-unit-inventory/">
                      Utah Housing Unit Inventory
                    </a>{" "}
                    dataset. Parcels which correspond to single- and
                    multi-family housing units are aggregated by county
                    assessors and submitted to the dataset. The dataset
                    currently includes the core Wasatch Front — Salt Lake, Utah,
                    Davis, and Weber counties — along with Tooele, Morgan, and
                    Washington counties.
                  </p>
                  <p>
                    <strong>Last updated</strong>: October 14, 2026
                  </p>
                </article>
                <article className="copy-card">
                  <h3 className="copy-card-title">Assessment/Sales Ratios</h3>
                  <p>
                    Assessment/Sales ratios are provided by the Utah State Tax
                    Commission. The reference year depends on the year that the
                    assessed value is associated with. Please refer to these
                    documents for specific values:{" "}
                    <a href="https://files.tax.utah.gov/propertytax/srs/srs2026.pdf">
                      Washington County (2025 figures temporarily used for 2026 data)
                    </a>
                    ,{" "}
                    <a href="https://files.tax.utah.gov/propertytax/srs/srs2025.pdf">
                      Davis, Morgan, Salt Lake, Tooele, and Weber Counties (2024
                      data)
                    </a>
                    ,{" "}
                    <a href="https://files.tax.utah.gov/propertytax/srs/srs2024.pdf">
                      Utah County (2023 data)
                    </a>
                    .
                  </p>
                  <p>
                    <strong>Last updated</strong>: 2026
                  </p>
                </article>
                <article className="copy-card">
                  <h3 className="copy-card-title">House Price Index Ratios</h3>
                  <p>
                    The House Price Index ratios use the FHFA All-Transactions
                    House Price Index and are provided by the Federal Reserve
                    Bank of St. Louis (FRED). Assessed values are as of January
                    1, so each ratio combines the county's annual index (2025
                    divided by its <code>assessed_value_year</code>;{" "}
                    <a href="https://fred.stlouisfed.org/series/ATNHPIUS49011A">
                      example for Davis County
                    </a>
                    ) with a timing correction from the metro-area quarterly
                    index (FHFA does not publish quarterly county indices).
                    Washington County's 2026 assessed values are newer than the
                    latest county index, so its ratio uses the St. George metro
                    quarterly index only.
                  </p>
                  <p>
                    <strong>Last updated</strong>: October 16, 2026
                  </p>
                </article>
                <article className="copy-card">
                  <h3 className="copy-card-title">Census Boundaries</h3>
                  <p>
                    Place names and boundaries are provided by the U.S. Census
                    Bureau from the{" "}
                    <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2024.html">
                      2024 Census TIGER/Line Shapefiles
                    </a>
                    .
                  </p>
                  <p>
                    <strong>Last updated</strong>: September 25, 2024
                  </p>
                </article>
                <article className="copy-card">
                  <h3 className="copy-card-title">American Community Survey</h3>
                  <p>
                    American Community Survey data from the 2020-2024 5-year
                    estimates are also provided by the U.S. Census Bureau via
                    the{" "}
                    <a href="https://www.census.gov/data/developers.html">
                      Census API
                    </a>
                    . The tables used are{" "}
                    <a href="https://data.census.gov/table?q=B19013">
                      Median Household Income in the Past 12 Months (B19013)
                    </a>{" "}
                    and{" "}
                    <a href="https://data.census.gov/table?q=B25003">
                      Tenure (B25003)
                    </a>
                    .
                  </p>
                  <p>
                    <strong>Last updated</strong>: January 29, 2026
                  </p>
                </article>
              </div>
            </section>
          </div>
        </main>

        <SiteFooter />
      </div>
    </>
  );
}

export default AboutPage;
