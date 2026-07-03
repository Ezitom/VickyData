// ⚠️  DEPRECATED — This file is no longer used.
// The project has migrated to PeaceSub as the VTU provider.
// See config/peacesub.js for the active provider configuration.
// This file is kept only for historical reference.


const baseURL = String(process.env.CHEAPDATAHUB_BASE_URL || '')
  .trim()
  .replace(/\/+$/g, '') + '/';

const cheapDataHub = axios.create({
  baseURL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.CHEAPDATAHUB_API_KEY}`
  }
});

module.exports = cheapDataHub;
