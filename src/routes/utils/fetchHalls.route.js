const express = require("express");
const { db } = require("../../config/firebase");

const router = express.Router();

/* =========================
   FETCH ALL HALLS
   GET /halls
========================= */
router.get("/", async (req, res) => {
  try {
    const snapshot = await db.collection("halls").get();

    const halls = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ success: true, data: halls });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch halls",
    });
  }
});

/* =========================
   ADD HALL
   POST /halls
========================= */
router.post("/", async (req, res) => {
  try {
    const { name, rows, columns, capacity, status, seatingType } = req.body;

    if (!name || !rows || !columns || !capacity || !status || !seatingType) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const hall = {
      name: name.trim(),
      rows: Number(rows),
      columns: Number(columns),
      capacity: Number(capacity),
      status,
      seatingType,
      createdAt: new Date(),
      updatedAt:new Date()
    };

    const docRef = await db.collection("halls").add(hall);

    res.status(201).json({
      success: true,
      data: { id: docRef.id, ...hall },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to add hall",
    });
  }
});

/* =========================
   EDIT HALL
   PUT /halls/:id
========================= */
router.put("/:id", async (req, res) => {
  try {
    const ref = db.collection("halls").doc(req.params.id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "Hall not found",
      });
    }

    const { name, rows, columns, capacity, status, seatingType } = req.body;

    console.log(columns);
    
    await ref.update({
      name,
      rows,
      columns,
      capacity,
      status,
      updatedAt: new Date(),
    });

    res.json({
      success: true,
      message: "Hall updated successfully",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to update hall",
    });
  }
});

/* =========================
   DELETE HALL
   DELETE /halls/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    const ref = db.collection("halls").doc(req.params.id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "Hall not found",
      });
    }

    await ref.delete();

    res.json({
      success: true,
      message: "Hall deleted successfully",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to delete hall",
    });
  }
});

module.exports = router;
