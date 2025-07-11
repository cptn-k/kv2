const firestore = require('./firestore');
const system = require('./system');

const STORE_NAME = 'kv2-user';

// ====================================================
// UTILITY FUNCTIONS
// ====================================================

/**
 * Creates a document key from a user ID
 * @param {string} userId - The user ID
 * @returns {string} The document key
 */
function makeKey(userId) {
  return `user#${userId}`;
}

/**
 * Generates a standardized account name
 * @param {string} type - Account type (e.g., 'slack', 'google')
 * @returns {string} Formatted account name with timestamp
 */
function makeAccountName(type) {
  return `${type}_${Date.now()}`;
}

// ====================================================
// CORE USER OPERATIONS
// ====================================================



/**
 * Gets all user IDs from the database
 * @returns {Promise<Array<string>>} Array of user IDs
 */
const getUsers = () =>
  firestore.list(STORE_NAME)
    .then(users => users.filter(user => user.id).map(user => user.id));

/**
 * Gets a user by ID
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} User data
 * @throws {Error} If user is not found
 */
const getUser = (userId) =>
  firestore.read(STORE_NAME, makeKey(userId)).then(data => {
    if(!data) throw system.mkError("User not found", { userId });
    return data;
  });

/**
 * Updates user data
 * @param {string} userId - The user ID
 * @param {Object} userData - The user data to update
 * @returns {Promise<Object>} The updated user data
 */
const updateUser = (userId, userData) =>
  firestore.read(STORE_NAME, makeKey(userId))
    .then(data => {
      if (!data) {
        throw system.mkError("User not found", {userId});
      }
      const updated = {...data, ...userData};
      return firestore.write(STORE_NAME, makeKey(userId), updated, true);
    });


// ====================================================
// ACCOUNT MANAGEMENT
// ====================================================

/**
 * Gets all accounts for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} Object containing user accounts
 */
const getUserAccounts = (userId) =>
  getUser(userId).then(data => data.accounts || {});

/**
 * Gets a specific account for a user
 * @param {string} userId - The user ID
 * @param {string} accountId - The account ID to retrieve
 * @returns {Promise<Object>} The account data
 */
const getUserAccount = (userId, accountId) =>
  getUserAccounts(userId).then(accounts => accounts[accountId]);

/**
 * Adds a new account for a user
 * @param {string} userId - The user ID
 * @param {string} provider - The type of account (e.g., 'google', 'slack')
 * @param {Object} accountData - The account data
 * @returns {Promise<Object>} The account object with ID
 */
const addUserAccount = (userId, provider, accountData) =>
  getUser(userId).then(data => {
    // Generate a new account ID based on the provider
    const accountId = makeAccountName(provider);
    const account = {
      ...accountData,
      type: provider,
      createdAt: Date.now()
    }
    const accounts = {
      [accountId]: account,
      ...data.accounts
    }
    const updated = { ...data, accounts };
    return updateUser(userId, updated)
      .then(() => account);
  });

/**
 * Removes an account for a user
 * @param {string} userId - The user ID
 * @param {string} accountId - The account ID to remove
 * @returns {Promise<boolean>} True if the account was removed, false otherwise
 */
const removeUserAccount = (userId, accountId) =>
  firestore.read(STORE_NAME, makeKey(userId))
    .then(data => {
      if (!data) {
        throw system.mkError("User not found", {userId});
      }
      if (!data.accounts || !data.accounts[accountId]) {
        throw system.mkError("Account not found", {userId, accountId});
      }

      const accounts = { ...data.accounts };
      delete accounts[accountId];

      const updated = { ...data, accounts };

      return firestore.write(STORE_NAME, makeKey(userId), updated, true)
        .then(() => true);
    });


// ====================================================
// TOKEN MANAGEMENT
// ====================================================

/**
 * Saves a token for a specific account
 * @param {string} userId - The user ID
 * @param {string} accountId - The account ID
 * @param {string} token - The token to save
 * @returns {Promise<Object>} The updated account data
 */
const saveAccountToken = (userId, accountId, token) =>
  firestore.read(STORE_NAME, makeKey(userId))
    .then(data => {
      if (!data || !data.accounts) {
        throw new Error(`User ${userId} or account ${accountId} not found`);
      }

      const accounts = { ...data.accounts };
      if (!accounts[accountId]) {
        throw new Error(`Account ${accountId} not found for user ${userId}`);
      }

      accounts[accountId] = {
        ...accounts[accountId],
        token,
        updatedAt: Date.now()
      };

      const updated = { ...data, accounts };
      return firestore.write(STORE_NAME, makeKey(userId), updated, true)
        .then(() => accounts[accountId]);
    });

/**
 * Updates a token for a specific account
 * @param {string} userId - The user ID
 * @param {string} accountId - The account ID
 * @param {string} token - The new token
 * @returns {Promise<Object>} The updated account data
 */
const updateAccountToken = (userId, accountId, token) =>
  saveAccountToken(userId, accountId, token);


// ====================================================
// PROVIDER-SPECIFIC ACCOUNT FUNCTIONS
// ====================================================

/**
 * Adds or updates the Google account for a user
 * @param {string} userId - The user ID
 * @param {object} googleAccountData - The Google account data
 * @returns {Promise<object>} The Google account data
 */
const addGoogleAccount = (userId, googleAccountData) =>
  addUserAccount(userId, 'google', googleAccountData);

/**
 * Removes a Google account for a user
 * @param {string} userId - The user ID
 * @param {string} accountId - The Google account ID to remove
 * @returns {Promise<boolean>} True if the account was removed, false otherwise
 */
const removeGoogleAccount = (userId, accountId) =>
  removeUserAccount(userId, accountId);

/**
 * Updates the token for a Google account
 * @param {string} userId - The user ID
 * @param {string} accountId - The Google account ID
 * @param {string} token - The new token
 * @returns {Promise<Object>} The updated account data
 */
const updateGoogleAccountToken = (userId, accountId, token) =>
  updateAccountToken(userId, accountId, token);

// ====================================================
// USER CREATION AND LOOKUP
// ====================================================

/**
 * Create a new user with Slack account
 * @param {string} slackUserId - The Slack user ID
 * @returns {Promise<string>} The new user ID
 */
const createUser = (slackUserId) => {
  const newUserId = system.mkUUID();
  const key = makeKey(newUserId);
  const accountKey = makeAccountName('slack');
  const data = {
    id: newUserId,
    slackUserId,
    accounts: {
      [accountKey]: {
        type: 'slack',
        userId: slackUserId,
        createdAt: Date.now()
      }
    }
  };

  return firestore.write(STORE_NAME, key, data, true)
    .then(() => newUserId);
};

/**
 * Find a user ID by Slack user ID
 * @param {string} slackUserId - The Slack user ID to look up
 * @returns {Promise<string>} The user ID
 * @throws {Error} If user is not found
 */
const getUserBySlackId = (slackUserId) =>
  firestore.query(STORE_NAME, 'slackUserId', slackUserId)
    .then(results => {
      if (results.length) {
        return results[0].id;
      }
      throw system.mkError("User not found", { slackUserId });
    });

/**
 * Get all users from the database
 * @returns {Promise<Array>} Array of user objects
 */
const getAllUsers = () =>
  firestore.list(STORE_NAME, 100, 0);

/**
 * Gets the Slack account for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} The Slack account data or null if no Slack account exists
 */
const getSlackAccount = async (userId) => {
  const accounts = await getUserAccounts(userId);
  return Object.values(accounts).find(account => account.type === 'slack') || null;
};


/**
 * Gets the ClickUp token for a user
 * @param {string} userId - The user ID
 * @returns {Promise<string>} The ClickUp token
 * @throws {Error} If ClickUp account is not found
 */
const getClickUpToken = async (userId) => {
  const accounts = await getUserAccounts(userId);
  const clickUpAccount = Object.values(accounts).find(account => account.type === 'clickup');
  if (!clickUpAccount) {
    throw system.mkError("ClickUp account not found", {userId});
  }
  return clickUpAccount.accessToken;
};


module.exports = {
  // Core user operations
  getUsers,
  getUser,
  updateUser,
  getAllUsers,

  // User creation and lookup
  createUser,
  getUserBySlackId,

  // Account management
  getUserAccounts,
  getUserAccount,
  addUserAccount,
  removeUserAccount,

  // Token management
  saveAccountToken,
  updateAccountToken,
  
  // Provider-specific functions
  addGoogleAccount,
  removeGoogleAccount,
  updateGoogleAccountToken,
  getSlackAccount,
  getClickUpToken,
};