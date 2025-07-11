const system = require('./system');
const {google} = require('googleapis');
const userService = require('./user-service');
const GoogleContactsDriver = require("./google-contacts-driver");
const sercretService = require("./secret-service");

const STORE_NAME = 'k2o-contacts';

class ContactsService {
  /**
   * Creates a new ContactsService instance for a user
   * @param {string} userId - The ID of the user
   * @returns {Promise<ContactsService>} A ContactsService instance
   */
  static async create(userId) {
    if (!userId) {
      throw system.mkError('Required parameter missing: userId', {
        method: 'ContactsService.create'
      });
    }
    
    const clientId = await sercretService.getGoogleClientId();
    const clientSecret = await sercretService.getGoogleClientSecret();

    const accounts = await userService.getUserAccounts(userId)
      .then(list => Object.values(list).filter(account => account.type === 'google'));
      
    const drivers = await Promise.all(
      accounts.map(account =>
        GoogleContactsDriver.create(clientId, clientSecret, account.token))
    );
    
    return new ContactsService(userId, drivers);
  }

  
  constructor(userId, drivers) {
    this._userId = userId;
    this._contactDrivers = drivers;
  }
  
  
  /**
   * Finds and retrieves a list of contacts based on a freeform search query
   * @param {string} query - The freeform search query
   * @returns {Promise<Array>} List of matched contacts
   */
  async find(query) {
    if (!query) {
      throw system.mkError('Search query is required', {
        method: 'ContactsService.find',
        userId: this._userId
      });
    }
    
    const results = await Promise.all(
      this._contactDrivers.map(driver => driver.find(query))
    );
    
    return results.flat();
  }
}


module.exports = ContactsService;