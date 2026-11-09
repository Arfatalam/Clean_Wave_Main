//#region src/react/stable-keys.d.ts
declare const STABLE_KEYS: {
  readonly USER_MEMBERSHIPS_KEY: "userMemberships";
  readonly USER_INVITATIONS_KEY: "userInvitations";
  readonly USER_SUGGESTIONS_KEY: "userSuggestions";
  readonly DOMAINS_KEY: "domains";
  readonly MEMBERSHIP_REQUESTS_KEY: "membershipRequests";
  readonly MEMBERSHIPS_KEY: "memberships";
  readonly INVITATIONS_KEY: "invitations";
  readonly PLANS_KEY: "billing-plans";
  readonly SUBSCRIPTION_KEY: "billing-subscription";
  readonly PAYMENT_METHODS_KEY: "billing-payment-methods";
  readonly PAYMENT_ATTEMPTS_KEY: "billing-payment-attempts";
  readonly STATEMENTS_KEY: "billing-statements";
  readonly API_KEYS_KEY: "apiKeys";
  readonly ORGANIZATION_CREATION_DEFAULTS_KEY: "organizationCreationDefaults";
  readonly OAUTH_CONSENT_INFO_KEY: "oauthConsentInfo";
  readonly CREDIT_BALANCE_KEY: "billing-credit-balance";
};
type ResourceCacheStableKey = (typeof STABLE_KEYS)[keyof typeof STABLE_KEYS];
declare const INTERNAL_STABLE_KEYS: {
  readonly PAYMENT_ATTEMPT_KEY: "billing-payment-attempt";
  readonly BILLING_PLANS_KEY: "billing-plan";
  readonly BILLING_STATEMENTS_KEY: "billing-statement";
  readonly CREDIT_HISTORY_KEY: "billing-credit-history";
  readonly USER_ENTERPRISE_CONNECTIONS_KEY: "userEnterpriseConnections";
  readonly ENTERPRISE_CONNECTION_TEST_RUNS_KEY: "enterpriseConnectionTestRuns";
  readonly ORGANIZATION_ENTERPRISE_CONNECTIONS_KEY: "organizationEnterpriseConnections";
  readonly ORGANIZATION_ENTERPRISE_CONNECTION_TEST_RUNS_KEY: "organizationEnterpriseConnectionTestRuns";
  readonly ORGANIZATION_DOMAINS_KEY: "organizationDomains";
  readonly ORGANIZATION_DIRECTORY_SYNC_KEY: "organizationDirectorySync";
  readonly ORGANIZATION_DIRECTORY_SYNC_USERS_KEY: "organizationDirectorySyncUsers";
  readonly ORGANIZATION_DIRECTORY_SYNC_STATUS_KEY: "organizationDirectorySyncStatus";
  readonly ORGANIZATION_DIRECTORY_SYNC_GROUP_ROLE_MAPPINGS_KEY: "organizationDirectorySyncGroupRoleMappings";
  readonly ORGANIZATION_SSO_BYPASS_ALLOWLIST_KEY: "organizationSSOBypassAllowlist";
};
type __internal_ResourceCacheStableKey = (typeof INTERNAL_STABLE_KEYS)[keyof typeof INTERNAL_STABLE_KEYS];
//#endregion
export { ResourceCacheStableKey, __internal_ResourceCacheStableKey };
//# sourceMappingURL=stable-keys.d.mts.map