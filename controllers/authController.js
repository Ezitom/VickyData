const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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

    // Send welcome email (non-blocking — do not await so SMTP issues don't affect registration)
    sendMail(
      email,
      'Welcome to VICKYDATA!',
      `
      <div style="font-family: Arial, sans-serif; 
                  max-width: 600px; margin: 0 auto;">
        
        <div style="background-color: #0D0D0D; 
                    padding: 32px; 
                    text-align: center;
                    border-radius: 12px 12px 0 0;">
          <h1 style="color: #00C6AE; 
                     margin: 0; 
                     font-size: 2rem;
                     letter-spacing: 2px;">
            VICKY<span style="color: white;">DATA</span>
          </h1>
        </div>

        <div style="background-color: #ffffff; 
                    padding: 32px;
                    border-radius: 0 0 12px 12px;
                    border: 1px solid #eee;">
          
          <h2 style="color: #111; margin-top: 0;">
            Welcome to VICKYDATA, 
            ${full_name.split(' ')[0]}! 🎉
          </h2>
          
          <p style="color: #555; line-height: 1.6;">
            Your account has been created successfully. 
            You can now buy affordable data and airtime 
            for all Nigerian networks instantly.
          </p>

          <div style="background: #f5f5f5; 
                      border-radius: 8px; 
                      padding: 20px; 
                      margin: 24px 0;">
            <h3 style="margin-top:0; color:#111;">
              What you can do on VICKYDATA:
            </h3>
            <ul style="color: #555; 
                       line-height: 2; 
                       padding-left: 20px;">
              <li>Buy data for MTN, Airtel, Glo and 9mobile</li>
              <li>Send airtime to any Nigerian number</li>
              <li>Fund your wallet once and buy anytime</li>
              <li>Track all your transactions in one place</li>
            </ul>
          </div>

          <a href="https://vickydata.netlify.app/login.html"
             style="display: block;
                    background-color: #00C6AE;
                    color: #0D0D0D;
                    text-decoration: none;
                    padding: 14px 24px;
                    border-radius: 8px;
                    text-align: center;
                    font-weight: 700;
                    font-size: 1rem;
                    margin: 24px 0;">
            Login to Your Account
          </a>

          <p style="color: #555; line-height: 1.6;">
            If you have any questions or need help, 
            chat with us directly on WhatsApp:
            <a href="https://wa.me/2348143905306" 
               style="color: #00C6AE; 
                      font-weight: 600;">
              Click here to chat
            </a>
          </p>

          <hr style="border: none; 
                     border-top: 1px solid #eee; 
                     margin: 24px 0;">
          
          <p style="color: #999; 
                    font-size: 0.8rem; 
                    text-align: center;">
            This email was sent because you created an 
            account on VICKYDATA. If you did not create 
            this account please ignore this email.
          </p>
        </div>
      </div>
      `
    );

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

// PATCH /api/auth/me
const updateMe = async (req, res) => {
  try {
    const { full_name, phone } = req.body;

    if (!full_name || !phone) {
      return res.status(400).json({ message: 'full_name and phone are required.' });
    }

    if (!isValidNigerianPhone(phone)) {
      return res.status(400).json({ message: 'Phone must be 11 digits and start with 070, 080, 081, 090, or 091.' });
    }

    // Check if phone already exists for another user
    const { data: existingPhone } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .neq('id', req.user.id)
      .single();

    if (existingPhone) {
      return res.status(409).json({ message: 'An account with this phone number already exists.' });
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({
        full_name,
        phone,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user.id)
      .select('id, full_name, email, phone, wallet_balance, role')
      .single();

    if (updateError) {
      console.error('Update user profile error:', updateError);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({
      message: 'Profile updated successfully.',
      user: updatedUser
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    // Look up user — always return the same message to prevent email enumeration
    const { data: user } = await supabase
      .from('users')
      .select('id, full_name, email')
      .eq('email', email.toLowerCase())
      .single();

    if (user) {
      // Generate a 6-digit OTP token
      const token = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

      // Delete any existing reset tokens for this user
      await supabase
        .from('password_resets')
        .delete()
        .eq('user_id', user.id);

      // Store new token
      const { error: insertError } = await supabase
        .from('password_resets')
        .insert({ user_id: user.id, token, expires_at: expiresAt });

      if (insertError) {
        console.error('Password reset insert error:', insertError);
        return res.status(500).json({ message: 'Something went wrong. Please try again.' });
      }

      // Send reset email
      const firstName = user.full_name.split(' ')[0];
      const resetHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
              .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #00C6AE, #009E8E); padding: 30px; text-align: center; }
              .header h1 { color: #fff; margin: 0; font-size: 28px; letter-spacing: 2px; }
              .body { padding: 30px; }
              .body h2 { color: #333; }
              .body p { color: #555; line-height: 1.7; }
              .otp-box { display: block; width: fit-content; margin: 24px auto; background: #f0fffe; border: 2px dashed #00C6AE; border-radius: 12px; padding: 16px 40px; text-align: center; }
              .otp-code { font-size: 42px; font-weight: bold; color: #00C6AE; letter-spacing: 8px; font-family: monospace; }
              .footer { background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #999; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header"><h1>VICKYDATA</h1></div>
              <div class="body">
                <h2>Password Reset Request</h2>
                <p>Hi ${firstName},</p>
                <p>We received a request to reset your VICKYDATA account password. Use the OTP code below to reset your password. This code expires in <strong>15 minutes</strong>.</p>
                <div class="otp-box">
                  <div class="otp-code">${token}</div>
                </div>
                <p>Enter this code on the password reset page along with your new password.</p>
                <p>If you did not request a password reset, you can safely ignore this email — your password will not change.</p>
              </div>
              <div class="footer">&copy; ${new Date().getFullYear()} VICKYDATA. All rights reserved.</div>
            </div>
          </body>
        </html>
      `;

      sendMail(user.email, 'VICKYDATA - Password Reset OTP', resetHtml);
    }

    // Always return success to prevent email enumeration
    return res.status(200).json({
      message: 'If an account with that email exists, a reset code has been sent.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res) => {
  try {
    const { email, token, new_password } = req.body;

    if (!email || !token || !new_password) {
      return res.status(400).json({ message: 'email, token, and new_password are required.' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    // Look up user
    const { data: user } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email.toLowerCase())
      .single();

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset code.' });
    }

    // Look up reset token
    const { data: resetRecord } = await supabase
      .from('password_resets')
      .select('token, expires_at')
      .eq('user_id', user.id)
      .eq('token', token)
      .single();

    if (!resetRecord) {
      return res.status(400).json({ message: 'Invalid or expired reset code.' });
    }

    // Check expiry
    if (new Date() > new Date(resetRecord.expires_at)) {
      await supabase.from('password_resets').delete().eq('user_id', user.id);
      return res.status(400).json({ message: 'Reset code has expired. Please request a new one.' });
    }

    // Hash new password
    const password_hash = await bcrypt.hash(new_password, 10);

    // Update user password
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (updateError) {
      console.error('Reset password update error:', updateError);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    // Delete used token
    await supabase.from('password_resets').delete().eq('user_id', user.id);

    return res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

module.exports = { register, login, getMe, changePassword, updateMe, forgotPassword, resetPassword };
