const mongoose=require('mongoose');
const schema=new mongoose.Schema({room:{type:mongoose.Schema.Types.ObjectId,required:true},user:{type:mongoose.Schema.Types.ObjectId,required:true},problem:{type:mongoose.Schema.Types.ObjectId,required:true},firstRunAt:Date,expiresAt:{type:Date,required:true}});
schema.index({room:1,user:1,problem:1},{unique:true});schema.index({expiresAt:1},{expireAfterSeconds:0});module.exports=mongoose.model('BehaviourAction',schema);
