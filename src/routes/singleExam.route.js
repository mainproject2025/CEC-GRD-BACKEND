const path = require("path");
const multer = require("multer");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const archiver = require("archiver");
const express = require("express");

const router = express.Router();

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
const upload = multer({ dest: "uploads/" });

/* ================================
   CONFIG & CONSTANTS
================================ */
const CONFIG = {
  PAGE: { width: 595.28, height: 841.89, margin: 40 },
  CELL_HEIGHT: 30,
  FONT_SIZE_HEADER: 16,
  FONT_SIZE_TEXT: 9,
  OPTIMIZATION_CYCLES: 25000,
};

const SUBJECT_COLORS = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
  "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#fabebe",
  "#008080", "#e6beff", "#9a6324", "#fffac8", "#800000",
  "#aaffc3", "#808000", "#ffd8b1", "#000075", "#808080"
];

/* ================================
   UTILITIES
================================ */
function robustCSVParser(csvData) {
  const lines = csvData.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ''));
  const reValid = /^\s*(?:'[^']*'|"[^"]*"|[^,'"]*)\s*(?:,\s*(?:'[^']*'|"[^"]*"|[^,'"]*)\s*)*$/;
  const reValue = /(?!\s*$)\s*(?:'([^']*)'|"([^"]*)"|([^,'"]*))\s*(?:,|$)/g;
  return lines.slice(1).map(line => {
    if (!reValid.test(line)) return null;
    const row = {};
    let match, i = 0;
    reValue.lastIndex = 0;
    while ((match = reValue.exec(line)) && i < headers.length) {
      row[headers[i]] = (match[1] || match[2] || match[3] || "").trim();
      i++;
    }
    return row;
  }).filter(Boolean);
}

const cleanupFiles = (files) => {
  files.forEach(f => {
    if (f && fs.existsSync(f)) fs.unlink(f, (err) => {
      if (err) console.error(`Cleanup failed for ${f}:`, err);
    });
  });
};

/* ================================
   STAGE 1: ALLOCATION
================================ */
function stage1_DistributeToHalls(halls, studentsRaw) {
  const subjectGroups = {};
  studentsRaw.forEach(s => {
    const sub = s['Subject'] || s['Code'] || s['Branch'] || "Unknown";
    if (!subjectGroups[sub]) subjectGroups[sub] = [];
    subjectGroups[sub].push(s);
  });

  const sortedSubjects = Object.keys(subjectGroups)
    .sort((a, b) => subjectGroups[b].length - subjectGroups[a].length);

  const hallBuckets = halls.map(h => ({
    details: h,
    capacity: parseInt(h.Rows || h.rows) * parseInt(h.Columns || h.cols),
    assigned: [],
    assignedSubjects: new Set()
  }));

  // Optimization: Sort halls descending by capacity
  hallBuckets.sort((a, b) => b.capacity - a.capacity);

  let activeSub1 = sortedSubjects.shift();
  let activeSub2 = sortedSubjects.shift();

  for (const bucket of hallBuckets) {
    while (bucket.assigned.length < bucket.capacity) {
      if (!activeSub1 && sortedSubjects.length > 0) activeSub1 = sortedSubjects.shift();
      if (!activeSub2 && sortedSubjects.length > 0) activeSub2 = sortedSubjects.shift();
      if (!activeSub1 && !activeSub2) break;

      let targetSubject = null;
      const count1 = activeSub1 ? bucket.assigned.filter(s => s.subject === activeSub1).length : Infinity;
      const count2 = activeSub2 ? bucket.assigned.filter(s => s.subject === activeSub2).length : Infinity;

      if (activeSub1 && activeSub2) {
        targetSubject = (count1 <= count2) ? activeSub1 : activeSub2;
      } else {
        targetSubject = activeSub1 || activeSub2;
      }

      if (targetSubject && subjectGroups[targetSubject].length > 0) {
        const student = subjectGroups[targetSubject].shift();
        bucket.assigned.push({ ...student, subject: targetSubject });
        bucket.assignedSubjects.add(targetSubject);

        if (subjectGroups[targetSubject].length === 0) {
          if (targetSubject === activeSub1) activeSub1 = null;
          else activeSub2 = null;
        }
      } else {
         if (targetSubject === activeSub1) activeSub1 = null;
         else activeSub2 = null;
      }
    }
  }
  return hallBuckets;
}

/* ================================
   STAGE 2: RANDOMIZATION
================================ */
function stage2_Randomize(hallBuckets) {
  hallBuckets.forEach(bucket => {
    for (let i = bucket.assigned.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bucket.assigned[i], bucket.assigned[j]] = [bucket.assigned[j], bucket.assigned[i]];
    }
  });
  return hallBuckets;
}

/* ================================
   STAGE 3: OPTIMIZATION
================================ */
function countConflicts(grid, r, c, rows, cols) {
  const currentSub = grid[r][c]?.subject;
  if (!currentSub) return 0;
  let conflicts = 0;
  const neighbors = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  neighbors.forEach(([dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
      if (grid[nr][nc]?.subject === currentSub) conflicts++;
    }
  });
  return conflicts;
}

function calculateTotalConflicts(grid, rows, cols) {
  let total = 0;
  for(let r=0; r<rows; r++) {
    for(let c=0; c<cols; c++) {
       const current = grid[r][c];
       if(!current) continue;
       if(c + 1 < cols && grid[r][c+1] && grid[r][c+1].subject === current.subject) total++;
       if(r + 1 < rows && grid[r+1][c] && grid[r+1][c].subject === current.subject) total++;
    }
  }
  return total;
}

function stage3_OptimizeSeating(hallBucket) {
  const rows = parseInt(hallBucket.details.Rows || hallBucket.details.rows);
  const cols = parseInt(hallBucket.details.Columns || hallBucket.details.cols);
  
  const subjectQueues = {};
  hallBucket.assigned.forEach(s => {
    if(!subjectQueues[s.subject]) subjectQueues[s.subject] = [];
    subjectQueues[s.subject].push(s);
  });

  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const forbiddenSubjects = new Set();
      if (r > 0 && grid[r-1][c]) forbiddenSubjects.add(grid[r-1][c].subject);
      if (c > 0 && grid[r][c-1]) forbiddenSubjects.add(grid[r][c-1].subject);

      const candidateSubjects = Object.keys(subjectQueues)
        .filter(sub => subjectQueues[sub].length > 0)
        .sort((a, b) => subjectQueues[b].length - subjectQueues[a].length);

      if (candidateSubjects.length === 0) break; 
      let chosenSubject = candidateSubjects.find(sub => !forbiddenSubjects.has(sub));
      if (!chosenSubject) chosenSubject = candidateSubjects[0];
      grid[r][c] = subjectQueues[chosenSubject].shift();
    }
  }

  let currentTotalConflicts = calculateTotalConflicts(grid, rows, cols);
  for (let i = 0; i < CONFIG.OPTIMIZATION_CYCLES; i++) {
    if (currentTotalConflicts === 0) break; 
    const r1 = Math.floor(Math.random() * rows);
    const c1 = Math.floor(Math.random() * cols);
    const r2 = Math.floor(Math.random() * rows);
    const c2 = Math.floor(Math.random() * cols);
    if (r1 === r2 && c1 === c2) continue;

    const preLocal = countConflicts(grid, r1, c1, rows, cols) + countConflicts(grid, r2, c2, rows, cols);
    const temp = grid[r1][c1];
    grid[r1][c1] = grid[r2][c2];
    grid[r2][c2] = temp;
    const postLocal = countConflicts(grid, r1, c1, rows, cols) + countConflicts(grid, r2, c2, rows, cols);

    if (postLocal > preLocal) {
      const revert = grid[r1][c1];
      grid[r1][c1] = grid[r2][c2];
      grid[r2][c2] = revert;
    } else {
      currentTotalConflicts += (postLocal - preLocal);
      if (i % 100 === 0) currentTotalConflicts = calculateTotalConflicts(grid, rows, cols);
    }
  }
  return grid;
}

/* ================================
   STAGE 4: EVALUATION
================================ */
function stage4_Evaluate(grid) {
  let totalConflicts = 0;
  let filledSeats = 0;
  const rows = grid.length;
  const cols = grid[0].length;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c]) {
        filledSeats++;
        const right = (c + 1 < cols) ? grid[r][c+1] : null;
        const bottom = (r + 1 < rows) ? grid[r+1][c] : null;
        
        if (right && right.subject === grid[r][c].subject) totalConflicts++;
        if (bottom && bottom.subject === grid[r][c].subject) totalConflicts++;
        
        if (countConflicts(grid, r, c, rows, cols) > 0) {
            grid[r][c].conflict = true;
        }
      }
    }
  }
  return { totalConflicts, filledSeats };
}

/* ================================
   PDF GENERATION HELPERS
================================ */

// NEW: Helper to draw page border
function drawPageBorder(doc) {
  const x = 20; // 20px from edge
  const y = 20;
  const w = CONFIG.PAGE.width - 40;
  const h = CONFIG.PAGE.height - 40;
  doc.save()
     .lineWidth(1)
     .strokeColor('black')
     .rect(x, y, w, h)
     .stroke()
     .restore();
}

// Helper to draw tables
function drawTable(doc, headers, rows, startY, startX) {
  let currentY = startY;
  const pageBottom = CONFIG.PAGE.height - CONFIG.PAGE.margin;

  // Draw Header
  const drawHeader = (y) => {
    doc.fontSize(8).font('Helvetica-Bold');
    let x = startX;
    headers.forEach(h => {
      doc.text(h.label, x, y, { width: h.width, align: 'left' });
      x += h.width;
    });
    doc.moveTo(startX, y + 12).lineTo(CONFIG.PAGE.width - CONFIG.PAGE.margin, y + 12).stroke();
    doc.font('Helvetica');
    return y + 20;
  };

  currentY = drawHeader(currentY);

  // Draw Rows
  doc.fontSize(8);
  rows.forEach(row => {
    if (currentY > pageBottom) {
      doc.addPage();
      currentY = CONFIG.PAGE.margin;
      currentY = drawHeader(currentY);
      doc.fontSize(8);
    }

    let x = startX;
    row.forEach((text, i) => {
      doc.text(String(text), x, currentY, { width: headers[i].width, align: 'left', ellipsis: true });
      x += headers[i].width;
    });
    currentY += 15;
  });
  
  return currentY;
}

/* ================================
   PDF GENERATOR FUNCTIONS
================================ */

/**
 * PDF 1: Seating Plan & Door Summary
 * Contains: Hall Summary Table, Visual Grid
 */
function generateSeatingPDF(hallName, seatGrid, evaluation, summaryRows, filePath, subjectColors) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: CONFIG.PAGE.margin, size: "A4" });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Border for Page 1
    drawPageBorder(doc);
    doc.on('pageAdded', () => drawPageBorder(doc));

    // --- PAGE 1: DOOR DISPLAY (SUMMARY) ---
    doc.fontSize(16).text(`Hall Summary: ${hallName}`, { align: 'center' });
    doc.moveDown();
    
    const summaryHeaders = [
      { label: "Subject", width: 150 },
      { label: "Branch", width: 80 },
      { label: "From Roll No", width: 100 },
      { label: "To Roll No", width: 100 },
      { label: "Count", width: 50 }
    ];

    drawTable(doc, summaryHeaders, summaryRows, doc.y, CONFIG.PAGE.margin);

    // --- PAGE 2: SEATING PLAN (VISUAL GRID) ---
    doc.addPage();
    doc.fontSize(CONFIG.FONT_SIZE_HEADER).text(`Seating Plan: ${hallName}`, { align: 'center' });
    doc.fontSize(10).text(`Quality Check: ${evaluation.totalConflicts} conflicts.`, { align: 'center' });
    doc.moveDown();
    
    // Legend
    doc.fontSize(8);
    let legendX = CONFIG.PAGE.margin;
    Object.keys(subjectColors).forEach((sub) => {
      if(legendX + 50 > CONFIG.PAGE.width) { legendX = CONFIG.PAGE.margin; doc.moveDown(); }
      doc.fillColor(subjectColors[sub]).text(sub, legendX, doc.y, { lineBreak: false });
      legendX += (sub.length * 6) + 20;
    });
    doc.fillColor("black");
    doc.moveDown(2);

    // Grid Drawing
    const cols = seatGrid[0].length;
    const pageWidth = CONFIG.PAGE.width - (CONFIG.PAGE.margin * 2);
    const cellWidth = pageWidth / cols;
    let currentY = doc.y;

    seatGrid.forEach((row) => {
      if (currentY + CONFIG.CELL_HEIGHT > CONFIG.PAGE.height - CONFIG.PAGE.margin) {
        doc.addPage();
        currentY = CONFIG.PAGE.margin;
      }
      row.forEach((seat, cIndex) => {
        const x = CONFIG.PAGE.margin + (cIndex * cellWidth);
        doc.rect(x, currentY, cellWidth, CONFIG.CELL_HEIGHT).stroke();
        if (seat) {
          const color = subjectColors[seat.subject] || "black";
          if(seat.conflict) {
             doc.save().fillOpacity(0.1).fillColor('red')
                .rect(x, currentY, cellWidth, CONFIG.CELL_HEIGHT).fill().restore();
          }
          doc.fontSize(7).fillColor("gray")
             .text((seat.subject||"").substring(0, 10), x + 2, currentY + 2, { width: cellWidth - 4, align: 'center' });
          doc.fontSize(10).fillColor(color)
             .text(seat['Roll Number']||seat.roll||"", x + 2, currentY + 12, { width: cellWidth - 4, align: 'center' });
        } else {
          doc.fontSize(8).fillColor("#ccc").text("-", x + 2, currentY + 10, { width: cellWidth - 4, align: 'center' });
        }
      });
      currentY += CONFIG.CELL_HEIGHT;
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * PDF 2: Attendance Sheet
 * Contains: Attendance Table with Signature column
 */
function generateAttendancePDF(hallName, allStudents, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: CONFIG.PAGE.margin, size: "A4" });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Border
    drawPageBorder(doc);
    doc.on('pageAdded', () => drawPageBorder(doc));

    doc.fontSize(14).text(`Attendance Sheet: ${hallName}`, { align: 'center' });
    doc.moveDown();

    // Group by Subject for attendance, then Sort by Roll No
    allStudents.sort((a, b) => {
      if (a.subject < b.subject) return -1;
      if (a.subject > b.subject) return 1;
      return (a['Roll Number']||"").localeCompare(b['Roll Number']||"", undefined, { numeric: true });
    });

    const attendanceHeaders = [
      { label: "No", width: 25 },
      { label: "Roll Number", width: 80 },
      { label: "Student Name", width: 100 },
      { label: "Branch", width: 50 },
      { label: "Subject", width: 90 },
      { label: "Seat", width: 40 },
      { label: "Signature", width: 100 }
    ];

    const attendanceRows = allStudents.map((s, i) => [
      i + 1,
      s['Roll Number'] || s['RollNo'] || "-",
      s['Student Name'] || s['Name'] || "-",
      s['Branch'] || "-",
      s['Subject'],
      `R${s.r}-C${s.c}`,
      "" // Empty for signature
    ]);

    drawTable(doc, attendanceHeaders, attendanceRows, doc.y, CONFIG.PAGE.margin);

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * PDF 3: Master Summary (Detailed)
 * Contains: Boxes for each hall listing ALL roll numbers
 */
function generateMasterPDF(masterData, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: CONFIG.PAGE.margin, size: "A4" });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Border
    drawPageBorder(doc);
    doc.on('pageAdded', () => drawPageBorder(doc));

    doc.fontSize(16).text("Master Exam Plan", { align: 'center' });
    doc.moveDown();

    // masterData is object: { "HallName": { "Branch - Subject": [roll, roll...] } }
    const hallNames = Object.keys(masterData).sort();

    hallNames.forEach((hallName, hIdx) => {
      // Check for page break if near bottom
      if (doc.y > CONFIG.PAGE.height - 150) doc.addPage();

      // Hall Header Box
      const startY = doc.y;
      doc.font('Helvetica-Bold').fontSize(12)
         .rect(CONFIG.PAGE.margin, startY, CONFIG.PAGE.width - (CONFIG.PAGE.margin * 2), 20)
         .fillAndStroke('#f0f0f0', 'black');
      
      doc.fillColor('black').text(`HALL: ${hallName}`, CONFIG.PAGE.margin + 5, startY + 5);
      doc.moveDown(1.5);

      // List details inside
      const subjects = masterData[hallName];
      const subKeys = Object.keys(subjects).sort();

      subKeys.forEach(subKey => {
         // Check space for content
         if (doc.y > CONFIG.PAGE.height - 100) {
             doc.addPage();
             // Redraw hall header continuation
             doc.font('Helvetica-Bold').fontSize(12).text(`HALL: ${hallName} (Contd...)`);
             doc.moveDown(0.5);
         }

         doc.font('Helvetica-Bold').fontSize(10).text(subKey, { underline: true });
         doc.font('Helvetica').fontSize(9);
         
         const rolls = subjects[subKey].sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
         doc.text(rolls.join(", "), { align: 'justify', indent: 10 });
         doc.moveDown(0.5);
      });

      doc.moveDown(1);
      // Separator Line
      doc.moveTo(CONFIG.PAGE.margin, doc.y).lineTo(CONFIG.PAGE.width - CONFIG.PAGE.margin, doc.y).stroke();
      doc.moveDown(1);
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/* ================================
   API ENDPOINT
================================ */
router.post("/", upload.fields([{ name: "students", maxCount: 1 }, { name: "halls", maxCount: 1 }]), async (req, res) => {
  const tempFiles = [];
  try {
    if (!req.files.students || !req.files.halls) throw new Error("Missing files.");
    tempFiles.push(req.files.students[0].path, req.files.halls[0].path);

    const studentsRaw = robustCSVParser(fs.readFileSync(req.files.students[0].path, "utf8"));
    const hallsRaw = robustCSVParser(fs.readFileSync(req.files.halls[0].path, "utf8"));

    if (!studentsRaw.length || !hallsRaw.length) throw new Error("Empty CSVs.");

    const uniqueSubjects = [...new Set(studentsRaw.map(s => s['Subject'] || s['Code'] || s['Branch']))];
    const subjectColors = {};
    uniqueSubjects.forEach((sub, i) => subjectColors[sub] = SUBJECT_COLORS[i % SUBJECT_COLORS.length]);

    // STAGE 1: Distribution
    let hallBuckets = stage1_DistributeToHalls(hallsRaw, studentsRaw);

    // STAGE 2: Randomization
    hallBuckets = stage2_Randomize(hallBuckets);

    const outputDir = path.join(__dirname, "output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    const generatedPDFFiles = [];
    const reportStats = [];
    
    // Data container for the Master PDF: { HallName: { SubjectKey: [Rolls] } }
    const masterData = {};

    for (const bucket of hallBuckets) {
      if (bucket.assigned.length === 0) continue;

      // STAGE 3: Optimization
      const grid = stage3_OptimizeSeating(bucket);

      // STAGE 4: Evaluation
      const stats = stage4_Evaluate(grid);
      reportStats.push(`Hall ${bucket.details.RoomName || "Unk"}: ${stats.filledSeats} seats, ${stats.totalConflicts} conflicts.`);

      // Prepare Data for PDFs
      let allStudents = [];
      grid.forEach((row, rIndex) => {
          row.forEach((student, cIndex) => {
              if(student) {
                  allStudents.push({ ...student, r: rIndex + 1, c: cIndex + 1 });
              }
          });
      });

      // Calculate Summary Rows (Branch/Subject Grouping) & Master Data
      const summaryGroups = {};
      const hallName = bucket.details.RoomName || "Unk";
      if(!masterData[hallName]) masterData[hallName] = {};

      allStudents.forEach(s => {
        // Summary for Seating PDF
        const key = `${s['Branch'] || 'Gen'} - ${s['Subject']}`;
        if(!summaryGroups[key]) summaryGroups[key] = { branch: s['Branch'], subject: s['Subject'], rolls: [] };
        summaryGroups[key].rolls.push(s['Roll Number'] || s['RollNo'] || "");

        // Master Data Collection
        if(!masterData[hallName][key]) masterData[hallName][key] = [];
        masterData[hallName][key].push(s['Roll Number'] || s['RollNo'] || "");
      });

      const summaryRows = Object.values(summaryGroups).map(g => {
        g.rolls.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const start = g.rolls[0];
        const end = g.rolls[g.rolls.length - 1];
        return [ g.subject, g.branch || "-", start, end, g.rolls.length ];
      });

      const safeName = (bucket.details.RoomName || "Hall").replace(/[^a-z0-9]/gi, '_');
      
      // 1. Generate Seating PDF
      const seatPdfPath = path.join(outputDir, `Seating_${safeName}.pdf`);
      await generateSeatingPDF(bucket.details.RoomName, grid, stats, summaryRows, seatPdfPath, subjectColors);
      generatedPDFFiles.push(seatPdfPath);
      tempFiles.push(seatPdfPath);

      // 2. Generate Attendance PDF
      const attPdfPath = path.join(outputDir, `Attendance_${safeName}.pdf`);
      await generateAttendancePDF(bucket.details.RoomName, allStudents, attPdfPath);
      generatedPDFFiles.push(attPdfPath);
      tempFiles.push(attPdfPath);
    }

    // 3. Generate Master Summary PDF (Detailed)
    const masterPdfPath = path.join(outputDir, `Master_Exam_Plan.pdf`);
    await generateMasterPDF(masterData, masterPdfPath);
    generatedPDFFiles.push(masterPdfPath);
    tempFiles.push(masterPdfPath);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=Exam_Allocation_Final.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    generatedPDFFiles.forEach(f => archive.file(f, { name: path.basename(f) }));
    archive.append(reportStats.join('\n'), { name: 'allocation_report.txt' });

    res.on('finish', () => cleanupFiles(tempFiles));
    await archive.finalize();

  } catch (err) {
    cleanupFiles(tempFiles);
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;