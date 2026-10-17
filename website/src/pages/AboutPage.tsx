import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import PageTitle from "../components/PageTitle";

const SECTIONS = [
  { id: "how-it-works", label: "How it works" },
  { id: "sources", label: "Sources" },
  { id: "limitations", label: "Limitations" },
];

const SOURCES = [
  {
    name: "Utah Housing Unit Inventory",
    href: "https://gis.utah.gov/products/sgid/planning/housing-unit-inventory/",
    publisher: "Utah Geospatial Resource Center",
    usedFor: "Parcel records, assessed values, year built, lot size",
    updated: "October 14, 2026",
  },
  {
    name: "Assessment/Sales Ratio Studies",
    href: "https://files.tax.utah.gov/propertytax/srs/srs2025.pdf",
    publisher: "Utah State Tax Commission",
    usedFor:
      "How assessed values compare with sale prices in each county (2024 study for Utah County, 2025 for Davis, Morgan, Salt Lake, Tooele and Weber, 2026 as a stand-in for Washington)",
    updated: "2026",
  },
  {
    name: "FHFA House Price Index",
    href: "https://fred.stlouisfed.org/series/ATNHPIUS49011A",
    publisher: "FHFA via FRED",
    usedFor:
      "Price changes from each county's assessment date to the 2025 average (county annual and metro quarterly series)",
    updated: "October 16, 2026",
  },
  {
    name: "TIGER/Line Shapefiles (2024)",
    href: "https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2024.html",
    publisher: "U.S. Census Bureau",
    usedFor: "City, CDP and ZIP Code Tabulation Area boundaries",
    updated: "September 25, 2024",
  },
  {
    name: "American Community Survey, 2020–2024",
    href: "https://www.census.gov/data/developers.html",
    publisher: "U.S. Census Bureau",
    usedFor:
      "Median household income (B19013) and owner-occupied share (B25003)",
    updated: "January 29, 2026",
  },
];

function AboutPage() {
  return (
    <>
      <PageTitle title="About | Utah Home Values Explorer" />
      <div className="page-shell">
        <SiteHeader />

        <main className="container">
          <div className="about-layout">
            <nav className="about-toc" aria-label="On this page">
              <p className="eyebrow">On this page</p>
              <ol>
                {SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.label}</a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="about-content">
              <div className="about-intro">
                <p className="eyebrow">Utah Home Values</p>
                <h1>Data &amp; Methodology</h1>
                <p className="about-lede">
                  Every value on this site starts as a county assessor's record.
                  Here is how those records become comparable market estimates,
                  and where each number comes from.
                </p>
              </div>

              <section className="about-section" id="how-it-works">
                <h2>How it works</h2>
                <ol className="about-steps">
                  <li>
                    <h3>Start from parcel records</h3>
                    <p>
                      The Utah Housing Unit Inventory lists every housing parcel
                      that county assessors report. It has reliable values for
                      seven counties: Davis, Morgan, Salt Lake, Tooele, Utah,
                      Washington and Weber.
                    </p>
                  </li>
                  <li>
                    <h3>Keep comparable single-family homes</h3>
                    <ul>
                      <li>
                        Detached single-family homes only. Counties report
                        townhomes and condos inconsistently.
                      </li>
                      <li>
                        One unit per record, assessed between $50,000 and $20
                        million, on up to 100 acres.
                      </li>
                      <li>
                        Lots under 0.05 acres built since 2000 and records
                        sharing a parcel footprint are dropped as likely
                        attached units.
                      </li>
                      <li>
                        Homes missing square footage are kept only if their
                        value looks complete next to similar homes nearby.
                      </li>
                    </ul>
                  </li>
                  <li>
                    <h3>Convert assessed values to market values</h3>
                    <p className="about-formula">
                      market value = assessed value ÷ assessment/sales ratio ×
                      house price index change
                    </p>
                    <ul>
                      <li>
                        The assessment/sales ratio corrects for how far each
                        county's assessments run below or above sale prices.
                      </li>
                      <li>
                        The house price index change moves each county from its
                        January 1 assessment date to the 2025 average.
                      </li>
                    </ul>
                  </li>
                  <li>
                    <h3>Group homes into areas</h3>
                    <ul>
                      <li>
                        Each parcel is placed in the Census city, CDP and ZIP
                        Code Tabulation Area that contains it. This catches
                        unincorporated communities that a city name field would
                        miss.
                      </li>
                      <li>
                        Areas with fewer than 20 homes are not published, and
                        neither are ZIP codes lying mostly outside the seven
                        counties.
                      </li>
                      <li>
                        An area shows assessed values only when at least 90% of
                        its homes share one assessment year.
                      </li>
                    </ul>
                  </li>
                  <li>
                    <h3>Add context</h3>
                    <p>
                      American Community Survey estimates add median household
                      income and the share of homes that are owner-occupied, for
                      a simple affordability comparison.
                    </p>
                  </li>
                </ol>
              </section>

              <section className="about-section" id="sources">
                <h2>Sources</h2>
                <table className="sources-table">
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col">Used for</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SOURCES.map((source) => (
                      <tr key={source.name}>
                        <th scope="row">
                          <a href={source.href}>{source.name}</a>
                          <span>{source.publisher}</span>
                        </th>
                        <td>{source.usedFor}</td>
                        <td className="sources-updated">{source.updated}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="about-note">
                  Ratio studies by year:{" "}
                  <a href="https://files.tax.utah.gov/propertytax/srs/srs2024.pdf">
                    2024
                  </a>
                  ,{" "}
                  <a href="https://files.tax.utah.gov/propertytax/srs/srs2025.pdf">
                    2025
                  </a>
                  ,{" "}
                  <a href="https://files.tax.utah.gov/propertytax/srs/srs2026.pdf">
                    2026
                  </a>
                  . ACS tables:{" "}
                  <a href="https://data.census.gov/table?q=B19013">B19013</a>,{" "}
                  <a href="https://data.census.gov/table?q=B25003">B25003</a>.
                </p>
              </section>

              <section className="about-section" id="limitations">
                <h2>Limitations</h2>
                <ul>
                  <li>
                    These are statistical estimates for groups of homes, not
                    appraisals of any one home.
                  </li>
                  <li>
                    Counties assess in different years, so assessed values are
                    only comparable within a county. Use market-adjusted values
                    to compare across counties.
                  </li>
                  <li>
                    The newest homes appear only once their county has assessed
                    them in full.
                  </li>
                  <li>
                    Building square footage isn't used as a measure, because
                    some counties include basements and others don't.
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </main>

        <SiteFooter />
      </div>
    </>
  );
}

export default AboutPage;
