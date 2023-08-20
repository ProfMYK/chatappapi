const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  text: String,
  sender: String,
  senderId: String,
  receiverId: String,
}, { timestamps: true });

module.exports = mongoose.model('Message', MessageSchema);
