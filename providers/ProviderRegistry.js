/**
 * ProviderRegistry — Loads and manages all VTU provider adapters.
 * ----------------------------------------------------------------
 * Reads provider configuration from environment variables and the
 * database (vtu_providers table). Instantiates each adapter and
 * makes them accessible by slug.
 *
 * The PRIMARY provider is determined by the database at runtime —
 * no code change is needed to switch providers.
 */
const supabase = require('../config/supabase');
const PeaceSubProvider = require('./peacesub/PeaceSubProvider');
const RapidBillsProvider = require('./rapidbills/RapidBillsProvider');
const BilloxProvider = require('./billox/BilloxProvider');
const VTpassProvider = require('./vtpass/VTpassProvider');

// Provider class map
const PROVIDER_CLASSES = {
  peacesub: PeaceSubProvider,
  rapidbills: RapidBillsProvider,
  billox: BilloxProvider,
  vtpass: VTpassProvider
};

// Default/fallback env-based configurations.
// These are used when database rows don't exist yet.
const DEFAULT_CONFIGS = {
  peacesub: {
    slug: 'peacesub',
    name: 'PEACESUB',
    status: 'active',
    priority: 1,
    is_primary: true,
    environment: 'live',
    api_base_url: process.env.PEACESUB_BASE_URL,
    api_key: process.env.PEACESUB_API_KEY,
    secret_key: null,
    public_key: null,
    supported_services: ['data', 'airtime']
  },
  rapidbills: {
    slug: 'rapidbills',
    name: 'RapidBills',
    status: 'inactive',
    priority: 2,
    is_primary: false,
    environment: 'live',
    api_base_url: process.env.RAPIDBILLS_BASE_URL || 'https://www.rapidbills.ng/api/reseller/v1',
    api_key: process.env.RAPIDBILLS_API_KEY,
    secret_key: null,
    public_key: null,
    supported_services: ['data', 'airtime']
  },
  billox: {
    slug: 'billox',
    name: 'Billox',
    status: 'inactive',
    priority: 3,
    is_primary: false,
    environment: 'live',
    api_base_url: process.env.BILLOX_BASE_URL || 'https://app-api.billox.ng/api',
    api_key: process.env.BILLOX_API_KEY,
    secret_key: null,
    public_key: null,
    supported_services: ['data', 'airtime']
  },
  vtpass: {
    slug: 'vtpass',
    name: 'VTpass',
    status: 'inactive',
    priority: 4,
    is_primary: false,
    environment: 'live',
    api_base_url: process.env.VTPASS_BASE_URL || 'https://vtpass.com/api',
    api_key: process.env.VTPASS_PUBLIC_KEY,
    secret_key: process.env.VTPASS_SECRET_KEY,
    public_key: process.env.VTPASS_PUBLIC_KEY,
    supported_services: ['data', 'airtime']
  }
};

class ProviderRegistry {
  constructor() {
    // Loaded provider instances keyed by slug
    this._providers = {};
    // DB-sourced config cache (refreshed on demand)
    this._dbConfigs = {};
    this._lastLoaded = null;
  }

  /**
   * Merge DB config into an env-based default config.
   * Credentials in the DB are optional — env vars take precedence for secrets.
   */
  _mergeConfig(defaultCfg, dbRow) {
    if (!dbRow) return defaultCfg;
    return {
      ...defaultCfg,
      slug: dbRow.slug || defaultCfg.slug,
      name: dbRow.name || defaultCfg.name,
      status: dbRow.status || defaultCfg.status,
      priority: dbRow.priority ?? defaultCfg.priority,
      is_primary: dbRow.is_primary ?? defaultCfg.is_primary,
      environment: dbRow.environment || defaultCfg.environment,
      // Only override URL/key from DB if they are non-empty
      api_base_url: dbRow.api_base_url || defaultCfg.api_base_url,
      // NEVER override actual secret credentials from the DB with blanks
      api_key: defaultCfg.api_key || dbRow.api_key_hint || null,
      secret_key: defaultCfg.secret_key || null,
      public_key: defaultCfg.public_key || null,
      supported_services: dbRow.supported_services || defaultCfg.supported_services
    };
  }

  /**
   * Load all provider configurations from the DB and instantiate adapters.
   * This is called lazily and cached.
   */
  async load() {
    try {
      const { data: rows } = await supabase
        .from('vtu_providers')
        .select('*')
        .order('priority', { ascending: true });

      if (rows && rows.length > 0) {
        rows.forEach(row => {
          this._dbConfigs[row.slug] = row;
        });
      }
    } catch (err) {
      console.warn('[ProviderRegistry] Could not load providers from DB (table may not exist yet):', err.message);
    }

    // Instantiate all known providers
    for (const [slug, defaultCfg] of Object.entries(DEFAULT_CONFIGS)) {
      const dbRow = this._dbConfigs[slug] || null;
      const config = this._mergeConfig(defaultCfg, dbRow);
      const ProviderClass = PROVIDER_CLASSES[slug];
      if (ProviderClass) {
        this._providers[slug] = new ProviderClass(config);
        this._providers[slug]._dbConfig = config; // store merged config
      }
    }

    this._lastLoaded = Date.now();
    console.log('[ProviderRegistry] Providers loaded:', Object.keys(this._providers).join(', '));
    return this;
  }

  /**
   * Reload provider instances (call after DB config changes).
   */
  async reload() {
    this._providers = {};
    this._dbConfigs = {};
    return this.load();
  }

  /**
   * Get a provider instance by slug.
   * @param {string} slug
   * @returns {BaseProvider|null}
   */
  get(slug) {
    return this._providers[slug] || null;
  }

  /**
   * Get the current PRIMARY active provider from DB config.
   * Falls back to PEACESUB if DB is unavailable.
   */
  async getPrimaryProvider() {
    try {
      const { data: row } = await supabase
        .from('vtu_providers')
        .select('slug')
        .eq('is_primary', true)
        .eq('status', 'active')
        .order('priority', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (row?.slug && this._providers[row.slug]) {
        return this._providers[row.slug];
      }
    } catch (err) {
      console.warn('[ProviderRegistry] Could not fetch primary from DB:', err.message);
    }

    // Guaranteed fallback: always return peacesub
    console.warn('[ProviderRegistry] Falling back to PEACESUB as primary provider.');
    return this._providers['peacesub'];
  }

  /**
   * Get all providers ordered by priority.
   */
  getAllProviders() {
    return Object.values(this._providers).sort(
      (a, b) => (a._dbConfig?.priority ?? 99) - (b._dbConfig?.priority ?? 99)
    );
  }

  /**
   * Get all active providers.
   */
  async getActiveProviders() {
    try {
      const { data: rows } = await supabase
        .from('vtu_providers')
        .select('slug')
        .eq('status', 'active')
        .order('priority', { ascending: true });

      if (rows && rows.length > 0) {
        return rows
          .map(r => this._providers[r.slug])
          .filter(Boolean);
      }
    } catch (err) {
      console.warn('[ProviderRegistry] Could not fetch active providers from DB:', err.message);
    }

    // Fallback: only peacesub
    return [this._providers['peacesub']].filter(Boolean);
  }
}

// Singleton instance
const registry = new ProviderRegistry();
// Load on startup (non-blocking)
registry.load().catch(err => console.error('[ProviderRegistry] Initial load error:', err.message));

module.exports = registry;
