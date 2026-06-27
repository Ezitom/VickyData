const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getUserTransactions,
  getSingleTransaction
} = require('../controllers/transactionController');

router.get('/', authMiddleware, getUserTransactions);
router.get('/:id', authMiddleware, getSingleTransaction);

module.exports = router;
