const express=require('express');
const { db } = require("../../config/firebase");
const router=express.Router();

router.post('/',async (req,res)=>{

    
    try{
        const {examId,halls}=req.body;

        await db.collection('examAllocations').doc(examId).update(
            {
                halls:halls
            }
        ).then(()=>{
            res.json({ success: true});
        })
    }catch(e){
        res.status(500).json({erro:e});
    }
});

module.exports=router;