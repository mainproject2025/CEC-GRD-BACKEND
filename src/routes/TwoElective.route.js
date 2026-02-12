const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

const { admin, db } = require("../config/firebase");

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

  let aIndex = 0;
  let bIndex = 0;

  const allocation = {};
  const report = [];

  hallsData.forEach((hall, hallIndex) => {

    const rows = Number(hall.Rows);
    const columns = Number(hall.Columns);
    let hallPlacedCount = 0;

    // Determine Hall Type (Bench vs Chair) from possible CSV headers
    // Default to Bench if not explicitly "Chair"
    const rawType = hall.Type || hall.type || hall.Furniture || hall.furniture || hall.SeatingType || "Bench";
    const type = rawType.toLowerCase().includes("chair") ? "Chair" : "Bench";

    const matrix = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => [])
    );

    // Column-wise filling
    for (let col = 0; col < columns; col++) {
      for (let row = 0; row < rows; row++) {

        let targetYear = null;

        if (type === "Bench") {
          // BENCH PATTERN
          const patternIndex = col % 3; // 0, 1, 2

          const aExhausted = aIndex >= A.length;
          const bExhausted = bIndex >= B.length;

          // Override if one year exhausted
          if (aExhausted && !bExhausted) {
            // Only B remains -> B _ B (2 per bench)
            // Slots 0 and 2 get B.
            if (patternIndex === 0 || patternIndex === 2) targetYear = "B";
            else targetYear = null;
          } else if (!aExhausted && bExhausted) {
            // Only A remains -> A _ A (2 per bench)
            // Slots 0 and 2 get A.
            if (patternIndex === 0 || patternIndex === 2) targetYear = "A";
            else targetYear = null;
          } else {
            // Standard Alternating
            if (hallIndex % 2 === 0) {
              // First Room -> A B A
              if (patternIndex === 0) targetYear = "A";
              else if (patternIndex === 1) targetYear = "B";
              else targetYear = "A";
            } else {
              // Next Room -> B A B
              if (patternIndex === 0) targetYear = "B";
              else if (patternIndex === 1) targetYear = "A";
              else targetYear = "B";
            }
          }

        } else {
          // CHAIR PATTERN
          const patternIndex = col % 2; // 0, 1

          const aExhausted = aIndex >= A.length;
          const bExhausted = bIndex >= B.length;

          // Override if one year exhausted
          if (aExhausted && !bExhausted) {
            // Only B remains -> Request: B _ B B _ B
            // This acts like a 3-column pattern: fill 0 and 2, skip 1.
            const exPattern = col % 3;
            if (exPattern === 0 || exPattern === 2) targetYear = "B";
            else targetYear = null; // Skip middle
          } else if (!aExhausted && bExhausted) {
            // Only A remains -> Request: A _ A A _ A
            const exPattern = col % 3;
            if (exPattern === 0 || exPattern === 2) targetYear = "A";
            else targetYear = null;
          } else {
            // Standard Alternating
            if (hallIndex % 2 === 0) {
              // First Room -> A B
              targetYear = patternIndex === 0 ? "A" : "B";
            } else {
              // Next Room -> B A
              targetYear = patternIndex === 0 ? "B" : "A";
            }
          }
        }

        // Try to place student of targetYear
        let student = null;

        if (targetYear === "A") {
          if (aIndex < A.length) {
            student = A[aIndex++];
          }
          // Strict pattern: no fallback to B here
        } else if (targetYear === "B") {
          if (bIndex < B.length) {
            student = B[bIndex++];
          }
        }

        // Strict Fallback Logic (Adjacency Check)
        if (!student && targetYear) {
          // No student found for target year (exhausted?), but wait, handled by override above?
          // Not completely. If override says null, we skip.
          // If override says A but A is empty (shouldn't happen with override logic), then empty.
          // But if specific slot didn't trigger override yet?
          // Override logic relies on aExhausted check at column start. 
          // Logic seems consistent.
          // But let's keep the fallback check just in case, or rather just rely on pattern.
          // The previous TwoCommon code didn't have extensive "if !student" logic because logic was tight.
          // Wait, I see I removed the explicit fallback block in TwoCommon because 
          // the exhaustion override handles the "filling" strategy. 
        }

        if (student) {
          matrix[row][col] = [student];
          hallPlacedCount++;
        }
      }
    }

    allocation[hall.HallName] = matrix;

    report.push({
      hall: hall.HallName,
      placed: hallPlacedCount,
      capacity: rows * columns,
      type: type
    });
  });

  const unplacedA = A.length - aIndex;
  const unplacedB = B.length - bIndex;

  return {
    allocation,
    report,
    unplaced: {
      A: unplacedA,
      B: unplacedB,
      total: unplacedA + unplacedB
    }
  };
}





/* ================================
   PRINT ALLOCATION
================================ */
function printAllocation(allocation, report, unplaced) {
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

  console.log("\n========== ALLOCATION REPORT ==========\n");
  if (report) {
    report.forEach(r => {
      console.log(`Hall: ${r.hall} | Placed: ${r.placed} | Capacity: ${r.capacity} | Type: ${r.type}`);
    });
  }

  if (unplaced && unplaced.total > 0) {
    console.log("\n⚠️ UNPLACED STUDENTS:");
    console.log(`Year A: ${unplaced.A}`);
    console.log(`Year B: ${unplaced.B}`);
    console.log(`Total Unplaced: ${unplaced.total}`);
  } else {
    console.log("\n✅ All students placed successfully.");
  }
}

/* ================================
   FIRESTORE SERIALIZER
================================ */
function serializeAllocationForFirestore(allocation, report) {
  const result = {};

  for (const [hall, rows] of Object.entries(allocation)) {
    // Find metadata from report
    const hallMeta = report.find(r => r.hall === hall);
    const type = hallMeta ? hallMeta.type : "Bench"; // Default to Bench

    const hallData = {
      rows: rows.length,
      columns: rows[0]?.length || 0,
      type: type
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
              s.Student ||
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

        yearMap[year] = students
          .filter(s => {
            // Fuzzy find Roll key
            const rollKey = Object.keys(s).find(k => k.toLowerCase().includes("roll")) || "Roll";
            const roll = s[rollKey] || s["Roll Number"] || s.Roll; // try multiple variants
            const sub = s.Subject || s.subject;

            // Ensure roll is present and not just whitespace
            const hasRoll = roll && String(roll).trim().length > 0;
            return hasRoll;
          })
          .map((s) => {
            const rollKey = Object.keys(s).find(k => k.toLowerCase().includes("roll")) || "Roll";
            return {
              ...s,
              year,
              YEAR: s.year,
              // Normalize Roll property for easier access later
              Roll: s[rollKey] || s["Roll Number"] || s.Roll || "UNKNOWN",
              subject: s.Subject || s.subject,
            };
          });
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

      const { allocation, report, unplaced } = allocateColumnWiseAB(ordered, hallsData);

      // Print final seating
      printAllocation(allocation, report, unplaced);

      if (unplaced.total > 0) {
        return res.status(400).json({
          success: false,
          error: `Allocation failed. ${unplaced.total} students could not be placed.`,
          details: {
            unplacedA: unplaced.A,
            unplacedB: unplaced.B,
            report: report
          }
        });
      }

      /* -----------------------------
         SAVE TO FIRESTORE
      ------------------------------ */

      const name = req.body.examName;
      const sems = req.body.years;
      const types = req.body.type;
      const examDate = req.body.examDate;

      await db
        .collection("examAllocations")
        .add({
          meta: {
            totalStudents: merged.length,
            method: "AB Column-wise Subject Grouped",
          },

          halls:
            serializeAllocationForFirestore(
              allocation,
              report
            ),

          createdAt:
            admin.firestore.FieldValue.serverTimestamp(),

          name,
          sems,

          isElective: types !== "Normal",

          examDate,
        });

      res.json({
        success: true,
        message: "Allocation completed",
        report: report,
        unplaced: unplaced
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
