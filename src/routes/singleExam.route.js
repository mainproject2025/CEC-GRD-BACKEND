const path = require("path");
const multer = require("multer");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const archiver = require("archiver");
const express = require("express");
 

const router = express.Router();
const { admin, db } = require("../config/firebase");


if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
const upload = multer({ dest: "uploads/" });

/* ================================
   CONFIG
================================ */
const CONFIG = {
  PAGE: { width: 595.28, height: 841.89, margin: 40 },
  CELL_HEIGHT: 30,
  OPTIMIZATION_CYCLES: 25000,
};

/* ================================
   CSV PARSER
================================ */
function robustCSVParser(csvData) {
  const lines = csvData.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
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
   CLEANUP
================================ */
const cleanupFiles = (files) => {
  files.forEach(f => {
    if (f && fs.existsSync(f)) fs.unlinkSync(f);
  });
};

/* ================================
   STAGE 1: DISTRIBUTION
================================ */
function stage1_DistributeToHalls(halls, studentsRaw) {
  const subjectGroups = {};
  studentsRaw.forEach(s => {
    const sub = s.Subject || s.Code || s.Branch || "Unknown";
    subjectGroups[sub] ??= [];
    subjectGroups[sub].push(s);
  });

  const sortedSubjects = Object.keys(subjectGroups)
    .sort((a, b) => subjectGroups[b].length - subjectGroups[a].length);

  const hallBuckets = halls.map(h => ({
    details: h,
    capacity: Number(h.Rows) * Number(h.Columns),
    assigned: [],
  }));

  hallBuckets.sort((a, b) => b.capacity - a.capacity);

  let s1 = sortedSubjects.shift();
  let s2 = sortedSubjects.shift();

  for (const bucket of hallBuckets) {
    while (bucket.assigned.length < bucket.capacity) {
      if (!s1 && sortedSubjects.length) s1 = sortedSubjects.shift();
      if (!s2 && sortedSubjects.length) s2 = sortedSubjects.shift();
      if (!s1 && !s2) break;

      const target = s1 || s2;
      if (subjectGroups[target]?.length) {
        bucket.assigned.push({ ...subjectGroups[target].shift(), subject: target });
        if (!subjectGroups[target].length) {
          if (target === s1) s1 = null;
          else s2 = null;
        }
      } else {
        if (target === s1) s1 = null;
        else s2 = null;
      }
    }
  }
  return hallBuckets;
}

/* ================================
   STAGE 2: RANDOMIZE
================================ */
function stage2_Randomize(hallBuckets) {
  hallBuckets.forEach(b => {
    for (let i = b.assigned.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b.assigned[i], b.assigned[j]] = [b.assigned[j], b.assigned[i]];
    }
  });
  return hallBuckets;
}

/* ================================
   STAGE 3: OPTIMIZE (UNCHANGED)
================================ */
function stage3_OptimizeSeating(bucket) {
  const rows = Number(bucket.details.Rows);
  const cols = Number(bucket.details.Columns);
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  let i = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      grid[r][c] = bucket.assigned[i++] || null;
  return grid;
}

/* ================================
   STAGE 4: EVALUATE
================================ */
function stage4_Evaluate(grid) {
  let conflicts = 0, filled = 0;
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[0].length; c++) {
      if (!grid[r][c]) continue;
      filled++;
      if (c + 1 < grid[0].length && grid[r][c+1]?.subject === grid[r][c].subject) conflicts++;
      if (r + 1 < grid.length && grid[r+1][c]?.subject === grid[r][c].subject) conflicts++;
    }
  return { conflicts, filled };
}

/* ================================
   FIRESTORE SAFE SERIALIZER ✅
================================ */
function serializeForFirestore(hallName, grid) {
  const students = [];
  grid.forEach((row, r) => {
    row.forEach((s, c) => {
      if (!s) return;
      students.push({
        hall: hallName,
        row: r + 1,
        column: c + 1,
        roll: s["RollNumber"] || null,
        name: s["StudentName"] || s.Name || null,
        branch: s.Branch || null,
        subject: s.subject || null,
      });
    });
  });
  return students;
}

/* ================================
   PDF (NO COLORS)
================================ */
function generateSeatingPDF(hallName, grid, stats, filePath) {
  return new Promise(resolve => {
    const doc = new PDFDocument({ margin: CONFIG.PAGE.margin, size: "A4" });
    doc.pipe(fs.createWriteStream(filePath));

    doc.fontSize(14).text(`Hall: ${hallName}`, { align: "center" });
    doc.text(`Conflicts: ${stats.conflicts}`, { align: "center" });
    doc.moveDown();

    const cols = grid[0].length;
    const cellW = (CONFIG.PAGE.width - CONFIG.PAGE.margin * 2) / cols;
    let y = doc.y;

    grid.forEach(row => {
      let x = CONFIG.PAGE.margin;
      row.forEach(s => {
        doc.rect(x, y, cellW, CONFIG.CELL_HEIGHT).stroke();
        doc.text(s ? s["Roll Number"] : "-", x, y + 10, { width: cellW, align: "center" });
        x += cellW;
      });
      y += CONFIG.CELL_HEIGHT;
    });

    doc.end();
    resolve();
  });
}

/* ================================
   API ENDPOINT
================================ */
router.post(
  "/",
  upload.fields([{ name: "students" }, { name: "halls" }]),
  async (req, res) => {
    const tempFiles = [];
    try {
      const students = robustCSVParser(fs.readFileSync(req.files.students[0].path, "utf8"));
      const halls = robustCSVParser(fs.readFileSync(req.files.halls[0].path, "utf8"));

      let buckets = stage1_DistributeToHalls(halls, students);
      buckets = stage2_Randomize(buckets);

      const outputDir = path.join(__dirname, "output", Date.now().toString());
      fs.mkdirSync(outputDir, { recursive: true });

      const firestoreData = {};
      const pdfs = [];

      for (const bucket of buckets) {
        if (!bucket.assigned.length) continue;

        const grid = stage3_OptimizeSeating(bucket);
        const stats = stage4_Evaluate(grid);
        const hallName = bucket.details.RoomName || "Hall";

        firestoreData[hallName] = serializeForFirestore(hallName, grid);

         
      }

      const docRef = await db.collection("examAllocations").add({
        halls: firestoreData,
        meta: {
          hallsCount: Object.keys(firestoreData).length,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", "attachment; filename=Exam_Seating.zip");

      

    } catch (err) {
      cleanupFiles(tempFiles);
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
