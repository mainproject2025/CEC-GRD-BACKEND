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
      .on("data", d => results.push(d))
      .on("end", () => resolve(results))
      .on("error", reject);
  });

/* ================================
   GROUP BY SUBJECT
================================ */
function groupBySubject(students, key = "Elective_1") {
  const map = {};
  students.forEach(s => {
    const subject = s[key];
    if (!subject) return;
    if (!map[subject]) map[subject] = [];
    map[subject].push(s);
  });
  return map;
}

/* ================================
   ROUND ROBIN SUBJECT MIX
================================ */
function interleaveSubjects(subjectMap) {
  const subjects = Object.keys(subjectMap);
  const ptr = subjects.map(() => 0);
  const out = [];
  let added = true;

  while (added) {
    added = false;
    subjects.forEach((s, i) => {
      if (ptr[i] < subjectMap[s].length) {
        out.push({ ...subjectMap[s][ptr[i]++], subject: s });
        added = true;
      }
    });
  }
  return out;
}

/* ================================
   BENCH CAPACITY
================================ */
function evaluateBenchCapacity(hallsData, totalStudents) {
  let benches = 0;
  hallsData.forEach(
    h => (benches += Number(h.Rows) * Math.floor(Number(h.Columns) / 3))
  );

  if (2 * benches >= totalStudents) return { studentsPerBench: 2 };
  if (3 * benches >= totalStudents) return { studentsPerBench: 3 };
  throw new Error("❌ Insufficient bench capacity");
}

/* ================================
   SHUFFLE
================================ */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* ================================
   SUBJECT SAFE PICKER
================================ */
function pickAvoidingSameSubject(pool, usedSubjects) {
  for (let i = 0; i < pool.length; i++) {
    if (!usedSubjects.has(pool[i].subject)) {
      return pool.splice(i, 1)[0];
    }
  }
  return null;
}

/* ================================
   DOMINANT SUBJECT PER HALL
================================ */
function assignDominantSubjects(hallsData, subjectMap) {
  const hallSub = {};
  hallsData.forEach(h => {
    const sorted = Object.entries(subjectMap).sort(
      (a, b) => b[1].length - a[1].length
    );
    hallSub[h.HallName] = sorted[0]?.[0];
  });
  return hallSub;
}

/* ================================
   SUBJECT-AWARE ALLOCATION
================================ */
function allocateStudentsSubjectWise(students, hallsData, spb) {
  const allocation = {};
  const subjectMap = {};

  students.forEach(s => {
    if (!subjectMap[s.subject]) subjectMap[s.subject] = [];
    subjectMap[s.subject].push(s);
  });

  Object.values(subjectMap).forEach(shuffle);
  const hallSubject = assignDominantSubjects(hallsData, subjectMap);

  hallsData.forEach(hall => {
    const rows = Number(hall.Rows);
    const benches = Math.floor(Number(hall.Columns) / 3);
    const matrix = [];
    const dominant = hallSubject[hall.HallName];

    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let b = 0; b < benches; b++) {
        const bench = [];
        const used = new Set();

        for (let i = 0; i < spb; i++) {
          let student =
            pickAvoidingSameSubject(subjectMap[dominant] || [], used);

          if (!student) {
            for (const pool of Object.values(subjectMap)) {
              student = pickAvoidingSameSubject(pool, used);
              if (student) break;
            }
          }

          if (student) {
            used.add(student.subject);
            bench.push(student);
          }
        }
        row.push(bench);
      }
      matrix.push(row);
    }
    allocation[hall.HallName] = matrix;
  });

  return allocation;
}

/* ================================
   HALL ANALYSIS
================================ */
function analyzeHall(hall) {
  let students = 0, benchesUsed = 0;
  hall.forEach(r =>
    r.forEach(b => {
      if (b.length) benchesUsed++;
      students += b.length;
    })
  );
  return { students, benchesUsed };
}

/* ================================
   REPACK TO 2 PER BENCH
================================ */
function repackToTwo(hall) {
  const list = [];
  hall.forEach(r => r.forEach(b => b.forEach(s => list.push(s))));
  let i = 0;
  hall.forEach(r =>
    r.forEach(b => {
      b.length = 0;
      if (i < list.length) b.push(list[i++]);
      if (i < list.length) b.push(list[i++]);
    })
  );
}

/* ================================
   OPTIMIZATION
================================ */
function optimizeHallUtilization(allocation, hallsData, spb) {
  const halls = Object.keys(allocation);

  halls.forEach(name => {
    const hall = allocation[name];
    const info = hallsData.find(h => h.HallName === name);
    const totalBenches =
      Number(info.Rows) * Math.floor(Number(info.Columns) / 3);

    const { students, benchesUsed } = analyzeHall(hall);

    if (spb === 3 && benchesUsed < totalBenches && students <= totalBenches * 2) {
      repackToTwo(hall);
    }
  });
}

/* ================================
   FIRESTORE SERIALIZER (SAFE)
================================ */
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
            // 🔥 ONLY PRIMITIVES (Firestore safe)
            roll: s.RollNumber || s.Roll || s["Roll Number"] || null,

            name: s.Name || s["StudentName"] || null,

            year: s.year || null,
            batch: s.Batch || s["Batch"] || null,
            isPublished:false,
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
   🚀 EXPRESS ROUTE
================================ */
router.post(
  "/",
  upload.fields([
    { name: "halls", maxCount: 1 },
    { name: "students", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const hallsCSV = req.files.halls[0].path;
      const studentCSVs = req.files.students.map(f => f.path);

      const hallsData = await parseCSV(hallsCSV);

      const yearMap = {};
      for (const f of studentCSVs) {
        const year = path.parse(f).name;
        const students = await parseCSV(f);
        yearMap[year] = interleaveSubjects(groupBySubject(students));
      }

      const merged = Object.entries(yearMap).flatMap(([year, list]) =>
        list.map(s => ({ ...s, year }))
      );

      const { studentsPerBench } = evaluateBenchCapacity(
        hallsData,
        merged.length
      );

      let allocation = allocateStudentsSubjectWise(
        merged,
        hallsData,
        studentsPerBench
      );

      optimizeHallUtilization(allocation, hallsData, studentsPerBench);
      let name=req.body.examName
      let sems=req.body.years
      let types=req.body.type
      const doc = await db.collection("examAllocations").add({
        meta: {
          studentsPerBench,
          totalStudents: merged.length,
          
        },
        halls: serializeAllocationForFirestore(allocation),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        name,
        sems,
        isElective:types==='Normal'?false:true
      });

      res.json({
        success: true,
        allocationId: doc.id,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
