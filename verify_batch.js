
function getSortedStudents(students) {
    // We need to group them, not just sort them into a single list
    const groups = {};
    students.forEach(s => {
        const batch = (s.Batch || "Unknown").trim();
        if (!groups[batch]) groups[batch] = [];
        groups[batch].push(s);
    });

    // Sort inside groups for consistency (e.g. by Branch then Roll)
    Object.keys(groups).forEach(b => {
        groups[b].sort((a, b) => (a.RollNumber || "").localeCompare(b.RollNumber || ""));
    });

    return groups;
}

function generateSeatingPlan(halls, students) {
    const groups = getSortedStudents(students);
    const batches = Object.keys(groups).sort(); // ["A", "B"]

    // Pointers for each batch
    const pointers = {};
    batches.forEach(b => pointers[b] = 0);

    const results = [];

    halls.forEach((hall, hallIndex) => {
        const rows = hall.Rows;
        const columns = hall.Columns;
        const matrix = Array.from({ length: rows }, () => Array(columns).fill(null));

        // Start Offset for this hall (to rotate patterns? or strict A B A B?)
        // "A B A B format" typically implies strict alternation.
        // Let's assume strict Alternation starting from Batch A for Col 0?
        // Or should it continue from where we left off? 
        // Usually exam halls want simple static patterns like "Odd Cols A, Even Cols B".
        // Let's stick to Hall 0 starts with Batch[0]. Hall 1 starts with... Batch[1]?
        // "Next Hall" rotation is good for fairness/distribution.

        const startBatchIndex = hallIndex % batches.length;

        for (let c = 0; c < columns; c++) {

            // Determine Batch for this column
            const batchIndex = (startBatchIndex + c) % batches.length;
            const currentBatch = batches[batchIndex];

            for (let r = 0; r < rows; r++) {
                // Fill straight down
                if (pointers[currentBatch] < groups[currentBatch].length) {
                    matrix[r][c] = groups[currentBatch][pointers[currentBatch]++];
                }
            }
        }

        results.push({ name: hall.Name, matrix });
    });

    return results;
}

// TEST
const students = [
    { RollNumber: "A1", Batch: "A" }, { RollNumber: "A2", Batch: "A" }, { RollNumber: "A3", Batch: "A" }, { RollNumber: "A4", Batch: "A" },
    { RollNumber: "B1", Batch: "B" }, { RollNumber: "B2", Batch: "B" }, { RollNumber: "B3", Batch: "B" }, { RollNumber: "B4", Batch: "B" },
];

const halls = [{ Name: "H1", Rows: 2, Columns: 4 }];

const res = generateSeatingPlan(halls, students);

res.forEach(h => {
    console.log("Hall:", h.name);
    h.matrix.forEach(row => {
        console.log(row.map(s => s ? s.RollNumber + "(" + s.Batch + ")" : "---").join("\t"));
    });
});
