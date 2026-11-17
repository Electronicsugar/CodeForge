const mongoose=require('mongoose');
const schema=new mongoose.Schema({
  key:{type:String,required:true,unique:true},room:{type:mongoose.Schema.Types.ObjectId,required:true},teamId:{type:mongoose.Schema.Types.ObjectId,required:true},problem:{type:mongoose.Schema.Types.ObjectId,required:true},language:{type:String,enum:['cpp','python','javascript','java'],required:true},
  state:{type:Buffer,required:true},revision:{type:Number,default:0,required:true},hash:{type:String,required:true},
},{timestamps:true});
schema.index({room:1,teamId:1,problem:1,language:1},{unique:true});
module.exports=mongoose.model('CollaborativeDocument',schema);
