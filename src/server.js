const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const archiver = require("archiver");
const cors = require("cors");

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });

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
  return lines.slice(1).map(line => {
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
   GROUP BY BRANCH
================================ */
function groupByBranch(students) {
  const map = {};
  students.forEach(s => {
    if (!map[s.Branch]) map[s.Branch] = [];
    map[s.Branch].push(s["Roll Number"]);
  });
  return map;
}

/* ================================
   STAGE 1 – ALLOCATION
================================ */
function allocateHall(hall, groups, pointers, order) {
  const R = Number(hall.Rows);
  const C = Number(hall.Columns);
  const seats = Array.from({ length: R }, () => Array(C).fill(""));

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const branch = order[c % order.length];
      if (pointers[branch] < groups[branch].length) {
        seats[r][c] = groups[branch][pointers[branch]++];
      }
    }
  }
  return seats;
}

/* ================================
   STAGE 2 – RANDOMIZATION
================================ */
function SeatRandomization(arr) {
  const flat = arr.flat().filter(Boolean);
  shuffleArray(flat);
  let i = 0;
  return arr.map(row => row.map(() => flat[i++] || ""));
}

/* ================================
   STAGE 3 – OPTIMIZATION (BRANCH + SUBJECT)
================================ */
function SeatOptimization(arr, rollToBranch, rollToSubject) {
  const R = arr.length;
  const C = arr[0].length;

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C - 1; c++) {
      const a = arr[r][c];
      const b = arr[r][c + 1];
      if (!a || !b) continue;

      const sameBranch = rollToBranch[a] === rollToBranch[b];
      const sameSubject =
        rollToSubject[a] &&
        rollToSubject[b] &&
        rollToSubject[a] === rollToSubject[b];

      if (sameBranch || sameSubject) {
        outer:
        for (let i = r + 1; i < R; i++) {
          for (let j = 0; j < C; j++) {
            const x = arr[i][j];
            if (!x) continue;

            const branchOK =
              rollToBranch[x] !== rollToBranch[a];

            const subjectOK =
              !rollToSubject[x] ||
              rollToSubject[x] !== rollToSubject[a];

            if (branchOK && subjectOK) {
              [arr[r][c + 1], arr[i][j]] = [x, b];
              break outer;
            }
          }
        }
      }
    }
  }
  return arr;
}

/* ================================
   STAGE 4 – EVALUATION
================================ */
function SeatEvaluation(arr, rollToBranch, rollToSubject) {
  let violations = 0;
  for (let r = 0; r < arr.length; r++) {
    for (let c = 0; c < arr[0].length - 1; c++) {
      const a = arr[r][c];
      const b = arr[r][c + 1];
      if (!a || !b) continue;

      if (
        rollToBranch[a] === rollToBranch[b] ||
        (rollToSubject[a] &&
          rollToSubject[b] &&
          rollToSubject[a] === rollToSubject[b])
      ) {
        violations++;
      }
    }
  }
  return Math.max(100 - violations * 5, 0);
}

/* ================================
   AUTO-RETRY OPTIMIZATION
================================ */
function optimizedSeating(
  hall,
  groups,
  pointers,
  order,
  rollToBranch,
  rollToSubject
) {
  let best = null;
  let bestScore = -1;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const localPointers = { ...pointers };
    let seats = allocateHall(hall, groups, localPointers, order);
    seats = SeatRandomization(seats);
    seats = SeatOptimization(seats, rollToBranch, rollToSubject);

    const score = SeatEvaluation(
      seats,
      rollToBranch,
      rollToSubject
    );

    if (score > bestScore) {
      bestScore = score;
      best = seats;
    }
    if (bestScore >= QUALITY_THRESHOLD) break;
  }
  return best;
}

/* ================================
   SUBJECT EXTRACTION
================================ */
function extractSubjects(students) {
  const slots = {
    Common_Subject_1: {},
    Common_Subject_2: {},
    Elective_1: {},
    Elective_2: {}
  };

  students.forEach(s => {
    Object.keys(slots).forEach(k => {
      if (s[k]) slots[k][s[k]] = (slots[k][s[k]] || 0) + 1;
    });
  });
  return slots;
}

/* ================================
   TIMETABLE GENERATION
================================ */
function generateTimeTable(slots) {
  const list = Object.entries(slots).map(([slot, subjects]) => ({
    slot,
    subjects
  }));

  shuffleArray(list);

  const table = [];
  let day = 1;

  for (let i = 0; i < list.length; i += 2) {
    table.push({
      day: `Day ${day++}`,
      forenoon: list[i] || null,
      afternoon: list[i + 1] || null
    });
  }
  return table;
}

/* ================================
   PDF – HALL SEATING (TABLE)
================================ */
function exportHallSeatingPDF(hall, seats, filePath) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(16).text("Hall Seating Arrangement", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Hall: ${hall.RoomName}`, { align: "center" });
  doc.moveDown(1);

  const cols = seats[0].length;
  const pageWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const cellW = pageWidth / cols;
  const cellH = 25;

  let y = doc.y;
  doc.fontSize(9);

  seats.forEach(row => {
    let x = doc.page.margins.left;
    row.forEach(cell => {
      doc.rect(x, y, cellW, cellH).stroke();
      doc.text(cell || "-", x + 2, y + 7, {
        width: cellW - 4,
        align: "center"
      });
      x += cellW;
    });
    y += cellH;

    if (y + cellH > doc.page.height - 40) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  });

  doc.end();
}

/* ================================
   PDF – TIMETABLE (TABLE)
================================ */
function exportTimetablePDF(timetable, filePath) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(18).text("Examination Timetable", { align: "center" });
  doc.moveDown(1);

  const headers = ["Day", "Session", "Slot", "Subject", "Students"];
  const colWidths = [70, 90, 120, 160, 70];
  const rowH = 25;

  let x = doc.page.margins.left;
  let y = doc.y;

  doc.fontSize(10);

  headers.forEach((h, i) => {
    doc.rect(x, y, colWidths[i], rowH).stroke();
    doc.text(h, x + 4, y + 8, {
      width: colWidths[i] - 8,
      align: "center"
    });
    x += colWidths[i];
  });

  y += rowH;

  timetable.forEach(d => {
    ["forenoon", "afternoon"].forEach(s => {
      if (!d[s]) return;

      Object.entries(d[s].subjects).forEach(([sub, cnt]) => {
        x = doc.page.margins.left;

        const row = [
          d.day,
          s.toUpperCase(),
          d[s].slot,
          sub,
          String(cnt)
        ];

        row.forEach((cell, i) => {
          doc.rect(x, y, colWidths[i], rowH).stroke();
          doc.text(cell, x + 4, y + 8, {
            width: colWidths[i] - 8,
            align: "center"
          });
          x += colWidths[i];
        });

        y += rowH;

        if (y + rowH > doc.page.height - 40) {
          doc.addPage();
          y = doc.page.margins.top;
        }
      });
    });
  });

  doc.end();
}

/* ================================
   API ENDPOINT
================================ */
app.post(
  "/generate",
  upload.fields([
    { name: "students", maxCount: 1 },
    { name: "halls", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const students = excelToCsv(
        fs.readFileSync(req.files.students[0].path, "utf8")
      );
      const halls = shuffleArray(
        excelToCsv(fs.readFileSync(req.files.halls[0].path, "utf8"))
      );

      const outputDir = path.join(__dirname, "output");
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

      const groups = groupByBranch(students);
      const order = Object.keys(groups);
      const pointers = {};
      order.forEach(b => (pointers[b] = 0));

      const rollToBranch = {};
      const rollToSubject = {};

      students.forEach(s => {
        rollToBranch[s["Roll Number"]] = s.Branch;
        rollToSubject[s["Roll Number"]] = s.Common_Subject_1;
      });

      const files = [];

      halls.forEach(hall => {
        const seats = optimizedSeating(
          hall,
          groups,
          pointers,
          order,
          rollToBranch,
          rollToSubject
        );
        const fp = `${outputDir}/Seating_${hall.RoomName}.pdf`;
        exportHallSeatingPDF(hall, seats, fp);
        files.push(fp);
      });

      const slotMap = extractSubjects(students);
      const timetable = generateTimeTable(slotMap);

      const timetablePDF = `${outputDir}/Exam_Timetable.pdf`;
      exportTimetablePDF(timetable, timetablePDF);
      files.push(timetablePDF);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Exam_PDFs.zip"
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);

      files.forEach(f =>
        archive.file(f, { name: path.basename(f) })
      );

      await archive.finalize();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "PDF generation failed" });
    }
  }
);

/* ================================
   START SERVER
================================ */
app.listen(5000, () => {
  console.log("Server running");
});
