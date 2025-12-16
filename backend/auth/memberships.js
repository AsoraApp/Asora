// Authoritative tenant memberships (stub for B1)
// Replace with database-backed memberships later

const membershipsByUser = {
  user_1: ["tenant_1"]
};

function getTenantMemberships(userId) {
  return membershipsByUser[userId] || [];
}

module.exports = {
  getTenantMemberships
};
