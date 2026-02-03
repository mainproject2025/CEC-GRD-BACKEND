const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

const { admin, db } = require("../config/firebase");

const StudYear={}
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
   GROUP BY YEAR + SUBJECT
================================ */
function groupByYearAndSubject(students) {
  const result = {
    A: {},
    B: {},
  };

  students.forEach((s) => {
    const year = s.year;
    const subject = s.subject;

    if (!result[year][subject]) {
      result[year][subject] = [];
    }

    result[year][subject].push(s);
  });

  return result;
}

/* ================================
   BUILD SUBJECT ORDERED LIST
================================ */
function buildOrderedList(grouped) {
  const subjects = new Set([
    ...Object.keys(grouped.A),
    ...Object.keys(grouped.B),
  ]);

  const ordered = [];

  subjects.forEach((sub) => {
    if (grouped.A[sub]) ordered.push(...grouped.A[sub]);
    if (grouped.B[sub]) ordered.push(...grouped.B[sub]);
  });

  return ordered;
}

/* ================================
   COLUMN-WISE AB ALLOCATION
================================ */
function allocateColumnWiseAB(students, hallsData) {

  const A = students.filter((s) => s.year === "A");
  const B = students.filter((s) => s.year === "B");

  let a = 0;
  let b = 0;

  const allocation = {};

  // Pattern per row (for 3 benches)
  const rowPattern = [
    ["A", "B", "A"], // Bench 1
    ["B", "A", "B"], // Bench 2
    ["A", "B", "A"], // Bench 3
  ];

  let oneYearFinished = false;

  hallsData.forEach((hall) => {

    const rows = Number(hall.Rows);
    const benches = Math.floor(Number(hall.Columns) / 3);

    const matrix = Array.from({ length: rows }, () =>
      Array.from({ length: benches }, () => [])
    );

    // Column-wise filling
    for (let col = 0; col < benches; col++) {

      for (let row = 0; row < rows; row++) {

        const bench = [];

        const hasA = a < A.length;
        const hasB = b < B.length;

        /* ===============================
           CASE 1: BOTH YEARS AVAILABLE
           → USE ROW PATTERN (3 SEATS)
        =============================== */

        if (hasA && hasB && !oneYearFinished) {

          const pattern =
            rowPattern[col % rowPattern.length];

          for (const p of pattern) {

            if (p === "A" && a < A.length) {
              bench.push(A[a++]);
            }

            else if (p === "B" && b < B.length) {
              bench.push(B[b++]);
            }

            // Safety fallback
            else if (a < A.length) {
              bench.push(A[a++]);
            }

            else if (b < B.length) {
              bench.push(B[b++]);
            }
          }

          // If one year ended during fill
          if (a >= A.length || b >= B.length) {
            oneYearFinished = true;
          }
        }

        /* ===============================
           CASE 2: ONE YEAR FINISHED
           → USE 2 PER BENCH
        =============================== */

        else {

          oneYearFinished = true;

          // Fill only with remaining students

          if (a < A.length) bench.push(A[a++]);
          if (a < A.length) bench.push(A[a++]);

          if (b < B.length) bench.push(B[b++]);
          if (b < B.length) bench.push(B[b++]);
        }

        // Place bench if it has students
        if (bench.length >= 2) {
          matrix[row][col] = bench;
        }
      }
    }

    allocation[hall.HallName] = matrix;
  });

  /* ===============================
     PRINT REMAINING STUDENTS
  =============================== */

  const remaining = [];

  while (a < A.length) remaining.push(A[a++]);
  while (b < B.length) remaining.push(B[b++]);

  if (remaining.length) {

    console.log("\n⚠️ REMAINING STUDENTS\n");

    remaining.forEach((s, i) => {
      console.log(
        `${i + 1}. Roll: ${s.Roll || s.RollNumber || "?"} | ` +
        `Year: ${s.year} | Subject: ${s.subject}`
      );
    });

    console.log("\n--------------------------\n");

  } else {

    console.log("\n✅ All students placed.\n");
  }

  return allocation;
}





/* ================================
   PRINT ALLOCATION
================================ */
function printAllocation(allocation) {
  console.log("\n========== SEATING ARRANGEMENT ==========\n");

  for (const [hall, rows] of Object.entries(allocation)) {
    console.log(`🏫 Hall: ${hall}\n`);

    rows.forEach((row, r) => {
      let line = `Row ${r + 1}: `;

      row.forEach((bench) => {
        if (!bench.length) {
          line += "[ --- ] ";
          return;
        }

        const seats = bench.map(
          (s) =>
            `${s.Roll || s.RollNumber || "?"}-${s.year}`
        );

        line += `[ ${seats.join(" | ")} ] `;
      });

      console.log(line);
    });

    console.log("\n---------------------------------\n");
  }
}

/* ================================
   FIRESTORE SERIALIZER
================================ */
function serializeAllocationForFirestore(allocation) {
  const result = {};

  for (const [hall, rows] of Object.entries(allocation)) {
    const hallData = {
      rows: rows.length,
      columns: rows[0]?.length || 0,
    };

    rows.forEach((row, r) => {
      const rowStudents = [];

      row.forEach((bench, b) => {
        bench.forEach((s, i) => {
          if (!s) return;

          rowStudents.push({
            roll:
              s.RollNumber ||
              s.Roll ||
              s["Roll Number"] ||
              null,

            name:
              s.StudentName ||
              s.Name ||
              null,

            subject: s.subject || null,

            year: s.YEAR || null,

            batch: s.Batch || null,

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
   ROUTE
================================ */
router.post(
  "/",
  upload.fields([
    { name: "halls", maxCount: 1 },
    { name: "students", maxCount: 2 },
  ]),

  async (req, res) => {
    try {
      /* -----------------------------
         READ CSV FILES
      ------------------------------ */

      const hallsCSV = req.files.halls[0].path;

      const studentCSVs =
        req.files.students.map((f) => f.path);

      const hallsData = await parseCSV(hallsCSV);

      const yearMap = {};

      /* -----------------------------
         READ YEAR FILES
      ------------------------------ */

      for (let i = 0; i < studentCSVs.length; i++) {
        const file = studentCSVs[i];

        const year = i === 0 ? "A" : "B";

        const students = await parseCSV(file);



        yearMap[year] = students.map((s) => ({
          ...s,
          year,
          YEAR:s.year,
          subject: s.Subject || s.subject,
        }));
      }

      /* -----------------------------
         MERGE STUDENTS
      ------------------------------ */

      const merged = [
        ...(yearMap.A || []),
        ...(yearMap.B || []),
      ];

      /* -----------------------------
         GROUP BY YEAR + SUBJECT
      ------------------------------ */

      const grouped =
        groupByYearAndSubject(merged);

      console.log("\n===== GROUPED OBJECT =====\n");
      console.dir(grouped, { depth: null });

      /* -----------------------------
         BUILD ORDERED LIST
      ------------------------------ */

      const ordered =
        buildOrderedList(grouped);

      console.log("\n===== ORDERED LIST =====\n");

      ordered.forEach((s, i) => {
        console.log(
          `${i + 1}. ${s.Roll || s.RollNumber} | ${s.subject} | ${s.year}`
        );
      });

      /* -----------------------------
         ALLOCATE SEATS
      ------------------------------ */

      const allocation =
        allocateColumnWiseAB(
          ordered,
          hallsData
        );

      // // Print final seating
      // printAllocation(allocation);

      /* -----------------------------
         SAVE TO FIRESTORE
      ------------------------------ */

      const name = req.body.examName;
      const sems = req.body.years;
      const types = req.body.type;
      const examDate = req.body.examDate;

      // await db
      //   .collection("examAllocations")
      //   .add({
      //     meta: {
      //       totalStudents: merged.length,
      //       method: "AB Column-wise Subject Grouped",
      //     },

      //     halls:
      //       serializeAllocationForFirestore(
      //         allocation
      //       ),

      //     createdAt:
      //       admin.firestore.FieldValue.serverTimestamp(),

      //     name,
      //     sems,

      //     isElective: types !== "Normal",

      //     examDate,
      //   });

      res.json({
        success: true,
        message: "Allocation completed",
      });

    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

module.exports = router;
