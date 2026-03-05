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
   BUILD SUBJECT GROUPS FROM REMAINING STUDENTS
   (used after one year is exhausted)
================================ */
function buildSubjectGroups(students) {
  const map = {};
  students.forEach((s) => {
    const subj = s.subject || "Unknown";
    if (!map[subj]) map[subj] = [];
    map[subj].push(s);
  });
  return map;
}

/* ================================
   FIX SAME-SUBJECT ADJACENCY (horizontal)
   After filling a hall, scan every row for adjacent seats sharing
   the same subject, then swap one of them with another cell that
   has a different subject. Repeats up to 100 passes until clean.
================================ */
function fixSameSubjectAdjacency(matrix) {
  const R = matrix.length;
  const C = matrix[0].length;
  const getSubj = (cell) => (cell && cell.length ? (cell[0].subject || null) : null);

  for (let pass = 0; pass < 100; pass++) {
    let clean = true;

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C - 1; c++) {
        const sA = getSubj(matrix[r][c]);
        const sB = getSubj(matrix[r][c + 1]);
        if (!sA || !sB || sA !== sB) continue;

        // Found adjacency violation — find a swap candidate
        clean = false;
        search:
        for (let i = 0; i < R; i++) {
          for (let j = 0; j < C; j++) {
            if (i === r && (j === c || j === c + 1)) continue;
            const sX = getSubj(matrix[i][j]);
            if (!sX || sX === sA) continue;
            // Avoid creating a new violation on the right of (r, c+1)
            const sRight = (c + 2 < C) ? getSubj(matrix[r][c + 2]) : null;
            if (sRight && sX === sRight) continue;
            [matrix[r][c + 1], matrix[i][j]] = [matrix[i][j], matrix[r][c + 1]];
            break search;
          }
        }
      }
    }

    if (clean) break;
  }
  return matrix;
}

/* ================================
   COLUMN-WISE ALLOCATION

   Phase 1 – Both years have students:
     Alternate columns: dominant year → other year → dominant → …
     Each column is filled top-to-bottom with that year's students.

   Phase 2 – One year exhausted:
     Group remaining students by subject.
     Each column is assigned to the subject with the most remaining
     students (picking a different subject each column, same logic
     as singleExam).
================================ */
function allocateColumnWiseAB(students, hallsData) {

  // Separate by year
  const A = students.filter((s) => s.year === "A");
  const B = students.filter((s) => s.year === "B");

  // ── Group by subject within each year first ──────────────────────────────
  // Sort each year's list by subject so all students of the same subject
  // are contiguous. This way each column filling naturally stays within
  // one subject cohort instead of randomly mixing subjects mid-column.
  const bySubject = (a, b) =>
    (a.subject || "").localeCompare(b.subject || "");
  A.sort(bySubject);
  B.sort(bySubject);
  // ─────────────────────────────────────────────────────────────────────────

  // Determine dominant (more students) vs other year
  const dominant = A.length >= B.length ? "A" : "B";
  const dominantArr = dominant === "A" ? A : B;
  const otherArr = dominant === "A" ? B : A;

  // Mutable pointers — shared across all halls
  let dominantIdx = 0;
  let otherIdx = 0;

  // Phase 2 state — hoisted outside forEach so it persists across halls.
  // If Phase 2 activates mid-hall, these survive into the next hall's
  // columns so no student is silently dropped.
  let subjectGroups = null;   // { subjectName: [student, …] }
  let subjectPointers = null;   // { subjectName: number }
  let prevSubjectKey = null;   // avoid same subject in back-to-back columns

  const allocation = {};
  const report = [];

  hallsData.forEach((hall) => {
    const rows = Number(hall.Rows);
    const columns = Number(hall.Columns);
    let hallPlacedCount = 0;

    // Build empty matrix  [row][col] = [ student ] or []
    const matrix = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => [])
    );

    for (let col = 0; col < columns; col++) {

      const domExhausted = dominantIdx >= dominantArr.length;
      const otherExhausted = otherIdx >= otherArr.length;

      /* ---- PHASE 1: both years still have students ---- */
      if (!domExhausted && !otherExhausted) {

        // Alternate: even columns → dominant, odd columns → other
        const isEvenCol = col % 2 === 0;
        const arr = isEvenCol ? dominantArr : otherArr;
        const idxRef = isEvenCol
          ? { get: () => dominantIdx, inc: () => { dominantIdx++; } }
          : { get: () => otherIdx, inc: () => { otherIdx++; } };

        for (let row = 0; row < rows; row++) {
          if (idxRef.get() < arr.length) {
            matrix[row][col] = [arr[idxRef.get()]];
            idxRef.inc();
            hallPlacedCount++;
          }
        }

        /* ---- PHASE 2: one year exhausted – subject-based fill ---- */
      } else {

        // Build subject groups ONCE from ALL remaining students.
        // After this both pointer arrays are marked fully consumed
        // so we never double-count.
        if (!subjectGroups) {
          const remaining = [
            ...dominantArr.slice(dominantIdx),
            ...otherArr.slice(otherIdx),
          ];
          dominantIdx = dominantArr.length;
          otherIdx = otherArr.length;

          subjectGroups = buildSubjectGroups(remaining);
          subjectPointers = Object.fromEntries(
            Object.keys(subjectGroups).map((k) => [k, 0])
          );
        }

        // Pick the subject with the most remaining students
        // (prefer a different subject from the previous column)
        let bestSubject = null;
        let maxRemaining = 0;

        for (const [subj, arr] of Object.entries(subjectGroups)) {
          const rem = arr.length - subjectPointers[subj];
          if (rem > maxRemaining && subj !== prevSubjectKey) {
            maxRemaining = rem;
            bestSubject = subj;
          }
        }

        // If the only subject left is the same as the previous column,
        // SKIP this column (leave it empty) and reset prevSubjectKey.
        // Next column will then be allowed to use it — creating an
        // interleaved pattern:  SubjX | --- | SubjX | ---
        // This prevents same-subject adjacency even when only one subject remains.
        if (!bestSubject && prevSubjectKey) {
          const rem = subjectGroups[prevSubjectKey]
            ? subjectGroups[prevSubjectKey].length - subjectPointers[prevSubjectKey]
            : 0;
          if (rem > 0) {
            prevSubjectKey = null; // allow it in the NEXT column
            continue;             // skip this column
          }
          // rem === 0 means all done — nothing to place
        }

        if (bestSubject) {
          const arr = subjectGroups[bestSubject];
          for (let row = 0; row < rows; row++) {
            if (subjectPointers[bestSubject] < arr.length) {
              matrix[row][col] = [arr[subjectPointers[bestSubject]++]];
              hallPlacedCount++;
            }
          }
          prevSubjectKey = bestSubject;
        }
      }
    } // end columns loop

    // Enforce: no two adjacent seats in the same row may share a subject
    fixSameSubjectAdjacency(matrix);

    allocation[hall.HallName] = matrix;

    report.push({
      hall: hall.HallName,
      placed: hallPlacedCount,
      capacity: rows * columns,
      type: "Column-wise (Year alternating → Subject fallback)",
    });
  }); // end halls loop

  // Count students that were never assigned a seat
  const unplacedYear = Math.max(0, dominantArr.length - dominantIdx)
    + Math.max(0, otherArr.length - otherIdx);

  // If Phase 2 was active, also count any leftover in subject groups
  const unplacedSubj = subjectGroups
    ? Object.entries(subjectGroups).reduce(
      (acc, [k, arr]) => acc + Math.max(0, arr.length - subjectPointers[k]),
      0
    )
    : 0;

  const totalUnplaced = unplacedYear + unplacedSubj;

  // Split unplaced back to A / B for the report
  const unplacedA = dominant === "A"
    ? Math.max(0, dominantArr.length - dominantIdx)
    : Math.max(0, otherArr.length - otherIdx);
  const unplacedB = dominant === "B"
    ? Math.max(0, dominantArr.length - dominantIdx)
    : Math.max(0, otherArr.length - otherIdx);

  console.log("\n===== UNPLACED STUDENTS =====\n");
  console.log(`Year A: ${unplacedA}`);
  console.log(`Year B: ${unplacedB}`);
  console.log(`Phase-2 subject leftovers: ${unplacedSubj}`);
  console.log(`Total Unplaced: ${totalUnplaced}`);

  return {
    allocation,
    report,
    unplaced: {
      A: unplacedA,
      B: unplacedB,
      total: totalUnplaced,
    },
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
         ALLOCATE SEATS
         (dominant-year alternating columns → subject fallback)
      ------------------------------ */

      console.log("\n===== STUDENT COUNTS =====\n");
      console.log(`Year A: ${(yearMap.A || []).length} students`);
      console.log(`Year B: ${(yearMap.B || []).length} students`);

      const { allocation, report, unplaced } =
        allocateColumnWiseAB(
          merged,
          hallsData
        );

      // // Print final seating
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
              allocation
            ),

          createdAt:
            admin.firestore.FieldValue.serverTimestamp(),

          name,
          sems,
          isElective: false,
          examDate,
        });

      res.json({
        success: true,
        message: "Allocation completed successfully",
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
