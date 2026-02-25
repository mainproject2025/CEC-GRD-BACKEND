
/* ================================
   SORT STUDENTS (Batch -> Branch -> Roll)
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
    }).map(s => s.RollNumber);
}

function buildRollToBranch(students) {
    const map = {};
    students.forEach(s => map[s.RollNumber] = s.Branch);
    return map;
}

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
function generateSeatingPlan(halls, allStudents, rollToBranch) {

    const results = [];
    let studentIndex = 0;
    const totalStudents = allStudents.length;

    const cap2 = calculateTotalCapacity(halls, true);
    const globalTwo = totalStudents <= cap2;

    console.log("Students:", totalStudents);
    console.log("2 Bench Cap:", cap2);
    console.log("Mode:", globalTwo ? "2" : "3");

    /* ---------- ALLOCATION ---------- */

    halls.forEach((hall) => {
        const rows = Number(hall.Rows);
        const columns = Number(hall.Columns);

        const seats = Array.from({ length: rows }, () => Array(columns).fill(""));

        // Column-wise filling
        for (let c = 0; c < columns; c++) {

            // If in 2-seater mode (globalTwo), skip the middle seat of a 3-seater bench (index 1, 4, 7...)
            if (globalTwo && c % 3 === 1) continue;

            for (let r = 0; r < rows; r++) {

                if (studentIndex < totalStudents) {
                    seats[r][c] = allStudents[studentIndex++];
                }

            }
        }

        /* ---------- PRINT ---------- */

        printHallAllocation(
            hall.HallName,
            seats,
            rollToBranch
        );

        results.push({
            hallName: hall.HallName,
            allocation: seats,
            maxBench: globalTwo ? 2 : 3
        });
    });

    return results;
}

// ==========================================
// TEST DATA
// ==========================================

const students = [
    { RollNumber: "CS01", Branch: "CS", Batch: "A" },
    { RollNumber: "CS02", Branch: "CS", Batch: "A" },
    { RollNumber: "CS03", Branch: "CS", Batch: "A" },
    { RollNumber: "CS04", Branch: "CS", Batch: "B" }, // Diff Batch
    { RollNumber: "EC01", Branch: "EC", Batch: "A" },
    { RollNumber: "EC02", Branch: "EC", Batch: "A" },
    { RollNumber: "ME01", Branch: "ME", Batch: "A" },
    { RollNumber: "ME02", Branch: "ME", Batch: "B" },
];

const halls = [
    { HallName: "H1", Rows: 3, Columns: 3, Type: "Bench" }
];

console.log("Input Students:", students);

const sorted = getSortedStudents(students);
console.log("Sorted Rolls:", sorted);
// Expect: CS01, CS02, CS03, EC01, EC02, ME01 (Batch A) -> CS04, ME02 (Batch B)

const rollToBranch = buildRollToBranch(students);

generateSeatingPlan(halls, sorted, rollToBranch);

