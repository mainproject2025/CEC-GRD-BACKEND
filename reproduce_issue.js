const fs = require('fs');

// --- Mock Data ---

// Failure Case: Many small batches that get exhausted but prevent other batches from filling the room
function createStudents() {
    let students = [];
    const batches = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    // 10 batches, 2 students each = 20 students.
    // Hall 1 has 5x5 = 25 seats.
    // maxBatchesPerHall = ceil(10/2) = 5.
    // Selected: A, B, C, D, E.
    // A,B,C,D,E fill 2 seats each = 10 seats filled.
    // Remaining 15 seats empty.
    // Batches F, G, H, I, J (10 students) are NOT selected.
    // Result: 10/20 allocated. 10 missing.

    batches.forEach((batch) => {
        for (let i = 1; i <= 2; i++) {
            students.push({
                RollNumber: `${batch}${i.toString().padStart(3, '0')}`,
                Batch: batch,
                StudentName: `Student ${batch}${i}`
            });
        }
    });
    return students;
}

const rooms = {
    "Hall-1": { row: 5, cols: 5 } // 25 seats
};


// --- Copy-pasted Logic from singleCommon.js (simplified for reproduction) ---

function getSortedStudents(students) {
    return students.sort((a, b) => {
        const batchA = (a.Batch || "").trim();
        const batchB = (b.Batch || "").trim();
        if (batchA < batchB) return -1;
        if (batchA > batchB) return 1;
        return (a.RollNumber || "").localeCompare(b.RollNumber || "");
    });
}

function groupByBatch(data) {
    const batchMap = {};
    data = getSortedStudents(data);
    data.forEach(student => {
        student.batch = student.Batch;
        if (!batchMap[student.batch]) batchMap[student.batch] = [];
        batchMap[student.batch].push(student);
    });
    return batchMap;
}

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

function getLastActiveRoom(allocation) {
    let roomNames = Object.keys(allocation);
    let lastActive = null;
    for (let roomName of roomNames) {
        let matrix = allocation[roomName];
        let hasStudent = matrix.some(row => row.some(seat => seat !== null));
        if (hasStudent) lastActive = roomName;
    }
    return lastActive;
}

function allocateSmartColumnWise(data, rooms) {
    const batchMap = groupByBatch(data);
    let allocation = {};

    const totalBatches = Object.keys(batchMap).length;
    const maxBatchesPerHall = Math.max(2, Math.ceil(totalBatches / 2));
    console.log(`Max Batches per Hall: ${maxBatchesPerHall}`);

    for (let [roomName, roomInfo] of Object.entries(rooms)) {
        const { row, cols } = roomInfo;
        let matrix = Array.from({ length: row }, () => Array.from({ length: cols }, () => null));

        // logic here
        let selectedBatches = getTopNBatches(batchMap, maxBatchesPerHall);
        console.log(`Selected Batches for ${roomName}:`, selectedBatches);

        for (let c = 0; c < cols; c++) {
            let batch = getHighestFromSelected(batchMap, selectedBatches);

            // FIX PROPOSED: If no batch from selected, try ANY OTHER BATCH?
            // Currently mimicking BROKEN behavior:
            if (!batch) {
                console.log(`Column ${c}: No batch selected from limited set. Stopping.`);
                break;
            }

            for (let r = 0; r < row; r++) {
                if (batchMap[batch] && batchMap[batch].length > 0) {
                    matrix[r][c] = batchMap[batch].shift();
                }
            }
        }
        allocation[roomName] = matrix;
    }

    return allocation;
}

function rebalanceAllocation(allocation) {
    let roomNames = Object.keys(allocation);
    let lastRoomName = getLastActiveRoom(allocation);
    if (!lastRoomName) return allocation;

    let lastRoom = allocation[lastRoomName];
    let unplaced = [];

    let emptySeats = findEmptySeats(lastRoom);
    let totalSeats = lastRoom.length * lastRoom[0].length;

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
        return allocation;
    }

    for (let roomName of roomNames) {
        if (roomName === lastRoomName) continue;
        if (unplaced.length === 0) break;
        let room = allocation[roomName];
        let seats = findEmptySeats(room);
        for (let seat of seats) {
            if (unplaced.length === 0) break;
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

    return allocation;
}

// --- Main Execution ---

const students = createStudents();
const totalStudents = students.length;
console.log(`Total Students: ${totalStudents}`);

const allocation = allocateSmartColumnWise([...students], rooms);
const finalAllocation = rebalanceAllocation(allocation);

// Count Allocated
let allocatedCount = 0;
let allocatedRolls = new Set();

Object.entries(finalAllocation).forEach(([roomName, matrix]) => {
    matrix.forEach(row => {
        row.forEach(seat => {
            if (seat) {
                allocatedCount++;
                allocatedRolls.add(seat.RollNumber);
            }
        });
    });
});

console.log(`Allocated Students: ${allocatedCount}`);
console.log(`Missing Students: ${totalStudents - allocatedCount}`);

const allRolls = new Set(students.map(s => s.RollNumber));
const missing = [...allRolls].filter(x => !allocatedRolls.has(x));

if (missing.length > 0) {
    console.log("Missing Roll Numbers:");
    console.log(missing);
} else {
    console.log("All students allocated successfully.");
}
