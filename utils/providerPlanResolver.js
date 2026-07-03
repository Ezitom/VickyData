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

const resolveProviderBundleId = async (localPlan, peaceSub) => {
  if (!localPlan) return null;

  const currentBundleId = localPlan.bundle_id;
  if (currentBundleId && String(currentBundleId).trim() !== '' && !String(currentBundleId).toLowerCase().includes('placeholder')) {
    return currentBundleId;
  }

  try {
    const response = await peaceSub.get('/dataplans/');
    const providerPlans = Array.isArray(response?.data)
      ? response.data
      : (response?.data?.plans || response?.data?.data || []);
    const match = findProviderPlanMatch(localPlan, providerPlans);

    if (match?.id || match?.bundle_id || match?.plan_id) {
      return match.id || match.bundle_id || match.plan_id;
    }
  } catch (error) {
    console.warn('Unable to resolve provider bundle id:', error.message);
  }

  return currentBundleId || null;
};

module.exports = {
  normalizeText,
  findProviderPlanMatch,
  resolveProviderBundleId
};
