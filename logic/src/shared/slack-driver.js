const { WebClient } = require('@slack/web-api');
const axios = require('axios');
const system = require('./system');
const BucketDriver = require('./bucket-driver');


class Slack {
  constructor(client, clientId, clientSecret, token, botId) {
    this.client = client;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.token = token;
    this.botId = botId;
    this.bucket = new BucketDriver('k2o-dev-input-images');
  }

  
  /**
   * Creates a new Slack client instance
   * @param {string} [accessToken] - Slack bot access token. If not provided, it will be fetched from secretService
   * @param {string} [clientId] - Slack client ID for OAuth
   * @param {string} [clientSecret] - Slack client secret for OAuth
   * @returns {Promise<Slack>} A new Slack client instance
   */
  static async create(accessToken, clientId, clientSecret) {
    const client = new WebClient(accessToken);
    const botId = (await client.auth.test()).user_id;
    return new Slack(client, clientId, clientSecret, accessToken, botId);
  }

  
  static mdToSlack(text) {
    return text
      // Convert ** text ** patterns to *text*
      .replace(/\*\*\s*(.*?)\s*\*\*/g, '*$1*')
      // Replace headings "### text" at start of line with "▪️*text*"
      .replace(/^####\s*(.*)$/gm, '▪️*$1*\n')
      // Replace level-4 headings "#### text" with "➤ *text*"
      .replace(/^###\s*(.*)$/gm, '► *$1*\n')
      // Convert "[text](link)" to "<link | text>"
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2 | $1>');
  }
  
  /**
   * Generates the Slack authentication URL
   * @param {string} userId - The user ID to associate with this authentication
   * @param {string} [redirectUrl] - Optional redirect URL, defaults to system base URL + /slack/auth/callback
   * @returns {string} The Slack OAuth URL
   */
  getAuthUrl(userId, redirectUrl) {
    if (!userId) {
      throw new Error('Missing user ID');
    }

    if (!this.clientId) {
      throw new Error('Missing Slack client ID');
    }

    const redirect = redirectUrl || `${system.getBaseUrl()}/slack/auth/callback`;

    const scopes = [
      'app_mentions:read',
      'channels:history',
      'chat:write',
      'groups:history',
      'im:history',
      'incoming-webhook',
      'reactions:write'
    ].join(',');

    return `https://slack.com/oauth/v2/authorize?client_id=${this.clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirect)}&state=${userId}`;
  }

  /**
   * Gets tokens from authorization code
   * @param {string} code - The authorization code from Slack OAuth
   * @param {string} [redirectUrl] - Optional redirect URL, must match the one used in getAuthUrl
   * @returns {Promise<Object>} The tokens object containing access_token, refresh_token, etc.
   */
  async getTokensFromCode(code, redirectUrl) {
    if (!code) {
      throw new Error('Missing authorization code');
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Missing Slack client ID or secret');
    }

    const redirect = redirectUrl || `${system.getBaseUrl()}/slack/auth/callback`;

    const response = await axios.post('https://slack.com/api/oauth.v2.access', null, {
      params: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        redirect_uri: redirect
      }
    });

    if (!response.data.ok) {
      throw new Error(`Slack OAuth error: ${response.data.error}`);
    }

    return response.data;
  }

  postMessage(channel, text, threadTs) {
    const messagePayload = {
      channel,
      text: Slack.mdToSlack(text),
      thread_ts: threadTs
    };
    return this.client.chat.postMessage(messagePayload);
  }

  /**
   * Adds an emoji reaction to a specified Slack message.
   * @param {string} channel - ID of the Slack channel.
   * @param {string} name - Name of the emoji (without colons), e.g. "thumbsup".
   * @param {string} timestamp - Timestamp of the message to react to.
   * @returns {Promise<Object>} The API response.
   */
  addReaction(channel, name, timestamp) {
    return this.client.reactions.add({
      channel,
      name,
      timestamp
    });
  }
  
  /**
   * Gets the bot's user ID from Slack
   * @returns {string} The bot's user ID
   */
  getBotUserId() {
    return this.botId;
  }
  

  /**
   * Downloads a file from an event.files[] object using WebClient.
   * @param {Object} file - Slack file object from event.files[]
   * @returns {Promise<string>} The saved file key in bucket
   */
  async downloadFile(file) {
    const axiosResponse = await axios.get(file.url_private_download, {
      method: 'get',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      responseType: 'arraybuffer'
    });

    const fileExt = file.filetype;
    const key = `${system.mkShortUUID()}.${fileExt}`;
    const contentType = axiosResponse.headers['content-type'];

    await this.bucket.saveImage(key, axiosResponse.data, contentType);

    return key;
  }
}


module.exports = Slack;
