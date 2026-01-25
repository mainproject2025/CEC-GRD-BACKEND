const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      require("/etc/secrets/serviceAccountKey.json")
    ),
  });
}

const db = admin.firestore();

module.exports = { admin, db };
