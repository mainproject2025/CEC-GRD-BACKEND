const path = require("path");
const multer = require("multer");
const fs = require("fs");
const express = require("express");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Initialize Firebase Admin (make sure to set up your service account)
// admin.initializeApp({
//   credential: admin.credential.applicationDefault()
// });

const { admin, db } = require("../config/firebase");

/* ================================
   CONFIG
================================ */
const QUALITY_THRESHOLD = 85;
const MAX_RETRIES = 10;

/* ================================
   CSV → JSON
================================ */
function excelToCsv(csvData) {
  const lines = csvData.split("\n").filter(Boolean);
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
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
function groupStudents(students, isElective) {
  const map = {};

  if (isElective === "true") {
    students.forEach((s) => {
      if (!map[s.Subject]) {
        map[s.Subject] = { rolls: [] };
      }
      map[s.Subject].rolls.push(s["RollNumber"]);
    });
  } else {
    students.forEach((s) => {
      if (!map[s.Branch]) map[s.Branch] = [];
      map[s.Branch].push(s["RollNumber"]);
    });
  }

  return map;
}

/* ================================
   MAP BUILDERS
================================ */
function buildRollToBranch(students) {
  const map = {};
  students.forEach((s) => (map[s["RollNumber"]] = s.Branch));
  return map;
}

function buildRollToSubject(students) {
  const map = {};
  students.forEach((s) => (map[s["RollNumber"]] = s.Subject));
  return map;
}

function buildRollToStudentInfo(students) {
  const map = {};
   
  
  students.forEach((s) => {
   
  
    
    
    map[s["RollNumber"]] = {
      name: s.StudentName || "",
      branch: s.Branch || "",
      subject: s.Subject || "",
      batch: s.Batch || "",
      year: s.Year || ""
    };
  });
   
 
  
  return map;
}

/* ================================
   COMMON ALLOCATION
================================ */
function allocateHallCommon(hall, groups, pointers, order) {
  const R = Number(hall.Rows);
  const C = Number(hall.Columns);
  const seats = Array.from({ length: R }, () => Array(C).fill(""));

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const key = order[c % order.length];
      if (pointers[key] < groups[key].length) {
        seats[r][c] = groups[key][pointers[key]++];
      }
    }
  }
  return seats;
}

/* ================================
   ELECTIVE ALLOCATION
================================ */
function allocateHallElective(hall, groups, pointers, order) {
  const R = Number(hall.Rows);
  const C = Number(hall.Columns);
  const seats = Array.from({ length: R }, () => Array(C).fill(""));

  let subjectIndex = 0;

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (subjectIndex >= order.length) return seats;

      const subject = order[subjectIndex];
      const rolls = groups[subject].rolls;

      if (pointers[subject] < rolls.length) {
        seats[r][c] = rolls[pointers[subject]++];
      } else {
        subjectIndex++;
        c--;
      }
    }
  }
  return seats;
}

/* ================================
   RANDOMIZATION
================================ */
function randomizeSeats(arr) {
  const flat = arr.flat().filter(Boolean);
  shuffleArray(flat);
  let i = 0;
  return arr.map((row) => row.map(() => flat[i++] || ""));
}

/* ================================
   COMMON OPTIMIZATION
================================ */
function commonOptimization(arr, rollToBranch) {
  const R = arr.length;
  const C = arr[0].length;

  for (let pass = 0; pass < R * C; pass++) {
    let fixed = false;

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C - 1; c++) {
        const a = arr[r][c];
        const b = arr[r][c + 1];
        if (!a || !b) continue;

        if (rollToBranch[a] === rollToBranch[b]) {
          for (let i = r; i < R && !fixed; i++) {
            for (let j = 0; j < C; j++) {
              const x = arr[i][j];
              if (x && rollToBranch[x] !== rollToBranch[a]) {
                [arr[r][c + 1], arr[i][j]] = [x, b];
                fixed = true;
                break;
              }
            }
          }
        }
      }
    }
    if (!fixed) break;
  }
  return arr;
}

/* ================================
   ELECTIVE OPTIMIZATION
================================ */
function electiveOptimization(arr, rollToSubject) {
  const R = arr.length;
  const C = arr[0].length;

  for (let pass = 0; pass < R * C; pass++) {
    let fixed = false;

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C - 1; c++) {
        const a = arr[r][c];
        const b = arr[r][c + 1];
        if (!a || !b) continue;

        const sa = rollToSubject[a];
        const sb = rollToSubject[b];

        if (sa === sb) {
          outer:
          for (let i = r + 1; i < R; i++) {
            for (let j = 0; j < C; j++) {
              const x = arr[i][j];
              if (!x) continue;

              const sx = rollToSubject[x];

              const leftOK =
                c === 0 || rollToSubject[arr[r][c - 1]] !== sx;
              const rightOK =
                c + 2 >= C || rollToSubject[arr[r][c + 2]] !== sx;

              if (sx !== sa && leftOK && rightOK) {
                [arr[r][c + 1], arr[i][j]] = [x, b];
                fixed = true;
                break outer;
              }
            }
          }
        }
      }
    }

    if (!fixed) break;
  }

  return arr;
}

/* ================================
   OPTIMIZED SEATING
================================ */
function optimizedSeating(
  hall,
  groups,
  pointers,
  order,
  rollToBranch,
  rollToSubject,
  isElective
) {
  if (isElective === "true") {
    let seats = allocateHallElective(hall, groups, pointers, order);
    seats = randomizeSeats(seats);
    seats = electiveOptimization(seats, rollToSubject);
    return [seats, pointers];
  }

  let best = null;
  let bestScore = -1;
  let tempPointer;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const localPointers = { ...pointers };
    let seats = allocateHallCommon(hall, groups, localPointers, order);
    seats = randomizeSeats(seats);
    seats = commonOptimization(seats, rollToBranch);

    const score = Math.random() * 100;
    if (score > bestScore) {
      bestScore = score;
      best = seats;
      tempPointer = localPointers;
    }
    if (bestScore >= QUALITY_THRESHOLD) break;
  }

  return [best, tempPointer];
}

/* ================================
   CONVERT SEATING TO FIRESTORE FORMAT
================================ */
function convertSeatingToFirestoreFormat(hall, seats, rollToStudentInfo) {
  const allocation = [];
  let seatNumber = 1;

    
   
  // console.log(rollToStudentInfo);
  
  seats.forEach((row, rowIndex) => {
    row.forEach((roll, colIndex) => {
       
       
      
      if (roll) {
 
        const studentInfo = rollToStudentInfo[roll] || {};
        
        allocation.push({
          roll: roll,
          name: studentInfo.name,
          batch: studentInfo.batch,
          year: studentInfo.year,
          hall: hall.HallName,
          row: rowIndex + 1,
          bench: colIndex + 1,
          seat: seatNumber
        });
        seatNumber++;
      }
    });
  });
   

  
  
  return allocation;
}

/* ================================
   SAVE TO FIRESTORE
================================ */
async function saveAllocationToFirestore(hallAllocations, metadata,name,sem) {
  const docRef = db.collection("examAllocations").doc();
  
  const firestoreData = {
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    halls: {},
    meta: metadata,
    name:name,
    sems:sem
  };

  hallAllocations.forEach(({ hallName, allocation }) => {
     
    
    firestoreData.halls[hallName] = allocation;
  });

  await docRef.set(firestoreData);
  
  return docRef.id;
}

/* ================================
   API ENDPOINT
================================ */
router.post(
  "/",
  upload.fields([
    { name: "students", maxCount: 1 },
    { name: "halls", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const students = excelToCsv(
        fs.readFileSync(req.files.students[0].path, "utf8")
      );
      const halls = shuffleArray(
        excelToCsv(fs.readFileSync(req.files.halls[0].path, "utf8"))
      );

       
      
      const isElective = req.body.isElective;

      const groups = groupStudents(students, isElective);

     
      
      const order = Object.keys(groups);

      let pointers = {};
      order.forEach((k) => (pointers[k] = 0));
      
      
      const rollToBranch = buildRollToBranch(students);
      const rollToSubject = buildRollToSubject(students);
      const rollToStudentInfo = buildRollToStudentInfo(students);

      // console.log(rollToStudentInfo);
      
      const hallAllocations = [];

      halls.forEach((hall) => {
        const [seats, newPointers] = optimizedSeating(
          hall,
          groups,
          pointers,
          order,
          rollToBranch,
          rollToSubject,
          isElective
        );

        pointers = newPointers;

        // console.log(hall);
        // console.log(seats);
        // console.log(rollToStudentInfo);

         
        const allocation = convertSeatingToFirestoreFormat(
          hall,
          seats,
          rollToStudentInfo
        );
        
         
         
        
        hallAllocations.push({
          hallName: hall.HallName,
          allocation: allocation
        });
      });

      // Prepare metadata
      const metadata = {
        totalStudents: students.length,
        totalHalls: halls.length,
        isElective: isElective === "true",
        studentsPerBench: hallAllocations[0]?.allocation.length > 0 
          ? Math.max(...hallAllocations[0].allocation.map(s => s.bench))
          : 0
      };

      // Save to Firestore
      const docId = await saveAllocationToFirestore(hallAllocations, metadata,req.body.examName,req.body.years);

      res.json({
        success: true,
        message: "Allocation saved successfully",
        documentId: docId,
        totalStudents: students.length,
        totalHalls: halls.length
      });

      // Clean up uploaded files
      fs.unlinkSync(req.files.students[0].path);
      fs.unlinkSync(req.files.halls[0].path);

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Allocation generation failed", details: err.message });
    }
  }
);

module.exports = router;