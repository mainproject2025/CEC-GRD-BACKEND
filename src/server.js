const express = require("express");
const fs = require("fs");
const cors = require("cors");

const app = express();
import dotenv from "dotenv";
dotenv.config();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ======================
   ROUTE IMPORTS
====================== */
const singleExamCommon = require("./routes/singleCommon");
const singleExamElective = require("./routes/singleExam.route");
const twoExamCommon = require("./routes/TwoCommon.route");
const twoExamElective = require("./routes/TwoElective.route");
const auth = require("./routes/auth.route");
const FetchExamDetails = require("./routes/utils/examDetailsFetch.route");
const pdfMakerCommon = require("./routes/pdf.route");
const pdfMakerElective = require("./routes/pdfElective.route");
const notifications = require("./routes/utils/notification.route");

// ✅ HALL ROUTES (IMPORTANT)
const fetchHalls = require("./routes/utils/fetchHalls.route");

/* ======================
   ROUTE MIDDLEWARES
====================== */
app.use("/GeneratePdfElective", pdfMakerElective);
app.use("/singleGenerateCommon", singleExamCommon);
app.use("/singleGenerateElective", singleExamElective);
app.use("/TwoGenerateCommon", twoExamCommon);
app.use("/TwoGenerateElective", twoExamElective);
app.use("/auth", auth);
app.use("/FetchExamDetails", FetchExamDetails);
app.use("/MakePdfCommon", pdfMakerCommon);
app.use("/notification", notifications);

// ✅ HALL CRUD API
app.use("/halls", fetchHalls);
app.get("/", (req, res) => {
  return res.send({
    status: "Server is Healthy"
  });
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
