const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/user');

// @route   GET /api/users
// @desc    Get all users for chat functionality
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    // Get all users except the current user
    const users = await User.find({ _id: { $ne: req.user.id } })
      .select('username userType walletAddress');
    
    res.json(users);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/users/contacts/add/:userId
// @desc    Add a user to business associates/contacts
// @access  Private
router.post('/contacts/add/:userId', auth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const userToAddId = req.params.userId;
    
    // Check if the user to add exists
    const userToAdd = await User.findById(userToAddId);
    if (!userToAdd) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    // Get current user
    const currentUser = await User.findById(currentUserId);
    
    // Check if user is already in contacts
    if (currentUser.businessAssociates.includes(userToAddId)) {
      return res.status(400).json({ msg: 'User already in contacts' });
    }
    
    // Add user to business associates
    currentUser.businessAssociates.push(userToAddId);
    await currentUser.save();
    
    // Return the updated business associates list with user details
    const updatedUser = await User.findById(currentUserId)
      .populate('businessAssociates', 'username email userType walletAddress isOnline');
    
    res.json({
      msg: 'User added to contacts',
      contacts: updatedUser.businessAssociates
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   DELETE /api/users/contacts/remove/:userId
// @desc    Remove a user from business associates/contacts
// @access  Private
router.delete('/contacts/remove/:userId', auth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const userToRemoveId = req.params.userId;
    
    // Get current user
    const currentUser = await User.findById(currentUserId);
    
    // Check if user is in contacts
    if (!currentUser.businessAssociates.includes(userToRemoveId)) {
      return res.status(400).json({ msg: 'User not in contacts' });
    }
    
    // Remove user from business associates
    currentUser.businessAssociates = currentUser.businessAssociates
      .filter(userId => userId.toString() !== userToRemoveId);
      
    await currentUser.save();
    
    // Return the updated business associates list with user details
    const updatedUser = await User.findById(currentUserId)
      .populate('businessAssociates', 'username email userType walletAddress isOnline');
    
    res.json({
      msg: 'User removed from contacts',
      contacts: updatedUser.businessAssociates
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/users/profile
// @desc    Get user profile by userType and walletAddress
// @access  Public
router.post('/profile', auth, async (req, res) => {
  try {
    const { userType, walletAddress } = req.body;
    const userId = req.user.id;
    
    // Create an update object with only valid fields
    const updateFields = {};
    if (userType && userType !== '') {
      updateFields.userType = userType;
    }
    if (walletAddress && walletAddress !== '') {
      updateFields.walletAddress = walletAddress;
    }
    
    // Update the user if there are fields to update
    if (Object.keys(updateFields).length > 0) {
      await User.findByIdAndUpdate(userId, updateFields);
    }
    
    // Get the updated user data
    const updatedUser = await User.findById(userId);
    
    // Return only userType and walletAddress
    res.json({
      userType: updatedUser.userType || '',
      walletAddress: updatedUser.walletAddress || ''
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;