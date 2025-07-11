const { inspect } = require('util');
const yaml = require("js-yaml");
const {v4: uuidv4} = require('uuid');
const {SecretManagerServiceClient} = require("@google-cloud/secret-manager");
const { DateTime } = require('luxon');

const { client_email, private_key } = JSON.parse(process.env.GCP_CREDENTIALS || '{}');

const system = {
  /**
   * Logs a message with a specified severity level and additional context
   * Format is compatible with Google Cloud Logging
   * @param {string} level - Severity level (debug, info, warning, error)
   * @param {string} message - Message String
   * @param {object} [context={}] - Additional context to include in the log
   * @param error
   */
  _log: (level, message, context = {}, error = null) => {
    const _level = level.toLowerCase();
    
    const entry = {
      message,
      severity: _level,
      timestamp: Date.now(),
      localTime: new Date().toLocaleString(),
      data: context
    };
    
    if (error) {
      entry.error = {};
      try {
        const parsed = JSON.parse(error.message);
        if (parsed.message) entry.error.message = parsed.message;
        if (parsed.context) entry.error.context = parsed.context;
      } catch (e) {
        entry.errorMessage = error.message;
      }
      entry.error.stack = error.stack;
    }
    
    const invokeLogger = (_level === 'error') ? console.error : console.log;
    
    if (process.env.DEPLOYMENT === 'local') {
      invokeLogger(yaml.dump(entry, {}));
    } else {
      invokeLogger(JSON.stringify(entry));
    }
  },

  /**
   * Handles errors in request handlers, logs them, and sends appropriate response
   * @param {object} res - Express response object
   * @param {number} code - HTTP status code to return
   * @param {Error|string} err - Error object or message
   * @param {object} [context={}] - Additional context for logging
   * @returns {object} - Express response object
   */
  handleError: (res, code, err, context = {}) => {
    const error = err instanceof Error ? err : new Error(err);
    system.logError("Internal Server Error", error, {
      code: code,
      ...context
    });
    
    const response = {
      code: code
    };
    
    try {
      const parsed = JSON.parse(error.message);
      if (parsed.message) response.message = parsed.message;
      if (parsed.context) response.context = parsed.context;
    } catch (e) {
      response.message = error.message || 'An unexpected error occurred';
    }
    
    if (process.env.NODE_ENV === 'development') {
      response.stack = error.stack;
    }
    
    return res.status(code).json(response);
  },

  /**
   * Logs an info message with additional context
   * @param message
   * @param {object} [context={}] - Additional context to include in the log
   */
  logInfo: (message, context = {}) => {
    system._log('info', message, context);
  },

  /**
   * Logs an error message with additional context
   * @param message
   * @param error
   * @param {object} [context={}] - Additional context to include in the log
   */
  logError: (message, error, context = {}) => {
    message = message ?? error?.message ?? 'An unexpected error occurred';
    try {
      system._log('error', message, context, error);
    } catch (e) {
      console.error(`Failed to log error because: ${e}`);
      console.error(`Original error was: ${message} | ${context} | ${error}`);
    }
  },

  getBaseUrl: () => {
    const url = process.env.BASE_URL;
    if (!url) throw new Error('BASE_URL is not defined');
    return url;
  },
  
  mkError: (message, context) => {
    return new Error(JSON.stringify({ message, context }));
  },
  
  /**
   * Generates a random UUID v4
   * This is the standardized method for generating UUIDs across the system
   * Always use this method instead of directly importing uuid or crypto.randomUUID
   * @returns {string} - Random UUID string
   */
  mkUUID: () => {
    return uuidv4();
  },
  
  /**
   * Generates a shortened 8-character UUID
   * This method generates a full UUID and takes first 8 characters
   * @returns {string} - 8-character UUID string
   */
  mkShortUUID: () => {
    return uuidv4().substring(0, 8);
  },

  /**
   * Formats a timestamp as ISO 8601 with Pacific timezone offset (YYYY-MM-DDTHH:MM:SSZZ)
   * @param {number|string|Date} ts - Timestamp or date input
   * @returns {string} - Formatted string
   */
  formatTime: (ts) => {
    return DateTime.fromMillis(typeof ts === 'number' ? ts : new Date(ts).getTime(), {
      zone: 'America/Los_Angeles'
    }).toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");
  },

  /**
   * Parses an ISO 8601 timestamp string in PST/PDT and returns the equivalent timestamp (ms)
   * Assumes input format is: YYYY-MM-DDTHH:mm:ss in US Pacific local time
   * @param {string} str - Time string in ISO format
   * @returns {number} - Timestamp in milliseconds
   */
  parseTime: (str) => {
    return DateTime.fromFormat(str, "yyyy-MM-dd'T'HH:mm:ss", {
      zone: 'America/Los_Angeles'
    }).toMillis();
  },
  
  googleCredentials: {
    credentials: { client_email, private_key },
    projectId: process.env.GCP_PROJECT
  }
};


module.exports = system;
