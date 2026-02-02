const express = require("express");

const router = express.Router();

const { admin, db } = require("../config/firebase");

/* =====================================================
   🔁 RECONSTRUCT allocation MATRIX FROM FIRESTORE
===================================================== */
function reconstructAllocation(hallsData) {
  const allocation = {};

  for (const [hallName, hallData] of Object.entries(hallsData)) {
    const R = hallData.rows;
    const C = hallData.columns;

    if (!R || !C) continue;

    const matrix = Array.from({ length: R }, () =>
      Array.from({ length: C }, () => []),
    );

    for (const [key, value] of Object.entries(hallData)) {
      if (!/^row\d+$/.test(key)) continue;

      if (!Array.isArray(value)) continue;

      const rowIndex = Number(key.replace("row", ""));

      value.forEach((s) => {
        if (!s || typeof s !== "object") return;

        const benchIndex = s.bench - 1;

        if (matrix[rowIndex] && matrix[rowIndex][benchIndex]) {
          matrix[rowIndex][benchIndex].push({
            Name: s.name,
            RollNumber: s.roll,
            year: s.year,
            Batch: s.batch,
          });
        }
      });
    }

    allocation[hallName] = matrix;
  }

  console.log("✅ Allocation reconstructed");

  return allocation;
}

/* =====================================================
   📄 GENERATE HALL + ATTENDANCE HTML
===================================================== */
function generateHallHTML(allocation) {
  const hallHTMLs = {};

  for (const [hallName, rows] of Object.entries(allocation)) {
    const students = [];

    rows.forEach((row, rIdx) =>
      row.forEach((bench, bIdx) =>
        bench.forEach((s, sIdx) => {
          if (!s) return;

          students.push({
            name: s.Name,
            roll: s.RollNumber,
            year: s.year,
            row: rIdx + 1,
          });
        }),
      ),
    );

    const yearMap = {};

    students.forEach((s) => {
      yearMap[s.year] ??= [];
      yearMap[s.year].push(s);
    });

    Object.values(yearMap).forEach((arr) =>
      arr.sort((a, b) => a.name.localeCompare(b.name)),
    );

    let html = `
    <style>
      body { font-family: Arial; font-size: 11px; }
      h1, h2 { text-align: center; padding:2px;}
      table { width: 100%; border-collapse: collapse; margin-bottom:20px; }
      th, td { border: 1px solid #000; font-size:11px;}
      th { background: #eee; }
    </style>

    <h2>College of Engineering Chengannur</h2>
    <h2>First Series Examination Feb26</h2>
    <h2>Hall Seating Arrangement (Generated Using CEC-GRID)</h2>
    <h2>${hallName}</h2>
    <h2>Date:Feb 02 2026 (AN)</h2>
    `;

    /* Seating Table */

    for (const year of Object.keys(yearMap).sort()) {
      html += `
      <table>
        <tr>
          <th>Sl</th>
          <th>Name</th>
          <th>Roll</th>
          <th>Row</th>
        </tr>
      `;

      yearMap[year].forEach((s, i) => {
        html += `
        <tr>
          <td>${i + 1}</td>
          <td>${s.name}</td>
          <td>${s.roll}</td>
          <td>${s.row}</td>
        </tr>
        `;
      });

      html += `</table>`;
    }

    html += `<div class="page-break">
    <h2>College of Engineering Chengannur</h2>
    <h2>First Series Examination Feb26</h2>
    <h2>Seating Grid (Generated Using CEC-GRID)</h2>
    <h2>${hallName}</h2>
    <h4>Date:Feb 02 2026 (AN)</h4><table class="grid">`;

    const maxSeatsPerBench = Math.max(
      ...rows.flatMap((row) => row.map((bench) => bench.length)),
    );

    // ===== STYLE (ADD ONCE) =====
    html += `
<style>

  .seat-container {
    width: 100%;
    overflow-x: auto;
    margin: 20px 0;
  }

  #seat-grid {
    width: 100%;
    border-collapse: collapse;
    font-family: Arial, sans-serif;
    font-size: 12px;
    text-align: center;
  }

  #seat-grid th,
  #seat-grid td {
    border: 1px solid #333;
    padding: 6px 4px;
  }

  #seat-grid th {
    background: #f0f3f7;
    font-weight: 600;
  }

  #seat-grid tr:nth-child(even) td {
    background: #fafafa;
  }

  #seat-grid tr:hover td {
    background: #e8f2ff;
  }

  .row-label {
    background: #dde6f0;
    font-weight: bold;
  }

  .bench-label {
    background: #cfe2ff;
    font-weight: bold;
  }

  .seat-label {
    background: #edf3ff;
    font-size: 11px;
  }

  @media print {
    #seat-grid {
      page-break-inside: avoid;
    }
  }

</style>
`;

    // ===== TABLE START =====
    html += `
<div class="seat-container">
<table id="seat-grid">
`;

    /* ===== HEADER ROW (BENCH LABELS) ===== */

    html += `<tr><th class="row-label">Row / Bench</th>`;

    rows[0].forEach((bench, i) => {
      html += `
    <th class="bench-label" colspan="${maxSeatsPerBench}">
      B${i + 1}
    </th>
  `;
    });

    html += `</tr>`;

    /* ===== SUB HEADER (SEAT LABELS) ===== */

    html += `<tr><th></th>`;

    rows[0].forEach(() => {
      for (let i = 0; i < maxSeatsPerBench; i++) {
        html += `<th class="seat-label">S${i + 1}</th>`;
      }
    });

    html += `</tr>`;

    /* ===== DATA ROWS ===== */

    rows.forEach((row, r) => {
      html += `<tr>`;

      // Row label
      html += `<th class="row-label">R${r + 1}</th>`;

      row.forEach((bench) => {
        for (let i = 0; i < maxSeatsPerBench; i++) {
          const s = bench[i];

          html += `
        <td>
          ${s ? s.RollNumber : ""}
        </td>
      `;
        }
      });

      html += `</tr>`;
    });

    /* ===== TABLE END ===== */

    html += `
</table>
</div>
`;

    html += "</table>";
    html += `<div class="page-break"></div>
    <h2>College of Engineering Chengannur</h2>
    <h2>First Series Examination Feb26</h2>
    <h2>Attendance Sheet (Generated Using CEC-GRID)</h2>
    <h4>Date:Feb 02 2026 (AN)</h4><table class="grid">`;
    /* Attendance Sheet */

    html += `
    <h2>${hallName}</h2>
    `;

    for (const year of Object.keys(yearMap).sort()) {
      html += `
      <h3>Year: ${year=="A" ?4:2 }</h3>

      <table>
        <tr>
          <th>Sl</th>
          <th>Name</th>
          <th>Roll</th>
          <th>Signature</th>
        </tr>
      `;

      yearMap[year].forEach((s, i) => {
        html += `
        <tr>
          <td>${i + 1}</td>
          <td>${s.name}</td>
          <td>${s.roll}</td>
          <td></td>
        </tr>
        `;
      });

      html += `</table>`;
    }

    hallHTMLs[hallName] = html;
  }

  return hallHTMLs;
}

/* =====================================================
   📊 GENERATE ROLL SUMMARY HTML
===================================================== */
function generateSummaryHTML(allocation) {
  let html = `
  <style>
    body { font-family: Arial; font-size: 13px; }
    h2 { text-align: center; }
    table { width: 100%; border-collapse: collapse; margin-bottom:25px; }
    th, td { border: 1px solid #000; padding: 8px; }
    th { background: #eee; }
  </style>
    <h2>College of Engineering Chengannur</h2>
    <h2>First Series Examination Feb26</h2>
    <h2>Hall Summary(Generated Using CEC-GRID)</h2>
    <h4>Date:Feb 02 2026 (AN)</h4>
  `;

  for (const [hallName, rows] of Object.entries(allocation)) {
    const map = {};

    rows.forEach((row) =>
      row.forEach((bench) =>
        bench.forEach((s) => {
          if (!s) return;

          const roll = s.RollNumber;
          const year = s.year || "UNKNOWN";
          const batch = s.Batch || "UNKNOWN";

          map[year] ??= {};
          map[year][batch] ??= [];

          map[year][batch].push(roll);
        }),
      ),
    );

    html += `
    <h3>Hall: ${hallName}</h3>

    <table>
      <tr>
        <th>Year</th>
        <th>Batch</th>
        <th>Roll Numbers</th>
        <th>Absentees</th>
      </tr>
    `;

    Object.keys(map)
      .sort()
      .forEach((year) =>
        Object.keys(map[year])
          .sort()
          .forEach((batch) => {
            html += `
          <tr>
            <td>${year=="A" ?4:2 }</td>
            <td>${batch}</td>
            <td>${map[year][batch].sort().join(", ")}</td>
            <td></td>
          </tr>
          `;
          }),
      );

    html += `</table>`;
  }

  return html;
}

/* =====================================================
   🚀 ROUTE: CACHE → GENERATE → STORE → RETURN
===================================================== */
router.post("/", async (req, res) => {
  try {
    const { examId } = req.body;

    if (!examId) {
      return res.status(400).json({ error: "examId required" });
    }

    const ref = db.collection("examAllocations").doc(examId);

    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Allocation not found" });
    }

    const data = snap.data();

    /* =====================================
       ✅ RETURN CACHE
    ===================================== */
    if (data.hallHtml && data.summaryHtml) {
      console.log("✅ Returning cached HTML");

      return res.json({
        success: true,
        cached: true,
        halls: data.hallHtml,
        summary: data.summaryHtml,
      });
    }

    /* =====================================
       ⚡ GENERATE
    ===================================== */

    console.log("⚡ Generating new HTML");

    const allocation = reconstructAllocation(data.halls);

    const hallHTML = generateHallHTML(allocation);
    const summaryHTML = generateSummaryHTML(allocation);

    /* =====================================
       💾 SAVE
    ===================================== */

    await ref.update({
      hallHtml: hallHTML,
      summaryHtml: summaryHTML,
      htmlGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    /* =====================================
       📤 RETURN
    ===================================== */

    return res.json({
      success: true,
      cached: false,
      halls: hallHTML,
      summary: summaryHTML,
    });
  } catch (err) {
    console.error("ERROR:", err);

    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
