
function allocateColumnWiseAB(students, hallsData) {
  const A = students.filter((s) => s.year === "A");
  const B = students.filter((s) => s.year === "B");

  let aIndex = 0;
  let bIndex = 0;

  const allocation = {};

  hallsData.forEach((hall, hallIndex) => {
    const rows = Number(hall.Rows);
    const columns = Number(hall.Columns);
    const type = hall.Type || "Bench"; // Default to Bench if undefined

    // Initialize matrix with nulls
    const matrix = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => null)
    );

    // Determine the starting pattern based on hall index and type
    // implementation based on user request:
    // Bench:
    // Room 1 (Index 0): A B A A B A ...
    // Room 2 (Index 1): B A B B A B ...
    
    // Chair:
    // Room 1 (Index 0): A B A B ...
    // Room 2 (Index 1): B A B A ...

    // We need to fill COLUMN-WISE (Back to Back)
    // Means fill Col 0 (Row 0 to N), then Col 1 (Row 0 to N)...

    for (let col = 0; col < columns; col++) {
      for (let row = 0; row < rows; row++) {
        let student = null;

        // Determine which year should be placed here
        // This depends on the pattern
        
        // Let's create a visual pattern generator for the specific cell
        
        let targetYear = null;

        if (type === "Bench") {
            // Bench Pattern 
            // 3 seats per bench usually, but here user said:
            // "A B A A B A A B A" -> This looks like a sequence of 3: A B A, A B A ...
            // Wait, looking closer at user request:
            // "A B A A B A A B A"
            // This is a 1D sequence. 
            // User says "A and B are two years there in the hall csv file there is marked as whether the hall contains chair of bench"
            
            // User example for BENCH:
            // First room:
            // A B A A B A A B A
            // A B A A B A A B A
            // ...
            
            // Wait, this looks like the ROW pattern?
            // "Note one thing that place the student back by back first fill first column completely then only move to second"
            
            // So if I fill column 0:
            // Row 0: A
            // Row 1: A
            // Row 2: A
            // ...
            // This would match the visual "A B A..." if printed row by row?
            // "A B A A B A A B A" -> Is this Row 0? 
            // If Row 0 is "A B A A B A A B A", then Col 0 is A, Col 1 is B, Col 2 is A...
            
            // Let's re-read carefully: "place the students like this" ... "for first room"
            // A B A A B A A B A
            // A B A A B A A B A
            
            // This implies:
            // Col 0: A A A A ...
            // Col 1: B B B B ...
            // Col 2: A A A A ...
            // Col 3: A A A A ...
            // Col 4: B B B B ...
            // Col 5: A A A A ...
            
            // Pattern for Bench seems to be repeating block of 3 columns: A B A
            // Col 0: A
            // Col 1: B
            // Col 2: A
            // Col 3: A (Start of next block)
            // Col 4: B
            // Col 5: A
            
            // For NEXT room (Bench):
            // B A B B A B B A B
            // This is block: B A B

            // So for Bench:
            // Room Index Even (0, 2...): Pattern A B A
            // Room Index Odd (1, 3...): Pattern B A B
            
            // Determine pattern for this column
            const patternIndex = col % 3; // 0, 1, 2
            
            if (hallIndex % 2 === 0) {
                // Room 1 (Index 0) -> A B A
                if (patternIndex === 0) targetYear = "A"; // A
                else if (patternIndex === 1) targetYear = "B"; // B
                else targetYear = "A"; // A
            } else {
                // Room 2 (Index 1) -> B A B
                if (patternIndex === 0) targetYear = "B"; // B
                else if (patternIndex === 1) targetYear = "A"; // A
                else targetYear = "B"; // B
            }

        } else {
            // Chair Pattern (assuming "Chair" or anything else)
            // First Hall:
            // A B A B A B ...
            // Pattern: A B
            
            // Next Hall:
            // B A B A B A ...
            // Pattern: B A
            
             const patternIndex = col % 2; // 0, 1
             
             if (hallIndex % 2 === 0) {
                 // Room 1 -> A B
                 targetYear = patternIndex === 0 ? "A" : "B";
             } else {
                 // Room 2 -> B A
                 targetYear = patternIndex === 0 ? "B" : "A";
             }
        }
        
        // Now try to fetch a student of targetYear
        if (targetYear === "A") {
            if (aIndex < A.length) {
                student = A[aIndex++];
            } else if (bIndex < B.length) {
                // Fallback? usually strict but let's see. 
                // User didn't specify fallback behavior, assuming strict for now or fill with other?
                // The prompt says "place the students like this", implying a strict pattern.
                // But usually we want to fill the hall.
                // Let's stick to the pattern primarily. if empty, maybe leave empty?
                // Or maybe fill with the other specific year?
                // Existing code had fallback. 
                // Let's assume strict pattern for now to match the visual. 
                // If A is exhausted, we can't place A.
                // But maybe we should place B if A is done? 
                // "Note one thing that place the student back by back first fill first column completely then only move to second"
                // The user logic is about the PATTERN of allocation.
                
                // Let's try to stick to pattern.
            }
        } else {
             if (bIndex < B.length) {
                student = B[bIndex++];
            }
        }
        
        // If we found a student (or not), place in matrix
        // Note: The previous code was row-major for matrix construction but column-wise logic.
        // matrix[row][col] is standard.
        matrix[row][col] = student;
      }
    }

    allocation[hall.Name] = matrix;
  });

  return allocation;
}

// Mock Data
const students = [];
for(let i=0; i<60; i++) students.push({year: "A", id: i, name: `A${i}`});
for(let i=0; i<60; i++) students.push({year: "B", id: i, name: `B${i}`});

const halls = [
    { Name: "Hall 1", Rows: 4, Columns: 9, Type: "Bench" },
    { Name: "Hall 2", Rows: 4, Columns: 9, Type: "Bench" },
    { Name: "Hall 3", Rows: 4, Columns: 8, Type: "Chair" },
    { Name: "Hall 4", Rows: 4, Columns: 8, Type: "Chair" }
];

const result = allocateColumnWiseAB(students, halls);

// Print Helper
function printHall(name, matrix) {
    console.log(`\n--- ${name} ---`);
    for(let r=0; r<matrix.length; r++) {
        let rowStr = "";
        for(let c=0; c<matrix[r].length; c++) {
            const s = matrix[r][c];
            rowStr += (s ? s.year : "_") + " ";
        }
        console.log(rowStr);
    }
}

Object.keys(result).forEach(k => printHall(k, result[k]));
