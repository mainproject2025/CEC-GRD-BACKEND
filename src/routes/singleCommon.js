const path = require("path");
const multer = require("multer");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const archiver = require("archiver");
const express = require("express");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

/* ================================
   CONFIG
================================ */
const QUALITY_THRESHOLD = 85;
const MAX_RETRIES = 10;

const SUBJECT_COLORS = [
  "red",
  "blue",
  "green",
  "purple",
  "orange",
  "brown",
  "darkgreen",
  "darkblue",
  "magenta",
  "teal",
  "maroon",
];

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
      map[s.Subject].rolls.push(s["Roll Number"]);
    });
  } else {
    students.forEach((s) => {
      if (!map[s.Branch]) map[s.Branch] = [];
      map[s.Branch].push(s["Roll Number"]);
    });
  }

  return map;
}

/* ================================
   MAP BUILDERS
================================ */
function buildRollToBranch(students) {
  const map = {};
  students.forEach((s) => (map[s["Roll Number"]] = s.Branch));
  return map;
}

function buildRollToSubject(students) {
  const map = {};
  students.forEach((s) => (map[s["Roll Number"]] = s.Subject));
  return map;
}

function buildSubjectColorMap(students) {
  const map = {};
  let idx = 0;

  students.forEach((s) => {
    if (!map[s.Subject]) {
      map[s.Subject] = SUBJECT_COLORS[idx % SUBJECT_COLORS.length];
      idx++;
    }
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

        // ❌ Violation: A A
        if (sa === sb) {
          outer:
          for (let i = r + 1; i < R; i++) {
            for (let j = 0; j < C; j++) {
              const x = arr[i][j];
              if (!x) continue;

              const sx = rollToSubject[x];

              // ensure A B A pattern safety
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
   PDF EXPORT (COLOR CODED)
================================ */
function exportHallSeatingPDF(
  hall,
  seats,
  filePath,
  rollToSubject,
  subjectColorMap
) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(16).fillColor("black")
    .text("Hall Seating Arrangement", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(12)
    .text(`Hall: ${hall.RoomName}`, { align: "center" });
  doc.moveDown(1);

  const cols = seats[0].length;
  const pageWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const cellW = pageWidth / cols;
  const cellH = 25;

  let y = doc.y;
  doc.fontSize(9);

  seats.forEach((row) => {
    let x = doc.page.margins.left;

    row.forEach((roll) => {
      doc.rect(x, y, cellW, cellH).stroke();

      if (roll) {
        const subject = rollToSubject[roll];
        const color = subjectColorMap[subject] || "black";

        doc.fillColor(color).text(roll, x + 2, y + 7, {
          width: cellW - 4,
          align: "center",
        });
        doc.fillColor("black");
      } else {
        doc.text("-", x + 2, y + 7, {
          width: cellW - 4,
          align: "center",
        });
      }

      x += cellW;
    });

    y += cellH;
  });

  doc.end();
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

      const outputDir = path.join(__dirname, "output");
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

      const groups = groupStudents(students, isElective);
      const order = Object.keys(groups);

      let pointers = {};
      order.forEach((k) => (pointers[k] = 0));

      const rollToBranch = buildRollToBranch(students);
      const rollToSubject = buildRollToSubject(students);
      const subjectColorMap = buildSubjectColorMap(students);

      const files = [];

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

        const fp = `${outputDir}/Seating_${hall.RoomName}.pdf`;
        exportHallSeatingPDF(
          hall,
          seats,
          fp,
          rollToSubject,
          subjectColorMap
        );
        files.push(fp);
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Exam_PDFs.zip"
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);
      files.forEach((f) => archive.file(f, { name: path.basename(f) }));
      await archive.finalize();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "PDF generation failed" });
    }
  }
);

module.exports = router;
