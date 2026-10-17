# Audit Findings — Utah Home Values Explorer

Audit date: 2026-10-16 · Commit audited: `324384f` · Data audited: `website/public/data/*` generated 2026-10-15, raw HUI GDB `data/raw/HousingUnitInventory.gdb` (702,461 records)

How this was checked:
- I read all of the pipeline, API, and frontend code.
- I re-ran the filters against the raw GDB and did a spatial join to the TIGER place and ZCTA shapefiles.
- I checked every `hpi_ratio` against FRED and every `assessment_sales_ratio` against the Tax Commission's `srs2024.pdf`, `srs2025.pdf`, and `srs2026.pdf`.
- I looked up the missing ACS geographies through the Census API.
- I compared the styles to the live darrenskidmore.com CSS, ran the site locally in light, dark, and mobile views, and ran the test suite (31 passed) and `tsc --noEmit` (clean).

Severity key: **High** means it changes what users see or how they compare places. **Medium** means a real bug or a methodology gap with limited reach. **Low** is a nit or cleanup.

---

## Part 1 — Data pipeline & home value transformations

### What checks out

- **The original HPI ratios were computed correctly** (they have since been replaced; see 1.2). Every value matched `FRED ATNHPIUS{fips}A[2025] / [assessed_value_year]` to 4 decimals. Examples: Davis 306.40/300.38 = 1.0200, Utah 309.82/289.88 = 1.0688, Salt Lake 341.57/332.93 = 1.0260.
- **Assessment/sales ratios match the PDFs.** Each one is the county's Residential median from the study published in the year after `assessed_value_year`. The 2024 study's methodology says it matches sales to the *January 1, 2023* assessment, so "assessment year Y ↔ study Y+1" is the right mapping. Washington (2026) uses `srs2026` (2025 assessments) as a stand-in, which the About page already discloses.
- **The market-adjustment formula is applied correctly.** For every county, published market-adjusted ÷ assessed medians equal `hpi_ratio / assessment_sales_ratio`. Examples: Davis 1.0549, Utah 1.1151, Washington 1.0503.
- **The percentile arrays look sound.** All 238 geographies have monotonic percentile arrays. No point matches more than one place or ZCTA.
- **Unknown counties are handled.** A county in the HUI that isn't in `counties.yml` gets dropped cleanly; I tested this and it doesn't crash.
- **ACS proportion MOE is correct.** The owner-occupied MOE uses the Census proportion formula, with the documented fallback to the ratio formula.

### 1.1 [High — code fixed 2026-10-16, data not yet regenerated] Townhomes and condos are only included in Utah and Washington counties, which biases cross-county comparisons

The `SUBTYPE in {single_family, townhome, condo}` + `UNIT_COUNT == 1` + `IS_OUG != 1` filter acts very differently by county, because assessors submit attached units differently:

| County | Kept single_family | Kept townhome | Kept condo | Attached share |
|---|---:|---:|---:|---:|
| Utah | 131,778 | 7,306 | 2,183 | **6.7%** |
| Washington | 52,562 | 271 | 299 | 1.1% |
| Salt Lake, Davis, Weber, Tooele | all | 0 | 0 | 0% |
| Morgan | 3,578 | 10 | 0 | 0.3% |

In Salt Lake, Davis, Weber, and Tooele, almost every townhome or condo record is an owned-unit grouping (`IS_OUG = 1`) and/or has `UNIT_COUNT > 1`. Utah County reports them as individual units with `UNIT_COUNT = 1`, so they pass the filter.

**To be clear, `IS_OUG == 1` rows never got through.** The `IS_OUG != 1` filter works as intended. In the raw Utah County data, 12,483 condos and 9,972 townhomes have `IS_OUG == 1` and `UNIT_COUNT == 1`, and all of them were excluded. What got through were the 12,245 townhomes and 2,561 condos flagged `IS_OUG == 0` with `UNIT_COUNT == 1`. Utah County marks these as individual, non-grouped units, and the old filter accepted their subtypes. Under the SFH-only filter, the kept records are 100% `single_family` and `UNIT_COUNT == 1`, and `IS_OUG` is either 0 (589,529) or null (10,419; see 1.6).

**Impact.** Utah County medians are pulled down compared with an all-detached baseline. Using the HUI `CITY` field as a proxy, here is the market-adjusted median with and without attached units:

| City | Attached share | Median (all kept) | Median (single-family only) | Difference |
|---|---:|---:|---:|---:|
| Vineyard | 26% | $597K | $661K | **−9.7%** |
| Lehi | 13% | $594K | $626K | −5.2% |
| Saratoga Springs | 14% | $595K | $617K | −3.5% |
| American Fork | 12% | $525K | $543K | −3.4% |
| Utah County overall | 7% | $562K | $576K | −2.4% |

The Rankings page compares places across counties, so Utah County cities are systematically ranked as cheaper than equivalent detached stock elsewhere. The site copy ("estimated **single-family** home values") also doesn't match what the filter keeps.

**Decision: detached single-family only.** Townhome and condo classification is too inconsistent across counties to get complete data for them.

**What changed:**
- `filter_valid_housing_units` now keeps only `SUBTYPE == "single_family"`.
- The README filter list and the About page explain why attached units are excluded.
- A new test, `test_filter_valid_housing_units_keeps_only_single_family`, pins the rule.

**Before you regenerate:** combined with the 1.1c filters, re-running `generate_data` keeps 598,658 records, down from 610,017 published (−11,359, or −1.9%). That is over the 1% `validate_record_count_change` guard. The guard will refuse to publish. That is the guard doing its job, so let the expected drop through on purpose. For example, move the current `hui_*_values.json` aside before the run, or raise `max_drop_ratio` for that one run. Then re-run `download_acs_tables` so its geography list stays in sync.

### 1.1b [Medium — fixed 2026-10-16] The square-footage filter drops new construction, mostly in Utah County

**Done.** The `100 <= TOT_BD_FT2` bound is replaced by `drop_partial_values_missing_sqft`. A home with missing or zero sq ft (under `MIN_RECORDED_BUILDING_SQFT = 100`) is kept only if its value is at least `MISSING_SQFT_MIN_COHORT_VALUE_SHARE = 0.5` of the median for homes with sq ft in its county, city and build year. When the city cohort has fewer than `MIN_CITY_COHORT_SIZE = 10` homes, the county and build-year median is used instead, and a home with no cohort at all is dropped. The 30,000 upper bound stays. On the current GDB this keeps 7,590 homes without sq ft (Utah 6,114, Davis 1,440) and rejects 160, for 606,002 kept in total. Four tests cover it: keep, reject, the fallback, and the no-cohort case. The README documents the rule. The original analysis follows.

Square footage isn't comparable across counties. As you pointed out, some counties report above-grade area only and others include basements. The data agrees. Median `TOT_BD_FT2` for single-family homes built 2000–2010:

| County | Median sq ft |
|---|---:|
| Salt Lake | 3,398 |
| Utah | 3,253 |
| Washington | 2,133 |
| Morgan | 2,071 |
| Davis | 1,809 |
| Weber | 1,715 |
| Tooele | 1,569 |

That's roughly a 2× gap between neighboring Wasatch Front counties with similar housing stock, so the field can't be interpreted as a size measure.

The pipeline doesn't use sq ft for anything except the `100 <= TOT_BD_FT2 <= 30,000` sanity filter, but that filter is not neutral. Among single-family records that pass every other filter:

| County | Dropped by sq ft filter | Share | Median assessed (dropped) | Median assessed (kept) |
|---|---:|---:|---:|---:|
| Utah | 6,399 | **4.6%** | $583K | $516K |
| Davis | 1,505 | 1.7% | $615K | $510K |
| All others | 112 | <0.1% | — | — |

- 6,477 of the failures are `TOT_BD_FT2 < 100` (effectively 0), and 1,525 are null. Only 14 are over 30,000.
- In Utah County, **5,216 of the 6,399 dropped homes were built in the 2020s**, concentrated in Eagle Mountain (1,065), Saratoga Springs (1,001), and Lehi (715). The assessor seems to fill in square footage late for new builds, even though the value is already complete.
- So the filter removes newer, more expensive homes from exactly the fast-growing Utah County cities, which pulls their percentiles down.

**Not all low-sq-ft records are new builds.** A missing or zero value means different things in different counties:
- **Utah and Davis:** missing or zero sq ft marks new construction whose value is already complete.
- **West Valley City (Salt Lake):** 61 homes built in 1997 on 0.08–0.11 acres have `0` sq ft and are valued at about $60–94K. Six neighbors in the same cohort that do have sq ft are valued around $422K. The zero-sq-ft records are almost certainly land-only values (for example, manufactured homes assessed as personal property). The filter is correctly removing them.
- **Tooele:** records use `1`, `2`, and `10` as placeholder sq ft values. Their dollar values look like normal homes.

**Over 30,000 sq ft:** only 14 records reach this bound after every other filter has run. All of them look like non-homes or typos. Examples: a Sunset parcel at 171,539 sq ft and $13.2M, several 64–95-acre Utah County parcels worth $6–15M, and a Provo home at 38,400 sq ft valued at $350K (probably 3,840). The 829 single-family records over 30,000 sq ft in the raw data are almost all grouped multi-unit records (median `UNIT_COUNT` 19), which the other filters already drop.

**Why the filter exists (author's note).** In an earlier HUI dump, many zero-sq-ft Utah and Davis homes carried land-only values (under about $350K). Zero sq ft was a reliable "value not finished yet" flag.

**In the current dump (2026-10-14), that flag only holds for older build years.** Compare zero-sq-ft and sq-ft-present homes in the same county and build year:

| County, built | Zero sq ft: n | Zero sq ft: median | Has sq ft: median | Under $350K (zero / has sq ft) |
|---|---:|---:|---:|---:|
| Utah 2020 | 1,997 | $558K | $531K | 2.3% / 6.2% |
| Utah 2021 | 2,320 | $613K | $536K | 0.3% / 7.2% |
| Utah 2022 | 899 | $757K | $562K | 1.1% / 3.9% |
| Davis 2022 | 535 | $665K | $584K | 0.6% / 0.1% |
| Davis 2023 | 485 | $666K | $528K | 1.9% / 0.0% |
| Utah 2016–2019 | 75 | $218–329K (2018–19) | $576–592K | **46–68%** / ~0% |
| Utah ≤2014 | 1,099 | $495K | $498K | **14.7%** / 7.3% |

- **New construction (Utah 2020–2022, Davis 2022–2023):** zero-sq-ft homes are worth as much as or more than same-year homes with sq ft. That holds city by city too, for example Eagle Mountain, Saratoga Springs, Lehi, Kaysville and Layton. These are finished values with sq ft not yet entered.
- **Older zero-sq-ft homes in Utah County:** these still look land-only or partial, possibly teardown or rebuild lots. Here the filter is still doing useful work.
- **Past the build-year cutoff:** values are land-only *regardless* of sq ft. For Utah 2023, 96% of homes *with* sq ft are under $350K, and Davis 2024 looks the same. So `latest_year_built_with_value` already provides the land-only protection for the newest builds; the sq ft filter adds nothing there.

**Recommendation (parked by the author):**
- Whether zero sq ft means "land-only" changes from dump to dump, so don't hard-code a fix.
- Make the pipeline print a diagnostic for each update: for each county and build year, the count, median and share under $350K, for zero-sq-ft vs sq-ft-present records. That turns the decision into a quick check each time.
- If you later relax the filter, make the rule relative to the cohort rather than an absolute value floor. For example, keep a zero-sq-ft record only if its value is at least 50% of the median for sq-ft-present homes in the same county and build year. Land-only values run at about 20–40% of a finished home, so this separates them in any dump, keeps the West Valley 1997 cluster out ($90K vs a $422K cohort), and keeps the Utah 2016–2019 partials out.
- Keep the 30,000 upper bound. It only removes 14 records, and they are all bad.
- Relaxing the filter would add back about 6,800 records, mostly 2020–2023 builds. If that ships in the same regeneration as 1.1, the net change is small enough that it would likely pass the 1% guard with no override.

**Follow-up investigation (2026-10-16): which zero-sq-ft homes are actually land-only?** I compared each zero- or null-sq-ft home with the median value of homes that *do* have sq ft in the same county, city and build year (falling back to county and year when the city cohort has fewer than 10). A value under 50% of that cohort median looks land-only or partial.

| Group | Zero-sq-ft homes | Median value ÷ cohort median | Under 50% of cohort |
|---|---:|---:|---:|
| Utah, built before 1980 | 625 | 1.05 | 1% |
| Utah, 1980–1999 | 289 | 1.15 | 6% |
| Utah, 2000–2014 | 180 | 1.06 | 9% |
| **Utah, 2015–2019** | **76** | **0.46** | **53%** |
| Utah, 2020+ | 5,050 | 1.06 | 0% |
| Davis, 2000–2014 | 339 | 0.62 | 14% |
| Davis, 2015–2019 | 127 | 0.84 | 0% |
| Davis, 2020+ | 1,034 | 1.12 | 1% |

- **The problem is mostly Utah County homes built 2017–2019, not everything before 2019.** 38 of the 62 built 2017–2019 are under half their cohort median. That fits lots where a home was started but the value hadn't caught up by the assessment date. Older Utah County zero-sq-ft homes are worth about the same as their neighbors.
- **Across all Utah County homes built before 2020**, 82 of 1,170 fall under 50%: the 2017–2019 cluster plus scattered older ones (Payson, Highland, Provo, Mapleton). Their median is $178K; the other 1,088 have a median of $510K.
- **Davis 2000–2014 is a little soft** (median ratio 0.62), but none are under $100K. It's worth a look, not an exclusion.
  - **Resolved 2026-10-17:** after the filters, 290 remain, all built 2010–2014, and 285 are in North Salt Lake on 0.06–0.15 acre lots. A spot check confirmed they're real single-family homes, small and on very small lots, so their values are complete. The cohort rule keeps them correctly; no change needed.
- **The $100K floor doesn't solve this.** It only catches 15 of the 82 Utah County cases, because land values here are often $150–300K.

**Updated recommendation (still parked):** replace the `100 <= TOT_BD_FT2` bound with the cohort rule: keep a zero- or null-sq-ft home only if its value is at least 50% of the median for homes with sq ft in its county, city and build year. On the current data that brings back about 7,600 homes (mostly 2020+ new builds in Utah and Davis) and still excludes the 82 Utah County partials. Because it's relative to each cohort, it also adapts if a future dump has land-only values again.

**Impact with every other current filter applied (2026-10-16).** This accounts for the $100K floor, the small-lot rule and single-family only. The square-footage bound currently excludes 7,750 homes, which is 1.3% of the kept set. The cohort rule would keep 7,590 of them and reject 160 (Utah 91, Davis 62, mostly North Salt Lake).

| Market-adjusted median | Reject all (current) | Cohort rule | Accept all |
|---|---:|---:|---:|
| Utah County | $585K | $588K (+0.5%) | $588K (+0.5%) |
| Davis County | $550K | $552K (+0.4%) | $552K (+0.4%) |
| Other counties | — | ±0.2% or less | ±0.2% or less |
| Lehi | $635K | $642K (+1.1%) | $642K (+1.1%) |
| Kaysville | $651K | $659K (+1.2%) | $659K (+1.2%) |
| West Point | $550K | $561K (+2.0%) | $561K (+2.0%) |
| North Salt Lake | $589K | $587K (−0.3%) | $585K (−0.7%) |

- On this dump, the choice moves county medians by at most 0.5% and a handful of growth cities by 1–2%.
- The cohort rule and accept-all give nearly identical medians, because the $100K floor already removes the worst land-only values.
- The cohort rule's value is protection: if a future dump returns land-only values for unfinished homes, as an earlier one did, it rejects them automatically.

### 1.1c [Low; Medium for Vineyard — code fixed 2026-10-16] Some `single_family` records look like attached units

Even with the SFH-only filter, a few records with subtype `single_family` look like townhome, twin-home or PUD units:
- **Tiny lots:** 1,466 kept records have lots under 0.05 acres (about 2,180 sq ft). 1,081 of them are in Utah County, mostly built in the 2020s, and they are valued well below their county's median (Utah $370K vs $516K).
- **Shared footprints:** 339 kept records share an identical parcel footprint with another kept record. 321 of them are in Utah County. These look like stacked or grouped units.
- 271 records fall in both groups; 1,534 are flagged in total.

The overall impact is about 0.25% of records, but it's concentrated in a few places:

| City (HUI `CITY`) | Kept SFH | Flagged | Share | Median (all) | Median (excl. flagged) |
|---|---:|---:|---:|---:|---:|
| Vineyard | 2,184 | 317 | 14.5% | $661K | $689K (**−4.1%**) |
| Pleasant Grove | 7,173 | 240 | 3.3% | $575K | $581K (−1.0%) |
| Santaquin | 3,674 | 66 | 1.8% | $487K | $490K |
| Provo | 13,994 | 192 | 1.4% | $512K | $512K |

**Done.** The pipeline now requires `ACRES >= 0.05` (`MIN_SINGLE_FAMILY_ACRES`) for homes built in 2000 or later (`SMALL_LOT_EXEMPT_BEFORE_YEAR`). It also drops any record whose footprint geometry (compared as WKB) is identical to another kept record's. On the current GDB this removes 1,290 records, keeps 218 pre-2000 small lots (122 of them in Salt Lake County), and leaves no shared footprints. Three tests cover it. **Why the 2000 cutoff:** small lots before 2000 are few: 218 records, mostly Salt Lake City cottages built around 1900–1920 with about 820 sq ft of floor area. From the 2000s on, small lots become a new-development product: Provo and Lehi in the 2000s, then Pleasant Grove and Vineyard in the 2020s, where 432 of 656 are 0.01–0.02-acre footprint-only parcels. The 1960–1999 band (66 records) is mixed and includes a few parcels whose acreage looks wrong, but it's too small to matter. The original recommendation follows: add `ACRES >= 0.05`, and drop records whose footprint geometry is shared by more than one kept record. Both rules are cheap, fit the SFH-only intent, and mostly affect Vineyard and Pleasant Grove. Spot-check a few Vineyard parcels in the Utah County parcel viewer before adopting the threshold.

### 1.2 [Medium — config fixed 2026-10-16] The HPI adjustment understated appreciation by about 1.5–3.5%

**Done.** `config/counties.yml` now uses the hybrid ratios below, with the method and every source value recorded as comments. The README and About page describe the method. The original analysis follows.

Utah assesses property at its fair market value as of **January 1** of the assessment year (Utah Code §59-2-103). The ratio studies time-adjust sales to that date where the evidence supports it, so `assessed / ASR` is roughly a Jan 1 market value. The pipeline then multiplies by `HPI_2025 / HPI_Y` using **annual-average** county indices. The year-Y annual average is centred mid-year, so the appreciation between Jan 1 and mid-year is never applied.

**FHFA has no quarterly county index.** County (and ZIP and tract) indices are annual only. The finest quarterly geography is the metro area (CBSA), and all four relevant metros are on FRED through **2026 Q2**:

| Metro (FRED series) | Counties in this project |
|---|---|
| Salt Lake City-Murray (`ATNHPIUS41620Q`) | Salt Lake, Tooele |
| Provo-Orem-Lehi (`ATNHPIUS39340Q`) | Utah |
| Ogden (`ATNHPIUS36260Q`) | Davis, Weber, Morgan |
| St. George (`ATNHPIUS41100Q`) | Washington |

Membership was confirmed on 2026-10-16. FHFA adopted the OMB 2023 delineations with the 2025 Q1 release, and its own `hpi_at_metro.csv` labels CBSA 36260 as "Ogden, UT". That metro is Davis, Morgan and Weber; Box Elder moved to the Brigham City micropolitan area. FRED still shows the old "Ogden-Clearfield" title for the same series with identical values. The other three metros didn't change counties.

**Recommended method: a hybrid.** Keep the county annual ratio for county-specific growth, and multiply by a timing correction from the metro quarterly index:

`hpi_ratio = [county_annual(2025) / county_annual(Y)] × [metro_avg(Y) / metro_jan1(Y)]`, where `metro_jan1(Y) = mean(metro Q4 of Y−1, metro Q1 of Y)`.

| County (Y) | Current ratio | Hybrid ratio | Gap |
|---|---:|---:|---:|
| Salt Lake (2024) | 1.0260 | 1.0602 | **+3.3%** |
| Tooele (2024) | 1.0098 | 1.0434 | **+3.3%** |
| Davis (2024) | 1.0200 | 1.0437 | +2.3% |
| Weber (2024) | 1.0309 | 1.0549 | +2.3% |
| Morgan (2024) | 1.0236 | 1.0474 | +2.3% |
| Utah (2023) | 1.0688 | 1.0833 | +1.4% |
| Washington (2026) | 1.0000 | 0.9868 | −1.3% (see 1.3) |

This replaces my earlier, smaller estimate. That one approximated Jan 1 by averaging two annual indices, which smoothed away strong within-year gains in early 2024. The quarterly data shows the gap is bigger.

The same quarterly series would let you move the target from the "2025 average" to the latest quarter (2026 Q2), which adds about another 2.5–3%. That would require relabeling "Market-adjusted (2025)" everywhere (see 2.3 #8).

### 1.3 [Medium — config fixed 2026-10-16] Washington County can now get a real ratio instead of 1

**Done.** `hpi_ratio` for Washington is now 0.9868.

Washington's `assessed_value_year: 2026` with `hpi_ratio: 1` means its "2025" values are really January 2026 values. The St. George quarterly index already covers that period: mean(2025 Q4, 2026 Q1) = 378.4, and the 2025 average is 373.4, so the ratio to the 2025 average is **0.9868**. The current setting overstates Washington by about 1.3% relative to the other counties.

The ASR is still the 2025-assessment ratio applied to 2026 values. That one has to wait for `srs2027`, and the About page already discloses it. Consider adding a `# source:` comment for each config value.

### 1.4 [Medium — fixed 2026-10-16] Static data uses a different mixed-assessment-year rule than the API

**Done.** `geography_assessed_value_years` in `join_shapefile` now sets each place's and ZIP code's assessed year using the API's rule: `primary_assessed_value_year` with `PRIMARY_ASSESSED_VALUE_YEAR_MIN_SHARE = 0.9`. A test covers both the exactly-90% case and the below-90% case. On the current data, only Draper and ZIP 84020 change: 8,129 Salt Lake (2024) and 962 Utah County (2023) homes, an 89.4% share. Both now publish a null assessed year, so the website disables their Assessed toggle and labels it "mixed years". The README describes the rule. The original analysis follows.

The API sets `assessedValueYear` to `null` when fewer than 90% of units share a year. Static geographies just inherit the primary county's year.

- **Draper (`place:4920120`)** and **ZCTA 84020** are 89.4% Salt Lake (2024) and 10.6% Utah County (2023). The UI shows "Assessed (2024)" even though 964 of 9,095 values are 2023 assessments. The API would have hidden the assessed view for the same polygon.
- In assessed mode, the parent-county comparison for Draper compares mixed-year values against Salt Lake County's pure 2024 values.

**Recommendation.** In `join_shapefile`, compute `ASSESSED_VALUE_YEAR` with `primary_assessed_value_year(group, PRIMARY_ASSESSED_VALUE_YEAR_MIN_SHARE)` per geography instead of mapping from `PRIMARY_COUNTY`.

### 1.5 [Medium — n < 20 fixed 2026-10-16; coverage rule deferred] Small-sample geographies are published in the static JSON

**Done (n < 20 only).** `drop_small_geographies` removes places and ZIP codes with fewer than 20 homes (`MIN_PUBLISHED_GEOGRAPHY_RECORD_COUNT`) before the catalog and both value files are built, and a test covers it. In the regenerated data (2026-10-17, $50K floor), this drops ZIP 84034 and ZIP 84056. Ophir (20) and ZIP 84720 (24, the Cedar City fringe) stay. Because the partial-coverage rule below is deferred, ZIP 84720 and ZIP 84629 (52 homes, about 5% coverage) are still published. The original analysis follows.

The API refuses fewer than 100 units for privacy, but the static files publish full P1–P99 arrays for any `n`:

- 2 ZCTAs have `n < 20`. **84056 has n = 4**, and 84034 has n = 11.
- 6 places and 8 ZCTAs have `n < 100`.

With n = 4, the 99 percentiles are interpolations of four individual parcel values. The frontend hides anything under 20, but the JSON is public. Parcel values are public record, so this is about consistency more than real exposure. Still, the README states a privacy rationale that the static output doesn't follow.

**Partial-coverage ZIP codes are the bigger problem.** I divided each geography's kept homes by its ACS owner-occupied housing units; a fully covered area should land around 0.6–1.0:

| Geography | Kept homes | ACS owner-occupied units | Coverage | Why |
|---|---:|---:|---:|---|
| ZIP 84720 (Cedar City) | 26 | 5,353 | **0.5%** | Mostly in Iron County, which the HUI doesn't cover; only a Washington County fringe is counted |
| ZIP 84629 (Fairview) | 45 | 944 | **5%** | Mostly outside Utah County |
| ZIP 84056 | 4 | 19 | 21% | Tiny |
| ZIP 84034 (Ibapah) | 11 | 23 | 48% | Tiny |
| ZIP 84733 (Gunlock) | 46 | 89 | 52% | Partial |
| ZIP 84101 (downtown SLC) | 241 | 1,184 | 20% | Fine; mostly condos, so few single-family homes is expected |

Places and ZIP codes with 20–99 homes that are **fully covered** and are just small communities: Fairfield (57), New Harmony (97), Vernon (87), Hobble Creek (63), Elberta (54), Ophir (20), ZIP 84022 Dugway (27), ZIP 84018 Croydon (56), ZIP 84626 (70). Coverage above 1.0 for Hobble Creek, Elberta, 84018 and 84626 most likely reflects seasonal homes that ACS doesn't count as owner-occupied.

The real risk is 84720 and 84629: they're labeled with a whole ZIP code, and the site pairs them with ZIP-wide ACS income, but they describe only a sliver of that ZIP.

**Recommendation:**
- Drop places and ZIP codes with `n < 20`. That matches what the UI already hides.
- Also drop ZIP codes whose land area lies mostly outside the covered counties. Compute that from the Census 2020 ZCTA-to-county relationship file in the pipeline, rather than from ACS ratios, which miscount seasonal areas. This removes 84720 and 84629 for the right reason.
- Keep the small but fully covered communities. They're real places, and the UI already warns below 100.

### 1.6 [Low — fixed 2026-10-17] `latest_year_built_with_oug_set` is dead config

**Done.** The field is removed from `counties.yml`, and the `IS_OUG` filter has a comment explaining why null counts as not OUG. The original analysis follows.

The field is defined for every county but never read. The data confirms what it describes. `IS_OUG` is null for:
- 97–99% of Salt Lake records built after 2021
- 39–99% of Davis records built 2022–2023
- 79–100% of Weber records built after 2020

The pipeline treats null as "not OUG". This currently lets 3,093 Salt Lake, 544 Davis, and 472 Weber single-family records through unchecked. Single-family records are OUG only 0.07–0.67% of the time, so the real impact is a few dozen records.

**Recommendation.** Either use the field (for example, require `SUBTYPE == single_family` when built-year > oug_set year), or delete it and add a comment explaining why null-as-0 is acceptable.

### 1.7 [Low — fixed 2026-10-16] One ACS sentinel value drops the whole geography's ACS data

**Done.** `parse_number` in `download_acs_tables.py` now returns `null` for the Census API's negative sentinel values, one variable at a time. The owner-occupied share is still computed when only its margin of error is missing, and it is `null` when there are no occupied units. Housing Context in the UI shows "Not available" for any `null` value and hides its confidence interval, so a missing value can never render as "0%". `tests/test_acs_tables.py` covers these cases. This takes effect once `download_acs_tables` is re-run. The original analysis follows.

When the Census API returns `-666666666` for median income, `parse_number` raises, and the **whole row** is skipped, including valid tenure data. Seven geographies are affected: Elberta, Hobble Creek, Ophir, and ZCTAs 84018, 84034, 84626, and **84783**. 84783 has 414 occupied units and a valid 90% owner-occupied share that is thrown away.

**Recommendation.** Parse each variable separately and store `null` for jam values. Also write the ACS output atomically and validate it the way the HUI outputs are validated.

### 1.8 [Low] Other source-data quirks worth knowing

- **Possible duplicate records.** 1,901 records that pass the basic filters are exact duplicates on every field except `UNIT_ID`. Most are Utah County condos built 2020–2022 and Washington condos. They may be legitimate stacked units that share a footprint, but they're worth a spot check.
- **`UNIT_ID` is not unique.** Washington's IDs (0–57k) collide with Salt Lake, Davis, and Weber IDs, so no current join is safe on `UNIT_ID`. Nothing uses it today; this is a trap for the future.
- **[Fixed 2026-10-16] The $10K value floor was too low.** It is now $50K, with a test. A $100K floor was tried first, but it removed 34 genuine low-cost Wendover homes (median 876 sq ft, built around 1960, $43–89K), which pushed Wendover's median up 21%. With the 1.1b cohort rule handling land-only values for homes missing sq ft, $50K is enough. Wendover's median is unchanged at $159K.
- **[Fixed 2026-10-17] `TOT_BD_FT2` validation is weak.** `TOT_BD_FT2` is now a required column, though its values may be missing. The filter uses `TOT_BD_FT2` and `IS_OUG`, but neither is in `REQUIRED_HOUSING_SOURCE_COLUMNS`. `IS_OUG` falls back safely when it's missing; a missing `TOT_BD_FT2` gives a bare `KeyError` instead of a `DataValidationError`.
- **The record-count check is a loose proxy.** `validate_record_count_change` sums `n` across Region, County, Place, and ZCTA, so each home is counted about 3–4 times. That works as a proxy, but a county-level check would be more precise and easier to read.
- **Places miss unincorporated homes, as expected.** 12,874 homes (2.1%) fall outside any Census place. They appear only in county and ZCTA results.

### 1.9 [Medium — fixed 2026-10-17] Setup and pipeline robustness bugs

**Done.** `download_shapefiles.py` now uses the standard library (no `requests`), creates its directory, sets a timeout, and writes each file atomically. A missing ACS file no longer breaks the site; Housing Context shows "Not available". The API loads its data in a `lifespan` hook before accepting requests. The original analysis follows.

- **`pipeline/download_shapefiles.py` fails on a fresh clone.** It imports `requests`, which isn't in `requirements.txt`. It also writes to `data/raw/shapefiles/`, which nothing creates; README step 6 only runs `mkdir -p data/raw/`. It has no `timeout=` either.
- **A missing ACS file breaks the whole site.** `generate_data` writes a manifest that points to `acs_values.json`, but it doesn't produce that file. Running the documented steps out of order, or with a failed ACS fetch, makes `loadData()`'s `Promise.all` reject, and the explorer shows nothing. ACS is supplementary, so load it with a fallback to `undefined`.
- **The API reports ready too early.** `/api/health` returns `ok` before the 700k-record GDB has loaded, and the first `/api/polygon` request pays the full load cost. Warm `get_housing_points()` in a FastAPI `lifespan` hook, and only report healthy once the data is loaded.

### 1.10 [Improvement] Market-adjusted target year: keep an annual average and roll it forward each spring

**Decision (2026-10-16):** keep the market-adjusted target as a calendar-year average (currently 2025) and move it forward once a year. Don't switch to the latest quarter.

**Why:**
- **It keeps growth county-specific.** A latest-quarter target (for example 2026 Q2) would take the last six quarters of growth from metro indices. Davis, Weber and Morgan would all get the Ogden number, and Salt Lake and Tooele would share the Salt Lake City-Murray number. The annual target keeps each county's own year-over-year growth, which is what makes rankings fair.
- **Quarterly values are noisy.** The quarterly all-transactions index isn't seasonally adjusted, includes refinance appraisals, and FHFA revises recent quarters in each release. St. George fell 1.4% from 2026 Q1 to Q2. A quarterly target would make published values move between updates for reasons unrelated to the market.
- **It's one update a year.** The FHFA county annual index (out by spring; the 2025 values were in hand by 2026-03-31) and the Tax Commission's sales-ratio study both come out yearly, so a spring refresh covers both.
- **The site is mainly for comparing places.** Moving the target year shifts every county by a similar few percent, so relative comparisons barely change. Being a year behind matters mainly to someone reading the number as "what my house is worth today", and the note below covers that.

**Improvement 1 — a "prices since" note on the site.** Next to the market-adjusted values, show how much prices have moved since the target year, using the metro quarterly series already in `counties.yml`. For example: *"Values reflect 2025 average prices. FHFA's index for the Ogden metro rose about X% between the 2025 average and 2026 Q2."*
- Have the pipeline emit, for each county, the metro name, the latest quarter, and the percent change from the target-year metro average to that quarter. Put it in `geographies.json` or the manifest.
- The note is context only. It never changes the published percentiles, so metro-level growth stays out of the core figures.
- For places and ZIP codes, use the primary county's metro. Hide the note for the Wasatch Front region and custom areas, which span several metros.

**Improvement 2 — a data-driven label.** Have the pipeline emit `marketValueYear`, and render "Market-adjusted (YYYY)" from it in `GeographyExplorer.tsx`, `HomePage.tsx` and `AboutPage.tsx` (same as 2.3 #8). The yearly rollover then needs no code edits.

**Spring 2027 rollover checklist:**
1. Pull the 2026 county annual indices (`ATNHPIUS{fips}A`) and the metro quarterly series (`ATNHPIUS{CBSA}Q`) from FRED.
2. Recompute every `hpi_ratio` with the formula in `counties.yml`, targeting the 2026 average. Washington's ratio becomes `county_annual(2026) / county_annual(2026) × metro_avg(2026) / metro_jan1(2026)`, the same form as the other counties, so it no longer needs the metro-only special case.
3. Update `assessment_sales_ratio` for any county whose assessed year changes, and replace Washington's stand-in with the 2027 study (`srs2027`, which covers 2026 assessments) once it's published.
4. Bump `marketValueYear` (or the hard-coded label until Improvement 2 lands) and the About page "Last updated" dates.
5. Regenerate, then run `download_acs_tables`. Expect the record-count guard to pass unless the HUI itself changed.

---

## Part 2 — Frontend

### 2.1 Style alignment with darrenskidmore.com

Both sites already share the font stack (Outfit / Space Grotesk / Spline Sans Mono), the header and footer structure, the 72px nav, the 1200px container, and the radial-gradient body. The drift is in the color tokens and the shape language.

**The "weird blue background" is the dark theme.** `style.css:1003` sets a navy-indigo gradient (`#0b1220` → `#1d2440`, surface `#121a2b`). Your site uses neutral charcoal. The light theme drifts too: a cream `#fffdf7` glow and a teal-blue accent.

Token-by-token, taken from the live site CSS:

| Token | This project (light / dark) | darrenskidmore.com (light / dark) |
|---|---|---|
| `--bg` | `#f2f6fb` / `#0b1220` | `#f1f6ff` / `#101113` |
| `--bg-gradient` | `#fffdf7` / `#1d2440` | `#fdfdfd` / `#1c1e21` |
| `--text` | `#151923` / `#e5e7eb` | `#151923` / `#e7e8eb` |
| `--muted` | `#657083` / `#9ca3af` | `#5f6776` / `#a3a7af` |
| `--surface` | `#ffffff` / `#121a2b` | `#ffffff` / `#181a1d` |
| `--border` | `#d6deea` / `#243044` | `#d6deea` / `#2b2e33` |
| `--accent` | `#1476a8` / `#60a5fa` | `#60a5fa` / `#60a5fa` |
| Card radius | 8px | 14px |
| Card shadow | `0 22px 60px …` | none (border only; hover sets the border to accent and lifts 2px) |
| Primary button | square-ish, `#0d5e8a` fill, white text | **pill** (`999px`), `#60a5fa` fill, `#101113` text |
| Secondary button | none | pill, surface fill, 1px border |

Recommended changes:

1. **Replace the `:root` and dark-mode token blocks with the site's values.** Derive `--surface-soft` as `color-mix(in srgb, var(--surface), var(--bg) 35%)`, the way the site derives `.project-media`. Derive `--accent-soft` from `--accent` with `color-mix` as well.
2. **Use one accent in both themes.** Use `#60a5fa` with dark text (`#101113`) for active segmented buttons and the "Analyze Area" button, like the site's "View resume" pill. Dark text on `#60a5fa` has about 7:1 contrast, so it passes AA in both themes. Don't use `#60a5fa` as *text* on white (about 2.5:1). For links and `.metric h4` labels in light mode, keep a darker shade such as `#2563eb`, or use `--text` with an accent underline.
3. **Use the site's card and button shapes.** Set the card radius to 14px, drop `--shadow`, and add the site's hover treatment to clickable cards. Make `.custom-area-submit` and the segmented controls pills.
4. **Use the same nav brand mark.** The site shows an accent-colored line icon; this project uses a raster thumbnail. Re-using the same SVG mark, or at least sizing and styling it the same way, makes the project feel like part of the site.
5. **Recolor the chart.** `--warm` (`#be6b2d` / `#f59e0b`) for the highlighted percentiles has no counterpart on your site. Use `--accent` for the line and `--text` for the highlighted points.
6. **Pick one product name.** The `<title>` in `index.html` says "Utah Home **Values** Explorer", while `PageTitle` says "Utah Home **Value** Explorer".

### 2.2 Layout

Observations from 1280×900 and 375×812:

- **The hero pushes the tool below the fold.** On desktop, the explorer controls start around y = 520. On mobile, the first full screen is the title plus three paragraphs, and the explorer begins about 1.3 screens down. The third paragraph, a step-by-step "parcel search → assessed percentile → switch to market → read the same percentile" procedure, is really a feature request in disguise (see 2.3 #1).
  - **Suggestion:** Cut the hero to a one-line value proposition and a compact "Data as of …" line. Move the assessed-years caveat next to the Assessed toggle as a tooltip or footnote. Shrink or remove the hero image on mobile.
- **The Coverage cards add little.** Three cards (7 / 119 / 610,017) sit at the bottom of the home page. Fold them into the hero as one muted stat line ("610K homes · 7 counties · 119 cities") or move them to About.
- **The summary panel order isn't ideal.** It currently goes header → 5 percentile cards → Housing Context → chart. The chart is the richest view, yet it's last and needs scrolling. On desktop, consider a two-column summary: the key stats and Housing Context on the left, the percentile curve on the right. Keep the single column on mobile.
- **The custom-area textarea is very large.** It is `min-height: 25rem` (400px). About 10rem with auto-grow would do.
- **Rankings, home-value mode, is hard to read.**
  - "Rank 1" means "$500K is below the 1st percentile", which is the *most expensive* places. Five places tie at "≤1%".
  - Percentiles are floored to integers, so ties are common across the table.
  - Fixes: interpolate linearly between adjacent published percentiles (for example, "37.4%"), show "≥99%" at the top end, and add a one-line explainer such as "Places where $500K buys the smallest share of homes come first."
- **The percentile chart uses `tension: 0.22`.** That smoothing can visibly overshoot near P95–P99. Use `cubicInterpolationMode: "monotone"`.

### 2.3 New information the data already supports

These are ordered by value relative to effort.

1. **"Estimate my home's current value" calculator (no pipeline change).** Within a county, market-adjusted = assessed × `hpi_ratio / assessment_sales_ratio`, so this is a one-input widget: enter your assessed value, pick a county, and get the estimate plus where it falls in the selected geography's distribution. It replaces the hero's manual percentile-mapping procedure. Ship the per-county factors in `geographies.json` or the manifest.
2. **Parent overlay on the percentile chart (no pipeline change).** `parentPercentilePoints` is already computed in `GeographyExplorer.tsx:592` but only used for the "+x% from County" text. Draw it as a second, muted line.
3. **Better affordability metrics (no pipeline change).** The data supports "share of homes valued under 3× / 4× / 5× local median income", computed client-side from the percentile array and the ACS income. The same goes for "income needed to buy the median home" under a stated rate and down-payment assumption.
4. **Side-by-side comparison of two geographies (no pipeline change).** All the data is already loaded client-side.
5. **Rankings for ZCTAs and counties, plus CSV download (no pipeline change).**
6. **Age of stock and lot size (pipeline change).**
   - `APX_BLT_YR` and `ACRES` are already loaded but never summarized.
   - Median year built and a "share built since 2015" figure tell a strong story for growth areas such as Lehi, Herriman, Eagle Mountain, and St. George.
   - Lot-size percentiles are a useful companion to value.
   - Leave out value per square foot. `TOT_BD_FT2` mixes above-grade and basement-inclusive reporting across counties (1.1b), so it isn't interpretable.
7. **Choropleth map (pipeline change).** The TIGER place and ZCTA geometries are already downloaded. Export simplified TopoJSON (for example, `mapshaper -simplify 5%`, which stays well under 1 MB for 230 shapes) and color by median. This is probably the single most engaging addition for visitors.
8. **Data freshness in the UI.** Show `manifest.generatedAt` and each county's assessed year. Replace the hard-coded "Market-adjusted (2025)" label in `GeographyExplorer.tsx:205`, `HomePage.tsx`, and `AboutPage.tsx` with a `marketValueYear` emitted by the pipeline, so updates don't need code edits. See 1.10 for the target-year policy and the "prices since" note.

### 2.4 Frontend correctness issues

- **[Medium] The affordability legend contradicts the labels.** The text in `HousingContext.tsx:72-79` says "4.0–5.0 high, 5.0–6.0 very high, above 6.0 severe". The code in `affordabilityDescription()` uses the Demographia scale: ≤3 affordable, ≤4 moderately, ≤5 seriously, >5 severely. A ratio of 5.5 shows "Severely unaffordable" while the text calls it "very high". Pick one scale, ideally Demographia with a citation.
- **[Medium] The housing-context ratio changes with the value toggle.** `HousingContext` receives `selected`, which follows `valueMode`, so the price-to-income ratio silently switches to stale assessed medians in assessed mode. Always pass the market-adjusted stats. Also note that the ACS income is 2020–2024 in 2024 dollars while home values are 2025, which inflates the ratio slightly.
- **[Low] Two `formatCurrency` implementations.** `lib/format.ts` uses 3 minimum significant digits; `GeographyExplorer.tsx:60` uses 2. The same value prints as "$1.10M" on Rankings and "$1.1M" on the explorer. Keep the `lib/` version only.
- **[Low] The API URL falls back to `http://127.0.0.1:8000/api`.** The live build sets the env var correctly. A fork deployed without `VITE_FASTAPI_BASE_PATH` would probe localhost from every visitor's browser, which triggers Chrome's local-network-access permission prompt. Default to "no API" when the variable is unset in production builds.
- **[Low] `GeographyExplorer.tsx:911` checks the wrong ID.** It compares `selectedId !== WASATCH_FRONT_ID` but should use `activeSelectedId`, the ID actually rendered.

---

## Part 3 — Documentation

The README is solid on setup. These additions would most improve how the project comes across to someone browsing GitHub, such as a recruiter, a data person, or a potential contributor:

1. **Lead with visuals.** Put a screenshot or GIF of the explorer and the rankings page and a prominent live-demo link above the fold. Right now the first image a visitor sees is none.
2. **Add a "How it works" section with a diagram and the formula.** Show the flow: HUI GDB → filters → spatial join (TIGER) → percentile summaries → static JSON → React SPA, with the FastAPI polygon service on the side. Spell out `market_value = assessed / county_ASR × (HPI_2025 / HPI_assessed_year)`. Today this is spread across the README, the About page, and the code.
3. **Add a "Limitations & known biases" section.** Being upfront here signals rigor. Cover the single-family-only scope and why (1.1), why square footage is unused (1.1b), 1.2 (valuation-date timing), mixed assessment years, small-n geographies, `APX_BLT_YR` cutoffs that exclude new construction, and the fact that ASRs are county-wide medians rather than tier- or subtype-specific.
4. **Document `config/counties.yml` and add an annual-update runbook.**
   - None of the six fields are explained. `latest_year_built_with_value` and `latest_year_built_with_oug_set` are especially opaque, and the second is unused (1.6).
   - Add a "Updating for a new data release" checklist: which PDF table and row gives the ASR, which FRED series gives the HPI and how to compute the ratio, how to pick `latest_year_built_with_value` (for example, the last build year whose median isn't land-only), and which About-page dates to bump.
   - Put a per-value source comment in the YAML.
5. **Add an output data dictionary.** Document the schema of `geographies.json`, `hui_*_values.json`, `acs_values.json`, and `manifest.json`, including the meaning of `percentiles[i]`, the `$1,000` rounding, and the ID formats (`place:49xxxxx`, `zcta5:84xxx`, `county:salt-lake`). People who want to reuse the data will look for this.
**Status (2026-10-17):** items 2–7 are done. The README has How It Works (with a Mermaid diagram and the formula), Limitations, Updating the Data and an expanded Testing section. `docs/UPDATING.md` is the yearly runbook, the config files document their fields, `docs/DATA.md` is the output data dictionary, and CI runs pytest, the type check and a build. Items 1 (screenshots) and 8 (geodatabase download script) are still open.

6. **Fix the README errors.**
   - ~~The FHFA HPI description~~ and ~~the `##` heading~~ are fixed (2026-10-16).
   - The test list omits `tests/test_housing_loader.py`.
   - "As of January 2026" is stale; the latest update is 2026-10-14.
   - Steps 6 and 12 need the `shapefiles/` directory and `requests` (1.9).
7. **Improve dev tooling.** Add `requirements-dev.txt` with `pytest` and `httpx`, a `npm run typecheck` script, and a short GitHub Actions workflow running pytest and `tsc --noEmit`, with a status badge. The tests run in under 1s, so CI would be essentially free.
8. **Automate the geodatabase download.** It's the only manual step. ArcGIS Hub exposes a direct File Geodatabase download URL, so a `pipeline/download_hui.py` would make the whole pipeline reproducible with one command, or a `make all`.

---

## Suggested order of work

1. **Stage 1 (pipeline changes that affect values) is complete and regenerated as of 2026-10-17 01:48 UTC.** It covers 1.1, 1.1b, 1.1c, 1.2, 1.3, 1.4, 1.5 (n < 20), 1.7, and the 1.8 value floor. The output has 606,196 homes, 119 places and 109 ZIP codes. Compared with the data published before stage 1, county market medians moved 0.5% or less, and the largest place moves are Woodland Hills (+2.4%), West Point (+2.0%) and Sundance (+2.9%). Deferred: the ZIP partial-coverage rule (1.5).
2. Fix the frontend correctness items (2.4: the affordability legend and the ratio following the toggle) and the setup bugs (1.9).
3. Re-skin to the site tokens (2.1) and tighten the hero (2.2).
4. Add the calculator and the parent overlay (2.3 #1 and #2), both cheap and high value.
5. Write the README Limitations, How-it-works, and config docs (Part 3, items 2–4).
6. Add the data-driven market-value label and the "prices since" note (1.10) before the spring 2027 rollover.
