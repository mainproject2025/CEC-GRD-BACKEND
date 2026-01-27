const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");

/* ================================
   FIREBASE INIT
================================ */
const { admin, db } = require("../config/firebase");

/* ================================
   EXPRESS INIT
================================ */
const router = express.Router();
const upload = multer({ dest: "uploads/" });
// router.use(express.json());
let StudYears={}
/* ================================
   CSV PARSER
================================ */
const parseCSV = (filePath) =>
  new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (d) => results.push(d))
      .on("end", () => resolve(results))
      .on("error", reject);
  });

/* ================================
   BENCH CAPACITY EVALUATION
================================ */
function evaluateBenchCapacity(hallsData, totalStudents) {
  let totalBenches = 0;

  for (const hall of hallsData) {
    totalBenches += Number(hall.Rows) * Math.floor(Number(hall.Columns) / 3);
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
// function getPatternForHall(hallIndex) {
//   return hallIndex % 2 === 0
//     ? ["A", "B", "A", "A", "B", "A"]
//     : ["B", "A", "B", "B", "A", "B"];
// }

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

  let iA = 0;
  let iB = 0;

  const allocation = {};

  hallsData.forEach((hall, hallIndex) => {

    const rows = Number(hall.Rows);

    // Number of benches in one row
    const benchesPerRow = Math.floor(Number(hall.Columns) / 3);

    const hallName = hall.HallName;

    const hallMatrix = [];

    for (let r = 0; r < rows; r++) {

      // Flip every row
      // Row 0 → ABAB
      // Row 1 → BABA
      const rowOffset = r % 2 === 0 ? 0 : 1;

      const row = [];

      for (let b = 0; b < benchesPerRow; b++) {

        const bench = [];

        if (studentsPerBench === 2) {

          // 2 seats: A B or B A
          const order = rowOffset === 0 ? ["A", "B"] : ["B", "A"];

          order.forEach(o => {

            let student = null;

            if (o === "A" && iA < A.length)
              student = { ...A[iA++], year: yearA };

            if (o === "B" && iB < B.length)
              student = { ...B[iB++], year: yearB };

            if (!student && iA < A.length)
              student = { ...A[iA++], year: yearA };

            if (!student && iB < B.length)
              student = { ...B[iB++], year: yearB };

            if (student) bench.push(student);
          });

        } else {

          // 3 seats: AB A / BA B
          for (let s = 0; s < 3; s++) {

            const seatIndex = b * 3 + s;

            // Decide A or B
            const pick =
              (seatIndex + rowOffset + hallIndex) % 2 === 0
                ? "A"
                : "B";

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
   RANDOMIZATION
================================ */
function randomizeHallYearWise(allocation, yearA, yearB) {
  for (const hallName in allocation) {
    const rows = allocation[hallName];
    const posA = [],
      stuA = [];
    const posB = [],
      stuB = [];

    rows.forEach((row, r) =>
      row.forEach((bench, b) =>
        bench.forEach((student, s) => {
          if (student.year === yearA) {
            posA.push([r, b, s]);
            stuA.push(student);
          } else if (student.year === yearB) {
            posB.push([r, b, s]);
            stuB.push(student);
          }
        }),
      ),
    );

    shuffleArray(stuA);
    shuffleArray(stuB);

    posA.forEach(([r, b, s], i) => (rows[r][b][s] = stuA[i]));
    posB.forEach(([r, b, s], i) => (rows[r][b][s] = stuB[i]));
  }
}

/* ================================
   OPTIMIZATION STAGE
================================ */
function analyzeHall(hallMatrix) {
  let students = 0;
  let benchesUsed = 0;

  hallMatrix.forEach((row) =>
    row.forEach((bench) => {
      if (bench.length > 0) benchesUsed++;
      students += bench.length;
    }),
  );

  return { students, benchesUsed };
}

function repackHallToTwoPerBench(hallMatrix) {
  const students = [];
  hallMatrix.forEach((r) =>
    r.forEach((b) => b.forEach((s) => students.push(s))),
  );
  let idx = 0;

  hallMatrix.forEach((row) =>
    row.forEach((bench) => {
      bench.length = 0;
      if (idx < students.length) bench.push(students[idx++]);
      if (idx < students.length) bench.push(students[idx++]);
    }),
  );
}

function printHall(hallName, rows) {
  console.log("\nHall:", hallName);

  rows.forEach((row, r) => {
    const line = [];

    row.forEach((bench) => {
      bench.forEach((s) => {
        if (!s) return;

        line.push(`${s.year}-${s.RollNumber || s.Roll}`);
      });
    });

    console.log(`Row ${r + 1}:`, line.join(" | "));
  });

  console.log("----------------------------");
}

function optimizeHallUtilization(allocation, hallsData, studentsPerBench) {
  const hallNames = Object.keys(allocation);

  // Case 1: partial halls
  hallNames.forEach((hallName) => {
    const hallMatrix = allocation[hallName];
    const hallInfo = hallsData.find((h) => h.HallName === hallName);

    const totalBenches =
      Number(hallInfo.Rows) * Math.floor(Number(hallInfo.Columns) / 3);

    const { students, benchesUsed } = analyzeHall(hallMatrix);

    if (
      studentsPerBench === 3 &&
      benchesUsed < totalBenches &&
      students <= totalBenches * 2
    ) {
      repackHallToTwoPerBench(hallMatrix);
    }
  });

  // Case 2: rebalance halls
  for (let i = 0; i < hallNames.length; i++) {
    for (let j = i + 1; j < hallNames.length; j++) {
      const h1 = hallsData.find((h) => h.HallName === hallNames[i]);
      const h2 = hallsData.find((h) => h.HallName === hallNames[j]);

      const cap1 = Number(h1.Rows) * Math.floor(Number(h1.Columns) / 3);
      const cap2 = Number(h2.Rows) * Math.floor(Number(h2.Columns) / 3);

      const a = analyzeHall(allocation[hallNames[i]]);
      const b = analyzeHall(allocation[hallNames[j]]);

      if (a.students + b.students <= 2 * (cap1 + cap2)) {
        const combined = [];

        [hallNames[i], hallNames[j]].forEach((h) =>
          allocation[h].forEach((r) =>
            r.forEach((b) => b.forEach((s) => combined.push(s))),
          ),
        );

        let idx = 0;
        [hallNames[i], hallNames[j]].forEach((h) =>
          allocation[h].forEach((row) =>
            row.forEach((bench) => {
              bench.length = 0;
              if (idx < combined.length) bench.push(combined[idx++]);
              if (idx < combined.length) bench.push(combined[idx++]);
            }),
          ),
        );
      }
    }
  }
}

/* ================================
   DUPLICATE CHECK
================================ */
function checkDuplicateStudents(allocation) {
  const seen = new Map();
  const duplicates = [];

  for (const [hall, rows] of Object.entries(allocation)) {
    rows.forEach((row, r) =>
      row.forEach((bench, b) =>
        bench.forEach((student) => {
          const roll =
            student.RollNumber || student.Roll || student["Roll Number"];
          if (!roll) return;

          if (seen.has(roll)) {
            duplicates.push({
              roll,
              first: seen.get(roll),
              duplicateAt: { hall, row: r + 1, bench: b + 1 },
            });
          } else {
            seen.set(roll, { hall, row: r + 1, bench: b + 1 });
          }
        }),
      ),
    );
  }
  return duplicates;
}
///////////////////////////
function serializeAllocationForFirestore(allocation) {
  const result = {};

  for (const [hall, rows] of Object.entries(allocation)) {
    const totalRows = rows.length;
    const totalColumns = rows[0]?.length || 0;

    const hallData = {
      rows: totalRows,
      columns: totalColumns,
    };

    rows.forEach((row, r) => {
      const rowStudents = [];

      row.forEach((bench, b) => {
        bench.forEach((s, i) => {
          if (!s) return;
          
          rowStudents.push({
            roll: s.RollNumber || s.Roll || s["Roll Number"] || null,

            name: s.StudentName || s["StudentName"] || null,
            year: StudYears[s.year] || null,
            batch: s.Batch || s["Batch"] || null,
            isPublished: false,
            bench: b + 1,
            seat: i + 1,
          });
        });
      });

      hallData[`row${r}`] = rowStudents;
    });

    result[hall] = hallData;
  }

  return result;
}

/* ================================
   FIRESTORE STORAGE
================================ */
async function storeAllocationInFirestore(
  allocation,
  meta,
  name,
  sems,
  type,
  examDate,
) {
  const ref = db.collection("examAllocations").doc();

  const safeAllocation = serializeAllocationForFirestore(allocation);

  await ref.set({
    meta,
    halls: safeAllocation,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    name,
    sems,
    isElective: type === "Normal" ? false : true,
    examDate: examDate,
  });

  return ref.id;
}

/* ================================
   API ROUTE
================================ */
router.post(
  "/",
  upload.fields([
    { name: "halls", maxCount: 1 },
    { name: "students", maxCount: 2 },
  ]),
  async (req, res) => {
    try {
      const hallsCSV = req.files.halls[0].path;

      const studentCSVs = req.files.students.map((f) => f.path);

      const hallsData = await parseCSV(hallsCSV);

      const allStudents = {};
      const years = [];

      for (const file of studentCSVs) {
        const year = path.parse(file).name;
        years.push(year);
        allStudents[year] = await parseCSV(file);
        StudYears[year]=allStudents[year][0].year
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
        evalResult.studentsPerBench,
      );

      optimizeHallUtilization(
        allocation,
        hallsData,
        evalResult.studentsPerBench,
      );
       

      const duplicates = checkDuplicateStudents(allocation);
      let ExamName = req.body.examName;
      let year = req.body.years;
      let examDate = req.body.examDate;
      console.log(req.body);
      
      const examId = await storeAllocationInFirestore(
        allocation,
        {
          yearA,
          yearB,
          studentsPerBench: evalResult.studentsPerBench,
          totalStudents,
          duplicates,
          
        },
        req.body.examName,
        req.body.years,
        req.body.type,
        req.body.examDate
      )
        .then(() => {
          console.log("fdsfdasf");
        })
        .catch((e) => {
          console.log(e);
        });

      res.json({ success: true, examId, duplicates });
    } catch (err) {
      console.log("error");

      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
