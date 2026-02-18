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

function splitIntoRanges(rolls) {
  if (!rolls || rolls.length === 0) return [];

  // Proper numeric sort
  rolls.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const ranges = [];
  let start = rolls[0];
  let prev = rolls[0];

  function getPrefix(roll) {
    return roll.match(/^[A-Za-z]+/)?.[0] || "";
  }

  function getNumber(roll) {
    return parseInt(roll.match(/\d+$/)?.[0] || 0);
  }

  for (let i = 1; i < rolls.length; i++) {
    const current = rolls[i];

    const samePrefix = getPrefix(current) === getPrefix(prev);
    const consecutive = getNumber(current) === getNumber(prev) + 1;

    if (samePrefix && consecutive) {
      prev = current;
    } else {
      ranges.push({
        from: start,
        to: prev,
        count: getNumber(prev) - getNumber(start) + 1,
      });

      start = current;
      prev = current;
    }
  }

  // Push last range
  ranges.push({
    from: start,
    to: prev,
    count: getNumber(prev) - getNumber(start) + 1,
  });

  return ranges;
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
        }),
      ),
    );

    /* Group by Year */
    const yearMap = {};

    students.forEach((s) => {
      yearMap[s.year] ??= [];
      yearMap[s.year].push(s);
    });

    Object.values(yearMap).forEach((arr) =>
      arr.sort((a, b) => a.name.localeCompare(b.name)),
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

   .page-break {
    page-break-before: always;
    break-before: page;
  }

}

/* ================= GRID (BIG SIZE) ================= */

.grid-container {
  margin-top: 20px;
   
}

.direction-board {
  text-align: center;
  font-weight: bold;
  margin-bottom: 15px;
  border: 2px solid black;
  padding: 8px;
}

.row-visual {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.row-label-visual {
  width: 30px;
  font-weight: bold;
  text-align: center;
}

.seat-box {
  border-radius:5px;
  width: 80px;
  height: 50px;
  border: 2px solid black;
  margin-right: 8px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  font-size: 12px;
}

.empty-seat {
  background: #f5f5f5;
  color: #999;
}

.seat-roll {
  font-weight: bold;
}

.seat-year {
  font-size: 10px;
}


</style>
</head>

<body>
`;

    /* ================= SEATING LIST ================= */

    /* ================= GRID ================= */

    html += `

<h2>Seating Grid [${hallName}] <h6>generated using CEC-GRID</h6></h2>
<h5>Exam Date: ${formatWithHalfDay(date)}</h5>

<div class="grid-container">
  <div style="text-align: center; font-weight: bold; margin-bottom: 15px; padding: 8px;">
    Black Board
  </div>
`;

    rows.forEach((row, r) => {
      html += `<div class="row-visual">`;

      const rowLabel = r + 1;

      html += `<div class="row-label-visual">${rowLabel}</div>`;

      row.forEach((seatData) => {
        const student = seatData && seatData.length ? seatData[0] : null;

        html += `<div class="seat-box ${student ? "" : "empty-seat"}">`;

        if (student) {
          html += `
        <span class="seat-roll">${student.RollNumber || "?"}</span>
      `;
        } else {
          html += `Empty`;
        }

        html += `</div>`;
      });

      html += `</div>`;
    });

    html += `
</div>
`;

    /* ================= ATTENDANCE ================= */
    html += `
<div class="page-break"></div>

<h2>Attendance Sheet [${hallName}]</h2>
<h5>Exam Date: ${formatWithHalfDay(date)}</h5>
`;
    for (const year of Object.keys(yearMap).sort((a, b) => a - b)) {
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

      // 🔥 Strict Roll Number Sorting
      const sortedStudents = [...yearMap[year]].sort((a, b) => {
        const regex = /^([A-Z]+\d+)([A-Z])(\d+)$/;

        const matchA = a.roll.match(regex);
        const matchB = b.roll.match(regex);

        // Fallback if pattern doesn't match
        if (!matchA || !matchB) {
          return a.roll.localeCompare(b.roll, undefined, { numeric: true });
        }

        const [, prefixA, batchA, numA] = matchA;
        const [, prefixB, batchB, numB] = matchB;

        // 1️⃣ Compare prefix (EC24 etc)
        if (prefixA !== prefixB) {
          return prefixA.localeCompare(prefixB);
        }

        // 2️⃣ Compare batch letter (A before B)
        if (batchA !== batchB) {
          return batchA.localeCompare(batchB);
        }

        // 3️⃣ Compare numeric part
        return Number(numA) - Number(numB);
      });

      sortedStudents.forEach((s, i) => {
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

    html += `
  <br><br>
  <table style="width:100%; margin-bottom:20px;">
    <tr>
      <th style="text-align:left;">Absentees (Roll Numbers)</th>
    </tr>
    <tr>
      <td style="height:60px;"></td>
    </tr>
  </table>
  <table style="width:100%; border:none; margin-top:40px;">
    <tr style="border:none;">
      <td style="border:none; width:50%; text-align:left;">
        Name of Invigilator: ______________________________
      </td>
      <td style="border:none; width:50%; text-align:right;">
        Signature: ______________________________
      </td>
    </tr>
  </table>
`;

    hallHTMLs[hallName] = html;
  }

  return hallHTMLs;
}

/* =========================================================
   📊 GENERATE SUMMARY HTML
========================================================= */
/* =========================================================
   📊 GENERATE SUMMARY HTML
========================================================= */

function compressRollNumbers(rolls) {
  if (!rolls || rolls.length === 0) return "";

  // Sort properly (numeric aware)
  rolls.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const ranges = [];
  let start = rolls[0];
  let prev = rolls[0];

  function getPrefix(roll) {
    return roll.match(/^[A-Za-z]+/)?.[0] || "";
  }

  function getNumber(roll) {
    return parseInt(roll.match(/\d+$/)?.[0] || 0);
  }

  for (let i = 1; i < rolls.length; i++) {
    const current = rolls[i];

    const samePrefix = getPrefix(current) === getPrefix(prev);
    const consecutive = getNumber(current) === getNumber(prev) + 1;

    if (samePrefix && consecutive) {
      prev = current;
    } else {
      if (start === prev) {
        ranges.push(start);
      } else {
        ranges.push(`${start} - ${prev}`);
      }
      start = current;
      prev = current;
    }
  }

  // Push last range
  if (start === prev) {
    ranges.push(start);
  } else {
    ranges.push(`${start} - ${prev}`);
  }

  return ranges.join(", ");
}

function getBranchFromRoll(roll) {
  const match = roll.match(/^([A-Z]+)/);
  return match ? match[1] : "Other";
}

function generateSummaryHTML(allocation, date) {
  let html = `
  <style>
    body { 
      font-family: "Times New Roman", serif; 
      font-size: 14px; 
    }

    .main-header {
      border: 2px solid #000;
      padding: 10px;
      text-align: center;
      margin-bottom: 15px;
    }

    .summary-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
    }

    .summary-table th, 
    .summary-table td {
      border: 1px solid #000;
      padding: 6px 8px;
      text-align: center;
    }

    .branch-header {
      font-weight: bold;
    }

    h2, h3, h5 {
      margin: 3px 0;
    }
    
    td{
      border: 1px solid #000;
      font-weight: bold;
    }

  @media print {
  .page-break {
    page-break-before: always;
    break-before: page;
  }
}
  </style>
  
  <div class="main-header">
    <h2>College of Engineering Chengannur</h2>
    <h5>(Managed by IHRD, A Govt of Kerala Undertaking)</h5>
    <h5>Generated using CEC-GRID</h5>
    <h3>
      First Internal Examination – 
      ${new Date(date)
        .toLocaleString("default", { month: "long", year: "numeric" })
        .toUpperCase()}
    </h3>

    <div style="display:flex; justify-content:center; align-items:center; margin-top:10px; font-weight:bold; gap:10px;">
      <span style="text-align:center; font-size:20px; font-weight:bold;">S2</span>
      <span style="text-align:center; font-size:16px;">${formatWithHalfDay(
        date,
      )}</span>
    </div>
  </div>

  <table class="summary-table">
  `;

  // ==========================
  // 1️⃣ Flatten Data
  // ==========================
  const allStudents = [];

  Object.entries(allocation).forEach(([hallName, rows]) => {
    rows.forEach((row) => {
      row.forEach((bench) => {
        bench.forEach((s) => {
          if (!s) return;
          allStudents.push({
            roll: s.RollNumber,
            hall: hallName,
            branch: getBranchFromRoll(s.RollNumber),
          });
        });
      });
    });
  });

  // ==========================
  // 2️⃣ Sort by Branch → Roll
  // ==========================
  allStudents.sort((a, b) => {
    if (a.branch !== b.branch) return a.branch.localeCompare(b.branch);

    return a.roll.localeCompare(b.roll, undefined, { numeric: true });
  });

  // ==========================
  // 3️⃣ Group by Branch → Hall Ranges
  // ==========================
  const branchSegments = {};

  if (allStudents.length > 0) {
    let currentBranch = allStudents[0].branch;
    let currentHall = allStudents[0].hall;
    let startRoll = allStudents[0].roll;
    let endRoll = allStudents[0].roll;

    const pushSegment = (branch, start, end, hall) => {
      if (!branchSegments[branch]) branchSegments[branch] = [];
      const range = start === end ? start : `${start}-${end}`;
      branchSegments[branch].push({ range, hall });
    };

    for (let i = 1; i < allStudents.length; i++) {
      const s = allStudents[i];

      if (s.branch === currentBranch && s.hall === currentHall) {
        endRoll = s.roll;
      } else {
        pushSegment(currentBranch, startRoll, endRoll, currentHall);
        currentBranch = s.branch;
        currentHall = s.hall;
        startRoll = s.roll;
        endRoll = s.roll;
      }
    }

    pushSegment(currentBranch, startRoll, endRoll, currentHall);
  }

  // ==========================
  // 4️⃣ Render Table
  // ==========================
  Object.keys(branchSegments)
    .sort()
    .forEach((branch) => {
      html += `
      <tr>
        <th colspan="4" class="branch-header">${branch}</th>
      </tr>
      <tr>
        <th>Roll No.</th>
        <th>Class Room</th>
        <th>Roll No.</th>
        <th>Class Room</th>
      </tr>
    `;

      const segments = branchSegments[branch];

      for (let i = 0; i < segments.length; i += 2) {
        const seg1 = segments[i];
        const seg2 = segments[i + 1];

        html += `<tr>`;

        html += `<td>${seg1.range}</td><td>${seg1.hall}</td>`;

        if (seg2) {
          html += `<td>${seg2.range}</td><td>${seg2.hall}</td>`;
        } else {
          html += `<td></td><td></td>`;
        }

        html += `</tr>`;
      }
    });

  html += `</table>`;

  html += `
  <style>
    body { font-family: Arial; font-size: 14px; }
    table { width:100%; border-collapse: collapse; margin-bottom:25px; }
    th,td { border:1px solid #000; padding:6px; }
    th { background:#eee; }
  </style>
  <div class="page-break"></div>
  <h1>College of Engineering Chengannur</h1>
  <h1 style="text-align:center">Hall Allocation Summary</h1>
  <h6>Date: ${formatWithHalfDay(date)}</h6>
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

    Object.entries(map).forEach(([year, batches]) => {
      Object.entries(batches).forEach(([batch, rolls]) => {
        const ranges = splitIntoRanges(rolls);

        ranges.forEach((range) => {
          html += `
            <tr>
              <td>${year}</td>
              <td>${batch}</td>
              <td>${range.from}</td>
              <td>${range.to}</td>
              <td>${range.count}</td>
              <td></td>
            </tr>
          `;
        });
      });
    });

    html += "</table>";
  }

  return html;
}

/* =========================================================
   📊 GENERATE SUMMARY HTML
========================================================= */
function getRanges(rolls) {
  if (!rolls || rolls.length === 0) return "";

  // Natural sort
  const sorted = [...rolls].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );

  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];

  const getNum = (s) => {
    const match = s.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  };

  const getPrefix = (s) => {
    const match = s.match(/^(.*?)(\d+)$/);
    return match ? match[1] : s;
  };

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    const prevNum = getNum(prev);
    const currNum = getNum(curr);
    const prevPrefix = getPrefix(prev);
    const currPrefix = getPrefix(curr);

    if (
      prevNum !== null &&
      currNum !== null &&
      prevPrefix === currPrefix &&
      currNum === prevNum + 1
    ) {
      prev = curr;
    } else {
      ranges.push(start === prev ? start : `${start}-${prev}`);
      start = curr;
      prev = curr;
    }
  }
  ranges.push(start === prev ? start : `${start}-${prev}`);
  return ranges.join(", ");
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
    console.log("⚡ Generating new HTML1");

    const allocation = reconstructAllocation(data.halls);

    const roomHTMLs = generateHallHTML(allocation, data.examDate);
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
