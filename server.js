require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Route imports
const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const authMiddleware = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.set('trust proxy', 1);

// ─── CORS ───────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'https://vickydata.netlify.app',
    'http://127.0.0.1:5500',
    'http://localhost:5500'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

// ─── Rate Limiting ──────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests from this IP. Please try again after 15 minutes.' }
});

app.use(limiter);

// ─── Raw body for Paystack webhook (MUST come before express.json()) ─────────
// Paystack webhook needs the raw body buffer for HMAC signature verification
app.use('/api/wallet/paystack-webhook', express.raw({ type: 'application/json' }));

// ─── JSON Body Parser ────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.status(200).json({ status: 'VICKYDATA API is running' });
});

// ─── Configuration ────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.status(200).json({
    paystack_live_enabled: process.env.PAYSTACK_LIVE_ENABLED === 'true'
  });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

app.use('/api/purchase', purchaseRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/announcement', announcementRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} not found.` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`VICKYDATA API running on port ${PORT}`);
});

module.exports = app;
