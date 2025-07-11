const { google } = require('googleapis');
const system = require('./system');


const SCOPES = [
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
  'https://www.googleapis.com/auth/gmail.send',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.settings.readonly',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/directory.readonly',
  'https://www.googleapis.com/auth/user.addresses.read',
  'https://www.googleapis.com/auth/user.birthday.read',
  'https://www.googleapis.com/auth/user.emails.read',
  'https://www.googleapis.com/auth/user.phonenumbers.read',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];


/**
 * GoogleDriver class for handling Google API authentication
 */
class GoogleDriver {
  /**
   * Creates a new GoogleDriver instance
   * @param {string} clientId - The Google OAuth client ID
   * @param {string} clientSecret - The Google OAuth client secret
   */
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUrl = `${system.getBaseUrl()}/google/auth/callback`;
    this.oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUrl
    );
  }

  /**
   * Generates the Google authentication URL
   * @param {string} userId - The user ID to associate with this authentication
   * @param {string} [accountId] - Optional account ID to associate with this authentication
   */
  getAuthUrl(userId, accountId) {
    if (!userId) {
      throw new Error('Missing user ID');
    }
    
    const state = JSON.stringify({userId, ...(accountId && {accountId})});
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state
    });
  }

  /**
   * Gets tokens from authorization code
   * @param {string} code - The authorization code from Google OAuth
   * @returns {Promise<Object>} The tokens object containing access_token, refresh_token, etc.
   */
  async getTokensFromCode(code) {
    if (!code) {
      throw new Error('Missing authorization code');
    }

    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens;
  }
}

module.exports = GoogleDriver;
