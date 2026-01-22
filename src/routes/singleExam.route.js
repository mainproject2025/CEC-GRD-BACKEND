const path = require("path");
const multer = require("multer");
const fs = require("fs");
const express = require("express");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

const { admin, db } = require("../config/firebase");

/* ================================
   CSV → JSON
================================ */
function excelToCsv(csvData) {
  const lines = csvData.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(",");
    return headers.reduce((o, h, i) => {
      o[h] = values[i]?.trim() || "";
      return o;
    }, {});
  });
}

/* ================================
   UTILS
================================ */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ================================
   SUBJECT GROUPING (CORE CHANGE)
================================ */
function groupStudentsBySubject(students) {
  const map = {};
  students.forEach(s => {
    const subject = s.Common_Subject_1 || s.Subject || "Unknown";
    map[subject] ??= [];
    map[subject].push(s.RollNumber);
  });
  return map;
}

function buildRollToSubject(students) {
  const map = {};
  students.forEach(s => {
    map[s.RollNumber] = s.Common_Subject_1 || s.Subject || "Unknown";
  });
  return map;
}

function buildRollToInfo(students) {
  const map = {};
  students.forEach(s => {
    map[s.RollNumber] = {
      name: s.StudentName || "",
      batch: s.Batch || "",
      year: s.year || "",
      subject: s.Common_Subject_1 || s.Subject || ""
    };
  });
  return map;
}

/* ================================
   CAPACITY
================================ */
function getHallCapacity(hall, twoPerBench) {
  const R = Number(hall.Rows);
  const C = Number(hall.Columns);
  let cap = 0;
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      if (twoPerBench && c % 3 === 1) continue;
      cap++;
    }
  return cap;
}

function calculateTotalCapacity(halls, twoPerBench) {
  return halls.reduce((s, h) => s + getHallCapacity(h, twoPerBench), 0);
}

/* ================================
   CORE ALLOCATION (SUBJECT ROTATION)
================================ */
function allocateHall(hall, groups, pointers, order, startOffset, twoPerBench) {
  const R = Number(hall.Rows);
  const C = Number(hall.Columns);
  const seats = Array.from({ length: R }, () => Array(C).fill(null));
  let count = 0;

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (twoPerBench && c % 3 === 1) continue;

      const logical = twoPerBench ? c - Math.floor(c / 3) : c;
      const base = (logical + startOffset) % order.length;

      for (let k = 0; k < order.length; k++) {
        const key = order[(base + k) % order.length];
        if (pointers[key] < groups[key].length) {
          seats[r][c] = groups[key][pointers[key]++];
          count++;
          break;
        }
      }
    }
  }
  return { seats, count };
}

/* ================================
   RANDOMIZE WITHIN SUBJECT
================================ */
function randomizeSeatsBySubject(seats, rollToSubject) {
  const buckets = {};
  seats.forEach((row, r) =>
    row.forEach((roll, c) => {
      if (!roll) return;
      const sub = rollToSubject[roll];
      buckets[sub] ??= [];
      buckets[sub].push({ r, c, roll });
    })
  );

  Object.values(buckets).forEach(bucket => {
    const shuffled = shuffleArray(bucket.map(b => b.roll));
    bucket.forEach((pos, i) => {
      seats[pos.r][pos.c] = shuffled[i];
    });
  });

  return seats;
}

/* ================================
   SUBJECT ADJACENCY FIX
================================ */
function fixSameSubjectAdjacency(arr, rollToSubject) {
  const R = arr.length, C = arr[0].length;

  for (let pass = 0; pass < 50; pass++) {
    let clean = true;

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C - 1; c++) {
        const a = arr[r][c];
        const b = arr[r][c + 1];
        if (!a || !b) continue;

        if (rollToSubject[a] === rollToSubject[b]) {
          clean = false;
          search:
          for (let i = r + 1; i < R; i++) {
            for (let j = 0; j < C; j++) {
              const x = arr[i][j];
              if (x && rollToSubject[x] !== rollToSubject[a]) {
                [arr[r][c + 1], arr[i][j]] = [x, b];
                break search;
              }
            }
          }
        }
      }
    }
    if (clean) break;
  }
  return arr;
}

/* ================================
   MAIN GENERATOR
================================ */
function generateSeatingPlan(halls, groups, rollToSubject) {
  const order = Object.keys(groups);
  const pointers = Object.fromEntries(order.map(k => [k, 0]));
  const totalStudents = Object.values(groups).reduce((s, g) => s + g.length, 0);

  const globalTwoBench =
    totalStudents <= calculateTotalCapacity(halls, true);

  const result = [];

  halls.forEach((hall, idx) => {
    let useTwoBench = globalTwoBench;
    if (!globalTwoBench) {
      const cap2 = getHallCapacity(hall, true);
      const cap3 = getHallCapacity(hall, false);
      if (cap3 <= cap2) useTwoBench = true;
    }

    let { seats } = allocateHall(
      hall, groups, pointers, order, idx, useTwoBench
    );

    seats = randomizeSeatsBySubject(seats, rollToSubject);
    seats = fixSameSubjectAdjacency(seats, rollToSubject);

    result.push({
      hallName: hall.HallName,
      seats,
      maxBench: useTwoBench ? 2 : 3
    });
  });

  return result;
}

/* ================================
   FIRESTORE FORMAT
================================ */
function formatForFirestore(hall, seats, rollToInfo) {
  const hallData = {
    rows: Number(hall.Rows),
    columns: Number(hall.Columns),
  };

  let seatNo = 1;
  seats.forEach((row, r) => {
    const arr = [];
    row.forEach((roll, c) => {
      if (!roll) return;
      const info = rollToInfo[roll];
      arr.push({
        roll,
        name: info.name,
        batch: info.batch,
        year: info.year,
        subject: info.subject,
        hall: hall.HallName,
        row: r + 1,
        bench: c + 1,
        seat: seatNo++
      });
    });
    if (arr.length) hallData[`row${r}`] = arr;
  });

  return hallData;
}

/* ================================
   API
================================ */
router.post(
  "/",
  upload.fields([{ name: "students" }, { name: "halls" }]),
  async (req, res) => {
    try {
      const students = excelToCsv(fs.readFileSync(req.files.students[0].path, "utf8"));
      const halls = shuffleArray(excelToCsv(fs.readFileSync(req.files.halls[0].path, "utf8")));

      const groups = groupStudentsBySubject(students);
      const rollToSubject = buildRollToSubject(students);
      const rollToInfo = buildRollToInfo(students);

      const raw = generateSeatingPlan(halls, groups, rollToSubject);

      const firestoreHalls = {};
      raw.forEach(r => {
        const hall = halls.find(h => h.HallName === r.hallName);
        firestoreHalls[r.hallName] = formatForFirestore(hall, r.seats, rollToInfo);
      });

      const doc = await db.collection("examAllocations").add({
        name: req.body.examName,
        sems: req.body.years,
        isElective: req.body.type !== "Normal",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        meta: {
          totalStudents: students.length,
          totalHalls: halls.length,
          studentsPerBench: raw[0]?.maxBench || 0
        },
        halls: firestoreHalls
      });

      res.json({ success: true, documentId: doc.id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
