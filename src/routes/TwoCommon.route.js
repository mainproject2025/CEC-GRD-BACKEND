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

let StudYears = {};
let CL_STUDENTS = [];

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
   BENCH CAPACITY
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

  throw new Error("Insufficient bench capacity");
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
  studentsPerBench,
) {
  const A = [...allStudents[yearA]];
  const B = [...allStudents[yearB]];

  let iA = 0;
  let iB = 0;

  const allocation = {};

  hallsData.forEach((hall, hallIndex) => {
    const rows = Number(hall.Rows);
    const benchesPerRow = Math.floor(Number(hall.Columns) / 3);

    const hallName = hall.HallName;
    const hallMatrix = [];

    for (let r = 0; r < rows; r++) {
      const rowOffset = r % 2 === 0 ? 0 : 1;
      const row = [];

      for (let b = 0; b < benchesPerRow; b++) {
        const bench = [];

        if (studentsPerBench === 2) {
          const order = rowOffset === 0 ? ["A", "B"] : ["B", "A"];

          order.forEach((o) => {
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
          for (let s = 0; s < 3; s++) {
            const seatIndex = b * 3 + s;

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
   OPTIMIZE
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

function optimizeHallUtilization(allocation, hallsData, studentsPerBench) {
  for (const hallName in allocation) {
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
  }
}

/* ================================
   CL INJECTION
================================ */
function injectCLStudents(allocation, clStudents) {
  const removed = [];
  let clIndex = 0;

  for (const hallName of Object.keys(allocation)) {
    if (clIndex >= clStudents.length) break;

    const hall = allocation[hallName];
    const yearCount = {};

    hall.forEach((row) =>
      row.forEach((bench) =>
        bench.forEach((s) => {
          if (!s) return;

          yearCount[s.year] =
            (yearCount[s.year] || 0) + 1;
        }),
      ),
    );

    const targetYear = Object.entries(yearCount)
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    if (!targetYear) continue;

    hall.forEach((row) =>
      row.forEach((bench) =>
        bench.forEach((s, i) => {
          if (
            s &&
            s.year === targetYear &&
            clIndex < clStudents.length
          ) {
            removed.push(s);
            bench[i] = clStudents[clIndex++];
          }
        }),
      ),
    );
  }

  return {
    removedStudents: removed,
    remainingCL: clStudents.slice(clIndex),
  };
}

function reallocateLeftovers(allocation, students) {
  let idx = 0;

  for (const hallName of Object.keys(allocation)) {
    if (idx >= students.length) break;

    const hall = allocation[hallName];

    hall.forEach((row) =>
      row.forEach((bench) => {
        if (idx >= students.length) return;

        if (bench.length < 2) {
          const prev = bench[bench.length - 1];

          if (!prev || prev.year !== students[idx].year) {
            bench.push(students[idx++]);
          }
        }
      }),
    );
  }
}

/* ================================
   SERIALIZE
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
            name: s.StudentName || null,
            year: StudYears[s.year] || null,
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
   FIRESTORE
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
    examDate,
  });

  return ref.id;
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
      const hallsCSV = req.files.halls[0].path;
      const studentCSVs = req.files.students.map((f) => f.path);

      const hallsData = await parseCSV(hallsCSV);

      const allStudents = {};
      const years = [];

      CL_STUDENTS = [];

      for (const file of studentCSVs) {
        const year = path.parse(file).name;
        years.push(year);

        const data = await parseCSV(file);

        const normal = [];
        const cl = [];

        data.forEach((s) => {
          const roll =
            s.RollNumber || s.Roll || s["Roll Number"] || "";

          if (roll.includes("CL")) {
            cl.push({ ...s, year });
          } else {
            normal.push(s);
          }
        });

        allStudents[year] = normal;
        CL_STUDENTS.push(...cl);

        StudYears[year] = data[0]?.year || null;
      }

      const [yearA, yearB] = years;

      const totalStudents =
        allStudents[yearA].length +
        allStudents[yearB].length;

      const evalResult = evaluateBenchCapacity(
        hallsData,
        totalStudents,
      );

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

      // CL handling
      const { removedStudents, remainingCL } =
        injectCLStudents(allocation, CL_STUDENTS);

      const leftovers = [
        ...removedStudents,
        ...remainingCL,
      ];

      reallocateLeftovers(allocation, leftovers);

      const examId = await storeAllocationInFirestore(
        allocation,
        {
          yearA,
          yearB,
          studentsPerBench: evalResult.studentsPerBench,
          totalStudents,
        },
        req.body.examName,
        req.body.years,
        req.body.type,
        req.body.examDate,
      );

      // Cleanup
      fs.unlinkSync(hallsCSV);
      studentCSVs.forEach((f) => fs.unlinkSync(f));

      CL_STUDENTS = [];

      res.json({ success: true, examId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
