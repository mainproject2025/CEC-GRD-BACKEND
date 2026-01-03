const express = require("express");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
 

const router = express.Router();
const { admin, db } = require("../config/firebase");


/* =====================================================
   🔁 RECONSTRUCT allocation MATRIX FROM FIRESTORE
===================================================== */
function reconstructAllocation(halls) {
  const allocation = {};

  for (const [hallName, students] of Object.entries(halls)) {
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

/* ================================
   PDF: HALL SEATING
================================ */
async function generateHallSeatingPDF(allocation, outputDir = "output") {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  for (const [hallName, rows] of Object.entries(allocation)) {
    const students = [];

    rows.forEach((row, rIdx) =>
      row.forEach((bench, bIdx) =>
        bench.forEach((s, sIdx) => {
          if (!s) return;
          students.push({
            name: s.Name || "N/A",
            roll: s.RollNumber || "N/A",
            year: s.year,
            row: rIdx + 1,
            col: bIdx * 3 + sIdx + 1,
          });
        })
      )
    );

    const yearMap = {};
    students.forEach(s => {
      yearMap[s.year] ??= [];
      yearMap[s.year].push(s);
    });

    Object.values(yearMap).forEach(arr =>
      arr.sort((a, b) => a.name.localeCompare(b.name))
    );

    let html = `
      <style>
        body { font-family: Arial; font-size: 11px; }
        h1, h2 { text-align: center; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size:10px; }
        th, td { border: 1px solid #000; padding: 4px; }
        th { background: #f0f0f0; }
        .page-break { page-break-before: always; }
        .grid td { width: 50px; text-align: center; }
      </style>

      <h1>Hall Seating Arrangement</h1>
      <h2>Hall: ${hallName}</h2>
    `;

    for (const year of Object.keys(yearMap).sort()) {
      html += `<h3>Year: ${year}</h3>
        <table>
          <tr>
            <th>Sl</th><th>Student Name</th><th>Roll No</th><th>Row</th><th>Column</th>
          </tr>
      `;
      yearMap[year].forEach((s, i) => {
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
      html += `</table>`;
    }

    html += `<div class="page-break"></div>
      <h1>Seating Allocation Grid</h1>
      <h2>Hall: ${hallName}</h2>
      <table class="grid">
    `;

    rows.forEach(row => {
      html += `<tr>`;
      row.forEach(bench => {
        for (let i = 0; i < 3; i++) {
          const s = bench[i];
          html += `<td>${s ? s.RollNumber : "—"}</td>`;
        }
      });
      html += `</tr>`;
    });

    html += `</table>`;

    html += `
      <div class="page-break"></div>
      <h1>Seating Allocation Grid</h1>
      <h2>Hall: ${hallName} Attendence Sheet</h2>
      <table class="grid">
    `;

    for (const year of Object.keys(yearMap).sort()) {
      html += `<h3>Year: ${year}</h3>
        <table>
          <tr>
            <th>Sl</th><th>Student Name</th><th>Roll No</th><th>Signature</th>
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

    await page.setContent(html, { waitUntil: "load" });

    const file = path.join(outputDir, `${hallName}_Seating.pdf`);
    await page.pdf({
      path: file,
      format: "A4",
      margin: { top: 20, bottom: 20, left: 20, right: 20 },
    });
  }

  await browser.close();
}

/* ================================
   PDF: MASTER PLAN
================================ */
async function generateHallYearBatchRollSummaryPDF(allocation, outputDir = "output") {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  let html = `
    <style>
      body { font-family: Arial; font-size: 13px; }
      h1 { text-align: center; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size:19px; }
      th, td { border: 1px solid #000; padding: 9px; vertical-align: top; }
      th { background: #f0f0f0; }
    </style>

    <h1>Hall Allocation Summary (Year & Batch-wise)</h1>
  `;

  for (const [hallName, rows] of Object.entries(allocation)) {
    const map = {};

    rows.forEach(row =>
      row.forEach(bench =>
        bench.forEach(s => {
          if (!s) return;
          const year = s.year || "UNKNOWN";
          const batch = s.Batch || "UNKNOWN";
          map[year] ??= {};
          map[year][batch] ??= [];
          map[year][batch].push(s.RollNumber);
        })
      )
    );

    html += `<h3>Hall: ${hallName}</h3>
      <table>
        <tr><th>Year</th><th>Batch</th><th>Roll Numbers</th></tr>
    `;

    Object.keys(map).sort().forEach(year =>
      Object.keys(map[year]).sort().forEach(batch => {
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

  await page.setContent(html, { waitUntil: "load" });

  await page.pdf({
    path: path.join(outputDir, "Hall_Year_Batch_Roll_Summary.pdf"),
    format: "A4",
    margin: { top: 20, bottom: 20, left: 20, right: 20 },
  });

  await browser.close();
}

/* =====================================================
   🚀 EXPRESS ROUTE
===================================================== */
router.get("/subject-allocation/:examId/pdfs", async (req, res) => {
  try {
    const { examId } = req.params;

    const snap = await db
      .collection("subjectAllocations")
      .doc(examId)
      .get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Allocation not found" });
    }

    const data = snap.data();
    const allocation = reconstructAllocation(data.halls);

    const outputDir = path.join("output", examId);

    await generateHallSeatingPDF(allocation, outputDir);
    await generateHallYearBatchRollSummaryPDF(allocation, outputDir);

    res.json({
      success: true,
      message: "PDFs generated successfully",
      path: outputDir,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
