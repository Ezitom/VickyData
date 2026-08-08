const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getCustomerAnnouncement,
  markAnnouncementSeen
} = require('../controllers/announcementController');

// All customer announcement routes require authentication
router.use(authMiddleware);

router.get('/', getCustomerAnnouncement);
router.post('/seen', markAnnouncementSeen);

module.exports = router;
