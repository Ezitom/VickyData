const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { sendMail } = require('../config/mailer');

// Helper: generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Helper: validate Nigerian phone number
const isValidNigerianPhone = (phone) => {
  return /^(070|080|081|090|091)\d{8}$/.test(phone);
};

// Helper: validate email format
const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// POST /api/auth/register
const register = async (req, res) => {
  try {
    const { full_name, email, phone, password } = req.body;

    // Validate required fields
    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({ message: 'All fields are required: full_name, email, phone, password.' });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format.' });
    }

    // Validate phone number
    if (!isValidNigerianPhone(phone)) {
      return res.status(400).json({ message: 'Phone must be 11 digits and start with 070, 080, 081, 090, or 091.' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    // Check if email already exists
    const { data: existingEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingEmail) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    // Check if phone already exists
    const { data: existingPhone } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingPhone) {
      return res.status(409).json({ message: 'An account with this phone number already exists.' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Insert new user
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        full_name,
        email: email.toLowerCase(),
        phone,
        password_hash,
        role: 'user'
      })
      .select('id, full_name, email, phone, wallet_balance, role')
      .single();

    if (insertError) {
      console.error('Register insert error:', insertError);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    // Generate JWT
    const token = generateToken(newUser);

    // Send welcome email (non-blocking)
    const firstName = full_name.split(' ')[0];
    const welcomeHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #6c3de0, #a855f7); padding: 30px; text-align: center; }
            .header h1 { color: #fff; margin: 0; font-size: 28px; letter-spacing: 2px; }
            .body { padding: 30px; }
            .body h2 { color: #333; }
            .body p { color: #555; line-height: 1.7; }
            .btn { display: inline-block; background: linear-gradient(135deg, #6c3de0, #a855f7); color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 16px; }
            .footer { background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>VICKYDATA</h1></div>
            <div class="body">
              <h2>Welcome, ${firstName}! 🎉</h2>
              <p>Your VICKYDATA account is ready. You can now fund your wallet and purchase affordable data plans and airtime for any Nigerian network — MTN, Airtel, Glo, and 9mobile.</p>
              <p>Get started by funding your wallet and enjoy seamless top-ups anytime, anywhere.</p>
              <a href="${process.env.FRONTEND_URL}" class="btn">Visit VICKYDATA</a>
              <p style="margin-top: 24px;">If you did not create this account, please ignore this email.</p>
            </div>
            <div class="footer">
              &copy; ${new Date().getFullYear()} VICKYDATA. All rights reserved.
            </div>
          </div>
        </body>
      </html>
    `;

    sendMail(newUser.email, 'Welcome to VICKYDATA', welcomeHtml);

    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: {
        id: newUser.id,
        full_name: newUser.full_name,
        email: newUser.email,
        phone: newUser.phone,
        wallet_balance: newUser.wallet_balance,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    // Find user by email (include password_hash)
    const { data: user, error } = await supabase
      .from('users')
      .select('id, full_name, email, phone, wallet_balance, role, is_active, password_hash')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ message: 'Account suspended. Contact support.' });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        wallet_balance: user.wallet_balance,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    // Fetch fresh wallet balance
    const { data: user, error } = await supabase
      .from('users')
      .select('id, full_name, email, phone, wallet_balance, role')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({ user });
  } catch (error) {
    console.error('GetMe error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/auth/change-password
const changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ message: 'current_password and new_password are required.' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    // Fetch user with password hash
    const { data: user, error } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    // Hash new password
    const new_password_hash = await bcrypt.hash(new_password, 10);

    // Update in Supabase
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: new_password_hash, updated_at: new Date().toISOString() })
      .eq('id', req.user.id);

    if (updateError) {
      console.error('Change password update error:', updateError);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

module.exports = { register, login, getMe, changePassword };
