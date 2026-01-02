const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { generateSeating } = require("../utils/seatingEngine");

const router = express.Router();

/* ================================
   MULTER CONFIG
================================ */
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const upload = multer({
  dest: uploadDir,
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith(".csv")) cb(null, true);
    else cb(new Error("Only CSV files allowed"));
  }
});

/* ================================
   POST /api/seating/generate
================================ */
router.post(
  "/",
  upload.fields([
    { name: "halls", maxCount: 1 },
    { name: "students", maxCount: 5 }
  ]),
  async (req, res) => {
    try {
      if (!req.files?.halls || !req.files?.students) {
        return res.status(400).json({
          error: "Hall CSV and Student CSV files are required"
        });
      }

      const hallsCSV = req.files.halls[0].path;
      const studentCSVs = req.files.students.map(f => f.path);

      await generateSeating({
        hallsCSV,
        studentCSVs
      });

      return res.json({
        success: true,
        message: "Seating allocation completed",
        outputs: fs.readdirSync("output")
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }
);

module.exports = router;
