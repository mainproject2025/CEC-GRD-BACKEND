const express = require("express");
const router = express.Router();
const { admin, db } = require("../../config/firebase");

/* =====================================================
   CREATE GLOBAL FACULTY NOTIFICATION
===================================================== */
router.post("/create", async (req, res) => {
  try {
    const { title, message, type = "info" } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: "Title and message are required" });
    }

    const docRef = await db.collection("notifications").add({
      title,
      message,
      type,
      scope: "faculty",      // 🔥 GLOBAL VISIBILITY
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      id: docRef.id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* =====================================================
   FETCH ALL FACULTY NOTIFICATIONS
===================================================== */
router.get("/", async (req, res) => {
  try {
    const snap = await db
      .collection("notifications")
      .orderBy("createdAt", "desc")
      .get();

    const notifications = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    res.json(notifications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// /* =====================================================
//    MARK ONE NOTIFICATION AS READ (GLOBAL)
// ===================================================== */
// router.patch("/:id/read", async (req, res) => {
//   try {
//     await db.collection("notifications").doc(req.params.id).update({
//       read: true,
//     });

//     res.json({ success: true });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

// /* =====================================================
//    MARK ALL FACULTY NOTIFICATIONS AS READ
// ===================================================== */
// router.patch("/mark-all-read", async (req, res) => {
//   try {
//     const snap = await db
//       .collection("notifications")
//       .where("scope", "==", "faculty")
//       .where("read", "==", false)
//       .get();

//     const batch = db.batch();
//     snap.docs.forEach(doc => {
//       batch.update(doc.ref, { read: true });
//     });

//     await batch.commit();

//     res.json({
//       success: true,
//       updated: snap.size,
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// });

module.exports = router;
