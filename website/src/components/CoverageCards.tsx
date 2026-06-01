import type { AttributeData } from "../data/loadData";
import { formatNumber } from "../lib/format";

function getTotalRecords(data: AttributeData) {
  return Object.values(data.County).reduce((total, row) => total + row.n, 0);
}

function CoverageCards({ data }: { data: AttributeData }) {
  return (
    <section className="page-section">
      <h2>Coverage</h2>
      <div className="status-grid">
        <article className="stat-card">
          <span>Counties</span>
          <strong>{formatNumber(Object.keys(data.County).length)}</strong>
        </article>
        <article className="stat-card">
          <span>Places / CDPs</span>
          <strong>{formatNumber(Object.keys(data.Place).length)}</strong>
        </article>
        <article className="stat-card">
          <span>Total Records</span>
          <strong>{formatNumber(getTotalRecords(data))}</strong>
        </article>
      </div>
    </section>
  );
}

export default CoverageCards;
