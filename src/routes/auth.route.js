const express = require("express");
const fetch = require("node-fetch");
const router = express.Router();

const { admin, db } = require("../config/firebase");

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

/* ================================
   SIGN UP (email, password, role)
================================ */
router.post("/signup", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "email, password, role required",
      });
    }

    const user = await admin.auth().createUser({
      email,
      password,
    });

    await db.collection("users").doc(user.uid).set({
      uid: user.uid,
      email,
      role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      uid: user.uid,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
});

/* ================================
   LOGIN (email + password) ✅
================================ */
router.post("/login", async (req, res) => {
  try {
    const { idToken } = req.body; 
    

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "idToken required",
      });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log(decoded.uid);
    
    const snap = await db.collection("users").doc(decoded.uid).get();
    if (!snap.exists) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    res.json({
      success: true,
      user: snap.data(),
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
});

/* ================================
   AUTH MIDDLEWARE
================================ */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = header.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(token);

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

/* ================================
   GET CURRENT USER
================================ */
router.get("/me", authenticate, async (req, res) => {
  const snap = await db.collection("users").doc(req.user.uid).get();
  res.json({ success: true, user: snap.data() });
});

module.exports = router;
