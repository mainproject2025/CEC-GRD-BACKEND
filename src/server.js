const express = require("express");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const singleExamCommon= require('./routes/singleCommon')
const singleExamElective= require('./routes/singleExam.route')
const twoExamCommon=require('./routes/TwoCommon.route')
const twoExamElective=require('./routes/TwoElective.route')
const auth=require('./routes/auth.route')
const FetchExamDetails=require('./routes/utils/examDetailsFetch.route')
const pdfMakerCommon=require('./routes/pdf.route')
const pdfMakerElective=require('./routes/pdfElective.route')

app.use('/GeneratePdfElective',pdfMakerElective)
app.use('/singleGenerateCommon',singleExamCommon)
app.use('/singleGenerateElective',singleExamElective)
app.use('/TwoGenerateCommon',twoExamCommon)
app.use('/TwoGenerateElective',twoExamElective)
app.use('/auth',auth)
app.use('/FetchExamDetails',FetchExamDetails)
app.use('/MakePdfCommon',pdfMakerCommon)

/* ================================
   START SERVER
================================ */
app.listen(5001, () => {
  console.log("Server running...");
});
