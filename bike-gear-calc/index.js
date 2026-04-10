/**
 * Bicycle Gear Calculator
 *
 * Key concepts:
 *  - Gear Ratio   = chainring teeth / cog teeth
 *  - Development  = gear ratio * wheel circumference (meters per crank revolution)
 *  - Cadence      = pedaling speed in RPM
 *  - Speed        = development * cadence (converted to km/h or mph)
 */

const WHEEL_CIRCUMFERENCES_M = {
  "700c": 2.096,   // standard road
  "650b": 1.953,   // gravel / MTB 27.5"
  "26in": 1.995,   // classic MTB
  "29in": 2.326,   // 29er MTB
};

/**
 * Calculate gear ratio from chainring and cog tooth counts.
 * @param {number} chainring - Front chainring teeth
 * @param {number} cog       - Rear cog teeth
 * @returns {number}
 */
function gearRatio(chainring, cog) {
  if (cog <= 0) throw new Error("Cog teeth must be greater than zero");
  return chainring / cog;
}

/**
 * Calculate development (meters traveled per crank revolution).
 * @param {number} chainring    - Front chainring teeth
 * @param {number} cog          - Rear cog teeth
 * @param {string} wheelSize    - Key from WHEEL_CIRCUMFERENCES_M (default "700c")
 * @returns {number} meters per revolution
 */
function development(chainring, cog, wheelSize = "700c") {
  const circ = WHEEL_CIRCUMFERENCES_M[wheelSize];
  if (!circ) throw new Error(`Unknown wheel size "${wheelSize}". Choose from: ${Object.keys(WHEEL_CIRCUMFERENCES_M).join(", ")}`);
  return gearRatio(chainring, cog) * circ;
}

/**
 * Calculate speed given cadence and gear.
 * @param {number} chainring    - Front chainring teeth
 * @param {number} cog          - Rear cog teeth
 * @param {number} cadenceRpm   - Pedaling cadence in RPM
 * @param {string} wheelSize    - Key from WHEEL_CIRCUMFERENCES_M (default "700c")
 * @returns {{ kmh: number, mph: number }}
 */
function speed(chainring, cog, cadenceRpm, wheelSize = "700c") {
  const dev = development(chainring, cog, wheelSize);
  const kmh = (dev * cadenceRpm * 60) / 1000;
  const mph = kmh * 0.621371;
  return { kmh: +kmh.toFixed(2), mph: +mph.toFixed(2) };
}

/**
 * Build a full gear table for a drivetrain.
 * @param {number[]} chainrings - Array of front chainring tooth counts
 * @param {number[]} cogs       - Array of rear cog tooth counts
 * @param {number}  cadenceRpm  - Pedaling cadence in RPM (default 90)
 * @param {string}  wheelSize   - Wheel size key (default "700c")
 * @returns {Array<{ chainring, cog, ratio, developmentM, kmh, mph }>}
 */
function gearTable(chainrings, cogs, cadenceRpm = 90, wheelSize = "700c") {
  const rows = [];
  for (const chainring of chainrings) {
    for (const cog of cogs) {
      const ratio = gearRatio(chainring, cog);
      const developmentM = development(chainring, cog, wheelSize);
      const { kmh, mph } = speed(chainring, cog, cadenceRpm, wheelSize);
      rows.push({ chainring, cog, ratio: +ratio.toFixed(2), developmentM: +developmentM.toFixed(2), kmh, mph });
    }
  }
  return rows.sort((a, b) => a.ratio - b.ratio);
}

// ── Demo ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const chainrings = [50, 34];          // compact double
  const cogs       = [11, 13, 15, 17, 19, 22, 25, 28, 32]; // 9-speed cassette
  const cadence    = 90;                // rpm
  const wheel      = "700c";

  console.log(`Gear table — ${wheel}, ${cadence} rpm cadence\n`);
  console.log("Chainring | Cog | Ratio | Dev (m) | km/h  | mph");
  console.log("----------|-----|-------|---------|-------|------");

  for (const row of gearTable(chainrings, cogs, cadence, wheel)) {
    console.log(
      `    ${String(row.chainring).padStart(2)}    | ${String(row.cog).padStart(2)}  | ${String(row.ratio).padEnd(5)} | ${String(row.developmentM).padEnd(7)} | ${String(row.kmh).padEnd(5)} | ${row.mph}`
    );
  }
}

module.exports = { gearRatio, development, speed, gearTable, WHEEL_CIRCUMFERENCES_M };
