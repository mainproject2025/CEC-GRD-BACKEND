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
      Array.from({ length: C }, () => [])
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
        })
      )
    );

    const yearMap = {};

    students.forEach((s) => {
      yearMap[s.year] ??= [];
      yearMap[s.year].push(s);
    });

    Object.values(yearMap).forEach((arr) =>
      arr.sort((a, b) => a.name.localeCompare(b.name))
    );

    let html = `
    <style>
      body { font-family: Arial; font-size: 11px; }
      h1, h2 { text-align: center; }
      table { width: 100%; border-collapse: collapse; margin-bottom:20px; }
      th, td { border: 1px solid #000; padding: 4px; }
      th { background: #eee; }
    </style>

    <h1>Hall Seating Arrangement</h1>
    <h2>${hallName}</h2>
    `;

    /* Seating Table */

    for (const year of Object.keys(yearMap).sort()) {
      html += `
      <h3>Year: ${year}</h3>

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

    /* Attendance Sheet */

    html += `
    <h1>Attendance Sheet</h1>
    <h2>${hallName}</h2>
    `;

    for (const year of Object.keys(yearMap).sort()) {
      html += `
      <h3>Year: ${year}</h3>

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
    h1 { text-align: center; }
    table { width: 100%; border-collapse: collapse; margin-bottom:25px; }
    th, td { border: 1px solid #000; padding: 8px; }
    th { background: #eee; }
  </style>

  <h1>Hall Allocation Summary</h1>
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
        })
      )
    );

    html += `
    <h3>Hall: ${hallName}</h3>

    <table>
      <tr>
        <th>Year</th>
        <th>Batch</th>
        <th>Roll Numbers</th>
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
            <td>${year}</td>
            <td>${batch}</td>
            <td>${map[year][batch].sort().join(", ")}</td>
          </tr>
          `;
          })
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
