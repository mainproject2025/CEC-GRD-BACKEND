const express = require("express");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());

const singleExam= require('./routes/singleExam.route')
const twoExam=require('./routes/TwoCommon.route')
app.use('/singleGenerate',singleExam)
app.use('/TwoGenerate',twoExam)
/* ================================
   START SERVER
================================ */
app.listen(5000, () => {
  console.log("Server running...");
});
