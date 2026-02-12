
function allocateColumnWiseInterleaved(students, hallsData, groupByField) {

    // Group students
    const groups = {};
    students.forEach(s => {
        const key = s[groupByField];
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
    });

    const keys = Object.keys(groups);

    // Interleave into a single queue
    const queue = [];
    let maxLen = 0;
    keys.forEach(k => maxLen = Math.max(maxLen, groups[k].length));

    for (let i = 0; i < maxLen; i++) {
        keys.forEach(k => {
            if (i < groups[k].length) {
                queue.push(groups[k][i]);
            }
        });
    }

    let qIndex = 0;
    const allocation = {};

    hallsData.forEach((hall, hallIndex) => {

        const rows = Number(hall.Rows);
        const columns = Number(hall.Columns);
        const rawType = hall.Type || "Bench";
        const type = rawType.toLowerCase().includes("chair") ? "Chair" : "Bench";

        const matrix = Array.from({ length: rows }, () =>
            Array.from({ length: columns }, () => null)
        );

        // Determine start offset for this hall to rotate starting branch/subject
        // Hall 0 starts with key[0]
        // Hall 1 starts with key[1]
        // ...
        // Note: The global queue is already interleaved.
        // If we just pull from queue, we automatically get diversity.
        // BUT the user wanted "Next Hall" to have a shifted pattern "B A B..." vs "A B A...".
        // If queue is A B C A B C...
        // Hall 1 (9 seats): A B C A B C A B C. 
        // Next student in queue is A. 
        // Hall 2 (9 seats): A B C ... 
        // This naturally follows the queue order.
        // HOWEVER, the "A B A" vs "B A B" logic implied a specific spatial arrangement, not just queue order.
        // "A B A A B A..." -> Cols 0,1,2 are A,B,A.
        // If we just use the queue:
        // Col 0 (Row 0..N): A B C D ... (Vertical striping?)
        // User request: "A B A A B A..." -> This is Row-wise string?
        // "place the students like this... for first room A B A A B A..."
        // My previous interpretation (verified): 
        // Col 0: A...
        // Col 1: B...
        // Col 2: A...

        // So for Single Exam, we should probably maintain this "Column Identity".
        // Col 0 should be "Branch A".
        // Col 1 should be "Branch B".
        // Col 2 should be "Branch C" (or A if only 2).

        // If we have 3 branches: A, B, C.
        // Hall 0:
        // Col 0: A
        // Col 1: B
        // Col 2: C
        // Col 3: A
        // ...

        // Hall 1:
        // Col 0: B (Shifted)
        // Col 1: C
        // Col 2: A
        // ...

        // This requires independent pointers for each group, NOT a single interleaved queue.

        // Let's use independent pointers.
        const groupPointers = {};
        keys.forEach(k => groupPointers[k] = 0);

        let globalPointer = 0; // Fallback if regular pointers fail? No.

        // Calculate Hall Offset for pattern rotation
        const startObjIndex = hallIndex % keys.length;

        // Column-wise filling
        for (let col = 0; col < columns; col++) {

            // Determine which Group (Branch/Subject) this column belongs to
            // Based on pattern

            let groupIndex = (startObjIndex + col) % keys.length;

            // If "Bench" type (3 seats pattern), maybe we want A B A?
            // If Keys = [A, B].
            // Col 0: A
            // Col 1: B
            // Col 2: A (Wrap around 2 -> 0) matches A B A.

            // If Keys = [A, B, C].
            // Col 0: A
            // Col 1: B
            // Col 2: C 
            // This seems fair.

            for (let row = 0; row < rows; row++) {

                // Try to get student from current groupIndex
                let placed = false;
                let attempts = 0;

                // If the primary group is empty, do we skip or fill with next?
                // User: "place based on branch".
                // Previous logic was stricter.
                // Let's try to stick to pattern. If empty, maybe try next group?
                // If we want "Back to Back" fill, we must fill the seat.
                // But "A B A" implies specific assignment.
                // I will loop through keys starting from groupIndex to find a student.

                let currentKeyIndex = groupIndex;

                while (attempts < keys.length) {
                    const k = keys[currentKeyIndex];
                    if (groupPointers[k] < groups[k].length) {
                        matrix[row][col] = groups[k][groupPointers[k]++];
                        placed = true;
                        break;
                    }
                    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
                    attempts++;
                }
            }
        }

        allocation[hall.Name] = matrix;
    });

    return allocation;
}

// Mock Data
const students = [];
const branches = ["CS", "EC", "ME"];
branches.forEach(b => {
    for (let i = 0; i < 30; i++) students.push({ Branch: b, Id: i, Name: `${b}${i}` });
});

const halls = [
    { Name: "Hall 1", Rows: 4, Columns: 6, Type: "Bench" },
    { Name: "Hall 2", Rows: 4, Columns: 6, Type: "Bench" },
];

const result = allocateColumnWiseInterleaved(students, halls, "Branch");

function printHall(name, matrix) {
    console.log(`\n--- ${name} ---`);
    for (let r = 0; r < matrix.length; r++) {
        let rowStr = "";
        for (let c = 0; c < matrix[r].length; c++) {
            const s = matrix[r][c];
            rowStr += (s ? s.Branch : "__") + " ";
        }
        console.log(rowStr);
    }
}

Object.keys(result).forEach(k => printHall(k, result[k]));
