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
   BATCH GROUPING
================================ */
function getSortedStudents(students) {
  return students.sort((a, b) => {
    // 1. Sort by Batch
    const batchA = (a.Batch || "").trim();
    const batchB = (b.Batch || "").trim();
    if (batchA < batchB) return -1;
    if (batchA > batchB) return 1;

    // 2. Sort by Branch
    const branchA = (a.Branch || "").trim();
    const branchB = (b.Branch || "").trim();
    if (branchA < branchB) return -1;
    if (branchA > branchB) return 1;

    // 3. Sort by Roll Number
    return (a.RollNumber || "").localeCompare(b.RollNumber || "");
  });
}
function printRollNumbers(students) {
  students.forEach(student => {
    console.log(student.RollNumber);
  });
}

function groupByBatch(data) {
  const batchMap = {};

  // Sort first
  data = getSortedStudents(data);

  data.forEach(student => {
    // Basic fields
    student.name = student.StudentName || "";
    student.subject = student.Common_Subject_1 || student.Subject || "";
    student.year = student.year || "";
    student.RollNumber = student.RollNumber || "";

    // Determine batch
    const batch = student.Batch || (student.RollNumber ? student.RollNumber.substring(0, 4) : "Unknown");
    student.batch = batch;

    if (!batchMap[batch]) batchMap[batch] = [];
    batchMap[batch].push(student);
  });

  return batchMap;
}

/* ================================
   HELPERS
================================ */

function getTopNBatches(batchMap, n) {
  return Object.entries(batchMap)
    .filter(([_, students]) => students.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, n)
    .map(([batch]) => batch);
}

function getHighestFromSelected(batchMap, selectedBatches) {
  let available = selectedBatches
    .filter(batch => batchMap[batch] && batchMap[batch].length > 0)
    .sort((a, b) => batchMap[b].length - batchMap[a].length);

  return available.length > 0 ? available[0] : null;
}

function findEmptySeats(matrix) {
  let seats = [];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[0].length; c++) {
      if (!matrix[r][c]) seats.push({ row: r, col: c });
    }
  }
  return seats;
}

function hasCollision(matrix, row, col, student) {
  const left = col > 0 ? matrix[row][col - 1] : null;
  const right = col < matrix[0].length - 1 ? matrix[row][col + 1] : null;

  return (
    (left && left.batch === student.batch) ||
    (right && right.batch === student.batch)
  );
}

/* ================================
   FIND LAST ACTIVE ROOM
================================ */
function getLastActiveRoom(allocation) {
  let roomNames = Object.keys(allocation);
  let lastActive = null;

  for (let roomName of roomNames) {
    let matrix = allocation[roomName];
    let hasStudent = matrix.some(row =>
      row.some(seat => seat !== null)
    );

    if (hasStudent) {
      lastActive = roomName;
    }
  }

  return lastActive;
}

/* ================================
   MAIN ALLOCATION
================================ */
function allocateSmartColumnWise(data, rooms) {
  const batchMap = groupByBatch(data);
  let allocation = {};

  const totalBatches = Object.keys(batchMap).length;
  // This heuristic can be tuned. 
  // If we have many small batches, we might want fewer selected batches per hall.
  // Original logic: Math.ceil(totalBatches / 2)
  const maxBatchesPerHall = Math.max(2, Math.ceil(totalBatches / 2));

  // We need to iterate rooms in a specific order (array order) to fill them sequentially
  // The 'rooms' map here comes from 'halls' array iteration, but Object.entries might not guarantee order.
  // Better to pass array of room objects.
  // But let's follow the logic provided where 'rooms' was an object.
  // We'll rely on the caller to provide 'rooms' or process keys.

  for (let [roomName, roomInfo] of Object.entries(rooms)) {
    const { row, cols } = roomInfo;

    let matrix = Array.from({ length: row }, () =>
      Array.from({ length: cols }, () => null)
    );

    let selectedBatches = getTopNBatches(batchMap, maxBatchesPerHall);

    for (let c = 0; c < cols; c++) {
      let batch = getHighestFromSelected(batchMap, selectedBatches);

      // If no batch is selected, we might want to pick a new batch from available?
      // The original logic only picks from 'selectedBatches'.
      // If 'selectedBatches' are exhausted, that column stays empty?
      // Wait, 'getHighestFromSelected' picks from 'selectedBatches' which refers to 'batchMap'.
      // Students are shifted from 'batchMap'.

      if (!batch) break;

      for (let r = 0; r < row; r++) {
        if (batchMap[batch] && batchMap[batch].length > 0) {
          matrix[r][c] = batchMap[batch].shift();
        }
      }
    }

    allocation[roomName] = matrix;
  }

  let remaining = [];
  Object.values(batchMap).forEach(students => {
    if (students.length > 0) remaining.push(...students);
  });
  return { allocation, remaining };
}

/* ================================
   REBALANCE
================================ */
function rebalanceAllocation(allocation) {
  let roomNames = Object.keys(allocation);
  let lastRoomName = getLastActiveRoom(allocation);
  if (!lastRoomName) return { allocation, dropped: [] };

  let lastRoom = allocation[lastRoomName];
  let unplaced = [];

  let emptySeats = findEmptySeats(lastRoom);
  let totalSeats = lastRoom.length * lastRoom[0].length;

  // If partially filled
  if (emptySeats.length > 0 && emptySeats.length !== totalSeats) {
    for (let r = 0; r < lastRoom.length; r++) {
      for (let c = 0; c < lastRoom[0].length; c++) {
        if (lastRoom[r][c]) {
          unplaced.push(lastRoom[r][c]);
          lastRoom[r][c] = null;
        }
      }
    }
  } else {
    // If the last room is fully filled, or empty, do nothing
    return { allocation, dropped: [] };
  }

  // Fill in holes in logical order of rooms?
  // Current logic iterates all rooms except last one.
  for (let roomName of roomNames) {
    if (roomName === lastRoomName) continue;
    if (unplaced.length === 0) break;

    let room = allocation[roomName];
    let seats = findEmptySeats(room);

    for (let seat of seats) {
      if (unplaced.length === 0) break;

      // Try to place an unplaced student here
      for (let i = 0; i < unplaced.length; i++) {
        let student = unplaced[i];
        if (!hasCollision(room, seat.row, seat.col, student)) {
          room[seat.row][seat.col] = student;
          unplaced.splice(i, 1);
          break;
        }
      }
    }
  }

  // Put remaining back into last room
  let lastSeats = findEmptySeats(lastRoom);

  for (let seat of lastSeats) {
    if (unplaced.length === 0) break;

    for (let i = 0; i < unplaced.length; i++) {
      let student = unplaced[i];
      if (!hasCollision(lastRoom, seat.row, seat.col, student)) {
        lastRoom[seat.row][seat.col] = student;
        unplaced.splice(i, 1);
        break;
      }
    }
  }

  /* 
    The logic below used to force place collisions.
    We are removing it to respect strict "no collision" requirement.
    The remaining unplaced are returned in `dropped`.
  */
  // if (unplaced.length > 0) {
  //   lastSeats = findEmptySeats(lastRoom);
  //   for (let seat of lastSeats) {
  //     if (unplaced.length === 0) break;
  //     lastRoom[seat.row][seat.col] = unplaced.shift();
  //   }
  // }

  return { allocation, dropped: unplaced };
}

/* ================================
   FIRESTORE FORMAT
================================ */
function formatForFirestore(hall, seats) {
  const hallData = {
    rows: Number(hall.Rows),
    columns: Number(hall.Columns),
  };

  let seatNo = 1;
  seats.forEach((row, r) => {
    const arr = [];
    row.forEach((student, c) => {
      // If student is null, it's an empty seat
      if (!student) return;

      arr.push({
        roll: student.RollNumber,
        name: student.name,
        batch: student.batch,
        year: student.year,
        subject: student.subject,
        hall: hall.HallName,
        row: r + 1,
        bench: c + 1,
        seat: seatNo++ // Seat number logic might need adjustment if bench/chair logic implies something else
      });
    });
    // Only add row if it has students? Or keep it?
    // Start with empty rows if needed, but Firestore typically stores populated data
    if (arr.length) hallData[`row${r}`] = arr;
  });

  return hallData;
}

function printMatrix(allocation) {

  for (let [roomName, matrix] of Object.entries(allocation)) {

    const hasStudent = matrix.some(row =>
      row.some(seat => seat !== null)
    );

    if (!hasStudent) continue;

    console.log(`\n===== ${roomName} =====`);

    matrix.forEach(row => {
      console.log(
        row.map(seat =>
          seat ? seat.RollNumber : "EMPTY"
        ).join(" | ")
      );
    });
  }
}

/* ================================
   API ROUTE
================================ */
router.post(
  "/",
  upload.fields([{ name: "students" }, { name: "halls" }]),
  async (req, res) => {
    try {
      if (!req.files.students || !req.files.halls) {
        return res.status(400).json({ error: "Missing files" });
      }

      const students = excelToCsv(fs.readFileSync(req.files.students[0].path, "utf8"));
      const halls = excelToCsv(fs.readFileSync(req.files.halls[0].path, "utf8"));

      // 1. Prepare rooms object for the algorithm
      // Note: 'halls' input order is preserved.
      // Object insertion order is generally preserved for non-integer keys in modern JS.
      const rooms = {};
      halls.forEach(h => {
        rooms[h.HallName] = {
          row: Number(h.Rows),
          cols: Number(h.Columns)
        };
      });

      // printRollNumbers(students);

      // 2. Run Allocation
      let { allocation, remaining } = allocateSmartColumnWise(students, rooms);
      const rebalanceResult = rebalanceAllocation(allocation);
      allocation = rebalanceResult.allocation;

      // New step: Try to place remaining students into the LAST room strictly without collision
      let allUnplaced = [...remaining, ...rebalanceResult.dropped];

      if (allUnplaced.length > 0) {
        const lastRoomName = getLastActiveRoom(allocation);
        if (lastRoomName) {
          const lastRoom = allocation[lastRoomName];
          const seats = findEmptySeats(lastRoom);

          for (let seat of seats) {
            if (allUnplaced.length === 0) break;
            // Try to find a student who fits here
            for (let i = 0; i < allUnplaced.length; i++) {
              let s = allUnplaced[i];
              if (!hasCollision(lastRoom, seat.row, seat.col, s)) {
                lastRoom[seat.row][seat.col] = s;
                allUnplaced.splice(i, 1);
                break;
              }
            }
          }
        }
      }

      if (allUnplaced.length > 0) {
        console.log("\n===== UNPLACED STUDENTS =====");
        console.log("Total:", allUnplaced.length);
        allUnplaced.forEach(s => console.log(` - ${s.RollNumber} (${s.batch})`));
        console.log("=============================\n");
      }

      // 3. Format for Firestore
      const firestoreHalls = {};

      // printMatrix(allocation)

      // Iterate over the halls to match the output allocation
      halls.forEach(h => {
        const roomName = h.HallName;
        if (allocation[roomName]) {
          firestoreHalls[roomName] = formatForFirestore(h, allocation[roomName]);
        }
      });

      console.log("Exam Name:", req.body.examName);

      const doc = await db.collection("examAllocations").add({
        name: req.body.examName,
        sems: req.body.years,
        isElective: req.body.type !== "Normal", // Assuming this flag mapping is correct from previous code
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        meta: {
          totalStudents: students.length,
          totalHalls: halls.length,
          studentsPerBench: 1 // Single column logic usually assumes 1 per seat position
        },
        halls: firestoreHalls,
        examDate: req.body.examDate
      });

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    } finally {
      // Cleanup uploaded files
      if (req.files) {
        if (req.files.students) fs.unlinkSync(req.files.students[0].path);
        if (req.files.halls) fs.unlinkSync(req.files.halls[0].path);
      }
    }
  }
);

module.exports = router;
