const test = require('node:test');
const assert = require('node:assert/strict');
const { findProviderPlanMatch } = require('../utils/providerPlanResolver');

test('matches a provider plan using network, size and validity', () => {
  const localPlan = {
    network: 'MTN',
    size: '1GB',
    validity: '1 Day',
    plan_name: '1GB Daily'
  };

  const providerPlans = [
    { id: 101, network: 'MTN', size: '1GB', validity: '1 Day', name: '1GB Daily' },
    { id: 102, network: 'MTN', size: '2GB', validity: '7 Days', name: '2GB Weekly' }
  ];

  const match = findProviderPlanMatch(localPlan, providerPlans);
  assert.equal(match?.id, 101);
});

test('returns null when no provider plan matches the local plan', () => {
  const localPlan = {
    network: 'Airtel',
    size: '5GB',
    validity: '30 Days',
    plan_name: '5GB Monthly'
  };

  const providerPlans = [
    { id: 201, network: 'MTN', size: '1GB', validity: '1 Day', name: '1GB Daily' }
  ];

  const match = findProviderPlanMatch(localPlan, providerPlans);
  assert.equal(match, null);
});
