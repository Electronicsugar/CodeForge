const mongoose = require('mongoose');
const memberSchema = new mongoose.Schema({
  user:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
  ready:{type:Boolean,default:false},joinedAt:{type:Date,default:Date.now},
},{_id:false});
const teamSchema = new mongoose.Schema({
  name:{type:String,enum:['Alpha','Beta'],required:true},members:[memberSchema],
  // Reserved for the next scoring phase; no awards are made in this phase.
  score:{type:Number,default:0},
});
const schema = new mongoose.Schema({
  schemaVersion:{type:Number,default:1},revision:{type:Number,default:0},
  code:{type:String,required:true,unique:true},
  host:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
  hostType:{type:String,enum:['PARTICIPANT_HOST','EXTERNAL_HOST'],required:true},
  teamSize:{type:Number,enum:[1,2,3,4],required:true},teams:[teamSchema],
  duration:{type:Number,required:true},problemCount:{type:Number,required:true},
  problems:[{type:mongoose.Schema.Types.ObjectId,ref:'Problem'}],
  status:{type:String,enum:['waiting','ready','in_progress','completed','cancelled'],default:'waiting'},
  startTime:Date,endTime:Date,completedAt:Date,cancelledAt:Date,
},{timestamps:true});
schema.index({status:1,endTime:1});
schema.index({host:1,updatedAt:-1});
schema.index({'teams.members.user':1,updatedAt:-1});
module.exports=mongoose.model('BattleRoom',schema);
