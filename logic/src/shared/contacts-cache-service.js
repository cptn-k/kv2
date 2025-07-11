/**
 * @fileoverview ContactsCacheService - Service for caching and retrieving Google Contacts data
 *
 * This service retrieves contacts for all Google accounts linked to a user,
 * combines them into a single JSON object, and saves it to Firestore.
 *
 * @module contacts-cache-service
 * @version 1.0.0
 */



const firestore = require('./firestore');
const user = require('./user-service');
const secretService = require('./secret-service');
const system = require('./system');
const GoogleContactsDriver = require('./google-contacts-driver');



const COLLECTION = 'k2o-contacts';



/**
 * ContactsCacheService class for managing contact data caching
 */
class ContactsCacheService {
  /**
   * Creates a new ContactsCacheService instance
   * @param {string} userId - The user ID associated with this cache instance
   * @returns {Promise<ContactsCacheService>}
   * @throws {Error} If userId is missing
   */
  static async create(userId) {
    if (!userId) {
      throw system.mkError('Required parameter missing: userId', { method: 'ContactsCacheService.create' });
    }

    return new ContactsCacheService(userId);
  }


  /**
   * Initializes a service with required userId
   * @param {string} userId - ID of the user
   */
  constructor(userId) {
    if (!userId) {
      throw system.mkError('Required parameter missing: userId', { method: 'ContactsCacheService.constructor' });
    }
    this._userId = userId;
  }


  /**
   * Updates the contacts cache by retrieving unified contact data
   * for all Google accounts and saving it to Firestore
   * @returns {Promise<void>}
   */
  async updateContacts() {
    system.logInfo('Starting contacts update', {userId: this._userId});
    
    const accounts = await user.getUserAccounts(this._userId);
    const googleAccounts = Object.entries(accounts)
      .filter(([_, account]) => account.type === 'google');

    if (googleAccounts.length === 0) {
      system.logInfo('No Google accounts found for user', { userId: this._userId });
      return;
    }

    const [clientId, clientSecret] = await Promise.all([
      secretService.getGoogleClientId(),
      secretService.getGoogleClientSecret()
    ]);

    for (const [accountId, accountData] of googleAccounts) {
      system.logInfo('Processing account for contacts: ' + accountId, { userId: this._userId, accountId });

      const refreshToken = accountData.token;

      if (!refreshToken) {
        throw system.mkError('Missing refresh token for account', { 
          method: 'ContactsCacheService.updateContacts',
          userId: this._userId, 
          accountId 
        });
      }

      const contactsDriver = await GoogleContactsDriver.create(clientId, clientSecret, refreshToken);
      const contacts = await contactsDriver.getAllContacts();

      const documentId = `user#${this._userId}#${accountId}`;
      await firestore.write(COLLECTION, documentId, {
        _id: documentId,
        userId: this._userId,
        accountId,
        contacts,
        updatedAt: new Date().toISOString()
      });

      system.logInfo('Contacts updated successfully', { userId: this._userId, accountId });
    }
  }
  

  /**
   * Retrieves all contacts for the user from all linked Google accounts
   * and combines them into a single unified contacts collection
   * @returns {Promise<Array>} Combined array of all contacts across accounts
   */
  async getContacts() {
    const contactsDocuments = await firestore.query(COLLECTION, 'userId', this._userId);

    if (!contactsDocuments || contactsDocuments.length === 0) {
      return [];
    }

    const allContacts = [];

    for (const doc of contactsDocuments) {
      if (doc && Array.isArray(doc.contacts)) {
        const contactsWithAccount = doc.contacts.map(contact => ({
          ...contact,
          _accountId: doc.accountId
        }));

        allContacts.push(...contactsWithAccount);
      }
    }

    return allContacts;
  }
  
}



module.exports = ContactsCacheService;