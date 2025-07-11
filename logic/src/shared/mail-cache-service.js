/**
 * @fileoverview Mail Cache Service - Handles caching and retrieval of mail data
 *
 * This module provides functionality for caching email data in Firestore
 * and retrieving it efficiently. It serves as a data access layer for email content
 * that can be used by other services. Includes email summarization queue management
 * for processing and analyzing emails.
 *
 * @module mail-cache-service
 * @author K2O Development Team
 * @version 1.0.1
 *
 * @license MIT
 * @copyright (c) 2025 K2O Development Team
 *
 * Version History:
 * 1.0.1 (2025-07-10) - Current version with enhanced email processing and categorization
 * 1.0.0 (2025-06-15) - Initial release with basic email caching functionality
 *
 * NOTE: Areas for improvement (technical debt):
 * - Add support for bulk operations
 * - Implement TTL (time-to-live) for cached data
 * - Add pagination support for list operations
 * - Add error recovery for failed summarization jobs
 * - Implement priority-based queue processing
 */


const user = require('./user-service');
const secretService = require('./secret-service');
const GMail = require('./gmail-driver');
const OpenAiDriver = require('./openai-driver');
const firestore = require('./firestore');
const system = require('./system');
const ContactsCacheService = require('./contacts-cache-service');
const UserKnowledgeService = require("./user-knowledge-service");
const {convert} = require('html-to-text');



const MAIL_COLLECTION = 'k2o-mail';
const USER_COLLECTION = 'k2o-user';
const LABEL_ID = 'INBOX';
const BATCH_SIZE = 5;



/**
 * Service for caching and retrieving mail data from Firestore
 */
class MailCacheService {
  /**
   * Creates a new instance of the MailCacheService for a specific user
   * @param {string} userId - The user ID to create the service for
   * @returns {Promise<MailCacheService>} A new MailCacheService instance
   * @throws {Error} If userId is missing
   */
  static async create(userId) {
    if (!userId) {
      throw system.mkError('Required parameter missing: userId', { method: 'MailCacheService.create' });
    }

    const contactsCacheService = await ContactsCacheService.create(userId);
    const contactObjects = await contactsCacheService.getContacts();
    const contacts = contactObjects
      .filter(contact => contact.emailAddresses)
      .flatMap(contact => {
        const name = contact.names ? `${contact.names[0].displayName} ` : '';
        return contact.emailAddresses.map(email =>
          name ? `${name}<${email.value}>` : `<${email.value}>`
        );
      })
      .join(',')

    const knowledgeService = new UserKnowledgeService(userId);
    const knowledge = (await knowledgeService.listGeneralRecords())
      .map(item => item.content)
      .join('\n');

    return new MailCacheService(userId, await secretService.getOpenAiApiKey(), contacts, knowledge);
  }


  /**
   * Creates a new MailCacheService instance
   * @param {string} userId - The user ID associated with this cache instance
   * @param {string} openAiKey - The OpenAI API key
   * @param {string} contacts - The user's contacts retrieved from ContactsCacheService
   * @param knowledge
   * @throws {Error} If userId is missing
   */
  constructor(userId, openAiKey, contacts, knowledge) {
    if (!userId) {
      throw system.mkError('Required parameter missing: userId', {method: 'MailCacheService.constructor'});
    }
    if (!openAiKey) {
      throw system.mkError('Required parameter missing: openAiKey', {method: 'MailCacheService.constructor'});
    }
    if (!contacts) {
      throw system.mkError('Required parameter missing: contacts', {method: 'MailCacheService.constructor'});
    }

    this._userId = userId;
    this._cacheIdsKey = `user#${this._userId}#cached-ids`;
    this._contacts = contacts;
    this._knowledge = knowledge;

    this._openAiApiKey = openAiKey;
  }


  /**
   * Refreshes the mail cache by retrieving new emails and storing them in Firestore
   * Maintains a list of cached email IDs to avoid re-downloading emails that are already cached
   * @returns {Promise<void>} A promise that resolves when the refresh is complete
   */
  async importNewEmails() {
    const cachedIds = await firestore.read(USER_COLLECTION, this._cacheIdsKey) || {
      ids: [],
      inbox: [],
      deletables: [],
      newMail: [],
      summarizationQueue: [],
    };

    const newIds = [];
    const inbox = [];
    const oldMail = cachedIds.newMail || [];

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
      system.logInfo('Processing account for new mail: ' + accountId, { userId: this._userId, accountId });

      const refreshToken = accountData.token;
      if (!refreshToken) {
        throw system.mkError('Missing refresh token for account', { 
          method: 'MailCacheService.refresh',
          userId: this._userId, 
          accountId 
        });
      }

      const gmailClient = await GMail.create(accountId, refreshToken, clientId, clientSecret);

      const emailIds = await gmailClient.getIdsByLabel(LABEL_ID);

      emailIds.forEach(emailId => {
        const compositeId = this.composeId(accountId, emailId);
        inbox.push(compositeId);
      });

      const newEmailIds = emailIds.filter(emailId => {
        const compositeId = this.composeId(accountId, emailId);
        return !cachedIds.ids.includes(compositeId);
      });

      system.logInfo('Found new emails', {
        userId: this._userId,
        accountId,
        newCount: newEmailIds.length,
        totalCount: emailIds.length
      });

      for (const emailId of newEmailIds) {
        const emailData = await gmailClient.get(emailId);
        const compositeId = this.composeId(accountId, emailId);

        await firestore.write(MAIL_COLLECTION, compositeId, {
          _id: compositeId,
          ...emailData,
          userId: this._userId,
          accountId,
          providerId: emailId,
          importanceScore: 0,
          spamScore: 0,
          cachedAt: new Date().toISOString()
        });

        newIds.push(compositeId);
      }
    }

    await firestore.write(USER_COLLECTION, this._cacheIdsKey, {
      _id: this._cacheIdsKey,
      userId: this._userId,
      ids: cachedIds.ids.concat(newIds),
      inbox: inbox,
      newMail: oldMail.concat(newIds),
      summarizationQueue: cachedIds.summarizationQueue.concat(newIds),
      updatedAt: new Date().toISOString()
    });

    system.logInfo('Mail cache refresh completed', {
      tracker: this._cacheIdsKey,
      cachedCount: cachedIds.ids.length + newIds.length,
      newCount: newIds.length
    });
  }


  /**
   * Supply summaries for emails in the summarization queue
   * @returns {Promise<void>} A promise that resolves when all summaries are supplied
   */
  async supplySummaries() {
    const cachedIds = await firestore.read(USER_COLLECTION, this._cacheIdsKey);
    if (!cachedIds || !cachedIds.summarizationQueue || cachedIds.summarizationQueue.length === 0) {
      system.logInfo('No emails to summarize', {userId: this._userId});
      return;
    }

    let remainingIds = [...cachedIds.summarizationQueue];
    const remainingIdsSet = new Set(remainingIds);

    system.logInfo('Starting enhanced email processing', {
      userId: this._userId,
      remaining: remainingIds.length
    });
    
    for (let i = 0; i < cachedIds.summarizationQueue.length; i += BATCH_SIZE) {
      const batchIds = cachedIds.summarizationQueue.slice(i, i + BATCH_SIZE);
      const emails = await Promise.all(batchIds.map(id => this.get(id)));
      await Promise.all(emails.map(async email => {
        try {
          const summarized = await this.enhancedSummarize(email);
          const scored = await this.applyAdvancedScoring(summarized);
          const categorized = this.categorizeEmail(scored);
          const attachmentTagged = this.processAttachments(categorized);
          const sentimentAnalyzed = this.applySentimentAnalysis(attachmentTagged);
          
          processedEmails.push(sentimentAnalyzed);
          remainingIdsSet.delete(email._id);
        } catch (e) {
          system.logError('Failed to process email', e, {
            userId: this._userId,
            emailId: email._id
          });
        }
      }));
      
      system.logInfo('Enhanced email processing batch completed', {
        userId: this._userId,
        batchSize: batchIds.length,
        remaining: remainingIdsSet.size
      });
    }
    
    await this.updateInbox({
      ...cachedIds,
      summarizationQueue: Array.from(remainingIdsSet),
    });

    system.logInfo('Enhanced email processing completed', {userId: this._userId});
  }

  /**
   * Extracts attachment information from a mail object
   * @param {Object} mail - The mail object
   * @returns {Array} Array of attachment objects
   * @private
   */
  _extractAttachments(mail) {
    const attachments = [];

    const findAttachments = (part) => {
      if (!part) {
        return;
      }

      if (part.filename && part.filename.length > 0 && part.body) {
        attachments.push({
          id: part.body.attachmentId || '',
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0
        });
      }

      if (part.parts && Array.isArray(part.parts)) {
        part.parts.forEach(findAttachments);
      }
    };

    if (mail.payload) {
      findAttachments(mail.payload);
    }

    return attachments;
  }


  /**
   * Retrieves a cached email by its composite ID
   * @param {string} id - The composite ID in format 'userId#accountId#providerId'
   * @returns {Promise<Object|null>} The cached email data or null if not found
   * @throws {Error} If id is missing or malformed
   */
  async get(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'MailCacheService.get',
        userId: this._userId
      });
    }

    return firestore.read(MAIL_COLLECTION, id);
  }


  /**
   * Retrieves multiple cached emails by account ID
   * @param {string} accountId - The account ID to query
   * @param {number} limit - Maximum number of emails to retrieve (default: 100)
   * @returns {Promise<Object[]>} Array of cached email data
   * @throws {Error} If accountId is missing
   */
  async getByAccount(accountId, limit = 100) {
    if (!accountId) {
      throw system.mkError('Required parameter missing: accountId', {
        method: 'MailCacheService.getByAccount',
        userId: this._userId
      });
    }

    // Query using a common prefix for the specified account
    const prefix = `${this._userId}#${accountId}#`;
    // This is a simplified implementation - in a real system, you'd use a more efficient query
    // For example, using a separate index or a query that can match by prefix
    return firestore.query(MAIL_COLLECTION, 'userId', this._userId)
      .then(results => results
        .filter(item => item._id && item._id.startsWith(prefix))
        .slice(0, limit));
  }


  /**
   * Deletes a cached email by its ID
   * @param {string} id - The composite ID of the email to delete
   * @returns {Promise<void>}
   * @throws {Error} If id is missing
   */
  async delete(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'MailCacheService.delete',
        userId: this._userId
      });
    }

    return firestore.delete(MAIL_COLLECTION, id);
  }


  /**
   * Generates a composite cache ID by combining user ID, account ID, and provider ID
   * @param {string} accountId - The account identifier
   * @param {string} providerId - The provider-specific identifier
   * @returns {string} A composite ID in the format 'userId#accountId#providerId'
   */
  composeId(accountId, providerId) {
    return `${this._userId.substring(0, 8)}#${accountId}#${providerId}`;
  }


  /**
   * Decomposes a composite ID into its component parts
   * @param {string} id - The composite ID to decompose
   * @returns {Object} An object containing userId, accountId, and providerId
   * @throws {Error} If id is malformed
   */
  decomposeId(id) {
    const parts = id.split('#');
    if (parts.length < 3) {
      throw system.mkError('Malformed ID', {
        id,
        method: 'MailCacheService._decomposeId',
        userId: this._userId
      });
    }

    return {
      userId: parts[0],
      accountId: parts[1],
      providerId: parts[2]
    };
  }


  /**
   * Retrieves the cached IDs for emails
   * @returns {Promise<Object>} Object containing arrays of cached email IDs
   */
  async getInbox() {
    return (await firestore.read(USER_COLLECTION, this._cacheIdsKey)).inbox;
  }

  /**
   * Updates the inbox with sorted emails based on priority and deletable scores.
   * @returns {Promise<void>} A promise that resolves when the inbox is updated.
   * @param cachedIds
   */
  async updateInbox(cachedIds) {
    const emails = await Promise.all(
      cachedIds.inbox.map(id => this.get(id))
    );
    
    emails.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
    
    const deletableEmails = [...emails];
    deletableEmails.sort((a, b) => (b.deletableScore || 0) - (a.deletableScore || 0));
    
    await firestore.write(USER_COLLECTION, this._cacheIdsKey, {
      ...cachedIds,
      inbox: emails.map(email => email._id),
      deletables: deletableEmails.map(email => email._id),
      updatedAt: new Date().toISOString()
    });
    
    system.logInfo('Inbox updated', {size: emails.length});
  }
  

  /**
   * Generates an enhanced summary for an email with action items, key details, and context awareness
   * @param {Object} email - The email object to enhance
   * @returns {Promise<Object>} The email object with enhanced summary and metadata
   * @throws {Error} If email is missing or invalid
   */
  async enhancedSummarize(email) {
    if (!email || !email._id) {
      throw system.mkError('Required parameter missing: valid email object', {
        method: 'MailCacheService.enhancedSummarize',
        userId: this._userId
      });
    }

    const markdownContent = convert(email.htmlBody || email.textBody || '', {
      wordwrap: 80,
      preserveNewlines: true,
      selectors: [
        {selector: 'img', format: 'skip'},
        {selector: 'a', options: {linkBrackets: true}}
      ]
    });

    const aiDriver = await OpenAiDriver.create(
      this._openAiApiKey,
      this._userId,
      `internal#enhanced-email-${email._id}`,
      'You are an expert email analyzer with deep understanding of business and personal communications. Identify key information, action items, deadlines, and provide detailed, structured summaries.',
      []);

    await aiDriver.setContext("known contacts", this._contacts);
    await aiDriver.setContext("general knowledge", this._knowledge);
    await aiDriver.setContext("email metadata", JSON.stringify({
      from: email.from,
      to: email.to,
      cc: email.cc,
      date: email.date,
      subject: email.title
    }));

    const prompt = `
      Analyze this email comprehensively and provide the following structured information:

      1. Extended Summary (under 2500 characters) - Comprehensive summary capturing all important details and context
      2. Short Summary (under 500 characters) - Concise version highlighting only the most critical points
      3. Action Items - List of specific actions required, if any, with deadlines when mentioned
      4. Key People - People mentioned in the email who appear significant
      5. Deadlines - Any dates or timeframes mentioned that require attention
      6. Importance Score - From 0 to 1, where:
         - 0.8-1.0: Critical/urgent messages requiring immediate action
         - 0.6-0.8: Important business or personal communications
         - 0.4-0.6: Routine information that should be read
         - 0.2-0.4: Low priority, informational content
         - 0.0-0.2: Likely promotional or automated messages
      7. Spam Score - From 0 to 1, where 0 is definitely legitimate and 1 is certainly spam
      8. Category - Classify as: Promotional, Newsletter, Social, Event, Survey, Notification, Confirmation, Business, Personal, Financial, or Other
      9. Sentiment - Overall tone: Positive, Negative, Neutral, or Urgent

      Your response must be a valid plain JSON object with these exact fields: extendedSummary, shortSummary, actionItems, keyPeople, deadlines, importanceScore, spamScore, category, sentiment
      Example response format: 
      {
        "extendedSummary": "Comprehensive summary text...",
        "shortSummary": "Brief summary text...",
        "actionItems": ["Action 1 by date", "Action 2"],
        "keyPeople": ["John Smith", "Sarah Jones"],
        "deadlines": ["2025-07-15", "Next week"],
        "importanceScore": 0.75,
        "spamScore": 0.1,
        "category": "Business",
        "sentiment": "Positive"
      }

      EMAIL CONTENT:
      SUBJECT: ${email.title || 'No Subject'}
      FROM: ${email.from || 'Unknown Sender'}
      DATE: ${email.date || new Date().toISOString()}
      ${markdownContent.substring(0, 15000)}
    `;

    const response = await aiDriver.converse(prompt);

    // Extract and parse JSON response
    const startIndex = response.indexOf('{');
    const endIndex = response.lastIndexOf('}') + 1;
    if (!(startIndex >= 0 && endIndex > 0)) {
      throw system.mkError('Could not find JSON object in response', {
        id: email._id,
        method: 'MailCacheService.enhancedSummarize',
        response
      });
    }
    
    const cleanedResponse = response.substring(startIndex, endIndex)
      .split('\n')
      .map(line => line.replace(/\/\/.*$/, '').trim())
      .filter(line => line.length > 0)
      .join('\n');
    
    
    let data;
    try {
      data = JSON.parse(cleanedResponse);
    } catch (error) {
      throw system.mkError('Could not parse enhanced summarization response', {
        id: email._id,
        method: 'MailCacheService.enhancedSummarize',
        error: error.message,
        response
      });
    }

    // Validate the response structure
    const isValidResponse = data &&
      typeof data === 'object' &&
      typeof data.extendedSummary === 'string' &&
      typeof data.shortSummary === 'string' &&
      Array.isArray(data.actionItems) &&
      Array.isArray(data.keyPeople) &&
      Array.isArray(data.deadlines) &&
      typeof data.importanceScore === 'number' &&
      typeof data.spamScore === 'number' &&
      typeof data.category === 'string' &&
      typeof data.sentiment === 'string' &&
      data.importanceScore >= 0 &&
      data.importanceScore <= 1 &&
      data.spamScore >= 0 &&
      data.spamScore <= 1;

    if (!isValidResponse) {
      throw system.mkError('Invalid enhanced summarization response format', {
        id: email._id,
        method: 'MailCacheService.enhancedSummarize',
        response: data
      });
    }

    // Return enhanced email object
    return {
      ...email,
      autoSummary: data.extendedSummary,
      shortSummary: data.shortSummary,
      actionItems: data.actionItems,
      keyPeople: data.keyPeople,
      deadlines: data.deadlines,
      importanceScore: data.importanceScore,
      spamScore: data.spamScore,
      category: data.category,
      sentiment: data.sentiment,
      enhancedAt: new Date().toISOString()
    };
  }


  /**
   * Applies advanced scoring algorithms to further refine email importance and urgency
   * @param {Object} email - The email object with initial importance and spam scores
   * @returns {Promise<Object>} Email with updated scores and urgency classification
   */
  async applyAdvancedScoring(email) {
    if (!email || !email._id) {
      throw system.mkError('Required parameter missing: valid email object', {
        method: 'MailCacheService.applyAdvancedScoring',
        userId: this._userId
      });
    }

    // Clone the email object to avoid modifying the original
    const scoredEmail = { ...email };

    // Initialize urgency score and deletable score
    let urgencyScore = 0;
    let deletableScore = 0;

    // 1. Adjust based on action items
    if (scoredEmail.actionItems && scoredEmail.actionItems.length > 0) {
      // More action items increase urgency
      urgencyScore += Math.min(scoredEmail.actionItems.length * 0.05, 0.3);

      // Check for urgent keywords in action items
      const urgentTerms = ['urgent', 'immediately', 'asap', 'today', 'now', 'deadline'];
      const hasUrgentActions = scoredEmail.actionItems.some(item => 
        urgentTerms.some(term => item.toLowerCase().includes(term)));

      if (hasUrgentActions) {
        urgencyScore += 0.1;
      }
    }

    // 2. Adjust based on deadlines
    if (scoredEmail.deadlines && scoredEmail.deadlines.length > 0) {
      // Having deadlines increases urgency
      urgencyScore += 0.2;

      // Check for imminent deadlines (within 48 hours)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 2);

      const imminentDeadlines = scoredEmail.deadlines.filter(deadline => {
        // Try to parse date from string
        try {
          const deadlineDate = new Date(deadline);
          if (!isNaN(deadlineDate.getTime())) {
            return deadlineDate <= tomorrow;
          }
        } catch (e) {
          // If parsing fails, check for keywords
          const imminentTerms = ['today', 'tomorrow', 'asap', 'immediately', 'urgent'];
          return imminentTerms.some(term => deadline.toLowerCase().includes(term));
        }
        return false;
      });

      if (imminentDeadlines.length > 0) {
        urgencyScore += 0.3;
      }
    }

    // 3. Adjust based on sender relationships
    // This would ideally use a contacts database to determine relationship strength
    // For now, we'll use a simple approach using the domain
    const senderEmail = scoredEmail.from.match(/<([^>]+)>/)?.[1] || scoredEmail.from;
    const senderDomain = senderEmail.split('@')[1];

    
    // Check if sender's domain matches recipient's domain (internal communication)
    if (scoredEmail.to) {
      const recipientEmail = scoredEmail.to.match(/<([^>]+)>/)?.[1] || scoredEmail.to;
      const recipientDomain = recipientEmail.split('@')[1];
      
      if (senderDomain === recipientDomain) {
        // Internal communications get a boost
        scoredEmail.importanceScore = Math.min(scoredEmail.importanceScore + 0.1, 1.0);
      }
    }

    // 5. Apply sentiment analysis to adjust importance
    if (scoredEmail.sentiment) {
      switch (scoredEmail.sentiment.toLowerCase()) {
        case 'urgent':
          urgencyScore += 0.3;
          scoredEmail.importanceScore = Math.min(scoredEmail.importanceScore + 0.2, 1.0);
          break;
        case 'negative':
          // Negative emails often require attention
          scoredEmail.importanceScore = Math.min(scoredEmail.importanceScore + 0.1, 1.0);
          break;
        case 'positive':
          // No adjustment for positive emails
          break;
        default: // neutral
          // No adjustment for neutral sentiment
          break;
      }
    }

    // 6. Calculate deletable score based on email categories and spam score
    // Emails categorized as promotional, notification, confirmation, newsletter, or invoice are more deletable
    if (scoredEmail.category) {
      const deletableCategories = ['promotional', 'notification', 'confirmation', 'newsletter', 'invoice'];
      if (deletableCategories.includes(scoredEmail.category.toLowerCase())) {
        deletableScore += 0.3;
      }
    }

    // Specifically check for invoice-related content in the title or summary
    const invoiceTerms = ['invoice', 'receipt', 'payment confirmation', 'bill', 'statement'];
    const hasInvoiceContent = invoiceTerms.some(term => 
      (scoredEmail.title && scoredEmail.title.toLowerCase().includes(term)) ||
      (scoredEmail.shortSummary && scoredEmail.shortSummary.toLowerCase().includes(term)));

    if (hasInvoiceContent) {
      deletableScore += 0.35; // Higher deletable score for invoices
    }

    // If labels contain any of the deletable categories, increase score for each one
    if (scoredEmail.labels && Array.isArray(scoredEmail.labels)) {
      const deletableLabels = ['Promotional', 'Notification', 'Confirmation', 'Newsletter'];
      const matchingLabels = scoredEmail.labels.filter(label => 
        deletableLabels.includes(label));

      // Add 0.15 for each additional matching label (cumulative effect)
      if (matchingLabels.length > 0) {
        deletableScore += 0.15 * matchingLabels.length;
      }
    }

    // Incorporate spam score - higher spam score increases deletability
    if (scoredEmail.spamScore > 0) {
      deletableScore += scoredEmail.spamScore * 0.4; // Weight spam score appropriately
    }

    // Cap the deletable score at 1.0
    scoredEmail.deletableScore = Math.min(deletableScore, 1.0);

    // 7. Adjust final urgency and priority scores
    scoredEmail.urgencyScore = Math.min(urgencyScore, 1.0);

    // Combined priority score weighs importance and urgency, and reduces by deletable score
    scoredEmail.priorityScore = Math.min(
      0.7 * scoredEmail.importanceScore + 0.3 * scoredEmail.urgencyScore - 0.5 * scoredEmail.deletableScore, 
      1.0
    );

    // Ensure priority score doesn't go below zero
    scoredEmail.priorityScore = Math.max(scoredEmail.priorityScore, 0.0);

    // 8. Assign a priority label based on priorityScore
    if (scoredEmail.priorityScore >= 0.8) {
      scoredEmail.priorityLabel = 'Critical';
    } else if (scoredEmail.priorityScore >= 0.6) {
      scoredEmail.priorityLabel = 'High';
    } else if (scoredEmail.priorityScore >= 0.4) {
      scoredEmail.priorityLabel = 'Medium';
    } else if (scoredEmail.priorityScore >= 0.2) {
      scoredEmail.priorityLabel = 'Low';
    } else {
      scoredEmail.priorityLabel = 'Minimal';
    }

    return scoredEmail;
  }

  /**
   * Categorizes an email based on its content, sender, and metadata
   * @param {Object} email - The email object to categorize
   * @returns {Object} Email with refined categorization and labels
   */
  categorizeEmail(email) {
    if (!email || !email._id) {
      throw system.mkError('Required parameter missing: valid email object', {
        method: 'MailCacheService.categorizeEmail',
        userId: this._userId
      });
    }

    // Clone the email object to avoid modifying the original
    const categorizedEmail = { ...email };

    // Initialize labels array if it doesn't exist
    if (!categorizedEmail.labels) {
      categorizedEmail.labels = [];
    }

    // Category detection flag to track which primary category is detected
    const detectedCategories = new Set();

    // 1. Apply basic category to labels if it exists
    if (categorizedEmail.category) {
      // Make sure we don't add duplicate labels
      if (!categorizedEmail.labels.includes(categorizedEmail.category)) {
        categorizedEmail.labels.push(categorizedEmail.category);
        detectedCategories.add(categorizedEmail.category);
      }
    }

    // 2. Check for Promotional content
    const promotionalKeywords = ['offer', 'discount', 'promotion', 'sale', 'deal', 'coupon', 'save', 
                             'limited time', 'exclusive', 'buy now', 'off', 'free', 'promo'];
    const hasPromotionalContent = promotionalKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    if ((hasPromotionalContent || (categorizedEmail.spamScore > 0.3 && categorizedEmail.spamScore < 0.7)) && 
        !categorizedEmail.labels.includes('Promotional')) {
      categorizedEmail.labels.push('Promotional');
      detectedCategories.add('Promotional');
    }

    // 3. Check for Newsletter content
    const newsletterKeywords = ['newsletter', 'digest', 'weekly', 'monthly', 'update', 'bulletin', 
                           'roundup', 'recap', 'summary', 'edition'];
    const hasNewsletterContent = newsletterKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    if (hasNewsletterContent && !categorizedEmail.labels.includes('Newsletter')) {
      categorizedEmail.labels.push('Newsletter');
      detectedCategories.add('Newsletter');
    }

    // 4. Check for Financial content
    const financialKeywords = ['invoice', 'payment', 'transaction', 'receipt', 'order', 'subscription',
                             'credit card', 'billing', 'statement', 'paid', 'purchase', 'tax', 
                             'refund', 'balance', 'account', 'finance', 'bank', 'money'];
    const hasFinancialContent = financialKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    // Check specifically for invoice content to mark as deletable
    const invoiceKeywords = ['invoice', 'bill', 'receipt', 'statement', 'payment confirmation'];
    const hasInvoiceContent = invoiceKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    if (hasFinancialContent && !categorizedEmail.labels.includes('Financial')) {
      categorizedEmail.labels.push('Financial');
      detectedCategories.add('Financial');

      // If it's an invoice, increase the deletable score
      if (hasInvoiceContent) {
        categorizedEmail.labels.push('Invoice');
        categorizedEmail.deletableScore = categorizedEmail.deletableScore || 0;
        categorizedEmail.deletableScore += 0.4; // Significant boost to deletable score for invoices
      }
    }

    // 5. Check for action required
    if (categorizedEmail.actionItems && categorizedEmail.actionItems.length > 0) {
      categorizedEmail.labels.push('Action Required');

      // Check if response is needed
      const responseKeywords = ['let me know', 'please respond', 'reply', 'response', 'get back to me',
                              'what do you think', 'your thoughts', 'your opinion'];
      const needsResponse = responseKeywords.some(keyword => 
        (categorizedEmail.autoSummary && categorizedEmail.autoSummary.toLowerCase().includes(keyword)) ||
        categorizedEmail.actionItems.some(item => item.toLowerCase().includes(keyword)));

      if (needsResponse) {
        categorizedEmail.labels.push('Response Needed');
      }
    }

    // 6. Check for time sensitivity
    if (categorizedEmail.deadlines && categorizedEmail.deadlines.length > 0 || 
        (categorizedEmail.urgencyScore && categorizedEmail.urgencyScore > 0.6)) {
      categorizedEmail.labels.push('Time Sensitive');
    }

    // 7. Check for Social content - refined from original
    const socialKeywords = ['connect', 'connection', 'friend', 'following', 'follower', 'liked', 'commented',
                          'shared', 'social media', 'network', 'community', 'profile', 'group'];
    const hasSocialContent = socialKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    const socialSenders = ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'snapchat', 'pinterest',
                         'youtube', 'reddit', 'discord', 'slack'];
    const fromSocialNetwork = socialSenders.some(network => 
      categorizedEmail.from && categorizedEmail.from.toLowerCase().includes(network));

    if ((hasSocialContent || fromSocialNetwork) && !categorizedEmail.labels.includes('Social')) {
      categorizedEmail.labels.push('Social');
      detectedCategories.add('Social');
    }

    // 8. Check for Event content
    const eventKeywords = ['invitation', 'invite', 'event', 'party', 'celebration', 'gathering',
                         'meeting', 'webinar', 'conference', 'workshop', 'join us', 'calendar',
                         'schedule', 'agenda', 'rsvp', 'attend', 'save the date'];
    const hasEventContent = eventKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    if (hasEventContent && !categorizedEmail.labels.includes('Event')) {
      categorizedEmail.labels.push('Event');
      detectedCategories.add('Event');
    }

    // 9. Check for Survey content
    const surveyKeywords = ['survey', 'feedback', 'questionnaire', 'opinion', 'rate', 'rating',
                          'review', 'satisfaction', 'poll', 'evaluation', 'assessment', 'how did we do'];
    const hasSurveyContent = surveyKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    if (hasSurveyContent && !categorizedEmail.labels.includes('Survey')) {
      categorizedEmail.labels.push('Survey');
      detectedCategories.add('Survey');
    }

    // 10. Check for Notification content
    const notificationKeywords = ['notification', 'alert', 'update', 'status', 'changed', 'activity',
                                'notice', 'reminder', 'notify', 'fyi', 'attention'];
    const hasNotificationContent = notificationKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    // Also check sender domains that typically send notifications
    const notificationSenders = ['noreply', 'no-reply', 'donotreply', 'notification', 'alert', 'system',
                               'updates', 'info'];
    const fromNotificationSender = notificationSenders.some(sender => 
      categorizedEmail.from && categorizedEmail.from.toLowerCase().includes(sender));

    if ((hasNotificationContent || fromNotificationSender) && !categorizedEmail.labels.includes('Notification')) {
      categorizedEmail.labels.push('Notification');
      detectedCategories.add('Notification');
    }

    // 11. Detect follow-up emails
    const followupKeywords = ['follow up', 'following up', 'checking in', 'reminder', 'as discussed',
                            'as promised', 'as mentioned', 'as requested'];
    const isFollowup = followupKeywords.some(keyword => 
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)) ||
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)));

    if (isFollowup) {
      categorizedEmail.labels.push('Follow-up');
    }

    // 12. Check for Confirmation content
    const confirmationKeywords = ['confirmation', 'confirmed', 'verify', 'verified', 'complete', 'completed',
                               'success', 'successful', 'approved', 'processed', 'received', 'thank you for',
                               'order confirmed', 'booking confirmed', 'reservation confirmed', 'registered'];
    const hasConfirmationContent = confirmationKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    if (hasConfirmationContent && !categorizedEmail.labels.includes('Confirmation')) {
      categorizedEmail.labels.push('Confirmation');
      detectedCategories.add('Confirmation');
    }

    // 13. Check for Business content
    const businessKeywords = ['business', 'company', 'corporate', 'client', 'project', 'deadline', 'contract',
                           'proposal', 'agreement', 'meeting', 'vendor', 'partner', 'stakeholder', 'roi',
                           'kpi', 'metrics', 'performance', 'professional', 'report', 'quarterly'];
    const hasBusinessContent = businessKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    // Check if it's from a corporate domain (not free email provider)
    const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];
    const senderDomain = this._extractDomainFromEmail(categorizedEmail.from);
    const isLikelyBusiness = senderDomain && !personalDomains.some(domain => senderDomain.includes(domain));

    if ((hasBusinessContent || isLikelyBusiness) && 
        !categorizedEmail.labels.includes('Business') && 
        !detectedCategories.has('Personal')) {
      categorizedEmail.labels.push('Business');
      detectedCategories.add('Business');
    }

    // 14. Check for Personal content
    const personalKeywords = ['personal', 'family', 'friend', 'private', 'home', 'birthday', 'anniversary',
                           'vacation', 'holiday', 'gift', 'congratulations', 'best wishes', 'regards',
                           'love', 'miss you', 'thinking of you', 'visit', 'dinner', 'lunch'];
    const hasPersonalContent = personalKeywords.some(keyword => 
      (categorizedEmail.shortSummary && categorizedEmail.shortSummary.toLowerCase().includes(keyword)) ||
      (categorizedEmail.title && categorizedEmail.title.toLowerCase().includes(keyword)));

    // Check if sender is in contacts (suggesting personal relationship)
    const isFromContact = this._contacts && this._contacts.includes(categorizedEmail.from);

    if ((hasPersonalContent || isFromContact) && 
        !categorizedEmail.labels.includes('Personal') && 
        !detectedCategories.has('Business')) {
      categorizedEmail.labels.push('Personal');
      detectedCategories.add('Personal');
    }

    // 15. Detect information sharing emails
    if (categorizedEmail.actionItems && categorizedEmail.actionItems.length === 0 &&
        detectedCategories.size === 0) {
      categorizedEmail.labels.push('Information');
    }

    // 16. Special handling for high importance items
    if (categorizedEmail.priorityLabel === 'Critical' || categorizedEmail.priorityLabel === 'High') {
      categorizedEmail.labels.push('Important');
    }

    // Make sure labels are unique
    categorizedEmail.labels = [...new Set(categorizedEmail.labels)];

    // Set primary category if none was detected by the AI
    if (!categorizedEmail.category && detectedCategories.size > 0) {
      // Convert the set to an array and take the first category as primary
      categorizedEmail.category = Array.from(detectedCategories)[0];
    }

    return categorizedEmail;
  }

  /**
   * Processes email attachments and adjusts importance based on attachment types
   * @param {Object} email - The email object to process
   * @returns {Object} Email with attachment metadata and adjusted importance
   */
  processAttachments(email) {
    if (!email || !email._id) {
      throw system.mkError('Required parameter missing: valid email object', {
        method: 'MailCacheService.processAttachments',
        userId: this._userId
      });
    }

    // If no attachments, return the original email
    if (!email.attachments || email.attachments.length === 0) {
      return email;
    }

    // Clone the email object to avoid modifying the original
    const processedEmail = { ...email };

    // Initialize attachment metadata
    processedEmail.attachmentMetadata = {
      count: processedEmail.attachments.length,
      types: [],
      totalSize: 0,
      hasDocuments: false,
      hasImages: false,
      hasSpreadsheets: false,
      hasPresentations: false,
      hasArchives: false,
      hasExecutables: false
    };

    // File extension mapping to types
    const typeMap = {
      // Documents
      'pdf': 'document',
      'doc': 'document',
      'docx': 'document',
      'txt': 'document',
      'rtf': 'document',
      'odt': 'document',
      // Spreadsheets
      'xls': 'spreadsheet',
      'xlsx': 'spreadsheet',
      'csv': 'spreadsheet',
      'ods': 'spreadsheet',
      // Presentations
      'ppt': 'presentation',
      'pptx': 'presentation',
      'odp': 'presentation',
      // Images
      'jpg': 'image',
      'jpeg': 'image',
      'png': 'image',
      'gif': 'image',
      'bmp': 'image',
      'svg': 'image',
      // Archives
      'zip': 'archive',
      'rar': 'archive',
      '7z': 'archive',
      'tar': 'archive',
      'gz': 'archive',
      // Executables
      'exe': 'executable',
      'msi': 'executable',
      'app': 'executable',
      'dmg': 'executable',
      'bat': 'executable',
      'sh': 'executable'
    };

    // Process each attachment
    processedEmail.attachments.forEach(attachment => {
      // Calculate total size
      if (attachment.size) {
        processedEmail.attachmentMetadata.totalSize += attachment.size;
      }

      // Determine file type from extension
      if (attachment.filename) {
        const extension = attachment.filename.split('.').pop().toLowerCase();
        const type = typeMap[extension] || 'other';

        if (!processedEmail.attachmentMetadata.types.includes(type)) {
          processedEmail.attachmentMetadata.types.push(type);
        }

        // Set type flags
        switch (type) {
          case 'document':
            processedEmail.attachmentMetadata.hasDocuments = true;
            break;
          case 'spreadsheet':
            processedEmail.attachmentMetadata.hasSpreadsheets = true;
            break;
          case 'presentation':
            processedEmail.attachmentMetadata.hasPresentations = true;
            break;
          case 'image':
            processedEmail.attachmentMetadata.hasImages = true;
            break;
          case 'archive':
            processedEmail.attachmentMetadata.hasArchives = true;
            break;
          case 'executable':
            processedEmail.attachmentMetadata.hasExecutables = true;
            break;
        }
      }
    });

    // Add labels based on attachments
    if (!processedEmail.labels) {
      processedEmail.labels = [];
    }

    processedEmail.labels.push('Has Attachments');

    // Check for invoice attachments which are also considered deletable
    const invoiceAttachmentKeywords = ['invoice', 'receipt', 'bill', 'statement'];
    const hasInvoiceAttachment = processedEmail.attachments.some(attachment => 
      attachment.filename && invoiceAttachmentKeywords.some(keyword => 
        attachment.filename.toLowerCase().includes(keyword)
      )
    );

    if (hasInvoiceAttachment) {
      processedEmail.labels.push('Invoice Attachment');
      processedEmail.deletableScore = processedEmail.deletableScore || 0;
      processedEmail.deletableScore += 0.3; // Increase deletable score for invoice attachments
    }

    if (processedEmail.attachmentMetadata.hasDocuments) {
      processedEmail.labels.push('Has Documents');
    }

    if (processedEmail.attachmentMetadata.hasSpreadsheets) {
      processedEmail.labels.push('Has Spreadsheets');
    }

    if (processedEmail.attachmentMetadata.hasPresentations) {
      processedEmail.labels.push('Has Presentations');
    }

    if (processedEmail.attachmentMetadata.hasExecutables) {
      processedEmail.labels.push('Has Executables');
      // Executable attachments increase spam score
      processedEmail.spamScore = Math.min(processedEmail.spamScore + 0.2, 1.0);
    }

    // Business documents typically increase importance
    if (processedEmail.attachmentMetadata.hasDocuments || 
        processedEmail.attachmentMetadata.hasSpreadsheets || 
        processedEmail.attachmentMetadata.hasPresentations) {
      // Increase importance for business documents if not already high
      if (processedEmail.importanceScore < 0.7) {
        processedEmail.importanceScore = Math.min(processedEmail.importanceScore + 0.15, 0.85);
      }
    }

    // Make sure labels are unique
    processedEmail.labels = [...new Set(processedEmail.labels)];

    return processedEmail;
  }

  /**
   * Applies sentiment analysis to refine email categorization and scores
   * @param {Object} email - The email object to analyze
   * @returns {Object} Email with refined sentiment analysis and adjusted scores
   */
  applySentimentAnalysis(email) {
    if (!email || !email._id) {
      throw system.mkError('Required parameter missing: valid email object', {
        method: 'MailCacheService.applySentimentAnalysis',
        userId: this._userId
      });
    }

    // If sentiment is already analyzed by the AI model, no need to reprocess
    if (email.sentiment) {
      return email;
    }

    // Clone the email object to avoid modifying the original
    const analyzedEmail = { ...email };

    // Initialize sentiment metadata
    analyzedEmail.sentimentMetadata = {
      tone: 'neutral',
      intensity: 'moderate',
      emotionalContent: []
    };

    // Simple keyword-based sentiment analysis
    // In a production system, this would use a more sophisticated NLP approach
    const positiveWords = ['thank', 'thanks', 'appreciate', 'good', 'great', 'excellent', 'awesome', 
                           'happy', 'pleased', 'glad', 'congratulations', 'well done', 'success'];

    const negativeWords = ['issue', 'problem', 'error', 'mistake', 'fault', 'wrong', 'bad', 'poor', 
                           'sorry', 'apology', 'unfortunate', 'regret', 'concern', 'disappointing'];

    const urgentWords = ['urgent', 'immediately', 'asap', 'emergency', 'critical', 'important', 
                        'deadline', 'priority', 'crucial', 'vital', 'urgent attention'];

    // Analyze the email content for sentiment words
    const content = (analyzedEmail.autoSummary || '') + ' ' + (analyzedEmail.shortSummary || '') + ' ' + (analyzedEmail.title || '');
    const contentLower = content.toLowerCase();

    // Count occurrences of sentiment words
    let positiveCount = 0;
    let negativeCount = 0;
    let urgentCount = 0;

    // Check positive words
    positiveWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = contentLower.match(regex);
      if (matches) {
        positiveCount += matches.length;
        if (matches.length > 0 && !analyzedEmail.sentimentMetadata.emotionalContent.includes('positive')) {
          analyzedEmail.sentimentMetadata.emotionalContent.push('positive');
        }
      }
    });

    // Check negative words
    negativeWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = contentLower.match(regex);
      if (matches) {
        negativeCount += matches.length;
        if (matches.length > 0 && !analyzedEmail.sentimentMetadata.emotionalContent.includes('negative')) {
          analyzedEmail.sentimentMetadata.emotionalContent.push('negative');
        }
      }
    });

    // Check urgent words
    urgentWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = contentLower.match(regex);
      if (matches) {
        urgentCount += matches.length;
        if (matches.length > 0 && !analyzedEmail.sentimentMetadata.emotionalContent.includes('urgent')) {
          analyzedEmail.sentimentMetadata.emotionalContent.push('urgent');
        }
      }
    });

    // Determine overall sentiment
    if (urgentCount > Math.max(positiveCount, negativeCount)) {
      analyzedEmail.sentimentMetadata.tone = 'urgent';
    } else if (positiveCount > negativeCount * 1.5) {
      analyzedEmail.sentimentMetadata.tone = 'positive';
    } else if (negativeCount > positiveCount * 1.5) {
      analyzedEmail.sentimentMetadata.tone = 'negative';
    } else {
      analyzedEmail.sentimentMetadata.tone = 'neutral';
    }

    // Determine intensity
    const totalEmotionalWords = positiveCount + negativeCount + urgentCount;
    const contentWordCount = content.split(/\s+/).length;
    const emotionalDensity = contentWordCount > 0 ? totalEmotionalWords / contentWordCount : 0;

    if (emotionalDensity > 0.1) {
      analyzedEmail.sentimentMetadata.intensity = 'high';
    } else if (emotionalDensity > 0.05) {
      analyzedEmail.sentimentMetadata.intensity = 'moderate';
    } else {
      analyzedEmail.sentimentMetadata.intensity = 'low';
    }

    // If no sentiment was previously assigned, use our analysis
    if (!analyzedEmail.sentiment) {
      analyzedEmail.sentiment = analyzedEmail.sentimentMetadata.tone;
    }

    // Adjust importance score based on sentiment
    if (analyzedEmail.sentimentMetadata.tone === 'urgent') {
      analyzedEmail.urgencyScore = Math.min(analyzedEmail.urgencyScore ? analyzedEmail.urgencyScore + 0.2 : 0.7, 1.0);
      analyzedEmail.importanceScore = Math.min(analyzedEmail.importanceScore + 0.1, 1.0);
    } else if (analyzedEmail.sentimentMetadata.tone === 'negative' && 
               analyzedEmail.sentimentMetadata.intensity === 'high') {
      // High intensity negative emails often need attention
      analyzedEmail.importanceScore = Math.min(analyzedEmail.importanceScore + 0.1, 1.0);
    }

    // Apply custom temporal decay directly in the scoring process
    // Apply decay based on age
    const now = new Date();
    const emailDate = new Date(analyzedEmail.date);
    const ageInDays = (now - emailDate) / (1000 * 60 * 60 * 24);
    
    // Apply decay formula to priority score - exponential decay after 3 days
    if (ageInDays > 3) {
      const decayFactor = Math.exp(-0.1 * (ageInDays - 3));
      const newPriority = analyzedEmail.priorityScore * decayFactor;
      
      // Don't let priority go below a minimum threshold based on initial score
      const minPriority = email.priorityScore * 0.3;
      analyzedEmail.priorityScore = Math.max(newPriority, minPriority);
      analyzedEmail.decayFactor = decayFactor;
      analyzedEmail.decayApplied = true;
    }
    
    return analyzedEmail;
  }

  
  /**
   * Applies custom temporal decay to email importance based on recency and interaction patterns
   * @param {Object} email - Single email object to apply decay to
   * @returns {Object} A promise that resolves to the updated email object
   * @throws {Error} If email parameter is missing or invalid
   */
  _applyCustomTemporalDecay(email) {
    if (!email || typeof email !== 'object') {
      throw system.mkError('Required parameter missing or invalid: email', {
        method: 'MailCacheService.applyCustomTemporalDecay',
        userId: this._userId
      });
    }
    

    return email;
  }
  
  
  /**
   * Extract domain from email address
   * @param {string} emailAddress - Full email address
   * @returns {string|null} Domain name or null if parsing fails
   * @private
   */
  _extractDomainFromEmail(emailAddress) {
    if (!emailAddress) return null;

    // Extract the actual email address if it's in the format "Name <email@domain.com>"
    const match = emailAddress.match(/<([^>]+)>/) || emailAddress.match(/(\S+@\S+)/);
    if (!match) return null;

    const email = match[1];
    const domainMatch = email.match(/@([^@]+)$/);
    return domainMatch ? domainMatch[1] : null;
  }

  /**
   * Resets the summarization queue by adding all inbox emails to the queue
   * @returns {Promise<void>} A promise that resolves when the queue is reset
   */
  async resetSummarizationQueue() {
    const cachedIds = await firestore.read(USER_COLLECTION, this._cacheIdsKey);
    if (!cachedIds || !cachedIds.inbox || cachedIds.inbox.length === 0) {
      system.logInfo('No inbox emails found to reset queue', { userId: this._userId });
      return;
    }

    // Update the cache entry to include all inbox emails in the summarization queue
    await firestore.write(USER_COLLECTION, this._cacheIdsKey, {
      ...cachedIds,
      summarizationQueue: [...cachedIds.inbox],
      updatedAt: new Date().toISOString()
    });

    system.logInfo('Summarization queue reset completed', { 
      userId: this._userId,
      emailCount: cachedIds.inbox.length 
    });
  }

  /**
   * Searches emails by a specific label
   * @param {string} label - The label to search for
   * @param {number} limit - Maximum number of emails to return (default: 100)
   * @returns {Promise<Array>} Array of matching emails
   * @throws {Error} If label is missing
   */
  async searchByLabel(label, limit = 100) {
    if (!label) {
      throw system.mkError('Required parameter missing: label', {
        method: 'MailCacheService.searchByLabel',
        userId: this._userId
      });
    }

    const emails = await this._getAllEmails();
    return emails
      .filter(email => email.labels && email.labels.includes(label))
      .slice(0, limit);
  }

  /**
   * Searches emails by priority level
   * @param {string} priorityLevel - The priority level to search for (Critical, High, Medium, Low, Minimal)
   * @param {number} limit - Maximum number of emails to return (default: 100)
   * @returns {Promise<Array>} Array of matching emails
   * @throws {Error} If priorityLevel is missing
   */
  async searchByPriority(priorityLevel, limit = 100) {
    if (!priorityLevel) {
      throw system.mkError('Required parameter missing: priorityLevel', {
        method: 'MailCacheService.searchByPriority',
        userId: this._userId
      });
    }

    const emails = await this._getAllEmails();
    return emails
      .filter(email => email.priorityLabel === priorityLevel)
      .slice(0, limit);
  }

  /**
   * Searches emails within a date range
   * @param {string} startDate - Start date in ISO format (YYYY-MM-DD)
   * @param {string} endDate - End date in ISO format (YYYY-MM-DD)
   * @param {number} limit - Maximum number of emails to return (default: 100)
   * @returns {Promise<Array>} Array of matching emails
   * @throws {Error} If date parameters are missing or invalid
   */
  async searchByDateRange(startDate, endDate, limit = 100) {
    if (!startDate || !endDate) {
      throw system.mkError('Required parameters missing: startDate and/or endDate', {
        method: 'MailCacheService.searchByDateRange',
        userId: this._userId
      });
    }

    try {
      const start = new Date(startDate).toISOString();
      const end = new Date(endDate).toISOString();

      const emails = await this._getAllEmails();
      return emails
        .filter(email => {
          const emailDate = new Date(email.date).toISOString();
          return emailDate >= start && emailDate <= end;
        })
        .slice(0, limit);
    } catch (error) {
      throw system.mkError('Invalid date format', {
        method: 'MailCacheService.searchByDateRange',
        userId: this._userId,
        error: error.message
      });
    }
  }

  /**
   * Searches emails by sentiment
   * @param {string} sentiment - The sentiment to search for (Positive, Negative, Neutral, Urgent)
   * @param {number} limit - Maximum number of emails to return (default: 100)
   * @returns {Promise<Array>} Array of matching emails
   * @throws {Error} If sentiment is missing
   */
  async searchBySentiment(sentiment, limit = 100) {
    if (!sentiment) {
      throw system.mkError('Required parameter missing: sentiment', {
        method: 'MailCacheService.searchBySentiment',
        userId: this._userId
      });
    }

    const emails = await this._getAllEmails();
    return emails
      .filter(email => email.sentiment && 
              email.sentiment.toLowerCase() === sentiment.toLowerCase())
      .slice(0, limit);
  }

  /**
   * Searches emails by importance score range
   * @param {number} minScore - Minimum importance score (0-1)
   * @param {number} maxScore - Maximum importance score (0-1)
   * @param {number} limit - Maximum number of emails to return (default: 100)
   * @returns {Promise<Array>} Array of matching emails
   * @throws {Error} If score parameters are invalid
   */
  async searchByImportance(minScore = 0, maxScore = 1, limit = 100) {
    if (minScore < 0 || minScore > 1 || maxScore < 0 || maxScore > 1 || minScore > maxScore) {
      throw system.mkError('Invalid importance score range', {
        method: 'MailCacheService.searchByImportance',
        userId: this._userId
      });
    }

    const emails = await this._getAllEmails();
    return emails
      .filter(email => email.importanceScore >= minScore && 
              email.importanceScore <= maxScore)
      .slice(0, limit);
  }

  /**
   * Searches emails by category
   * @param {string} category - The category to search for (Business, Personal, Financial, etc.)
   * @param {number} limit - Maximum number of emails to return (default: 100)
   * @returns {Promise<Array>} Array of matching emails
   * @throws {Error} If category is missing
   */
  async searchByCategory(category, limit = 100) {
    if (!category) {
      throw system.mkError('Required parameter missing: category', {
        method: 'MailCacheService.searchByCategory',
        userId: this._userId
      });
    }

    const emails = await this._getAllEmails();
    return emails
      .filter(email => email.category && 
              email.category.toLowerCase() === category.toLowerCase())
      .slice(0, limit);
  }

  /**
   * Searches emails by spam score range
   * @param {number} minScore - Minimum spam score (0-1)
   * @param {number} maxScore - Maximum spam score (0-1)
   * @param {number} limit - Maximum number of emails to return (default: 100)
   * @returns {Promise<Array>} Array of matching emails
   * @throws {Error} If score parameters are invalid
   */
  async searchBySpam(minScore = 0, maxScore = 1, limit = 100) {
    if (minScore < 0 || minScore > 1 || maxScore < 0 || maxScore > 1 || minScore > maxScore) {
      throw system.mkError('Invalid spam score range', {
        method: 'MailCacheService.searchBySpam',
        userId: this._userId
      });
    }

    const emails = await this._getAllEmails();
    return emails
      .filter(email => email.spamScore >= minScore && 
              email.spamScore <= maxScore)
      .slice(0, limit);
  }
  
  /**
   * Returns the list of email IDs sorted by deletable score
   * @returns {Promise<Array<string>>} Array of email IDs sorted by deletable score
   */
  async getDeletables() {
    const cachedIds = await firestore.read(USER_COLLECTION, this._cacheIdsKey);
    return cachedIds?.deletables || [];
  }

  /**
   * Retrieves all items with their ids mentioned in inbox, recalculates their scores and saves them back
   * @returns {Promise<void>} A promise that resolves when rescoring is complete
   */
  async rescore() {
    const cachedIds = await firestore.read(USER_COLLECTION, this._cacheIdsKey);
    if (!cachedIds || !cachedIds.inbox || cachedIds.inbox.length === 0) {
      system.logInfo('No inbox emails found to rescore', { userId: this._userId });
      return;
    }

    system.logInfo('Starting email rescoring', {
      userId: this._userId,
      count: cachedIds.inbox.length
    });

    const inboxEmails = (await Promise.all(
      cachedIds.inbox.map(id => this.get(id))
    ));
    
    await Promise.all(
      inboxEmails.map(async (email) => {
        const rescored = await this.applyAdvancedScoring(email);
        await firestore.update(MAIL_COLLECTION, email._id, () => rescored);
      })
    );
    
    await this.updateInbox(cachedIds);

    system.logInfo('Email rescoring completed');
  }
  
  
  /**
   * Archives an email by removing it from the inbox
   * @param {string} id - The ID of the email to archive
   * @returns {Promise<void>} A promise that resolves when the email is archived
   * @throws {Error} If id is missing or email not found
   */
  async archive(id) {
    if (!id) {
      throw system.mkError('Required parameter missing: id', {
        method: 'MailCacheService.archive',
        userId: this._userId
      });
    }
    
    const cachedIds = await firestore.read(USER_COLLECTION, this._cacheIdsKey);
    if (!cachedIds || !cachedIds.inbox) {
      throw system.mkError('Inbox not found', {
        method: 'MailCacheService.archive',
        userId: this._userId
      });
    }
    
    const inboxIndex = cachedIds.inbox.indexOf(id);
    if (inboxIndex === -1) {
      throw system.mkError('Email not found in inbox', {
        method: 'MailCacheService.archive',
        userId: this._userId,
        emailId: id
      });
    }
    
    cachedIds.inbox.splice(inboxIndex, 1);

    const deletablesIndex = cachedIds.deletables ? cachedIds.deletables.indexOf(id) : -1;
    if (deletablesIndex !== -1) {
      cachedIds.deletables.splice(deletablesIndex, 1);
    }
    
    await firestore.write(USER_COLLECTION, this._cacheIdsKey, {
      ...cachedIds,
      updatedAt: new Date().toISOString()
    });
  }
  
  
  /**
   * General search method that searches across multiple fields
   * @param {string} query - Text to search for in email content and metadata
   * @param {number} limit - Maximum number of emails to return (default: 100)
   * @returns {Promise<Array>} Array of matching emails
   * @throws {Error} If query is missing
   */
  async search(query, limit = 100) {
    if (!query) {
      throw system.mkError('Required parameter missing: query', {
        method: 'MailCacheService.search',
        userId: this._userId
      });
    }

    const queryLower = query.toLowerCase();
    const emails = await this._getAllEmails();

    return emails
      .filter(email => {
        // Search in multiple fields
        return (
          (email.title && email.title.toLowerCase().includes(queryLower)) ||
          (email.from && email.from.toLowerCase().includes(queryLower)) ||
          (email.to && email.to.toLowerCase().includes(queryLower)) ||
          (email.textBody && email.textBody.toLowerCase().includes(queryLower)) ||
          (email.autoSummary && email.autoSummary.toLowerCase().includes(queryLower)) ||
          (email.shortSummary && email.shortSummary.toLowerCase().includes(queryLower))
        );
      })
      .slice(0, limit);
  }

  /**
   * Helper method to get all emails for the current user
   * @returns {Promise<Array>} Array of all user emails
   * @private
   */
  async _getAllEmails() {
    const cachedIds = await firestore.read(USER_COLLECTION, this._cacheIdsKey);
    if (!cachedIds || !cachedIds.ids || cachedIds.ids.length === 0) {
      return [];
    }

    const emails = await Promise.all(cachedIds.ids.map(id => this.get(id)));
    return emails.filter(email => email !== null);
  }
  
}


module.exports = MailCacheService;
