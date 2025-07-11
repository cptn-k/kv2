const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const { htmlToText } = require('html-to-text');
const system = require("./system");
const MarkdownIt = require('markdown-it');
const {DateTime} = require('luxon');


/**
 * Decodes a base64-encoded string to UTF-8.
 * @param {string|null|undefined} data - Base64 data.
 * @returns {string|null}
 */
function decodeBase64(data) {
  return data ? Buffer.from(data, 'base64').toString('utf-8') : null;
}


/**
 * Recursively find and decode a part by MIME type.
 * @param {Object} part - Gmail message part object.
 * @param {string} mime - MIME type to find (e.g., 'text/plain').
 * @returns {string|null} Decoded part data or null if not found.
 */
function findPartByMime(part, mime) {
  if (part.mimeType === mime && part.body?.data) {
    return decodeBase64(part.body.data);
  }
  if (part.parts) {
    for (const p of part.parts) {
      const found = findPartByMime(p, mime);
      if (found) return found;
    }
  }
  return null;
}


class GmailDriver {
  static async create(accountId, refreshToken, clientId, clientSecret) {
    const oauthClient = new OAuth2Client(clientId, clientSecret);
    oauthClient.setCredentials({ refresh_token: refreshToken });
    const { token } = await oauthClient.getAccessToken();
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });
    const tokenInfo = await auth.getTokenInfo(token);
    const email = tokenInfo.email;
    return new GmailDriver(auth, accountId, email);
  }

  
  constructor(authClient, accountId, email) {
    this._client = google.gmail({ version: 'v1', auth: authClient });
    this._accountId = accountId;
    this._emailAddress = email;
  }
  
  
  async _getAllMessageIds(labelId, pageToken = null) {
    const response = await this._client.users.messages.list({
      userId: 'me',
      labelIds: [labelId],
      maxResults: 400,
      pageToken
    });
    
    const messages = response.data.messages?.map(msg => msg.id) || [];
    
    if (response.data.nextPageToken) {
      const nextMessages = await this._getAllMessageIds(labelId, response.data.nextPageToken);
      return [...messages, ...nextMessages];
    }
    
    return messages;
  }
  
  async getIdsByLabel(labelId, sortOrder = 'desc') {
    const messages = await this._getAllMessageIds(labelId);
    return sortOrder === 'asc' ? messages.reverse() : messages;
  }
  
  
  async get(id) {
    const res = await this._client.users.messages
      .get({ userId: 'me', id });
    
    const data = res.data;
    const headers = data.payload?.headers || [];
    const getHeader = name =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || null;
    
    let textBody = findPartByMime(data.payload, 'text/plain');
    let htmlBody = findPartByMime(data.payload, 'text/html');

    if (!textBody && !htmlBody) {
      textBody = '';
      htmlBody = '';
    } else if (!textBody) {
      textBody = htmlToText(htmlBody, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] });
    } else if (!htmlBody) {
      htmlBody = textBody;
    }
    
    const rawCc = getHeader('Cc');
    
    system.logInfo('Email Fetched From Server', {
      accountEmail: this._emailAddress,
      providerId: id,
      date: getHeader('Date'),
      subject: getHeader('Subject')
    });
    
    
    return {
      date: getHeader('Date'),
      ts: DateTime.fromRFC2822(getHeader('Date')).toUnixInteger(),
      title: getHeader('Subject'),
      from: getHeader('From'),
      to: getHeader('To'),
      cc: getHeader('Cc'),
      messageId: getHeader('Message-ID'),
      snippet: data.snippet,
      textBody,
      htmlBody,
      linkToMessage: `https://mail.google.com/mail/u/0/?authuser=${this._emailAddress}#inbox/${id}`,
      providerId: id
    };
  }

  async getAll(ids) {
    return Promise.all(ids.map(id => this.get(id)));
  }
  
  async sendMail(to, title, body, inReplyTo = null, ccList = '') {
    const md = new MarkdownIt();
    const htmlBody = md.render(body);
    const textBody = htmlToText(htmlBody, {wordwrap: false});
    
    const message = [
      'Content-Type: multipart/alternative; boundary="boundary"',
      'MIME-Version: 1.0',
      `To: ${to}`,
      `Subject: ${title}`,
      inReplyTo ? `In-Reply-To: <${inReplyTo}>` : '',
      ccList.length > 0 ? `Cc: ${ccList}` : '',
      '',
      '--boundary',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      textBody,
      '',
      '--boundary',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      htmlBody,
      '',
      '--boundary--'
    ].join('\r\n');
    
    system.logInfo('Email Sent', {message})
    
    const encodedMessage = Buffer.from(message).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    await this._client.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });
  }
  
  getEmail() {
    return this._emailAddress;
  }
  
  async moveToJunk(id) {
    await this._client.users.messages.modify({
      userId: 'me',
      id: id,
      requestBody: {
        addLabelIds: ['SPAM'],
        removeLabelIds: ['INBOX']
      }
    });
  }
  
  async moveToTrash(id) {
    await this._client.users.messages.trash({
      userId: 'me',
      id: id
    });
  }
  
  async archive(id) {
    await this._client.users.messages.modify({
      userId: 'me',
      id: id,
      requestBody: {
        removeLabelIds: ['INBOX']
      }
    });
  }
  
  async search(text) {
    const response = await this._client.users.messages.list({
      userId: 'me',
      q: text,
      maxResults: 20
    });
    
    if (!response.data.messages) {
      return [];
    }
    
    return response.data.messages.map(msg => msg.id);
  }
}


module.exports = GmailDriver;