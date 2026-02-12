const express = require("express");
const router = express.Router();
const { db } = require("../../config/firebase");

/* ================================
   UTIL: FORMAT DATE + HALF DAY
================================ */
function formatWithHalfDay(dateTimeStr) {
  const [date, time] = dateTimeStr.split("T");
  const hour = parseInt(time.split(":")[0], 10);
  const period = hour < 12 ? "Forenoon" : "Afternoon";
  return `${date} ${period}`;
}

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

    const exams = snap.docs.map((doc) => {
      const data = doc.data();

      return {
        examId: doc.id,
        examName: data.name || "Unnamed Exam",
        sems: data.sems || [],
        isElective: data.isElective,
        isPublished: data.isPublished ?? false, // ✅ include publish state
        createdAt: formatWithHalfDay(data.examDate),
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

router.patch('/examDelete',(req,res)=>{
  const {examId}=req.body

  try {
    
    db.collection('examAllocations').doc(examId).delete().then(()=>{
      res.json({success:true})
    })

  } catch (error) {
    
    res.status(500).json({success:false,reason:"Firebase couldn't delete the exam try again"})

  }
})

/* ================================
   UPDATE isPublished
   PATCH /exams/:id/publish
================================ */
// router.patch("/:id/publish", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { isPublished } = req.body;

//     const ref = db.collection("examAllocations").doc(id);
//     const doc = await ref.get();

//     if (!doc.exists) {
//       return res.status(404).json({
//         success: false,
//         message: "Exam not found",
//       });
//     }

//     await ref.update({
//       isPublished:true
//     });

//     res.json({
//       success: true,
//       message: `Exam ${isPublished ? "published" : "unpublished"} successfully`,
//     });
//   } catch (err) {
//     console.error("PUBLISH EXAM ERROR:", err);
//     res.status(500).json({
//       success: false,
//       message: "Failed to update publish status",
//     });
//   }
// });

module.exports = router;
