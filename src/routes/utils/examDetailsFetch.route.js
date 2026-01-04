const express = require("express");
const router = express.Router();
const { db } = require("../../config/firebase");

/* ================================
   GET ALL EXAMS (LIGHTWEIGHT)
   GET /exams
================================ */
router.get("/", async (req, res) => {
  try {
    const snap = await db
      .collection("examAllocations")
      .orderBy("createdAt", "desc")
      .get();

    const exams = snap.docs.map(doc => {
      const data = doc.data();

      return {
        examId: doc.id,
        examName: data.name || "Unnamed Exam",
        sems: data.sems || [],
        isElective:data.isElective,
        createdAt:'1/1/2026'
      };
    });

    res.json({
      success: true,
      count: exams.length,
      exams,
    });
  } catch (err) {
    console.error("FETCH EXAMS ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch exams",
    });
  }
});

module.exports = router;
