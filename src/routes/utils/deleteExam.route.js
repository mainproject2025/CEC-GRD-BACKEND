const express = require('express');
const admin = require('firebase-admin');

const router = express.Router();
const db = admin.firestore();

// DELETE /utils/delete-exam/:examId
router.delete('/:examId', async (req, res) => {
    const { examId } = req.params;
    if (!examId) return res.status(400).json({ error: 'examId is required' });

    try {
        const examRef = db.collection('examAllocations').doc(examId);
        const doc = await examRef.get();
        if (!doc.exists) return res.status(404).json({ error: 'Exam not found' });

        await examRef.delete();
        return res.status(200).json({ message: 'Exam deleted' });
    } catch (err) {
        console.error('Delete exam error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
