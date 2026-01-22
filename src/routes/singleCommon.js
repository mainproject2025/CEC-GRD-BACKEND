const path = require("path");
const multer = require("multer");
const fs = require("fs");
const express = require("express");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

const { admin, db } = require("../config/firebase");

/* ================================
   CONFIG
================================ */
const QUALITY_THRESHOLD = 95; // High threshold for "evaluation" stage
const MAX_RETRIES = 20;

/* ================================
   CSV → JSON
================================ */
function excelToCsv(csvData) {
  const lines = csvData.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim() !== "");
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
function groupStudents(students) {
  const map = {};
  students.forEach((s) => {
    // Uses 'Branch' from CSV
    if (!map[s.Branch]) map[s.Branch] = [];
    map[s.Branch].push(s["RollNumber"]);
  });
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

function buildRollToStudentInfo(students) {
  const map = {};
  students.forEach((s) => {
    map[s["RollNumber"]] = {
      name: s.StudentName || "",
      branch: s.Branch || "",
      // Mapped 'Common_Subject_1' to subject as per your CSV headers
      subject: s.Common_Subject_1 || "", 
      batch: s.Batch || "",
      // Year is not in provided headers, defaulting to empty string 
      // or you can map s.Batch if it contains year info.
      year: s.year || "" 
    };
  });
  return map;
}

/* ================================
   CAPACITY CALCULATORS
================================ */
function getHallCapacity(hall, isTwoPerBench) {
  const R = Number(hall.Rows);
  const C = Number(hall.Columns);
  let capacity = 0;
  
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      // If 2 per bench (assuming 3-seat bench structure), skip middle seat (index 1, 4, 7...)
      // Standard pattern: Seat, Empty, Seat => Indices 0, 2 => c % 3 !== 1
      if (isTwoPerBench && c % 3 === 1) continue;
      capacity++;
    }
  }
  return capacity;
}

function calculateTotalCapacity(halls, isTwoPerBench) {
  return halls.reduce((sum, hall) => sum + getHallCapacity(hall, isTwoPerBench), 0);
}

/* ================================
   CORE ALLOCATION LOGIC
================================ */
function allocateHall(hall, groups, pointers, order, startBranchOffset, isTwoPerBench) {
  const R = Number(hall.Rows);
  const C = Number(hall.Columns);
  const seats = Array.from({ length: R }, () => Array(C).fill(""));
  let allocatedCount = 0;

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      // 2 PER BENCH LOGIC: Skip every 2nd seat in a set of 3 (indices 1, 4, 7...)
      if (isTwoPerBench && c % 3 === 1) {
        continue; 
      }

      // PATTERN LOGIC: (A B A) -> (B A B)
      // We shift the starting branch based on startBranchOffset (Hall Index)
      // The seat index 'c' determines rotation within the bench.
      // We essentially want sequential rotation: Branch 0, Branch 1, Branch 2...
      // But we must map 'c' to a continuous logical index because of skipped seats.
      
      let logicalColIndex = c;
      if (isTwoPerBench) {
        // Map 0->0, 2->1, 3->2, 5->3 ... to keep branch rotation smooth
        logicalColIndex = c - Math.floor(c / 3); 
      }

      const branchIndex = (logicalColIndex + startBranchOffset) % order.length;
      let allocated = false;

      // Try preferred branch first, then cycle others if empty
      for (let k = 0; k < order.length; k++) {
        const keyIdx = (branchIndex + k) % order.length;
        const key = order[keyIdx];

        if (pointers[key] < groups[key].length) {
          seats[r][c] = groups[key][pointers[key]++];
          allocated = true;
          allocatedCount++;
          break;
        }
      }
    }
  }
  return { seats, count: allocatedCount };
}

/* ================================
   RANDOMIZATION (INTRA-BRANCH)
================================ */
// "Select position of students from same branch then interchange randomly"
function randomizeSeatsByBranch(seats, rollToBranch) {
  const R = seats.length;
  const C = seats[0].length;
  const branchBuckets = {};

  // 1. Collect all students grouped by branch
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const roll = seats[r][c];
      if (roll) {
        const branch = rollToBranch[roll];
        if (!branchBuckets[branch]) branchBuckets[branch] = [];
        branchBuckets[branch].push({ r, c, roll });
      }
    }
  }

  // 2. Shuffle each bucket and put back into the specific slots for that branch
  Object.keys(branchBuckets).forEach(branch => {
    const bucket = branchBuckets[branch];
    const rolls = bucket.map(item => item.roll);
    shuffleArray(rolls); // Shuffle just the students

    bucket.forEach((pos, index) => {
      seats[pos.r][pos.c] = rolls[index];
    });
  });

  return seats;
}

/* ================================
   EVALUATION & OPTIMIZATION
================================ */
// "Check whether no two students from same batch sit together... overcome it"
function solveAdjacencyConstraints(arr, rollToBranch) {
  const R = arr.length;
  const C = arr[0].length;
  let fixed = false;

  // Simple pass: if A A detected, try to swap the second A with a B from below
  for (let pass = 0; pass < 50; pass++) { // Limit passes to prevent infinite loops
    fixed = true; // Assume fixed unless we find a problem
    
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C - 1; c++) {
        const a = arr[r][c];
        const b = arr[r][c + 1]; // Check horizontal neighbor

        // Skip empty seats or gaps (like in 2-per-bench)
        if (!a || !b) continue;

        if (rollToBranch[a] === rollToBranch[b]) {
          fixed = false;
          // Conflict found! Look for a swap candidate down the hall
          let swapped = false;
          
          searchLoop:
          for (let i = r; i < R; i++) {
            for (let j = 0; j < C; j++) {
              const candidate = arr[i][j];
              // Candidate must exist, have diff branch than A, and not create new conflict if moved to [r][c+1]
              if (candidate && rollToBranch[candidate] !== rollToBranch[a]) {
                 // Simple swap
                 arr[r][c+1] = candidate;
                 arr[i][j] = b;
                 swapped = true;
                 break searchLoop;
              }
            }
          }
          
          if (!swapped) {
            // Could not fix this specific conflict (hall might be dominated by one branch)
          }
        }
      }
    }
    
    if (fixed) break;
  }
  return arr;
}

/* ================================
   MAIN PROCESS
================================ */
function generateSeatingPlan(halls, groups, rollToBranch) {
  const order = Object.keys(groups);
  let pointers = {};
  order.forEach(k => pointers[k] = 0);

  const hallAllocations = [];
  // FIXED: Changed g.rolls.length to g.length because 'groups' values are simple arrays
  const totalStudents = Object.values(groups).reduce((acc, g) => acc + g.length, 0);
  
  // 1. INITIAL CHECK: Can we fit everyone using 2 per bench?
  const capacity2PerBench = calculateTotalCapacity(halls, true);
  const globalUseTwoPerBench = totalStudents <= capacity2PerBench;

  console.log(`Total Students: ${totalStudents}, Cap(2/bench): ${capacity2PerBench}. Global Mode: ${globalUseTwoPerBench ? '2/bench' : '3/bench'}`);

  halls.forEach((hall, index) => {
    let localUseTwoPerBench = globalUseTwoPerBench;
    
    // 2. PATTERN: Alternating start branch (A B A -> B A B)
    const startOffset = index; 

    // Make a copy of pointers to try allocation
    let tempPointers = { ...pointers };

    // 3. OPTIMIZATION: "Partially filled hall" check
    // If we are forced to 3/bench globally, check if THIS hall can fit remaining allocated students with 2/bench
    if (!globalUseTwoPerBench) {
        // Run a simulation with 2 per bench
        const simRes = allocateHall(hall, groups, { ...pointers }, order, startOffset, true);
        // Calculate how many students would arguably be assigned here if we used 3/bench
        // Actually, easiest way is: Allocate 3/bench first. Check count. 
        // If count <= capacity(2/bench), redo as 2/bench.
        
        // Let's try allocating with 3 per bench (Standard)
        const res3 = allocateHall(hall, groups, { ...pointers }, order, startOffset, false);
        const capacity2 = getHallCapacity(hall, true);
        
        if (res3.count <= capacity2) {
             console.log(`Optimization: Hall ${hall.HallName} downgraded to 2/bench for comfort.`);
             localUseTwoPerBench = true;
        }
    }

    // 4. ACTUAL ALLOCATION
    let result = allocateHall(hall, groups, pointers, order, startOffset, localUseTwoPerBench);
    let seats = result.seats;

    // 5. RANDOMIZATION: "Interchange position of students from same branch"
    seats = randomizeSeatsByBranch(seats, rollToBranch);

    // 6. EVALUATION: "Check whether no two students from same batch sit together"
    seats = solveAdjacencyConstraints(seats, rollToBranch);

    hallAllocations.push({
      hallName: hall.HallName,
      allocation: convertSeatingToFirestoreFormat(hall, seats),
      maxBench: localUseTwoPerBench ? 2 : 3 // Meta info
    });
  });

  return hallAllocations;
}

function convertSeatingToFirestoreFormat(hall, seats) {
  // Need to reconstruct rollToStudentInfo? No, we do it in route handler. 
  // Wait, this function is just helper. The mapping happens in main handler usually.
  // Refactoring to return raw seats here, and map in route.
  return seats; 
}

/* ================================
   SAVE TO FIRESTORE
================================ */
async function saveAllocationToFirestore(hallAllocations, metadata, name, sem,type,examDate,mode) {
  const docRef = db.collection("examAllocations").doc();
  
  const firestoreData = {
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    halls: {},
    meta: metadata,
    name: name,
    sems: sem,
    isElective:type==='Normal'?false:true,
    examDate:examDate,
    mode:mode,
    isPublished:false
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
router.post("/", upload.fields([{ name: "students" }, { name: "halls" }]), async (req, res) => {
  try {
    const students = excelToCsv(fs.readFileSync(req.files.students[0].path, "utf8"));
    const halls = shuffleArray(excelToCsv(fs.readFileSync(req.files.halls[0].path, "utf8")));

    const groups = groupStudents(students);
    const rollToBranch = buildRollToBranch(students);
    const rollToStudentInfo = buildRollToStudentInfo(students);

    // Generate Layouts
    const rawAllocations = generateSeatingPlan(halls, groups, rollToBranch);

    // Convert to Firestore Format
    const finalAllocations = rawAllocations.map(item => {
      const hallObj = halls.find(h => h.HallName === item.hallName);
      return {
        hallName: item.hallName,
        allocation: formatForFirestore(hallObj, item.allocation, rollToStudentInfo),
        maxBench: item.maxBench
      };
    });

    // Metadata
    const metadata = {
      totalStudents: students.length,
      totalHalls: halls.length,
      studentsPerBench: finalAllocations[0]?.maxBench || 0
    };

    const docId = await saveAllocationToFirestore(finalAllocations, metadata, req.body.examName, req.body.years,req.body.type,req.body.examDate,req.body.mode);

    res.json({ success: true, documentId: docId });

    fs.unlinkSync(req.files.students[0].path);
    fs.unlinkSync(req.files.halls[0].path);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function formatForFirestore(hall, seats, rollToInfo) {
  const hallData = { rows: Number(hall.Rows), columns: Number(hall.Columns) };
  let seatNum = 1;

  seats.forEach((row, rIdx) => {
    const rowArr = [];
    row.forEach((roll, cIdx) => {
      if (roll) {
        const info = rollToInfo[roll] || {};
        rowArr.push({
          roll, 
          name: info.name, 
          batch: info.batch, 
          year: info.year, 
          hall: hall.HallName,
          row: rIdx + 1,
          bench: cIdx + 1,
          seat: seatNum
        });
        seatNum++;
      }
    });
    hallData[`row${rIdx}`] = rowArr;
  });
  return hallData;
}

module.exports = router;