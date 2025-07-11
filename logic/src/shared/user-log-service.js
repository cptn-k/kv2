const firestore = require('./firestore');

/**
 * UserLogService - Manages user activity logs with date, content, and metrics
 */
class UserLogService {
  constructor() {
    this.collection = 'k2o-user-logs';
  }

  /**
   * Creates a new log entry
   * @param {string} userId - The user identifier
   * @param {string} content - The log content/message
   * @param {Object} metrics - Key-value pairs of metrics to store with the log
   * @returns {Promise<string>} - The ID of the created log entry
   */
  async createLogEntry(userId, content = '', metrics = {}) {
    if (!content && (!metrics || Object.keys(metrics).length === 0)) {
      throw new Error('Either content or metrics must be provided');
    }
    
    const logId = `${userId}_${Date.now()}`;
    const entry = {
      userId,
      content,
      metrics,
      date: new Date().toISOString(),
      timestamp: Date.now()
    };

    await firestore.write(this.collection, logId, entry);
    return logId;
  }

  /**
   * Finds log entries for a specific user within a date range
   * @param {string} userId - The user identifier
   * @param {Date|string|number} startDate - Start date for the period (inclusive)
   * @param {Date|string|number} endDate - End date for the period (inclusive)
   * @returns {Promise<Array>} - Array of matching log entries
   */
  async findEntriesByPeriod(userId, startDate, endDate) {
    if (!userId) throw new Error('userId is required');
    if (!startDate) throw new Error('startDate is required');
    if (!endDate) throw new Error('endDate is required');

    // Convert dates to timestamps for comparison
    const startTimestamp = this._getTimestamp(startDate);
    const endTimestamp = this._getTimestamp(endDate);

    // We need to implement a new function in firestore.js for this type of query
    return this._queryByDateRange(userId, startTimestamp, endTimestamp);
  }

  /**
   * Finds log entries for a specific user within a date range that contain specific metrics
   * @param {string} userId - The user identifier
   * @param {Date|string|number} startDate - Start date for the period (inclusive)
   * @param {Date|string|number} endDate - End date for the period (inclusive)
   * @param {Object} metrics - Key-value pairs of metrics to match
   * @returns {Promise<Array>} - Array of matching log entries
   */
  async findEntriesByPeriodAndMetrics(userId, startDate, endDate, metrics) {
    if (!userId) throw new Error('userId is required');
    if (!startDate) throw new Error('startDate is required');
    if (!endDate) throw new Error('endDate is required');
    if (!metrics || Object.keys(metrics).length === 0) {
      throw new Error('At least one metric is required');
    }

    // First get entries by date range
    const entries = await this.findEntriesByPeriod(userId, startDate, endDate);

    // Then filter by metrics
    return entries.filter(entry => {
      return Object.entries(metrics).every(([key, value]) => {
        return entry.metrics && entry.metrics[key] === value;
      });
    });
  }

  /**
   * Helper method to query logs by date range
   * @private
   */
  async _queryByDateRange(userId, startTimestamp, endTimestamp) {
    // First get all entries for this user
    const userEntries = await firestore.query(this.collection, 'userId', userId);

    // Then filter by timestamp range
    return userEntries.filter(entry => {
      return entry.timestamp >= startTimestamp && entry.timestamp <= endTimestamp;
    });
  }

  /**
   * Helper method to convert various date formats to timestamp
   * @private
   */
  _getTimestamp(date) {
    if (typeof date === 'number') {
      return date;
    } else if (typeof date === 'string') {
      return new Date(date).getTime();
    } else if (date instanceof Date) {
      return date.getTime();
    } else {
      throw new Error('Invalid date format');
    }
  }
}

module.exports =  UserLogService;