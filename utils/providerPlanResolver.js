const supabase = require('../config/supabase');

const normalizeText = (value = '') => {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
};

const findProviderPlanMatch = (localPlan, providerPlans = []) => {
  if (!localPlan) return null;

  const localNetwork = normalizeText(localPlan.network);
  const localSize = normalizeText(localPlan.size || localPlan.data_size || localPlan.bundle_size);
  const localValidity = normalizeText(localPlan.validity || localPlan.duration || localPlan.validity_period);
  const localName = normalizeText(localPlan.plan_name || localPlan.name || localPlan.title);

  let bestMatch = null;
  let bestScore = -1;

  providerPlans.forEach((providerPlan) => {
    const candidateNetwork = normalizeText(
      providerPlan.network || providerPlan.operator || providerPlan.provider || providerPlan.network_name
    );
    const candidateSize = normalizeText(
      providerPlan.size || providerPlan.data_size || providerPlan.bundle_size || providerPlan.plan_size || providerPlan.volume
    );
    const candidateValidity = normalizeText(
      providerPlan.validity || providerPlan.duration || providerPlan.validity_period || providerPlan.days
    );
    const candidateName = normalizeText(
      providerPlan.plan_name || providerPlan.name || providerPlan.title || providerPlan.description || providerPlan.plan
    );

    let score = 0;

    if (candidateNetwork && localNetwork && (candidateNetwork === localNetwork || candidateNetwork.includes(localNetwork) || localNetwork.includes(candidateNetwork))) {
      score += 3;
    }

    if (candidateSize && localSize && (candidateSize === localSize || candidateSize.includes(localSize) || localSize.includes(candidateSize))) {
      score += 2;
    }

    if (candidateValidity && localValidity && (candidateValidity === localValidity || candidateValidity.includes(localValidity) || localValidity.includes(candidateValidity))) {
      score += 2;
    }

    if (candidateName && localName && (candidateName === localName || candidateName.includes(localName) || localName.includes(candidateName))) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = providerPlan;
    }
  });

  if (bestScore >= 5) {
    return bestMatch;
  }

  return null;
};

const resolveProviderBundleId = async (localPlan, providerInstance) => {
  if (!localPlan) return null;

  const providerSlug = providerInstance?.slug || 'peacesub';

  // 1. Check database mappings first (explicit admin mapping override)
  try {
    const { data: mapping } = await supabase
      .from('provider_plan_mappings')
      .select('provider_plan_id')
      .eq('data_plan_id', localPlan.id)
      .eq('provider_slug', providerSlug)
      .maybeSingle();

    if (mapping?.provider_plan_id) {
      return mapping.provider_plan_id;
    }
  } catch (err) {
    console.warn('[PlanResolver] DB mapping check failed:', err.message);
  }

  // 2. Automated matching via provider catalog
  try {
    let providerPlans = [];
    if (providerInstance && typeof providerInstance.getDataPlans === 'function') {
      providerPlans = await providerInstance.getDataPlans();
    } else if (providerInstance && typeof providerInstance.get === 'function') {
      // Axios client fallback (legacy PeaceSub)
      const response = await providerInstance.get('/dataplans/');
      providerPlans = Array.isArray(response?.data)
        ? response.data
        : (response?.data?.plans || response?.data?.data || []);
    }

    if (Array.isArray(providerPlans) && providerPlans.length > 0) {
      const match = findProviderPlanMatch(localPlan, providerPlans);
      if (match?.id || match?.bundle_id || match?.plan_id) {
        return match.id || match.bundle_id || match.plan_id;
      }
    }
  } catch (error) {
    console.warn('[PlanResolver] Auto-resolve provider bundle id error:', error.message);
  }

  // 3. Fallback to localPlan.bundle_id
  return localPlan.bundle_id || null;
};

module.exports = {
  normalizeText,
  findProviderPlanMatch,
  resolveProviderBundleId
};
