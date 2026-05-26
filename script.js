const DATA_PATH = "data.json";
const TYPE_ORDER = ["City", "County", "Region", "Partial State"];

const elements = {
  preloading: document.getElementById("preloading"),
  dataSelectionContainer: document.getElementById("dataSelectionContainer"),
  dataPresentationContainer: document.getElementById(
    "dataPresentationContainer",
  ),
  rowCount: document.getElementById("rowCount"),
  placeSelect: document.getElementById("placeSelect"),
  interestRate: document.getElementById("interestRate"),
  loanYears: document.getElementById("loanYears"),
  downPaymentLabel: document.getElementById("downPaymentLabel"),
  downPayment: document.getElementById("downPayment"),
  downPaymentMode: document.getElementById("downPaymentMode"),
  affordabilityShare: document.getElementById("affordabilityShare"),
  selectedPlace: document.getElementById("selectedPlace"),
  selectedMeta: document.getElementById("selectedMeta"),
  tableContainer: document.getElementById("tableContainer"),
};

let rows = [];
let places = [];
let globalTable;

function placeKey(place, placeType) {
  return `${placeType}::${place}`;
}

function placeLabel(place, placeType) {
  if (placeType === "County") {
    return `${place} County`;
  }
  return place;
}

function roundToNearest(value, precision) {
  return Math.round(value / precision) * precision;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function monthlyPayment(principal, annualRate, years) {
  if (!Number.isFinite(principal) || principal <= 0) {
    return 0;
  }

  const monthlyRate = annualRate / 100 / 12;
  const paymentCount = years * 12;

  if (!Number.isFinite(paymentCount) || paymentCount <= 0) {
    return 0;
  }

  if (monthlyRate === 0) {
    return principal / paymentCount;
  }

  const growth = (1 + monthlyRate) ** paymentCount;
  return (principal * (monthlyRate * growth)) / (growth - 1);
}

function normalizePlace(rawPlace) {
  const counties = Array.isArray(rawPlace.Counties) ? rawPlace.Counties : [];
  const percentiles = Array.isArray(rawPlace.Percentiles)
    ? rawPlace.Percentiles
    : [];
  const placeName = rawPlace.PlaceName;
  const displayName = `${placeName} (${rawPlace.PlaceType})`;

  const normalizedPercentiles = percentiles.map((percentile) => ({
    place: placeName,
    placeType: rawPlace.PlaceType,
    counties: counties.join("|"),
    isWasatchFront: rawPlace.IsWasatchFront ?? null,
    count: Number(rawPlace.Count),
    pctRank: Number(percentile.Percentile),
    absoluteRank: Number(percentile.AbsoluteRank),
    totValue: Number(percentile.TotalValue),
  }));

  return {
    key: placeKey(placeName, rawPlace.PlaceType),
    place: placeName,
    displayName,
    placeType: rawPlace.PlaceType,
    counties,
    countiesLabel: counties.join("|"),
    isWasatchFront: rawPlace.IsWasatchFront ?? null,
    count: Number(rawPlace.Count),
    percentiles: normalizedPercentiles,
  };
}

function parseData(data) {
  const normalizedPlaces = data.map((rawPlace) => normalizePlace(rawPlace));

  return {
    places: normalizedPlaces.sort((a, b) => {
      const typeDiff =
        TYPE_ORDER.indexOf(a.placeType) - TYPE_ORDER.indexOf(b.placeType);
      if (typeDiff !== 0) {
        return typeDiff;
      }

      return a.displayName.localeCompare(b.displayName);
    }),
    rows: normalizedPlaces.flatMap((place) => place.percentiles),
  };
}

function getSelectedPlace() {
  return places.find((place) => place.key === elements.placeSelect.value);
}

function getReferenceHomeValue() {
  const selectedPlace = getSelectedPlace();

  if (!selectedPlace) {
    return 0;
  }

  const percentile50Row = selectedPlace.percentiles.find(
    (row) => row.pctRank === 50,
  );

  return percentile50Row?.totValue ?? 0;
}

function updateDownPaymentInput() {
  const previousMode = elements.downPayment.dataset.mode;
  const currentMode = elements.downPaymentMode.value;
  const currentValue = Number(elements.downPayment.value);
  const referenceHomeValue = getReferenceHomeValue();

  if (
    previousMode === "percent" &&
    currentMode === "dollars" &&
    Number.isFinite(currentValue) &&
    referenceHomeValue > 0
  ) {
    elements.downPayment.value = roundToNearest(
      (referenceHomeValue * currentValue) / 100,
      1000,
    );
  } else if (
    previousMode === "dollars" &&
    currentMode === "percent" &&
    Number.isFinite(currentValue) &&
    referenceHomeValue > 0
  ) {
    elements.downPayment.value = (
      (currentValue / referenceHomeValue) *
      100
    ).toFixed(1);
  }

  if (currentMode === "dollars") {
    elements.downPaymentLabel.innerText = "Down Payment ($)";
    elements.downPayment.step = "1000";
    elements.downPayment.min = "0";
    elements.downPayment.max = "";
  } else {
    elements.downPaymentLabel.innerText = "Down Payment (%)";
    elements.downPayment.step = "0.1";
    elements.downPayment.min = "0";
    elements.downPayment.max = "100";
  }

  elements.downPayment.dataset.mode = currentMode;
}

function resetTableContainer(message) {
  if (globalTable) {
    globalTable.destroy();
    globalTable = undefined;
  }

  elements.tableContainer.innerHTML = `<table id="dataTable" class="table table-striped"><tbody><tr><td>${message}</td></tr></tbody></table>`;
}

function getBaseTable(dataRows) {
  const table = document.createElement("table");
  table.id = "dataTable";
  table.classList.add("table", "table-striped");

  const thead = document.createElement("thead");
  const thRow = document.createElement("tr");
  const headers = [
    "Percentile",
    "Absolute Rank",
    "Home Value",
    "Loan Amount",
    "Monthly Payment",
    "Minimum HHI",
  ];

  headers.forEach((header) => {
    const th = document.createElement("th");
    th.innerText = header;
    thRow.appendChild(th);
  });

  const tbody = document.createElement("tbody");

  dataRows.forEach((row) => {
    const tr = document.createElement("tr");
    const cells = [
      row.pctRank,
      formatInteger(row.absoluteRank),
      formatCurrency(roundToNearest(row.totValue, 1000)),
      formatCurrency(roundToNearest(row.loanAmount, 1000)),
      formatCurrency(roundToNearest(row.payment, 10)),
      formatCurrency(roundToNearest(row.neededIncome, 1000)),
    ];

    cells.forEach((cell) => {
      const td = document.createElement("td");
      td.innerText = cell;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  thead.appendChild(thRow);
  table.appendChild(thead);
  table.appendChild(tbody);

  return table;
}

function getDataTableConfig() {
  return {
    searching: false,
    paging: false,
    info: false,
    lengthChange: false,
    order: [[0, "desc"]],
    columns: [
      { orderable: true },
      { orderable: false },
      { orderable: false },
      { orderable: false },
      { orderable: false },
      { orderable: false },
    ],
  };
}

function populatePlaces() {
  elements.placeSelect.innerHTML = "";

  places.forEach((place) => {
    const option = document.createElement("option");
    option.value = place.key;
    option.textContent = place.displayName;
    elements.placeSelect.appendChild(option);
  });

  elements.placeSelect.disabled = places.length === 0;
}

function render() {
  const selectedPlace = getSelectedPlace();

  if (!selectedPlace) {
    elements.selectedPlace.textContent = "";
    elements.selectedMeta.textContent = "";
    resetTableContainer("No place selected.");
    return;
  }

  const annualRate = Number(elements.interestRate.value);
  const years = Number(elements.loanYears.value);
  const downPaymentValue = Math.max(Number(elements.downPayment.value), 0);
  const downPaymentMode = elements.downPaymentMode.value;
  const affordabilityShare = Number(elements.affordabilityShare.value);
  const filteredRows = [...selectedPlace.percentiles].sort(
    (a, b) => b.pctRank - a.pctRank,
  );

  elements.selectedPlace.textContent = selectedPlace.displayName;
  elements.selectedMeta.textContent =
    `Type: ${selectedPlace.placeType} | ` +
    `n: ${formatInteger(selectedPlace.count)} | ` +
    `Counties: ${selectedPlace.countiesLabel || "-"} | ` +
    `Down payment: ${
      downPaymentMode === "dollars"
        ? formatCurrency(downPaymentValue)
        : `${downPaymentValue}%`
    } | ` +
    `Affordability share: ${formatInteger(affordabilityShare * 100)}% | ` +
    `Wasatch Front: ${
      selectedPlace.isWasatchFront === null
        ? "N/A"
        : selectedPlace.isWasatchFront
          ? "yes"
          : "no"
    }`;

  if (filteredRows.length === 0) {
    resetTableContainer("No rows found.");
    return;
  }

  const tableRows = filteredRows.map((row) => {
    const downPaymentShare =
      downPaymentMode === "dollars"
        ? Math.min(downPaymentValue / row.totValue, 1)
        : Math.min(Math.max(downPaymentValue / 100, 0), 1);
    const loanAmount = row.totValue * (1 - downPaymentShare);
    const payment = monthlyPayment(loanAmount, annualRate, years);
    const neededIncome = payment > 0 ? (payment / affordabilityShare) * 12 : 0;

    return {
      pctRank: row.pctRank,
      absoluteRank: row.absoluteRank,
      totValue: row.totValue,
      loanAmount,
      payment,
      neededIncome,
    };
  });

  if (globalTable) {
    globalTable.destroy();
    globalTable = undefined;
  }

  const baseTable = getBaseTable(tableRows);
  elements.tableContainer.innerHTML = "";
  elements.tableContainer.appendChild(baseTable);
  globalTable = new DataTable("#dataTable", getDataTableConfig());
}

function showLoadedState() {
  elements.preloading.classList.add("d-none");
  elements.dataSelectionContainer.classList.remove("d-none");
  elements.dataPresentationContainer.classList.remove("d-none");
  elements.rowCount.innerText = formatInteger(rows.length);
}

function loadFromData(data) {
  const parsed = parseData(data);
  rows = parsed.rows;
  places = parsed.places;
  populatePlaces();

  if (places.length > 0) {
    const preferred =
      places.find(
        (place) =>
          place.place === "Wasatch Front" && place.placeType === "Region",
      ) || places[0];
    elements.placeSelect.value = preferred.key;
  }

  showLoadedState();
  updateDownPaymentInput();
  render();
}

async function loadDefaultData() {
  try {
    const response = await fetch(DATA_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    loadFromData(await response.json());
  } catch (error) {
    elements.preloading.textContent = `Could not load ${DATA_PATH}.`;
  }
}

elements.placeSelect.addEventListener("change", () => {
  updateDownPaymentInput();
  render();
});
elements.interestRate.addEventListener("input", render);
elements.loanYears.addEventListener("input", render);
elements.downPayment.addEventListener("input", render);
elements.downPaymentMode.addEventListener("change", () => {
  updateDownPaymentInput();
  render();
});
elements.affordabilityShare.addEventListener("change", render);

updateDownPaymentInput();
loadDefaultData();
