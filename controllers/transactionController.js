const supabase = require('../config/supabase');

// GET /api/transactions
const getUserTransactions = async (req, res) => {
  try {
    const { type, status } = req.query;

    let query = supabase
      .from('transactions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);

    const { data: transactions, error } = await query;

    if (error) {
      console.error('Get transactions error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({ transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/transactions/:id
const getSingleTransaction = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: transaction, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id) // Users can only access their own transactions
      .single();

    if (error || !transaction) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    return res.status(200).json({ transaction });
  } catch (error) {
    console.error('Get single transaction error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

module.exports = { getUserTransactions, getSingleTransaction };
