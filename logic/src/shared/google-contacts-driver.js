const {google} = require('googleapis');
const {OAuth2Client} = require('google-auth-library');
const system = require("./system");


class GoogleContactsDriver {
  constructor(auth) {
    this.peopleService = google.people({version: 'v1', auth});
  }

  static async create(clientId, clientSecret, refreshToken) {
    if (!clientId || typeof clientId !== 'string') {
      throw new Error('clientId is required and must be a string');
    }
    if (!clientSecret || typeof clientSecret !== 'string') {
      throw new Error('clientSecret is required and must be a string');
    }
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new Error('refreshToken is required and must be a string');
    }
    
    const oauth2Client = new OAuth2Client(clientId, clientSecret);
    oauth2Client.setCredentials({refresh_token: refreshToken});
    return new GoogleContactsDriver(oauth2Client);
  }
  
  async getAllContacts() {
    try {
      const response = await this.peopleService.people.connections.list({
        resourceName: 'people/me',
        pageSize: 30,
        personFields: 'names,emailAddresses,phoneNumbers',
        sortOrder: 'FIRST_NAME_ASCENDING'
      });
      
      return response.data.connections || [];
    } catch (error) {
      throw new Error(`Failed to fetch contacts: ${error.message}`);
    }
  }
  
  async find(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Search text is required and must be a string');
    }
    
    const response = await this.peopleService.people.searchContacts({
      query: text,
      readMask: 'names,emailAddresses,phoneNumbers',
      pageSize: 30
    });
    
    return response.data.results || [];
  }
}


module.exports = GoogleContactsDriver;