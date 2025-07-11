const { google } = require('googleapis');
const secretService = require('./secret-service');

class GoogleCalendarDriver {
  /** Never use constructor directly. Use create() instead. */
  constructor(auth, accountId, email) {
    this.calendar = google.calendar({version: 'v3', auth});
    this.accountId = accountId;
    this.email = email;
  }

  /**
   * Creates a GoogleCalendarDriver using service account credentials.
   * @returns {Promise<GoogleCalendarDriver>}
   */
  static async create(clientId, clientSecret, token) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({refresh_token: token});
    const userInfo = await google.oauth2('v2').userinfo.get({auth: oauth2Client});
    return new GoogleCalendarDriver(oauth2Client, userInfo.data.id, userInfo.data.email);
  }

  /**
   * Fetches calendar events from now until the specified date.
   * @param {Date} tillDate
   * @returns {Promise<Array>} Array of event objects.
   */
  async getEventsFromNow(tillDate) {
    const res = await this.calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      timeMax: tillDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    return res.data.items;
  }

  /**
   * Adds a simple non-recurring event to the primary calendar.
   * @param {{ summary: string, start: { dateTime: string }, end: { dateTime: string } }} event
   * @returns {Promise<Object>} The created event object.
   */
  async addSimpleEvent(event) {
    const res = await this.calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });
    return res.data;
  }
}

module.exports = GoogleCalendarDriver;