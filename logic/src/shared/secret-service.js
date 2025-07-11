const gcpSecrets = require('./gcpsecrets');

/**
 * Retrieves the Slack client ID from Secret Manager.
 * @returns {Promise<string>} The Slack app's client ID.
 */
function getSlackClientId() {
  return gcpSecrets.get('slack-client-id');
}

/**
 * Retrieves the Slack client secret from Secret Manager.
 * @returns {Promise<string>} The Slack app's client secret.
 */
function getSlackClientSecret() {
  return gcpSecrets.get('slack-client-secret');
}

/**
 * Retrieves the Slack bot access token from Secret Manager.
 * @returns {Promise<string>} The Slack app's bot user OAuth access token.
 */
function getSlackBotToken() {
  return gcpSecrets.get('slack-bot-token');
}

/**
 * Retrieves the Google OAuth client ID from Secret Manager.
 * @returns {Promise<string>} The Google OAuth client ID.
 */
function getGoogleClientId() {
  return gcpSecrets.get('google-client-id');
}

/**
 * Retrieves the Google OAuth client secret from Secret Manager.
 * @returns {Promise<string>} The Google OAuth client secret.
 */
function getGoogleClientSecret() {
  return gcpSecrets.get('google-client-secret');
}

/**
 * Retrieves the OpenAI API key from Secret Manager.
 * @returns {Promise<string>} The OpenAI API key.
 */
function getOpenAiApiKey() {
  return gcpSecrets.get('openai-api-key');
}

/**
 * Retrieves the ClickUp client ID from Secret Manager.
 * @returns {Promise<string>} The ClickUp app's client ID.
 */
function getClickUpClientId() {
  return gcpSecrets.get('clickup-client-id');
}

/**
 * Retrieves the ClickUp client secret from Secret Manager.
 * @returns {Promise<string>} The ClickUp app's client secret.
 */
function getClickUpClientSecret() {
  return gcpSecrets.get('clickup-client-secret');
}


module.exports = {
  getSlackClientId,
  getSlackClientSecret,
  getSlackBotToken,
  getGoogleClientId,
  getGoogleClientSecret,
  getOpenAiApiKey,
  getClickUpClientId,
  getClickUpClientSecret
};