/**
 * @fileoverview Mail Service - Handles fetching and managing emails from Gmail accounts
 *
 * This module provides functionality for retrieving emails from user's Gmail accounts,
 * fetching email details, and generating summaries. It manages caching and authentication
 * for multiple accounts per user.
 *
 * @module mail-service
 * @author K2O Development Team
 * @version 1.0.0
 *
 * @license MIT
 * @copyright (c) 2025 K2O Development Team
 *
 * NOTE: Areas for improvement (technical debt):
 * - Add support for other email providers besides Gmail
 * - Implement pagination for email fetching
 * - Add ability to search emails by content
 * 
 * Version History:
 * - 1.0.0 (2025-06-29): Initial implementation
 *   - Gmail account integration
 *   - Email caching
 *   - Auto-summarization via OpenAI
 * - 1.1.0 (2025-06-30): Enhanced functionality
 *   - Improved auto-summarization with GPT-4o-mini model
 *   - Added mail rules management (create, update, delete, list)
 *   - Added rule testing capabilities for incoming emails
 */


const GMail = require('./gmail-driver');
const { firestore } = require('./firestore');
const user = require('./user-service');
const secretService = require('./secret-service');
const OpenAIDriver = require('./openai-driver');
const system = require('./system');
const MailCacheService = require('./mail-cache-service');

const COLLECTION = 'k2o-mail';
const RULES_COLLECTION = 'k2o-mail-rules';


class MailService {
  
  /**
   * Sends an email using the specified account
   * @param {string} account - The account ID to send from
   * @param {string} to - Recipient email address
   * @param {string} subject - Email subject
   * @param {string} body - Email body content
   * @param {string} [inResponseTo] - Optional ID of email being responded to
   * @param {string[]} [ccList] - Optional array of CC recipient email addresses
   * @param {boolean} [replyToAll] - Whether to include original recipients in reply
   * @returns {Promise<void>} A promise that resolves when email is sent
   * @throws {Error} If required parameters are missing or account not found
   */
  async sendMail(account, to, subject, body, inResponseTo, ccList = [], replyToAll = false) {
    if (!account || !to || !subject || !body) {
      throw system.mkError('Required parameters missing', {
        method: 'MailService.sendMail',
        userId: this._userId
      });
    }
    
    let client = this._clients[account];
    if (!client) {
      client = Object.values(this._clients)
        .find(client => client.getEmail() === account);
      if(!client) {
        throw system.mkError('Account not found', {
          accountId: account,
          userId: this._userId
        });
      }
    }
    
    let replyToId = null;
    if (inResponseTo) {
      const originalEmail = await this.get(inResponseTo);
      
      if (originalEmail) {
        replyToId = originalEmail.messageId;
        
        if (replyToAll && originalEmail.cc) {
          const originalCCs = originalEmail.cc.split(',').map(cc => cc.trim());
          const allCCs = [...new Set([...ccList, ...originalCCs])];
          ccList = allCCs.filter(cc => cc !== to); // Remove primary recipient from CC
        }
      }
    }
    
    return client.sendMail(to, subject, body, replyToId, ccList.join(','));
  }
  
  // ===== Initialization and Configuration =====

  /**
   * Creates a new MailService instance.
   * @param {Object} clients - Object mapping account IDs to Gmail client instances.
   * @param {string} userId - The user ID who owns these email accounts.
   * @param cache
   * @throws {Error} If userId is missing.
   */
  constructor(clients, userId, cache) {
    this._clients = clients;
    this._userId = userId;
    this._cache = cache;
  }

  /**
   * Initializes the Mail service for a user by obtaining OAuth credentials and creating Gmail clients for all accounts.
   * @param {string} userId - The ID of the user whose Gmail accounts to access.
   * @returns {Promise<MailService>} A promise resolving to a MailService instance.
   * @throws {Error} If userId is missing or if unable to retrieve OAuth credentials
   */
  static async create(userId) {
    if (!userId) {
      throw system.mkError('Required parameter missing: userId', { method: 'MailService.create' });
    }
    const accounts = await user.getUserAccounts(userId);
    const googleAccounts = Object.entries(accounts).filter(([_, account]) => account.type === 'google');

    const [clientId, clientSecret] = await Promise.all([
      secretService.getGoogleClientId(),
      secretService.getGoogleClientSecret()
    ]);

    const clients = {};

    for (const [accountId, accountData] of googleAccounts) {
      const refreshToken = accountData.token;
      if (!refreshToken) {
        throw system.mkError('Required parameter missing: refreshToken', { userId, accountId, method: 'MailService.create' });
      }
      clients[accountId] = await GMail.create(accountId, refreshToken, clientId, clientSecret);
    }
    
    const cache = await MailCacheService.create(userId);

    return new MailService(clients, userId, cache);
  }

  // ===== Account Management Methods =====

  /**
   * Returns a list of account IDs and email addresses associated with them.
   * @returns {Promise<Object[]>} A promise resolving to an array of account objects with id and email.
   */
  async getAccounts() {
    const accounts = await user.getUserAccounts(this._userId);
    return Object.entries(accounts)
      .filter(([_, account]) => account.type === 'google')
      .map(([accountId, account]) => ({
        id: accountId,
        email: account.email || 'Unknown email'
      }));
  }
  
  /**
   * Gets the email address associated with a given account ID
   * @param {string} accountId - The account ID to look up
   * @returns {string} The email address for the account
   * @throws {Error} If accountId is missing or account not found
   */
  getAddressForAccount(accountId) {
    if (!accountId) {
      throw system.mkError('Required parameter missing: accountId', {
        method: 'MailService.getAddressForAccount',
        userId: this._userId
      });
    }
    let client = this._clients[accountId];
    return client?.getEmail();
  }
  
  
  // ===== Mail Retrieval Methods =====

  /**
   * Fetches all message IDs under a specific Gmail label for a specific account.
   * @param {string} accountId - The account ID to query.
   * @param {string} labelId - The Gmail label ID to query (default: 'INBOX').
   * @returns {Promise<string[]>} A promise resolving to an array of message IDs (limited to 400).
   * @throws {Error} If accountId is missing or if the specified account is not found.
   */
  getMail(accountId, labelId = 'INBOX') {
    if (!accountId) {
      throw system.mkError('Required parameter missing: accountId', {
        method: 'MailService.getMail',
        userId: this._userId
      });
    }

    const client = this._clients[accountId];
    if (!client) {
      throw system.mkError('Account not found', {
        accountId,
        userId: this._userId,
        method: 'MailService.getMail'
      });
    }

    return client.getIdsByLabel(labelId)
      .then(providerIds => providerIds.slice(0, 400)
        .map(providerId => this._cache.composeId(accountId, providerId)));
  }

  /**
   * Fetches all message IDs under a specific Gmail label.
   * @param {string} labelId - The Gmail label ID to query.
   * @returns {Promise<string[]>} A promise resolving to an array of message IDs.
   * @throws {Error} If labelId is missing or if no accounts are available.
   * @deprecated Use getMail(accountId, labelId) instead
   */
  getIdsByLabel(labelId) {
    if (!labelId) {
      throw system.mkError('Required parameter missing: labelId', {
        method: 'MailService.getIdsByLabel',
        userId: this._userId
      });
    }

    // For backward compatibility - get IDs from the first client
    const accountId = Object.keys(this._clients)[0];
    if (!accountId) {
      throw system.mkError('No accounts available', {
        userId: this._userId,
        method: 'MailService.getIdsByLabel'
      });
    }

    return this._clients[accountId].getIdsByLabel(labelId)
      .then(providerIds => providerIds.map(providerId => this._cache.composeId(accountId, providerId)));
  }

  /**
   * Retrieves emails from all accounts.
   * @param {number} count - Maximum number of emails to retrieve per account (default: 200)
   * @param {number} nDetailed - Number of emails to retrieve with full details (default: 50)
   * @returns {Promise<Object[]>} A promise resolving to an array of email objects with varying detail levels.
   */
  async getAllMail(count = 200, nDetailed = 50) {
    const accountIds = Object.keys(this._clients);
    if (accountIds.length === 0) {
      return [];
    }
    
    let allEmails = [];

    for (const accountId of accountIds) {
      const emailIds = await this.getMail(accountId);
      if (emailIds.length === 0) continue;

      // Process first 100 emails with full details including autoSummary
      const firstBatch = emailIds.slice(0, nDetailed);
      const fullDetailEmails = await Promise.all(
        firstBatch.map(async (id) => {
          const email = await this.get(id);
          return {
            subject: email.title,
            date: email.date,
            sender: email.from,
            autoSummary: email.autoSummary,
            accountId,
            id
          };
        })
      );

      // Process remaining emails (up to 300 more) with limited details
      const secondBatch = emailIds.slice(nDetailed, count);
      const limitedDetailEmails = await Promise.all(
        secondBatch.map(async (id) => {
          const email = await this.getBrief(id);
          return {
            subject: email.title,
            date: email.date,
            sender: email.from,
            accountId,
            id
          };
        })
      );

      allEmails = [...allEmails, ...fullDetailEmails.filter(Boolean), ...limitedDetailEmails.filter(Boolean)];
    }

    return allEmails;
  }

  // ===== Email Content Methods =====

  /**
   * Retrieves a single email by ID, using cache if available.
   * @param {string} rawId - The Gmail message ID.
   * @returns {Promise<Object>} A promise resolving to the formatted email object with full content.
   * @throws {Error} If id is missing, if no client is found for the email ID, or if retrieval fails.
   */
  get(rawId) {
    return this._cache.get(rawId);
  }

  /**
   * Retrieves a brief email object by ID, summarizes if needed, and strips full bodies.
   * @param {string} id - The Gmail message ID.
   * @returns {Promise<Object>} A promise resolving to the brief email object without full body content.
   * @throws {Error} If id is missing, if email retrieval fails, or if account is not found.
   */
  async getBrief(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'MailService.getBrief',
        userId: this._userId
      });
    }
    const data = await this.get(id);

    if (!data) {
      throw system.mkError('Email not found', {
        id,
        userId: this._userId,
        method: 'MailService.getBrief'
      });
    }

    const { textBody, htmlBody, ...brief } = data;
    return brief;
  }

  /**
   * Creates an auto-summary of email text content using OpenAI
   * @param {string} id - Email ID for logging/context
   * @param {string} text - Email text content to summarize
   * @returns {Promise<string>} Summarized content or original text if short enough
   * @throws {Error} If OpenAI API key retrieval fails
   */
  async autoSummarize(id, text) {
    if(text.length < 3000) return text;
    
    system.logInfo("Generating Auto Summary", {id})
    
    const apiKey = await secretService.getOpenAiApiKey();
    if (!apiKey) {
      throw system.mkError('Failed to retrieve OpenAI API key', {
        method: 'MailService.getBrief',
        userId: this._userId
      });
    }
    
    const driver = await OpenAIDriver.create(
      apiKey,
      this._userId,
      `${id}`,
      'User a summarizer. Shorten the message user enters to less than 2000 characters',
      [],
      'gpt-4o-mini'
    );
    return await driver.converse(text);
  }

  // ===== Mail Rule Management =====

  /**
   * Creates a new mail rule
   * @param {string} senderEmail - Email address the rule applies to
   * @param {string} action - Plain text description of the action
   * @param {Object} flags - Rule flags
   * @param {boolean} flags.postToSlack - Whether to post matching emails to Slack
   * @param {boolean} flags.includeMorningSummary - Whether to include in morning summary
   * @param {boolean} flags.autoRespond - Whether to auto-respond
   * @returns {Promise<Object>} New rule
   */
  async createRule(senderEmail, action, flags) {
    if (!senderEmail || !action) {
      throw system.mkError('Required parameters missing', {
        method: 'MailService.createRule',
        userId: this._userId
      });
    }
    
    
    
    const id = 'rule#'+system.mkUUID();
    
    const rule = {
      _id: id,
      userId: this._userId,
      senderEmail,
      action,
      flags: {
        postToSlack: !!flags?.postToSlack,
        includeMorningSummary: !!flags?.includeMorningSummary,
        autoRespond: !!flags?.autoRespond
      },
      createdAt: new Date().toISOString()
    };
    
    return firestore.write(RULES_COLLECTION, id, rule).then(() => rule);
  }
  
  /**
   * Updates an existing mail rule
   * @param {string} ruleId - ID of the rule to update
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated rule
   */
  async updateRule(ruleId, updates) {
    if (!ruleId) {
      throw system.mkError('Required parameter missing: ruleId', {
        method: 'MailService.updateRule',
        userId: this._userId
      });
    }
    
    const rule = await firestore.read(RULES_COLLECTION, ruleId);
    if (!rule || rule.userId !== this._userId) {
      throw system.mkError('Rule not found', {
        method: 'MailService.updateRule',
        userId: this._userId
      });
    }
    
    const updatedRule = {
      ...rule,
      ...updates,
      userId: this._userId, // Ensure userId cannot be changed
      updatedAt: new Date().toISOString()
    };
    
    return firestore.write(RULES_COLLECTION, ruleId, updatedRule)
      .then(() => updatedRule);
  }
  
  /**
   * Deletes a mail rule
   * @param {string} ruleId - ID of the rule to delete
   * @returns {Promise<void>}
   */
  async deleteRule(ruleId) {
    if (!ruleId) {
      throw system.mkError('Required parameter missing: ruleId', {
        method: 'MailService.deleteRule',
        userId: this._userId
      });
    }

    return firestore.delete(RULES_COLLECTION, ruleId);
  }
  
  /**
   * Lists all rules for the current user
   * @returns {Promise<Array>} List of rules
   */
  async listRules() {
    return firestore.query(RULES_COLLECTION, 'userId', this._userId);
  }
  
  /**
   * Tests which rules apply to an email
   * @param {Object} email - Email object to test
   * @returns {Promise<Array>} List of applicable rules
   */
  async testRules(email) {
    if (!email?.from) {
      throw system.mkError('Invalid email object', {
        method: 'MailService.testRules',
        userId: this._userId
      });
    }
    
    const rules = await this.listRules();
    return rules.filter(rule =>
      email.from.toLowerCase().includes(rule.senderEmail.toLowerCase())
    );
  }

  /**
   * Moves an email to the trash folder.
   * @param {string} id - The composite ID of the email to move (userId#accountId#providerId).
   * @returns {Promise<void>} A promise that resolves when the email is moved to trash.
   * @throws {Error} If id is missing or the account for the email is not found.
   */
  async moveToTrash(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'MailService.moveToTrash',
        userId: this._userId
      });
    }

    const { accountId, providerId } = this._cache.decomposeId(id);
    const client = this._clients[accountId];

    if (!client) {
      throw system.mkError('Account not found', {
        accountId,
        userId: this._userId,
        method: 'MailService.moveToTrash'
      });
    }
    
    await client.moveToTrash(providerId);
    await this._cache.archive(id);
    system.logInfo('Email moved to trash', { id, userId: this._userId });
  }

  /**
   * Moves an email to the junk/spam folder.
   * @param {string} id - The composite ID of the email to move (userId#accountId#providerId).
   * @returns {Promise<void>} A promise that resolves when the email is moved to junk.
   * @throws {Error} If id is missing or the account for the email is not found.
   */
  async moveToJunk(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'MailService.moveToJunk',
        userId: this._userId
      });
    }

    const { accountId, providerId } = this._cache.decomposeId(id);
    const client = this._clients[accountId];

    if (!client) {
      throw system.mkError('Account not found', {
        accountId,
        userId: this._userId,
        method: 'MailService.moveToJunk'
      });
    }

    await client.moveToJunk(providerId);
    await this._cache.archive(id);
    system.logInfo('Email moved to junk', { id, userId: this._userId });
  }

  /**
   * Archives an email by removing the INBOX label.
   * @param {string} id - The composite ID of the email to archive (userId#accountId#providerId).
   * @returns {Promise<void>} A promise that resolves when the email is archived.
   * @throws {Error} If id is missing or the account for the email is not found.
   */
  async archive(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'MailService.archive',
        userId: this._userId
      });
    }

    const { accountId, providerId } = this._cache.decomposeId(id);
    const client = this._clients[accountId];

    if (!client) {
      throw system.mkError('Account not found', {
        accountId,
        userId: this._userId,
        method: 'MailService.archive'
      });
    }

    await client.archive(providerId);
    await this._cache.archive(id);
    
    system.logInfo('Email archived', { id, userId: this._userId });
  }
  
  /**
   * Generates a Gmail web link for a given email ID
   * @param {string} id - The composite ID of the email
   * @returns {string} The Gmail web URL for the email
   * @throws {Error} If id is missing or account not found
   */
  getLink(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'MailService.getLink',
        userId: this._userId
      });
    }
    
    const {accountId, providerId} = this._cache.decomposeId(id);
    const client = this._clients[accountId];
    
    if (!client) {
      throw system.mkError('Account not found', {
        accountId: accountId,
        userId: this._userId,
        method: 'MailService.getLink'
      });
    }

    const userEmail = client.getEmail();
    return `https://mail.google.com/mail/u/0/?authuser=${userEmail}#inbox/${providerId}`;
  }

  /**
   * Searches for emails across all connected Gmail accounts
   * @param {string} query - The search query to use
   * @returns {Promise<Object[]>} A promise resolving to an array of email objects across all accounts
   */
  async search(query) {
    if (!query) {
      throw system.mkError('Required parameter missing: query', {
        method: 'MailService.search',
        userId: this._userId
      });
    }

    // Get all connected Gmail accounts
    const accountIds = Object.keys(this._clients);
    if (accountIds.length === 0) {
      system.logInfo('No accounts available for search', { userId: this._userId });
      return [];
    }

    // Search in parallel across all accounts
    const searchResults = await Promise.all(
      accountIds.map(async (accountId) => {
        const client = this._clients[accountId];
        const ids = await client.search(query);
        return ids.map(i => this._cache.composeId(accountId, i));
      })
    );

    const allIds = searchResults.flat();

    let allResults = await Promise.all(
      allIds.map(async (id) => {
        const result = await this._cache.get(id);
        if (!result) return null;
        return {
          date: result.date,
          title: result.title,
          summary: result.autoSummary,
          subject: result.subject,
          sender: result.from,
          linkToMessage: result.linkToMessage,
          id: id
        };
      })
    );
    
    allResults = allResults.filter(Boolean);
    
    // Sort by date (newest first)
    allResults.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });

    return allResults;
  }
  
}

module.exports = MailService;
