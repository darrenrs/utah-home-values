import type { CSSProperties } from "react";
import type { HousingStock as HousingStockData } from "../data/loadData";

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function BandBar({
  title,
  bands,
  shares,
}: {
  title: string;
  bands: string[];
  shares: number[];
}) {
  return (
    <div className="stock-bar-card">
      <h4>{title}</h4>
      <div
        className="stock-bar"
        role="img"
        aria-label={`${title}: ${bands
          .map((band, index) => `${band} ${formatPercent(shares[index])}`)
          .join(", ")}`}
      >
        {shares.map((share, index) => (
          <span
            key={bands[index]}
            className="stock-bar-segment"
            style={
              {
                "--share": share,
                background: `var(--seq-${index + 1})`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <ul className="stock-legend">
        {bands.map((band, index) => (
          <li key={band}>
            <span
              className="stock-swatch"
              style={{ background: `var(--seq-${index + 1})` }}
              aria-hidden="true"
            />
            {band}{" "}
            <span className="stock-legend-share">
              {formatPercent(shares[index])}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Age and lot size of the single-family homes counted for an area. Building
// square footage is left out because counties report it inconsistently.
function HousingStock({
  id,
  housingStock,
}: {
  id: string;
  housingStock: HousingStockData;
}) {
  const stock = housingStock.geographies[id];

  if (!stock) {
    return null;
  }

  return (
    <section className="metric-section">
      <h3 className="metric-section-title">Housing Stock</h3>
      <p className="subheader-description">
        When the homes were built and how much land they sit on. The newest
        homes are not counted until their county has assessed them in full.
      </p>
      <div className="context-grid stock-grid">
        <article className="context-card">
          <h4>Median Year Built</h4>
          <p className="context-value">{stock.medianYearBuilt}</p>
          <p className="context-ci">
            middle 50%: {stock.yearBuiltP25}–{stock.yearBuiltP75}
          </p>
        </article>
        <article className="context-card">
          <h4>Median Lot Size</h4>
          <p className="context-value">{stock.medianLotAcres.toFixed(2)} ac</p>
          <p className="context-ci">
            middle 50%: {stock.lotAcresP25.toFixed(2)}–
            {stock.lotAcresP75.toFixed(2)} ac
          </p>
        </article>
      </div>

      <BandBar
        title="Year Built"
        bands={housingStock.yearBuiltBands}
        shares={stock.yearBuiltShares}
      />
      <BandBar
        title="Lot Size"
        bands={housingStock.lotSizeBands}
        shares={stock.lotSizeShares}
      />
    </section>
  );
}

export default HousingStock;
