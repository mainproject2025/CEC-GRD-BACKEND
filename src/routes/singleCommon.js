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
  const lines = csvData.replace(/\r\n/g, "\n")
    .split("\n")
    .filter(l => l.trim() !== "");

  const headers = lines[0].split(",");

  return lines.slice(1).map(line => {
    const values = line.split(",");
    return headers.reduce((obj, h, i) => {
      obj[h.trim()] = values[i]?.trim() || "";
      return obj;
    }, {});
  });
}

/* ================================
   UTILITIES
================================ */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ================================
   GROUP STUDENTS
================================ */
function groupStudents(students) {
  const map = {};

  students.forEach(s => {
    if (!map[s.Branch]) map[s.Branch] = [];
    map[s.Branch].push(s.RollNumber);
  });

  return map;
}

/* ================================
   MAP BUILDERS
================================ */
function buildRollToBranch(students) {
  const map = {};
  students.forEach(s => map[s.RollNumber] = s.Branch);
  return map;
}

function buildRollToStudentInfo(students) {
  const map = {};

  students.forEach(s => {
    map[s.RollNumber] = {
      name: s.StudentName || "",
      branch: s.Branch || "",
      subject: s.Subject || "",
      batch: s.Batch || "",
      year: s.year || ""
    };
  });

  return map;
}

/* ================================
   CAPACITY
================================ */
function getHallCapacity(hall, isTwo) {
  const R = Number(hall.Rows);
  const C = Number(hall.Columns);

  let cap = 0;

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {

      if (isTwo && c % 3 === 1) continue;

      cap++;
    }
  }

  return cap;
}

function calculateTotalCapacity(halls, isTwo) {
  return halls.reduce(
    (s, h) => s + getHallCapacity(h, isTwo),
    0
  );
}

/* ================================
   CORE ALLOCATION (AB / BA)
================================ */
function allocateHall(
  hall,
  groups,
  pointers,
  order,
  startOffset,
  isTwo
) {

  const R = Number(hall.Rows);
  const C = Number(hall.Columns);

  const seats = Array.from({ length: R }, () => Array(C).fill(""));
  let count = 0;

  for (let r = 0; r < R; r++) {

    // Flip every row
    const rowOffset = r % 2 === 0 ? 0 : 1;

    for (let c = 0; c < C; c++) {

      if (isTwo && c % 3 === 1) continue;

      let logical = c;

      if (isTwo) {
        logical = c - Math.floor(c / 3);
      }

      const base =
        (logical + rowOffset + startOffset) % order.length;

      for (let k = 0; k < order.length; k++) {

        const idx = (base + k) % order.length;
        const branch = order[idx];

        if (pointers[branch] < groups[branch].length) {

          seats[r][c] = groups[branch][pointers[branch]++];
          count++;
          break;
        }
      }
    }
  }

  return { seats, count };
}

/* ================================
   EVALUATION (FIX SAME BRANCH)
================================ */
function solveAdjacencyConstraints(arr, rollToBranch) {

  const R = arr.length;
  const C = arr[0].length;

  for (let pass = 0; pass < 40; pass++) {

    let ok = true;

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C - 1; c++) {

        const a = arr[r][c];
        const b = arr[r][c + 1];

        if (!a || !b) continue;

        if (rollToBranch[a] === rollToBranch[b]) {

          ok = false;

          search:
          for (let i = r; i < R; i++) {
            for (let j = 0; j < C; j++) {

              const cand = arr[i][j];

              if (
                cand &&
                rollToBranch[cand] !== rollToBranch[a]
              ) {

                arr[r][c + 1] = cand;
                arr[i][j] = b;

                break search;
              }
            }
          }
        }
      }
    }

    if (ok) break;
  }

  return arr;
}

/* ================================
   TERMINAL PRINT
================================ */
function printHallAllocation(name, seats, rollToBranch) {

  console.log("\n===============================");
  console.log("Hall:", name);
  console.log("===============================");

  seats.forEach((row, i) => {

    const line = row.map(s => {

      if (!s) return " --- ";

      return `${rollToBranch[s]}-${s}`;
    });

    console.log(`Row ${i + 1}:`, line.join(" | "));
  });

  console.log("===============================\n");
}

/* ================================
   MAIN ENGINE
================================ */
function generateSeatingPlan(halls, groups, rollToBranch) {

  const order = Object.keys(groups);

  let pointers = {};
  order.forEach(k => pointers[k] = 0);

  const results = [];

  const total = Object.values(groups)
    .reduce((a, g) => a + g.length, 0);

  const cap2 = calculateTotalCapacity(halls, true);

  const globalTwo = total <= cap2;

  console.log("Students:", total);
  console.log("2 Bench Cap:", cap2);
  console.log("Mode:", globalTwo ? "2" : "3");

  /* ---------- ALLOCATION ---------- */

  halls.forEach((hall, index) => {
    const rows = Number(hall.Rows);
    const columns = Number(hall.Columns);
    const startObjIndex = index % order.length;

    // Determine Hall Type
    const rawType = hall.Type || hall.type || hall.Furniture || hall.furniture || hall.SeatingType || "Bench";
    // const type = rawType.toLowerCase().includes("chair") ? "Chair" : "Bench";

    const seats = Array.from({ length: rows }, () => Array(columns).fill(""));

    // Column-wise filling
    for (let c = 0; c < columns; c++) {

      // If in 2-seater mode (globalTwo), skip the middle seat of a 3-seater bench (index 1, 4, 7...)
      if (globalTwo && c % 3 === 1) continue;

      // Determine logical group for this column
      // This creates the vertical striping effect: A B C A B C...
      let groupIndex = (startObjIndex + c) % order.length;

      for (let r = 0; r < rows; r++) {

        let placed = false;
        let attempts = 0;
        let currentKeyIndex = groupIndex;

        while (attempts < order.length) {
          const k = order[currentKeyIndex];

          if (pointers[k] < groups[k].length) {
            seats[r][c] = groups[k][pointers[k]++];
            placed = true;
            break;
          }

          // If preferred group empty, try next group
          currentKeyIndex = (currentKeyIndex + 1) % order.length;
          attempts++;
        }
      }
    }

    /* ---------- EVALUATION ---------- */

    const optimizedSeats = solveAdjacencyConstraints(
      seats,
      rollToBranch
    );

    /* ---------- PRINT ---------- */

    printHallAllocation(
      hall.HallName,
      optimizedSeats,
      rollToBranch
    );

    results.push({
      hallName: hall.HallName,
      allocation: optimizedSeats,
      maxBench: globalTwo ? 2 : 3
    });
  });

  return results;
}

/* ================================
   SAVE FIRESTORE
================================ */
async function saveAllocationToFirestore(
  halls,
  meta,
  name,
  sem,
  type,
  date,
  mode
) {

  const ref = db.collection("examAllocations").doc();

  const data = {
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    halls: {},
    meta,
    name,
    sems: sem,
    isElective: type !== "Normal",
    examDate: date,
    mode,
    isPublished: false
  };

  halls.forEach(h => {
    data.halls[h.hallName] = h.allocation;
  });

  await ref.set(data);

  return ref.id;
}

/* ================================
   FORMAT
================================ */
function formatForFirestore(hall, seats, info) {

  const data = {
    rows: Number(hall.Rows),
    columns: Number(hall.Columns)
  };

  let seatNo = 1;

  seats.forEach((row, r) => {

    const arr = [];

    row.forEach((roll, c) => {

      if (!roll) return;

      const i = info[roll] || {};

      arr.push({
        roll,
        name: i.name,
        batch: i.batch,
        year: i.year,
        hall: hall.HallName,
        row: r + 1,
        bench: c + 1,
        seat: seatNo++
      });
    });

    data[`row${r}`] = arr;
  });

  return data;
}

/* ================================
   API
================================ */
router.post(
  "/",
  upload.fields([
    { name: "students" },
    { name: "halls" }
  ]),

  async (req, res) => {

    try {

      const students = excelToCsv(
        fs.readFileSync(req.files.students[0].path, "utf8")
      );

      const halls = shuffleArray(
        excelToCsv(
          fs.readFileSync(req.files.halls[0].path, "utf8")
        )
      );

      const groups = groupStudents(students);
      const rollToBranch = buildRollToBranch(students);
      const rollToInfo = buildRollToStudentInfo(students);

      /* Generate */

      const raw = generateSeatingPlan(
        halls,
        groups,
        rollToBranch
      );

      /* Format */

      const final = raw.map(h => {

        const hall = halls.find(
          x => x.HallName === h.hallName
        );

        return {
          hallName: h.hallName,
          allocation: formatForFirestore(
            hall,
            h.allocation,
            rollToInfo
          ),
          maxBench: h.maxBench
        };
      });

      const meta = {
        totalStudents: students.length,
        totalHalls: halls.length,
        studentsPerBench: final[0]?.maxBench || 0
      };

      const id = await saveAllocationToFirestore(
        final,
        meta,
        req.body.examName,
        req.body.years,
        req.body.type,
        req.body.examDate,
        req.body.mode
      );

      res.json({
        success: true,
        documentId: id
      });

      fs.unlinkSync(req.files.students[0].path);
      fs.unlinkSync(req.files.halls[0].path);

    } catch (e) {

      console.error(e);

      res.status(500).json({
        error: e.message
      });
    }
  }
);

module.exports = router;
