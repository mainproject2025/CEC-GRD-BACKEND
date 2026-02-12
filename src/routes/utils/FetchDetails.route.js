const express = require("express");
const { db } = require("../../config/firebase");

const router = express.Router();

router.get("/:examId", async (req, res) => {
  try {
    const { examId } = req.params;

    // Get document by ID
    const docRef = db.collection("examAllocations").doc(examId);
    const docSnap = await docRef.get();

    // Check if exam exists
    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Exam not found",
      });
    }

    // Get all data
    const examData = {
      examId: docSnap.id,
      ...docSnap.data(),
    };

    res.json({
      success: true,
      exam: examData,
    });

  } catch (err) {
    console.error("FETCH EXAM BY ID ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch exam details",
      error: err.message,
    });
  }
});

module.exports=router;