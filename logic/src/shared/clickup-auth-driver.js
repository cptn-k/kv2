const axios = require('axios');


class ClickUpAuthDriver {
  /**
   * @param {string} clientId
   * @param {string} clientSecret
   * @param {string} redirectUri
   */
  constructor(clientId, clientSecret, redirectUri) {
    this._clientId = clientId;
    this._clientSecret = clientSecret;
    this._redirectUri = redirectUri;
  }

  /**
   * Returns the URL to redirect a user for ClickUp OAuth authorization.
   * @param {string} userId - Caller user ID, passed through state.
   * @returns {string}
   */
  getAuthUrl(userId) {
    const params = new URLSearchParams({
      client_id: this._clientId,
      redirect_uri: this._redirectUri,
      response_type: 'code',
      state: userId
    });
    return `https://app.clickup.com/api?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for access and refresh tokens.
   * @param {string} temporaryCode - OAuth authorization code.
   * @returns {Promise<Object>} The token response ({ access_token, refresh_token, ... }).
   * @throws {Error} If the response doesn't contain a valid access token.
   */
  async getAccessToken(temporaryCode) {
    const url = 'https://api.clickup.com/api/v2/oauth/token';
    const response = await axios.post(url, {
      client_id: this._clientId,
      client_secret: this._clientSecret,
      code: temporaryCode,
    });
    
    if (!response.data || !response.data.access_token) {
      throw new Error('Invalid response: Access token not provided by ClickUp');
    }
    return response.data.access_token;
  }
}

module.exports = ClickUpAuthDriver;