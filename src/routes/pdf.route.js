const express = require("express");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");


const router = express.Router();
const { admin, db } = require("../config/firebase");


/* =========================================================
   🔁 RECONSTRUCT allocation MATRIX from Firestore
========================================================= */
function reconstructAllocation(hallsData) {
  const allocation = {};

  for (const [hallName, students] of Object.entries(hallsData)) {
    let maxRow = 0;
    let maxBench = 0;

    students.forEach(s => {
      maxRow = Math.max(maxRow, s.row);
      maxBench = Math.max(maxBench, s.bench);
    });

    const rows = Array.from({ length: maxRow }, () =>
      Array.from({ length: maxBench }, () => [])
    );

    students.forEach(s => {
      rows[s.row - 1][s.bench - 1][s.seat - 1] = {
        Name: s.name,
        RollNumber: s.roll,
        year: s.year,
        Batch: s.batch,
      };
    });

    allocation[hallName] = rows;
  }

  return allocation;
}

/* =========================================================
   📄 GENERATE HALL PDFs (UNCHANGED LOGIC)
========================================================= */
async function generateHallSeatingPDF(allocation, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

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
    students.forEach(s => {
      grouped[s.year] ??= [];
      grouped[s.year].push(s);
    });

    Object.values(grouped).forEach(arr =>
      arr.sort((a, b) =>
        a.row === b.row ? a.col - b.col : a.row - b.row
      )
    );

    let html = `
      <style>
        body { font-family: Arial; font-size: 11px; }
        h1, h2 { text-align: center; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; font-size:10px; }
        th, td { border: 1px solid #000; padding: 4px; }
        th { background: #f0f0f0; }
        .page-break { page-break-before: always; }
        .grid td { width: 50px; text-align: center; }
      </style>

      <h1>Hall Seating Arrangement</h1>
      <h2>Hall: ${hallName}</h2>
    `;

    Object.keys(grouped).sort().forEach(year => {
      html += `
        <h3>Year: ${year}</h3>
        <table>
          <tr>
            <th>Sl No</th>
            <th>Name</th>
            <th>Roll</th>
            <th>Row</th>
            <th>Col</th>
          </tr>
      `;
      grouped[year].forEach((s, i) => {
        html += `
          <tr>
            <td>${i + 1}</td>
            <td>${s.name}</td>
            <td>${s.roll}</td>
            <td>${s.row}</td>
            <td>${s.col}</td>
          </tr>
        `;
      });
      html += "</table>";
    });

    html += `<div class="page-break"></div><h2>Grid</h2><table class="grid">`;

    rows.forEach(row => {
      html += "<tr>";
      row.forEach(bench =>
        [...Array(3)].forEach((_, i) => {
          const s = bench[i];
          html += `<td>${s ? s.RollNumber : "—"}</td>`;
        })
      );
      html += "</tr>";
    });

    html += "</table>";

    await page.setContent(html);
    await page.pdf({
      path: path.join(outputDir, `${hallName}_Seating.pdf`),
      format: "A4",
      margin: { top: 20, bottom: 20, left: 20, right: 20 },
    });
  }

  await browser.close();
}

/* =========================================================
   📊 MASTER PLAN PDF
========================================================= */
async function generateHallYearBatchRangePDF(allocation, outputDir) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

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

    rows.forEach(row =>
      row.forEach(bench =>
        bench.forEach(s => {
          if (!s) return;
          map[s.year] ??= {};
          map[s.year][s.Batch ?? "UNKNOWN"] ??= [];
          map[s.year][s.Batch ?? "UNKNOWN"].push(s.RollNumber);
        })
      )
    );

    html += `<h3>Hall: ${hall}</h3><table>
      <tr><th>Year</th><th>Batch</th><th>From</th><th>To</th><th>Count</th></tr>`;

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

  await page.setContent(html);
  await page.pdf({
    path: path.join(outputDir, "Hall_Year_Batch_Range_Summary.pdf"),
    format: "A4",
  });

  await browser.close();
}

/* =========================================================
   🚀 ROUTE: GENERATE PDFs BY EXAM ID
========================================================= */
router.post("/", async (req, res) => {
  try {
  const { examId } = req.body;

  const snap = await db.collection("examAllocations").doc(examId).get();
  if (!snap.exists) {
    return res.status(404).json({ error: "Not found" });
  }

  const data = snap.data();
  const allocation = reconstructAllocation(data.halls);

  const outputDir = path.join(__dirname, "..", "output", examId);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate PDFs
  await generateHallSeatingPDF(allocation, outputDir);
  await generateHallYearBatchRangePDF(allocation, outputDir);

  /* ===============================
     ZIP + STREAM RESPONSE
  =============================== */

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=Exam_${examId}_PDFs.zip`
  );
  res.setHeader("Content-Type", "application/zip");

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", (err) => {
    throw err;
  });

  // Pipe ZIP directly to response
  archive.pipe(res);

  // Add the entire output directory to zip
  archive.directory(outputDir, false);

  // Finalize ZIP
  await archive.finalize();

} catch (err) {
  console.error(err);
  res.status(500).json({ error: err.message });
}
});

module.exports = router;
