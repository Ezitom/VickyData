const supabase = require('../config/supabase');
const { sendAnnouncementEmails } = require('../utils/emailTemplates');

/**
 * POST /api/admin/announcement
 * Admin publishes a new announcement.
 * Deactivates existing active announcements, inserts a new active one,
 * and triggers Brevo email send to all users in background.
 */
const publishAnnouncement = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Announcement message is required.' });
    }

    const trimmedMessage = message.trim();

    // 1. Deactivate old active announcements
    const { error: deactivateError } = await supabase
      .from('announcements')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('is_active', true);

    if (deactivateError) {
      console.error('Error deactivating old announcements:', deactivateError);
      return res.status(500).json({ message: 'Failed to update old announcements.' });
    }

    // 2. Insert new active announcement
    const { data: newAnnouncement, error: insertError } = await supabase
      .from('announcements')
      .insert([
        {
          message: trimmedMessage,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (insertError || !newAnnouncement) {
      console.error('Error inserting new announcement:', insertError);
      return res.status(500).json({ message: 'Failed to publish new announcement.' });
    }

    // 3. Trigger Brevo email send asynchronously in background (fire-and-forget)
    setImmediate(() => {
      sendAnnouncementEmails(trimmedMessage).catch(err => {
        console.error('Background announcement email error:', err);
      });
    });

    return res.status(201).json({
      message: 'Announcement published successfully.',
      announcement: newAnnouncement
    });
  } catch (error) {
    console.error('publishAnnouncement controller error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

/**
 * GET /api/admin/announcement
 * Returns current active announcement for admin preview.
 */
const getAdminAnnouncement = async (req, res) => {
  try {
    const { data: activeAnnouncement, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching admin active announcement:', error);
      return res.status(500).json({ message: 'Failed to fetch active announcement.' });
    }

    return res.status(200).json({
      announcement: activeAnnouncement || null
    });
  } catch (error) {
    console.error('getAdminAnnouncement controller error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

/**
 * GET /api/announcement
 * Customer facing route to get current active announcement if not already seen.
 */
const getCustomerAnnouncement = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Fetch current active announcement
    const { data: activeAnnouncement, error: annError } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (annError) {
      console.error('Error fetching customer active announcement:', annError);
      return res.status(500).json({ message: 'Failed to fetch announcement.' });
    }

    if (!activeAnnouncement) {
      return res.status(200).json({ announcement: null });
    }

    // 2. Check if logged in user has seen this announcement
    const { data: viewRecord, error: viewError } = await supabase
      .from('announcement_views')
      .select('id')
      .eq('user_id', userId)
      .eq('announcement_id', activeAnnouncement.id)
      .maybeSingle();

    if (viewError) {
      console.error('Error checking announcement_views:', viewError);
      return res.status(500).json({ message: 'Failed to check announcement status.' });
    }

    if (viewRecord) {
      // User has already seen this announcement
      return res.status(200).json({ announcement: null });
    }

    return res.status(200).json({
      announcement: activeAnnouncement
    });
  } catch (error) {
    console.error('getCustomerAnnouncement controller error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

/**
 * POST /api/announcement/seen
 * Customer facing route to mark announcement as seen.
 */
const markAnnouncementSeen = async (req, res) => {
  try {
    const userId = req.user.id;
    const { announcement_id } = req.body;

    if (!announcement_id) {
      return res.status(400).json({ message: 'Announcement ID is required.' });
    }

    const { error } = await supabase
      .from('announcement_views')
      .upsert(
        [
          {
            user_id: userId,
            announcement_id,
            seen_at: new Date().toISOString()
          }
        ],
        { onConflict: 'user_id,announcement_id', ignoreDuplicates: true }
      );

    if (error) {
      console.error('Error marking announcement seen:', error);
      return res.status(500).json({ message: 'Failed to record announcement view.' });
    }

    return res.status(200).json({ message: 'Announcement marked as seen.' });
  } catch (error) {
    console.error('markAnnouncementSeen controller error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

module.exports = {
  publishAnnouncement,
  getAdminAnnouncement,
  getCustomerAnnouncement,
  markAnnouncementSeen
};
