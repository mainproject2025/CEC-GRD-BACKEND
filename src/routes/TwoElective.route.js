const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const upload = multer({ dest: "uploads/" });
const { admin, db } = require("../config/firebase");
const { log } = require("console");

let StudYears={}
let NewStudYears={}
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
   GROUP BY SUBJECT
================================ */
function groupBySubject(students, key = "Subject") {
  const map = {};
  students.forEach((s) => {
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
    (h) => (benches += Number(h.Rows) * Math.floor(Number(h.Columns) / 3)),
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
  hallsData.forEach((h) => {
    const sorted = Object.entries(subjectMap).sort(
      (a, b) => b[1].length - a[1].length,
    );
    hallSub[h.HallName] = sorted[0]?.[0];
  });
  return hallSub;
}

/* ================================
   SUBJECT-AWARE ALLOCATION
================================ */
function allocateStudentsSubjectWise(students, hallsData, spb) {
  /* ---------------------------
     GROUP BY SUBJECT + YEAR
  ----------------------------*/

  const subjectYearMap = {};

  students.forEach((s) => {
    if (!subjectYearMap[s.subject]) subjectYearMap[s.subject] = {};

    if (!subjectYearMap[s.subject][s.year])
      subjectYearMap[s.subject][s.year] = [];

    subjectYearMap[s.subject][s.year].push(s);
  });

  /* ---------------------------
     SORT SUBJECTS BY SIZE
  ----------------------------*/

  const subjects = Object.keys(subjectYearMap).sort((a, b) => {
    const count = (obj) => Object.values(obj).reduce((s, x) => s + x.length, 0);

    return count(subjectYearMap[b]) - count(subjectYearMap[a]);
  });

  const allocation = {};

  /* ---------------------------
     MAIN LOOP
  ----------------------------*/

  hallsData.forEach((hall, hallIndex) => {
    const rows = Number(hall.Rows);
    const benches = Math.floor(Number(hall.Columns) / 3);

    const hallMatrix = [];

    // Pick dominant subject for this hall
    const dominantSubject = subjects[hallIndex % subjects.length];

    const pools = subjectYearMap[dominantSubject] || {};

    for (let r = 0; r < rows; r++) {
      const rowOffset = r % 2 === 0 ? 0 : 1;

      const row = [];

      for (let b = 0; b < benches; b++) {
        const bench = [];

        for (let s = 0; s < spb; s++) {
          const seatIndex = b * spb + s;

          const preferYear =
            (seatIndex + rowOffset + hallIndex) % 2 === 0 ? "A" : "B";

          let student = null;

          /* ---------------------------
             TRY DOMINANT SUBJECT FIRST
          ----------------------------*/

          if (pools[preferYear]?.length) {
            student = pools[preferYear].shift();
          }

          /* ---------------------------
             FALLBACK SEARCH
          ----------------------------*/

          if (!student) {
            search: for (const [sub, years] of Object.entries(subjectYearMap)) {
              for (const [yr, list] of Object.entries(years)) {
                if (!list.length) continue;

                student = list.shift();
                break search;
              }
            }
          }

          /* ---------------------------
             SUBJECT CONFLICT CHECK
          ----------------------------*/

          if (student && bench.length) {
            const left = bench[bench.length - 1];

            if (
              left.subject === student.subject &&
              left.year !== student.year
            ) {
              // Put back and retry
              subjectYearMap[student.subject][student.year].unshift(student);

              student = null;
            }
          }

          if (student) bench.push(student);
        }

        row.push(bench);
      }

      hallMatrix.push(row);
    }

    allocation[hall.HallName] = hallMatrix;
  });

  return allocation;
}

/* ================================
   HALL ANALYSIS
================================ */
function analyzeHall(hall) {
  let students = 0,
    benchesUsed = 0;
  hall.forEach((r) =>
    r.forEach((b) => {
      if (b.length) benchesUsed++;
      students += b.length;
    }),
  );
  return { students, benchesUsed };
}

/* ================================
   REPACK TO 2 PER BENCH
================================ */
function repackToTwo(hall) {
  const list = [];
  hall.forEach((r) => r.forEach((b) => b.forEach((s) => list.push(s))));
  let i = 0;
  hall.forEach((r) =>
    r.forEach((b) => {
      b.length = 0;
      if (i < list.length) b.push(list[i++]);
      if (i < list.length) b.push(list[i++]);
    }),
  );
}

/* ================================
   OPTIMIZATION
================================ */
function optimizeHallUtilization(allocation, hallsData, spb) {
  const halls = Object.keys(allocation);

  halls.forEach((name) => {
    const hall = allocation[name];
    const info = hallsData.find((h) => h.HallName === name);
    const totalBenches =
      Number(info.Rows) * Math.floor(Number(info.Columns) / 3);

    const { students, benchesUsed } = analyzeHall(hall);

    if (
      spb === 3 &&
      benchesUsed < totalBenches &&
      students <= totalBenches * 2
    ) {
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

            name: s.StudentName || s["StudentName"] || null,

            year: NewStudYears[s.year] || null,
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
      const studentCSVs = req.files.students.map((f) => f.path);
    
      
      const hallsData = await parseCSV(hallsCSV);
      const yearMap = {};
      for (const f of studentCSVs) {
  
        const year = path.parse(f).name;
        const students = await parseCSV(f);
        StudYears[year]=students[0].year
        
        yearMap[year] = interleaveSubjects(groupBySubject(students));
         
        
      }

      const years = Object.keys(yearMap);
      
      console.log((Object.keys(StudYears)[0]))
      
      const merged = Object.entries(yearMap).flatMap(([year, list], i) =>{
        if (i===0){
          NewStudYears["A"]=StudYears[(Object.keys(StudYears)[0])]
        }else{
          NewStudYears["B"]=StudYears[(Object.keys(StudYears)[1])]
        }
        return list.map((s) => ({
          ...s,
          year: i === 0 ? "A" : "B",
        }));

      }
      );

      
      
       
      

      const { studentsPerBench } = evaluateBenchCapacity(
        hallsData,
        merged.length,
      );

      let allocation = allocateStudentsSubjectWise(
        merged,
        hallsData,
        studentsPerBench,
      );

      serializeAllocationForFirestore(allocation)

      optimizeHallUtilization(allocation, hallsData, studentsPerBench);
      let name = req.body.examName;
      let sems = req.body.years;
      let types = req.body.type;
      let examDate = req.body.examDate;
      const doc = await db.collection("examAllocations").add({
        meta: {
          studentsPerBench,
          totalStudents: merged.length,
        },
        halls: serializeAllocationForFirestore(allocation),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        name,
        sems,
        isElective: types === "Normal" ? false : true,
        examDate,
      });

      res.json({
        success: true,
        allocationId: "done",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
