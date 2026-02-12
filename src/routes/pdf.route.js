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

function formatWithHalfDay(dateTimeStr) {
  const [date, time] = dateTimeStr.split("T");
  const hour = parseInt(time.split(":")[0], 10);
  const period = hour < 12 ? "Forenoon" : "Afternoon";
  return `${date} ${period}`;
}

/* =========================================================
   📄 GENERATE HALL HTML
========================================================= */
function generateHallHTML(allocation, date) {
  const hallHTMLs = {};

  for (const [hallName, rows] of Object.entries(allocation)) {
    const students = [];

    const hallType = rows.hallType || "Bench";

    /* Collect Students */
    rows.forEach((row, rIdx) =>
      row.forEach((bench, bIdx) =>
        bench.forEach((s) => {
          if (!s) return;

          students.push({
            name: s.Name,
            roll: s.RollNumber,
            year: s.year,
            row: rIdx + 1,
            seatLabel: String.fromCharCode(65 + rIdx) + (bIdx + 1),
          });
        })
      )
    );

    /* Group by Year */
    const yearMap = {};

    students.forEach((s) => {
      yearMap[s.year] ??= [];
      yearMap[s.year].push(s);
    });

    Object.values(yearMap).forEach((arr) =>
      arr.sort((a, b) => a.name.localeCompare(b.name))
    );

    /* Base HTML */

    let html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">

<style>

body {
  font-family: Arial;
  font-size: 12px;
  margin: 6mm;
}

h1, h2, h3, h5 {
  text-align: center;
  margin: 4px 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 18px;
}

th, td {
  border: 1px solid #000;
  font-size: 12px;
  padding: 4px;
  text-align: center;
}

th {
  background: #eee;
}

 

/* ================= PRINT ================= */

@media print {

  body {
    margin-left: 4mm;
    margin-right: 4mm;
  }

   

}

/* ================= GRID (BIG SIZE) ================= */

.grid-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px;
  align-items: center;
  width: 100%;
  page-break-inside: avoid;
}

/* Row */

.row-visual {
  display: flex;
  gap: 12px;
  margin-bottom: 6px;
  align-items: center;
  page-break-inside: avoid;
}

/* Row Label */

.row-label-visual {
  font-weight: bold;
  width: 28px;
  font-size: 13px;
}

/* Bench */

.bench-visual {
  border: 1.5px solid #333;
  padding: 4px;
  display: flex;
  gap: 5px;
  background: #fff;
}

/* Chair */

.chair-visual {
  border: 1.5px solid #555;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8f8f8;
  font-size: 10px;
  border-radius: 3px;
  flex-direction: column;
}

/* Seat */

.seat-visual {
  border: 1px dashed #aaa;
  padding: 3px;
  font-size: 10px;
  min-width: 38px;
  text-align: center;
  background: #fff;
}

/* Empty */

.empty-seat {
  color: #bbb;
}

/* Roll */

.seat-roll {
  font-weight: bold;
  font-size: 10px;
  line-height: 1.1;
}

/* Year */

.seat-year {
  font-size: 9px;
  color: #666;
  line-height: 1;
}

.direction-board {
  width: 100%;
  text-align: center;
  font-weight: bold;
  font-size: 15px;
  color: white;
 
  border-radius: 6px;
  letter-spacing: 1px;
 
  margin-bottom: 10px;
}

</style>
</head>

<body>

<h2>College of Engineering Chengannur</h2>
<h2>First Series Examination Feb26</h2>
<h2>Hall Seating Arrangement (${hallType})</h2>
<h2>${hallName}</h2>
<h5>Exam Date: ${formatWithHalfDay(date)}</h5>
`;

    /* ================= SEATING LIST ================= */

    for (const year of Object.keys(yearMap).sort()) {
      html += `
<h3>Year: ${year}</h3>

<table>
<tr>
  <th>Sl</th>
  <th>Name</th>
  <th>Roll</th>
  <th>Seat</th>
</tr>
`;

      yearMap[year].forEach((s, i) => {
        html += `
<tr>
  <td>${i + 1}</td>
  <td>${s.name}</td>
  <td>${s.roll}</td>
  <td>${s.seatLabel} (R${s.row})</td>
</tr>
`;
      });

      html += `</table>`;
    }

    /* ================= GRID ================= */

    html += `
<div class="page-break"></div>

<h2>Seating Grid [${hallName}]</h2>
<h5>Exam Date: ${formatWithHalfDay(date)}</h5>

<div class="grid-container">
<div class="direction-board">
⬆ ALL EYES THIS WAY ⬆
</div>

`;

    rows.forEach((row, r) => {
      html += `<div class="row-visual">`;

      const rowLabel = 1 + r;

      html += `<div class="row-label-visual">${rowLabel}</div>`;

      /* BENCH MODE */

      if (hallType === "Bench") {
        const benchCount = Math.ceil(row.length / 3);

        for (let b = 0; b < benchCount; b++) {
          html += `<div class="bench-visual">`;

          for (let k = 0; k < 3; k++) {
            const colIdx = b * 3 + k;

            if (colIdx >= row.length) break;

            const seatData = row[colIdx];
            const student =
              seatData && seatData.length ? seatData[0] : null;

            html += `<div class="seat-visual ${student ? "" : "empty-seat"
              }">`;

            if (student) {
              html += `
<span class="seat-roll">${student.RollNumber || "?"}</span>
<span class="seat-year">${student.year}</span>
`;
            } else {
              html += "Empty";
            }

            html += `</div>`;
          }

          html += `</div>`;
        }

      }

      /* CHAIR MODE */

      else {
        row.forEach((seatData) => {
          const student =
            seatData && seatData.length ? seatData[0] : null;

          html += `<div class="chair-visual ${student ? "" : "empty-seat"
            }">`;

          if (student) {
            html += `
<span class="seat-roll">${student.RollNumber || "?"}</span>
<span class="seat-year">${student.year}</span>
`;
          } else {
            html += "Empty";
          }

          html += `</div>`;
        });
      }

      html += `</div>`;
    });

    html += `
</div>
`;

    /* ================= ATTENDANCE ================= */

    html += `
<div class="page-break"></div>

<h2>Attendance Sheet</h2>
<h5>Exam Date: ${formatWithHalfDay(date)}</h5>

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

    /* CLOSE */

    html += `
</body>
</html>
`;

    hallHTMLs[hallName] = html;
  }

  return hallHTMLs;
}

/* =========================================================
   📊 GENERATE SUMMARY HTML
========================================================= */
function generateSummaryHTML(allocation, date) {
  let html = `
  <style>
    body { font-family: Arial; font-size: 14px; }
    table { width:100%; border-collapse: collapse; }
    th,td { border:1px solid #000; padding:6px; }
    th { background:#eee; }
  </style>
  <h1>College of Engineering Chengannur</h1>
  <h1 style="text-align:center">Hall Allocation Summary </h1><h6>Date:${formatWithHalfDay(
    date,
  )}</h6>
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
        }),
      ),
    );

    html += `<h3>Hall: ${hall}</h3>

    <table>
      <tr>
        <th>Year</th>
        <th>Batch</th>
        <th>From</th>
        <th>To</th>
        <th>Count</th>
        <th>Absentees</th>
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
          <td></td>
        </tr>
      `;
      }),
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
    // if (data.summary && data.rooms) {
    //   console.log("✅ Returning cached HTML");

    //   return res.json({
    //     success: true,
    //     cached: true,
    //     summary: data.summary,
    //     rooms: data.rooms,
    //   });
    // }
    /* =====================================
       ⚡ GENERATE NEW
    ===================================== */
    console.log("⚡ Generating new HTML");

    const allocation = reconstructAllocation(data.halls);

    const roomHTMLs = generateHallHTML(allocation,data.examDate);
    const summaryHTML = generateSummaryHTML(allocation, data.examDate);

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
