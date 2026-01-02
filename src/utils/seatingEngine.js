const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

/* ================================
   CSV PARSER
================================ */
const parseCSV = (filePath) =>
  new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", d => results.push(d))
      .on("end", () => resolve(results))
      .on("error", reject);
  });

/* ================================
   BENCH CAPACITY EVALUATION
================================ */
function evaluateBenchCapacity(hallsData, totalStudents) {
  let totalBenches = 0;

  for (const hall of hallsData) {
    totalBenches +=
      Number(hall.Rows) * Math.floor(Number(hall.Columns) / 3);
  }

  if (2 * totalBenches >= totalStudents)
    return { studentsPerBench: 2, totalBenches };

  if (3 * totalBenches >= totalStudents)
    return { studentsPerBench: 3, totalBenches };

  throw new Error("❌ Insufficient bench capacity");
}

/* ================================
   PATTERN (ONLY FOR 3 PER BENCH)
================================ */
function getPatternForHall(hallIndex) {
  return hallIndex % 2 === 0
    ? ["A", "B", "A", "A", "B", "A"]
    : ["B", "A", "B", "B", "A", "B"];
}

/* ================================
   SHUFFLE
================================ */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* ================================
   ALLOCATION
================================ */
function allocateStudents(
  allStudents,
  yearA,
  yearB,
  hallsData,
  studentsPerBench
) {
  const A = [...allStudents[yearA]];
  const B = [...allStudents[yearB]];

  let iA = 0, iB = 0;
  const allocation = {};

  hallsData.forEach((hall, hallIndex) => {
    const rows = Number(hall.Rows);
    const benchesPerRow = Math.floor(Number(hall.Columns) / 3);
    const hallName = hall.HallName;

    const hallMatrix = [];
    const pattern =
      studentsPerBench === 3 ? getPatternForHall(hallIndex) : null;
    let p = 0;

    for (let r = 0; r < rows; r++) {
      const row = [];

      for (let b = 0; b < benchesPerRow; b++) {
        const bench = [];

        if (studentsPerBench === 2) {
          if (iA < A.length) bench.push({ ...A[iA++], year: yearA });
          if (iB < B.length) bench.push({ ...B[iB++], year: yearB });
        } else {
          for (let s = 0; s < 3; s++) {
            const pick = pattern[p % pattern.length];
            let student = null;

            if (pick === "A" && iA < A.length)
              student = { ...A[iA++], year: yearA };
            else if (pick === "B" && iB < B.length)
              student = { ...B[iB++], year: yearB };
            else if (iA < A.length)
              student = { ...A[iA++], year: yearA };
            else if (iB < B.length)
              student = { ...B[iB++], year: yearB };

            if (student) bench.push(student);
            p++;
          }
        }

        row.push(bench);
      }

      hallMatrix.push(row);
    }

    allocation[hallName] = hallMatrix;
  });

  return allocation;
}

/* ================================
   RANDOMIZATION (YEAR-WISE, PER HALL)
================================ */
function randomizeHallYearWise(allocation, yearA, yearB) {
  for (const hallName in allocation) {
    const rows = allocation[hallName];

    const posA = [], stuA = [];
    const posB = [], stuB = [];

    rows.forEach((row, r) => {
      row.forEach((bench, b) => {
        bench.forEach((student, s) => {
          if (student.year === yearA) {
            posA.push([r, b, s]);
            stuA.push(student);
          } else if (student.year === yearB) {
            posB.push([r, b, s]);
            stuB.push(student);
          }
        });
      });
    });

    shuffleArray(stuA);
    shuffleArray(stuB);

    posA.forEach((p, i) => {
      const [r, b, s] = p;
      rows[r][b][s] = stuA[i];
    });

    posB.forEach((p, i) => {
      const [r, b, s] = p;
      rows[r][b][s] = stuB[i];
    });
  }
}

/* ================================
   OPTIMIZATION STAGE
================================ */
function analyzeHall(hallMatrix) {
  let students = 0;
  let benchesUsed = 0;

  hallMatrix.forEach(row => {
    row.forEach(bench => {
      if (bench.length > 0) benchesUsed++;
      students += bench.length;
    });
  });

  return { students, benchesUsed };
}

function repackHallToTwoPerBench(hallMatrix) {
  const students = [];
  hallMatrix.forEach(r => r.forEach(b => b.forEach(s => students.push(s))));

  let idx = 0;
  hallMatrix.forEach(row => {
    row.forEach(bench => {
      bench.length = 0;
      if (idx < students.length) bench.push(students[idx++]);
      if (idx < students.length) bench.push(students[idx++]);
    });
  });
}

function optimizeHallUtilization(allocation, hallsData, studentsPerBench) {
  const hallNames = Object.keys(allocation);

  // Case 1: Partially filled halls (3 → 2 per bench)
  hallNames.forEach(hallName => {
    const hallMatrix = allocation[hallName];
    const hallInfo = hallsData.find(h => h.HallName === hallName);

    const totalBenches =
      Number(hallInfo.Rows) *
      Math.floor(Number(hallInfo.Columns) / 3);

    const { students, benchesUsed } = analyzeHall(hallMatrix);

    if (
      studentsPerBench === 3 &&
      benchesUsed < totalBenches &&
      students <= totalBenches * 2
    ) {
      repackHallToTwoPerBench(hallMatrix);
    }
  });

  // Case 2: Poorly utilized halls (rebalance)
  for (let i = 0; i < hallNames.length; i++) {
    for (let j = i + 1; j < hallNames.length; j++) {
      const h1 = hallsData.find(h => h.HallName === hallNames[i]);
      const h2 = hallsData.find(h => h.HallName === hallNames[j]);

      const cap1 =
        Number(h1.Rows) * Math.floor(Number(h1.Columns) / 3);
      const cap2 =
        Number(h2.Rows) * Math.floor(Number(h2.Columns) / 3);

      const a = analyzeHall(allocation[hallNames[i]]);
      const b = analyzeHall(allocation[hallNames[j]]);

      const totalStudents = a.students + b.students;

      if (totalStudents <= 2 * (cap1 + cap2)) {
        const combined = [];

        allocation[hallNames[i]].forEach(r =>
          r.forEach(b => b.forEach(s => combined.push(s)))
        );
        allocation[hallNames[j]].forEach(r =>
          r.forEach(b => b.forEach(s => combined.push(s)))
        );

        let idx = 0;
        [hallNames[i], hallNames[j]].forEach(hall => {
          allocation[hall].forEach(row => {
            row.forEach(bench => {
              bench.length = 0;
              if (idx < combined.length) bench.push(combined[idx++]);
              if (idx < combined.length) bench.push(combined[idx++]);
            });
          });
        });
      }
    }
  }
}

/* ================================
   DUPLICATE STUDENT CHECK ONLY
================================ */
function checkDuplicateStudents(allocation) {
  const seen = new Map();
  const duplicates = [];

  for (const [hall, rows] of Object.entries(allocation)) {
    rows.forEach((row, r) => {
      row.forEach((bench, b) => {
        bench.forEach(student => {
          const roll =
            student.RollNumber || student.Roll || student["Roll Number"];

          if (!roll) return;

          if (seen.has(roll)) {
            duplicates.push({
              roll,
              first: seen.get(roll),
              duplicateAt: { hall, row: r + 1, bench: b + 1 }
            });
          } else {
            seen.set(roll, { hall, row: r + 1, bench: b + 1 });
          }
        });
      });
    });
  }

  return duplicates;
}
//pdf generation
async function generateHallSeatingPDF(allocation, outputDir = "output") {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  for (const [hallName, rows] of Object.entries(allocation)) {

    /* ================= COLLECT STUDENTS ================= */
    const students = [];

    rows.forEach((row, rIdx) => {
      row.forEach((bench, bIdx) => {
        bench.forEach((student, sIdx) => {
          if (!student) return;
          students.push({
            name: student.Name || student["Student Name"] || "N/A",
            roll:
              student.RollNumber ||
              student.Roll ||
              student["Roll Number"] ||
              "N/A",
            year: student.year,
            row: rIdx + 1,
            col: bIdx * 3 + sIdx + 1,
          });
        });
      });
    });

    /* ================= GROUP BY YEAR ================= */
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

    /* ================= HTML ================= */
    let html = `
      <style>
        body { font-family: Arial; font-size: 11px; }
        h1, h2 { text-align: center; margin: 4px 0; }
        h3 { margin-top: 12px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size:10px; }
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
            <th>Student Name</th>
            <th>Roll Number</th>
            <th>Row</th>
            <th>Column</th>
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

      html += `</table>`;
    });

    /* ================= PAGE 2: GRID ================= */
    html += `
      <div class="page-break"></div>
      <h1>Seating Allocation Grid</h1>
      <h2>Hall: ${hallName}</h2>
      <table class="grid">
    `;

    rows.forEach(row => {
      html += "<tr>";
      row.forEach(bench => {
        for (let i = 0; i < 3; i++) {
          const s = bench[i];
          html += `<td>${
            s
              ? s.RollNumber || s.Roll || s["Roll Number"]
              : "—"
          }</td>`;
        }
      });
      html += "</tr>";
    });

    html += "</table>";

    html += `
      <div class="page-break"></div>
      <h1>Seating Allocation Grid</h1>
      <h2>Hall: ${hallName} Attendence Sheet</h2>
      <table class="grid">
    `;

    Object.keys(grouped).sort().forEach(year => {
      html += `
        <h3>Year: ${year}</h3>
        <table>
          <tr>
            <th>Sl No</th>
            <th>Student Name</th>
            <th>Roll Number</th>
            <th>Signature</th>
            
          </tr>
      `;

      grouped[year].forEach((s, i) => {
        html += `
          <tr>
            <td>${i + 1}</td>
            <td>${s.name}</td>
            <td>${s.roll}</td>
            <td> </td>
            
          </tr>
        `;
      });

      html += `</table>`;
    });

     
    

    /* ================= PDF ================= */
    await page.setContent(html, { waitUntil: "load" });

    const filePath = path.join(outputDir, `${hallName}_Seating.pdf`);
    await page.pdf({
      path: filePath,
      format: "A4",
      margin: { top: 20, bottom: 20, left: 20, right: 20 },
    });

    console.log(`📄 PDF generated: ${filePath}`);
  }

  await browser.close();
}


async function generateHallYearBatchRangePDF(allocation, outputDir = "output") {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  let html = `
    <style>
      body { font-family: Arial; font-size: 10px; }
      h1 { text-align: center; margin-bottom: 20px; }
      h3 { margin-top: 18px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px;font-size:10px; }
      th, td { border: 1px solid #000; padding: 4px; }
      th { background: #f0f0f0; }
    </style>

    <h1>Hall Allocation Summary (Year & Batch-wise)</h1>
  `;

  for (const [hallName, rows] of Object.entries(allocation)) {
    const map = {};

    rows.forEach(row =>
      row.forEach(bench =>
        bench.forEach(student => {
          if (!student) return;

          const roll =
            student.RollNumber ||
            student.Roll ||
            student["Roll Number"];

          const year = student.year || "UNKNOWN";
          const batch = student.Batch || student["Batch"] || "UNKNOWN";

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
          <th>From Roll</th>
          <th>To Roll</th>
          <th>Count</th>
        </tr>
    `;

    Object.keys(map).sort().forEach(year =>
      Object.keys(map[year]).sort().forEach(batch => {
        const rolls = map[year][batch].sort();
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

  await page.setContent(html, { waitUntil: "load" });

  const filePath = path.join(
    outputDir,
    "Hall_Year_Batch_Range_Summary.pdf"
  );

  await page.pdf({
    path: filePath,
    format: "A4",
    margin: { top: 20, bottom: 20, left: 20, right: 20 },
  });

  await browser.close();
  console.log(`📄 Hall summary PDF generated: ${filePath}`);
}

/* ================================
   MAIN
================================ */
async function generateSeating({ hallsCSV, studentCSVs }) {
  const hallsData = await parseCSV(hallsCSV);

  const allStudents = {};
  const years = [];

  for (const file of studentCSVs) {
    const yearName = path.parse(file).name;
    years.push(yearName);
    allStudents[yearName] = await parseCSV(file);
  }

  const [yearA, yearB] = years;

  const totalStudents =
    allStudents[yearA].length + allStudents[yearB].length;

  const evalResult = evaluateBenchCapacity(hallsData, totalStudents);

  let allocation = allocateStudents(
    allStudents,
    yearA,
    yearB,
    hallsData,
    evalResult.studentsPerBench
  );

  randomizeHallYearWise(allocation, yearA, yearB);
  optimizeHallUtilization(allocation, hallsData, evalResult.studentsPerBench);
const duplicates = checkDuplicateStudents(allocation);

  console.log("\n📋 DUPLICATE CHECK");
  if (duplicates.length === 0) {
    console.log("✅ No duplicate students found");
  } else {
    console.log("❌ Duplicate students detected:");
    console.table(duplicates);
  }

  generateHallSeatingPDF(allocation);
  generateHallYearBatchRangePDF(allocation);

  // FINAL PRINT
  for (const [hall, rows] of Object.entries(allocation)) {
    console.log(`\n🏛 ${hall}`);
    rows.forEach((row, r) => {
      console.log(
        `Row ${r + 1}:`,
        row
          .map(
            bench =>
              `[${bench
                .map(s => s.RollNumber || s.Roll || s["Roll Number"])
                .join(",")}]`
          )
          .join(" ")
      );
    });
  }
}

/* ================================
   CLI
================================ */
module.exports = {
  generateSeating
};

