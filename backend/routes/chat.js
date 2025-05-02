const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const ChatRoom = require('../models/ChatRoom');
const Message = require('../models/Message');
const User = require('../models/user');
const { uploadFile } = require('../config/supabase');

// @route   GET /api/chat/rooms
// @desc    Get all chat rooms for the current user
// @access  Private
router.get('/rooms', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find all chat rooms where the user is a participant
    const chatRooms = await ChatRoom.find({ participants: userId })
      .populate('disputeId', 'title status')
      .populate('participants', 'username email')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });
    
    res.json(chatRooms);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/chat/rooms/:roomId
// @desc    Get a specific chat room by ID
// @access  Private
router.get('/rooms/:roomId', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    
    // Find the chat room and check if user is a participant
    const chatRoom = await ChatRoom.findById(roomId)
      .populate('disputeId', 'title status')
      .populate('participants', 'username email')
      .populate('lastMessage');
    
    if (!chatRoom) {
      return res.status(404).json({ msg: 'Chat room not found' });
    }
    
    if (!chatRoom.participants.some(participant => participant._id.toString() === userId)) {
      return res.status(403).json({ msg: 'Not authorized to access this chat room' });
    }
    
    res.json(chatRoom);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/chat/messages/:roomId
// @desc    Get messages for a specific chat room
// @access  Private
router.get('/messages/:roomId', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    
    // Check if room exists and user is a participant
    const chatRoom = await ChatRoom.findById(roomId);
    
    if (!chatRoom) {
      return res.status(404).json({ msg: 'Chat room not found' });
    }
    
    if (!chatRoom.participants.includes(userId)) {
      return res.status(403).json({ msg: 'Not authorized to access these messages' });
    }
    
    // Get messages for the room
    const messages = await Message.find({ chatRoom: roomId })
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .populate('sender', 'username email')
      .lean();
    
    // Mark messages as read
    await Message.updateMany(
      { 
        chatRoom: roomId, 
        sender: { $ne: userId }, 
        readBy: { $ne: userId } 
      },
      { $push: { readBy: userId } }
    );
    
    res.json({
      messages: messages.reverse(),
      total: await Message.countDocuments({ chatRoom: roomId })
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/chat/direct/:userId
// @desc    Get direct messages with a specific user
// @access  Private
router.get('/direct/:userId', auth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const otherUserId = req.params.userId;
    const { limit = 50, offset = 0 } = req.query;
    
    // Check if other user exists
    const otherUser = await User.findById(otherUserId);
    
    if (!otherUser) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    // Get direct messages between the two users
    const messages = await Message.find({
      chatRoom: null, // Direct messages don't belong to a chat room
      $or: [
        { sender: currentUserId, receiver: otherUserId },
        { sender: otherUserId, receiver: currentUserId }
      ]
    })
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .populate('sender', 'username email')
      .lean();
    
    // Mark messages as read
    await Message.updateMany(
      { 
        sender: otherUserId, 
        receiver: currentUserId, 
        readBy: { $ne: currentUserId } 
      },
      { $push: { readBy: currentUserId } }
    );
    
    res.json({
      messages: messages.reverse(),
      total: await Message.countDocuments({
        chatRoom: null,
        $or: [
          { sender: currentUserId, receiver: otherUserId },
          { sender: otherUserId, receiver: currentUserId }
        ]
      })
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/chat/messages/:roomId
// @desc    Send a message to a chat room
// @access  Private
router.post('/messages/:roomId', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    const { content, messageType = 'text', fileData } = req.body;
    
    // Check if room exists and user is a participant
    const chatRoom = await ChatRoom.findById(roomId);
    
    if (!chatRoom) {
      return res.status(404).json({ msg: 'Chat room not found' });
    }
    
    if (!chatRoom.participants.includes(userId)) {
      return res.status(403).json({ msg: 'Not authorized to send messages in this chat room' });
    }
    
    let fileUrl = null;
    let fileName = null;
    
    // Handle file uploads if present
    if (fileData && (messageType === 'file' || messageType === 'image')) {
      const { base64, name, type } = fileData;
      fileUrl = await uploadFile({ data: base64, name, type }, `disputes/${chatRoom.disputeId}`);
      fileName = name;
    }
    
    // Create new message
    const newMessage = await Message.create({
      sender: userId,
      content,
      chatRoom: roomId,
      messageType,
      fileUrl,
      fileName,
      readBy: [userId] // Mark as read by sender
    });
    
    // Update chat room with last message
    chatRoom.lastMessage = newMessage._id;
    await chatRoom.save();
    
    // Populate the message with sender info
    await newMessage.populate('sender', 'username email');
    
    res.status(201).json(newMessage);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/chat/direct/:userId
// @desc    Send a direct message to a user
// @access  Private
router.post('/direct/:userId', auth, async (req, res) => {
  try {
    const senderId = req.user.id;
    const receiverId = req.params.userId;
    const { content, messageType = 'text', fileData } = req.body;
    
    // Check if receiver exists
    const receiver = await User.findById(receiverId);
    
    if (!receiver) {
      return res.status(404).json({ msg: 'Receiver not found' });
    }
    
    let fileUrl = null;
    let fileName = null;
    
    // Handle file uploads if present
    if (fileData && (messageType === 'file' || messageType === 'image')) {
      const { base64, name, type } = fileData;
      fileUrl = await uploadFile({ data: base64, name, type }, `direct/${senderId}_${receiverId}`);
      fileName = name;
    }
    
    // Create new message
    const newMessage = await Message.create({
      sender: senderId,
      receiver: receiverId,
      content,
      messageType,
      fileUrl,
      fileName,
      readBy: [senderId] // Mark as read by sender
    });
    
    // Populate the message with sender info
    await newMessage.populate('sender', 'username email');
    
    res.status(201).json(newMessage);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/chat/contacts
// @desc    Get user's contact list
// @access  Private
router.get('/contacts', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's business associates
    const user = await User.findById(userId).populate('businessAssociates', 'username email isOnline lastSeen');
    
    // Get users from recent direct messages as well
    const recentChats = await Message.aggregate([
      { $match: { $or: [{ sender: new mongoose.Types.ObjectId(userId) }, { receiver: new mongoose.Types.ObjectId(userId) }], chatRoom: null } },
      { $group: { _id: { $cond: [{ $eq: ['$sender', new mongoose.Types.ObjectId(userId)] }, '$receiver', '$sender'] } } },
      { $limit: 20 }
    ]);
    
    const recentChatUserIds = recentChats.map(chat => chat._id);
    
    // Fetch user details for recent chats
    const recentChatUsers = await User.find({
      _id: { $in: recentChatUserIds }
    }).select('username email isOnline lastSeen');
    
    // Combine business associates and recent chat users, removing duplicates
    const contacts = [...user.businessAssociates];
    recentChatUsers.forEach(recentUser => {
      if (!contacts.some(contact => contact._id.equals(recentUser._id))) {
        contacts.push(recentUser);
      }
    });
    
    res.json(contacts);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;