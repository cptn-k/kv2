const userService = require('./user-service');
const GoogleCalendarDriver = require('./google-calendar-driver');
const secretService = require('./secret-service');

/**
 * Service for managing calendar functionality across multiple user accounts
 */
class CalendarService {
  /**
   * Creates a CalendarService instance
   * @param {string} userId - User ID for whom the service is created
   * @param drivers
   */
  constructor(userId, drivers) {
    this.userId = userId;
    this.drivers = drivers;
  }

  /**
   * Creates a new CalendarService instance
   * @param {string} userId - User ID for whom to create the service
   * @returns {Promise<CalendarService>}
   */
  static async create(userId) {
    if (!userId) {
      throw new Error('User ID is required to create CalendarService');
    }
    
    const user = await userService.getUser(userId)
    const accounts = user.accounts || {};
    const clientId = await secretService.getGoogleClientId();
    const clientSecret = await secretService.getGoogleClientSecret();
    
    
    const drivers = new Map();
    await Promise.all(Object.entries(accounts)
      .filter(([_, account]) => account.type === 'google')
      .map(async ([accountId, account]) => {
        const driver = await GoogleCalendarDriver.create(clientId, clientSecret, account.token);
        drivers.set(accountId, driver);
      }));
    
    return new CalendarService(userId, drivers);
  }

  /**
   * Gets calendar events for the next 30 days from all Google accounts
   * @returns {Promise<Array>} Combined array of events from all accounts
   */
  async getMonthEvents() {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    return this._getEventsForPeriod(thirtyDaysFromNow);
  }

  /**
   * Gets calendar events for the next 7 days from all Google accounts
   * @returns {Promise<Array>} Combined array of events from all accounts
   */
  async getWeekEvents() {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    return this._getEventsForPeriod(sevenDaysFromNow);
  }

  
  /**
   * Creates a new calendar event for the specified account
   * @param {string} accountId - ID of the account to create event for
   * @param {Object} params - Event parameters
   * @returns {Promise<Object>} Created event details
   */
  async createEvent(accountId, params) {
    let driver = this.drivers.get(accountId);
    
    if (!driver) {
      driver = Array.from(this.drivers.values()).find(d => d.email === accountId);
      if (!driver) {
        throw new Error(`No calendar driver found for account ${accountId}`);
      }
    }
    
    return await driver.addSimpleEvent(params);
  }
  
  /**
   * Helper method to get events until a specific date from all Google accounts
   * @param {Date} tillDate - The end date for fetching events
   * @returns {Promise<Array>} Combined array of events from all accounts
   * @private
   */
  async _getEventsForPeriod(tillDate) {
    const allEvents = [];
    
    if (this.drivers.size === 0) {
      return [];
    }
    
    for (const driver of this.drivers.values()) {
      const events = await driver.getEventsFromNow(tillDate);
      
      const processedEvents = events.map(event => ({
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start.dateTime,
        end: event.end.dateTime,
        location: event.location,
        attendees: event.attendees,
        htmlLink: event.htmlLink,
        userId: this.userId
      }));
      
      allEvents.push(...processedEvents);
    }

    // Sort events by start time
    return allEvents.sort((a, b) => {
      const startA = new Date(a.start?.dateTime || a.start?.date);
      const startB = new Date(b.start?.dateTime || b.start?.date);
      return startA - startB;
    });
  }
}


module.exports = CalendarService;