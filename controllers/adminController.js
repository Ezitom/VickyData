const supabase = require('../config/supabase');
const peaceSub = require('../config/peacesub');
const { sendMail } = require('../config/mailer');
const { findProviderPlanMatch } = require('../utils/providerPlanResolver');

// Helper: format currency
const formatAmount = (amount) => {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);
};

// GET /api/admin/overview
const getOverview = async (req, res) => {
  try {
    // Total revenue (successful non-funding transactions)
    const { data: revenueData, error: revenueError } = await supabase
      .from('transactions')
      .select('amount')
      .in('type', ['data', 'airtime'])
      .eq('status', 'successful');

    const totalRevenue = revenueData
      ? revenueData.reduce((sum, t) => sum + parseFloat(t.amount), 0)
      : 0;

    // Total users
    const { count: totalUsers } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'user');

    // Transactions today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: todayCount } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    // Total Paystack funding transactions
    const { count: totalFunding } = await supabase
      .from('wallet_funding')
      .select('id', { count: 'exact', head: true });

    return res.status(200).json({
      total_revenue: totalRevenue,
      total_users: totalUsers || 0,
      transactions_today: todayCount || 0,
      total_funding_count: totalFunding || 0
    });
  } catch (error) {
    console.error('Admin overview error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/admin/transactions
const getAllTransactions = async (req, res) => {
  try {
    const { type, status, network, date_from, date_to } = req.query;

    let query = supabase
      .from('transactions')
      .select(`
        *,
        users (full_name, email)
      `)
      .order('created_at', { ascending: false });

    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);
    if (network) query = query.eq('network', network);
    if (date_from) query = query.gte('created_at', new Date(date_from).toISOString());
    if (date_to) {
      const endDate = new Date(date_to);
      endDate.setHours(23, 59, 59, 999);
      query = query.lte('created_at', endDate.toISOString());
    }

    const { data: transactions, error } = await query;

    if (error) {
      console.error('Admin get transactions error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({ transactions });
  } catch (error) {
    console.error('Admin get transactions error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/admin/users
const getAllUsers = async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, full_name, email, phone, wallet_balance, is_active, created_at, role')
      .eq('role', 'user')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Admin get users error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({ users });
  } catch (error) {
    console.error('Admin get users error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/admin/users/:id
const getSingleUser = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from('users')
      .select('id, full_name, email, phone, wallet_balance, is_active, role, created_at')
      .eq('id', id)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Count transactions
    const { count: transactionCount } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id);

    return res.status(200).json({ user: { ...user, transaction_count: transactionCount || 0 } });
  } catch (error) {
    console.error('Admin get single user error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// PATCH /api/admin/users/:id/toggle-status
const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('id, is_active')
      .eq('id', id)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const newStatus = !user.is_active;

    const { error: updateError } = await supabase
      .from('users')
      .update({ is_active: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      console.error('Toggle user status error:', updateError);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({
      message: newStatus ? 'User activated successfully.' : 'User suspended successfully.',
      is_active: newStatus
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/admin/plans
const getPlans = async (req, res) => {
  try {
    const { data: plans, error } = await supabase
      .from('data_plans')
      .select('*')
      .order('network')
      .order('selling_price');

    if (error) {
      console.error('Admin get plans error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({ plans });
  } catch (error) {
    console.error('Admin get plans error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/admin/plans
const createPlan = async (req, res) => {
  try {
    const { network, plan_name, size, validity, bundle_id, cost_price, selling_price } = req.body;

    if (!network || !plan_name || !size || !validity || !bundle_id || !cost_price || !selling_price) {
      return res.status(400).json({ message: 'All fields are required: network, plan_name, size, validity, bundle_id, cost_price, selling_price.' });
    }

    const validNetworks = ['MTN', 'Airtel', 'Glo', '9mobile'];
    if (!validNetworks.includes(network)) {
      return res.status(400).json({ message: 'Invalid network.' });
    }

    const { data: plan, error } = await supabase
      .from('data_plans')
      .insert({ network, plan_name, size, validity, bundle_id, cost_price, selling_price })
      .select()
      .single();

    if (error) {
      console.error('Admin create plan error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(201).json({ message: 'Plan created successfully.', plan });
  } catch (error) {
    console.error('Admin create plan error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// PATCH /api/admin/plans/:id
const updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { cost_price, selling_price, plan_name, size, validity, bundle_id } = req.body;

    const updateFields = {};
    if (cost_price !== undefined) updateFields.cost_price = cost_price;
    if (selling_price !== undefined) updateFields.selling_price = selling_price;
    if (plan_name !== undefined) updateFields.plan_name = plan_name;
    if (size !== undefined) updateFields.size = size;
    if (validity !== undefined) updateFields.validity = validity;
    if (bundle_id !== undefined) updateFields.bundle_id = bundle_id;

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update.' });
    }

    const { data: plan, error } = await supabase
      .from('data_plans')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Admin update plan error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({ message: 'Plan updated successfully.', plan });
  } catch (error) {
    console.error('Admin update plan error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// PATCH /api/admin/plans/:id/toggle-status
const togglePlanStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: plan, error: fetchError } = await supabase
      .from('data_plans')
      .select('id, is_active')
      .eq('id', id)
      .single();

    if (fetchError || !plan) {
      return res.status(404).json({ message: 'Data plan not found.' });
    }

    const newStatus = !plan.is_active;

    const { error: updateError } = await supabase
      .from('data_plans')
      .update({ is_active: newStatus })
      .eq('id', id);

    if (updateError) {
      console.error('Toggle plan status error:', updateError);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({
      message: newStatus ? 'Plan activated successfully.' : 'Plan deactivated successfully.',
      is_active: newStatus
    });
  } catch (error) {
    console.error('Toggle plan status error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/admin/wallet-funding
const getWalletFunding = async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from('wallet_funding')
      .select(`
        *,
        users (full_name, email)
      `)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data: funding, error } = await query;

    if (error) {
      console.error('Admin get wallet funding error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({ funding });
  } catch (error) {
    console.error('Admin get wallet funding error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// PATCH /api/admin/wallet-funding/:id/approve
// approveFunding and rejectFunding removed as Paystack webhook handles this automatically.

// GET /api/admin/settings
const getSettings = async (req, res) => {
  try {
    const { data: settings, error } = await supabase
      .from('site_settings')
      .select('setting_key, setting_value');

    if (error) {
      console.error('Admin get settings error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    // Convert to key-value object
    const settingsObj = {};
    settings.forEach((s) => {
      settingsObj[s.setting_key] = s.setting_value;
    });

    return res.status(200).json({ settings: settingsObj });
  } catch (error) {
    console.error('Admin get settings error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// PATCH /api/admin/settings
const updateSettings = async (req, res) => {
  try {
    const settingsToUpdate = req.body;

    if (!settingsToUpdate || typeof settingsToUpdate !== 'object' || Object.keys(settingsToUpdate).length === 0) {
      return res.status(400).json({ message: 'No settings provided to update.' });
    }

    // Upsert each setting
    const upsertPromises = Object.entries(settingsToUpdate).map(([key, value]) =>
      supabase
        .from('site_settings')
        .upsert(
          { setting_key: key, setting_value: String(value), updated_at: new Date().toISOString() },
          { onConflict: 'setting_key' }
        )
    );

    await Promise.all(upsertPromises);

    return res.status(200).json({ message: 'Settings updated successfully.' });
  } catch (error) {
    console.error('Admin update settings error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/admin/wallet-balance
const getProviderWalletBalance = async (req, res) => {
  try {
    const peaceSub = require('../config/peacesub');
    const response = await peaceSub.get('/user/');
    res.json({
      balance: response.data.wallet_balance || 
               response.data.balance || 0
    });
  } catch (error) {
    console.error('Provider wallet balance error:', error);
    res.status(500).json({
      message: 'Could not fetch provider wallet balance.'
    });
  }
};

// POST /api/admin/sync-plans
const syncPlans = async (req, res) => {
  try {
    const peaceSub = require('../config/peacesub');

    const response = await peaceSub.get('/dataplans/');
    const psPlans = response.data || [];

    const syncResults = [];
    const errors = [];

    for (const psPlan of psPlans) {
      try {
        const { data: existingPlan } = await supabase
          .from('data_plans')
          .select('*')
          .eq('bundle_id', psPlan.id)
          .single();

        if (existingPlan) {
          const oldCostPrice = 
            parseFloat(existingPlan.cost_price);
          const newCostPrice = 
            parseFloat(psPlan.plan_amount);

          if (oldCostPrice !== newCostPrice) {
            await supabase
              .from('data_plans')
              .update({ cost_price: newCostPrice })
              .eq('id', existingPlan.id);

            syncResults.push({
              network: existingPlan.network,
              plan: existingPlan.plan_name,
              old_cost: oldCostPrice,
              new_cost: newCostPrice,
              changed: true
            });
          } else {
            syncResults.push({
              network: existingPlan.network,
              plan: existingPlan.plan_name,
              old_cost: oldCostPrice,
              new_cost: newCostPrice,
              changed: false
            });
          }
        }
      } catch (planError) {
        errors.push({
          plan: psPlan.id,
          error: planError.message
        });
      }
    }

    const changedPlans = syncResults.filter(p => p.changed);
    const unchangedPlans = syncResults.filter(p => !p.changed);

    const { sendMail } = require('../config/mailer');
    await sendMail(
      process.env.MAIL_USER,
      'VICKYDATA - Plan Sync Complete',
      `
      <h2>Plan Sync Results</h2>
      <p><strong>Total plans checked:</strong> 
        ${syncResults.length}</p>
      <p><strong>Plans with price changes:</strong> 
        ${changedPlans.length}</p>
      <p><strong>Unchanged plans:</strong> 
        ${unchangedPlans.length}</p>

      ${changedPlans.length > 0 ? `
      <h3>Changed Plans:</h3>
      <table border="1" cellpadding="8">
        <tr>
          <th>Network</th>
          <th>Plan</th>
          <th>Old Cost</th>
          <th>New Cost</th>
        </tr>
        ${changedPlans.map(p => `
          <tr>
            <td>${p.network}</td>
            <td>${p.plan}</td>
            <td>N${p.old_cost}</td>
            <td>N${p.new_cost}</td>
          </tr>
        `).join('')}
      </table>
      ` : '<p>No price changes found.</p>'}

      <p>Log into your admin dashboard to review and 
         adjust selling prices if needed.</p>
      `
    );

    res.json({
      message: 'Plans synced successfully',
      summary: {
        total_checked: syncResults.length,
        changed: changedPlans.length,
        unchanged: unchangedPlans.length,
        errors: errors.length
      },
      changed_plans: changedPlans,
      errors
    });

  } catch (error) {
    console.error('Sync plans error:', error);
    res.status(500).json({
      message: 'Failed to sync plans. Please try again.'
    });
  }
};

module.exports = {
  getOverview,
  getAllTransactions,
  getAllUsers,
  getSingleUser,
  toggleUserStatus,
  getPlans,
  createPlan,
  updatePlan,
  togglePlanStatus,
  getWalletFunding,
  getSettings,
  updateSettings,
  getProviderWalletBalance,
  syncPlans
};
