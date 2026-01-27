const express = require("express");

const router = express.Router();

const { admin, db } = require("../config/firebase");

/* =========================================================
   🔁 RECONSTRUCT allocation MATRIX from Firestore
========================================================= */
function reconstructAllocation(hallsData) {
  const allocation = {};

  for (const [hallName, hallData] of Object.entries(hallsData)) {
    const R = hallData.rows;
    const C = hallData.columns;

    if (!R || !C) continue;

    // Create empty matrix
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

/* =========================================================
   📄 GENERATE HALL HTML
========================================================= */
function generateHallHTML(allocation) {
  const hallHTMLs = {};

  for (const [hallName, rows] of Object.entries(allocation)) {
    const students = [];

    rows.forEach((row, rIdx) =>
      row.forEach((bench, bIdx) =>
        bench.forEach((student, sIdx) => {
          if (!student) return;

          students.push({
            name: student.Name || "N/A",
            roll: student.RollNumber || "N/A",
            year: student.year,
            row: rIdx + 1,
            col: bIdx * 3 + sIdx + 1,
          });
        })
      )
    );

    const grouped = {};

    students.forEach((s) => {
      grouped[s.year] ??= [];
      grouped[s.year].push(s);
    });

    Object.values(grouped).forEach((arr) =>
      arr.sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
    );

    let html = `
    <style>
      body { font-family: Arial; font-size: 11px; }
      h1, h2 { text-align: center; }
      table { width: 100%; border-collapse: collapse; font-size:10px; }
      th, td { border: 1px solid #000; padding: 4px; }
      th { background: #f0f0f0; }
    </style>

    <h1>Hall Seating Arrangement</h1>
    <h2>Hall: ${hallName}</h2>
    `;

    Object.keys(grouped)
      .sort()
      .forEach((year) => {
        html += `
        <h3>Year: ${year}</h3>

        <table>
          <tr>
            <th>Sl No</th>
            <th>Name</th>
            <th>Roll</th>
            <th>Row</th>
          </tr>
      `;

        grouped[year].forEach((s, i) => {
          html += `
          <tr>
            <td>${i + 1}</td>
            <td>${s.name}</td>
            <td>${s.roll}</td>
            <td>${s.row}</td>
          </tr>
        `;
        });

        html += "</table>";
      });

      html += `<div class="page-break"></div><h2>Grid</h2><table class="grid">`;
    const maxSeatsPerBench = Math.max(
      ...rows.flatMap((row) => row.map((bench) => bench.length))
    );
    rows.forEach((row) => {
      html += "<tr>";
      row.forEach((bench) => {
        for (let i = 0; i < maxSeatsPerBench; i++) {
          const s = bench[i];
          html += `<td>${s ? s.RollNumber : ""}</td>`;
        }
      });
      html += "</tr>";
    });

    html += "</table>";
    
    hallHTMLs[hallName] = html;
  }

  return hallHTMLs;
}

/* =========================================================
   📊 GENERATE SUMMARY HTML
========================================================= */
function generateSummaryHTML(allocation) {
  let html = `
  <style>
    body { font-family: Arial; font-size: 14px; }
    table { width:100%; border-collapse: collapse; }
    th,td { border:1px solid #000; padding:6px; }
    th { background:#eee; }
  </style>

  <h1 style="text-align:center">Hall Allocation Summary</h1>
  `;

  for (const [hall, rows] of Object.entries(allocation)) {
    const map = {};

    rows.forEach((row) =>
      row.forEach((bench) =>
        bench.forEach((s) => {
          if (!s) return;

          map[s.year] ??= {};
          map[s.year][s.Batch ?? "UNKNOWN"] ??= [];
          map[s.year][s.Batch ?? "UNKNOWN"].push(s.RollNumber);
        })
      )
    );

    html += `<h3>Hall: ${hall}</h3>

    <table>
      <tr>
        <th>Year</th>
        <th>Batch</th>
        <th>From</th>
        <th>To</th>
        <th>Count</th>
      </tr>`;

    Object.entries(map).forEach(([year, batches]) =>
      Object.entries(batches).forEach(([batch, rolls]) => {
        rolls.sort();

        html += `
        <tr>
          <td>${year}</td>
          <td>${batch}</td>
          <td>${rolls[0]}</td>
          <td>${rolls[rolls.length - 1]}</td>
          <td>${rolls.length}</td>
        </tr>
      `;
      })
    );

    html += "</table>";
  }

  return html;
}

/* =========================================================
   🚀 ROUTE: CACHE → GENERATE → STORE → RETURN
========================================================= */
router.post("/", async (req, res) => {
  try {
    const { examId } = req.body;
    console.log(req.body);
    
    if (!examId) {
      return res.status(400).json({ error: "examId is required" });
    }

    const ref = db.collection("examAllocations").doc(examId);

    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Exam not found" });
    }

    const data = snap.data();

    /* =====================================
       ✅ RETURN CACHE IF EXISTS
    ===================================== */
    if (data.summary && data.rooms) {
      console.log("✅ Returning cached HTML");

      return res.json({
        success: true,
        cached: true,
        summary: data.summary,
        rooms: data.rooms,
      });
    }

    /* =====================================
       ⚡ GENERATE NEW
    ===================================== */
    console.log("⚡ Generating new HTML");

    const allocation = reconstructAllocation(data.halls);

    const roomHTMLs = generateHallHTML(allocation);
    const summaryHTML = generateSummaryHTML(allocation);

    /* =====================================
       💾 SAVE TO FIRESTORE
    ===================================== */
    await ref.update({
      summary: summaryHTML,
      rooms: roomHTMLs,
      htmlGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    /* =====================================
       📤 RETURN RESPONSE
    ===================================== */
    return res.json({
      success: true,
      cached: false,
      summary: summaryHTML,
      rooms: roomHTMLs,
    });
  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
