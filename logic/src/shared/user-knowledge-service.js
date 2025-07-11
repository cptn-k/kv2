/**
 * @fileoverview User Knowledge Service - Manages user knowledge in file and record structure
 *
 * This service provides functionality for organizing and persisting user knowledge
 * in a structured format. Knowledge is organized in files, with each file containing
 * multiple text records. The service supports standard CRUD operations for both files
 * and records, with special handling for a 'general' knowledge file.
 *
 * @module user-knowledge-service
 * @author K2O Development Team
 * @version 1.0.0
 *
 * @license MIT
 * @copyright (c) 2025 K2O Development Team
 *
 * NOTE: Areas for improvement (technical debt):
 * - Add pagination support for record listing
 * - Implement caching to reduce Firestore reads
 * - Add search functionality across records
 *
 * Version History:
 * - 1.0.0 (2025-06-29): Initial implementation
 *   - Core file and record management
 *   - Special handling for general knowledge file
 *   - Firestore persistence
 */

const firestore = require('./firestore');
const system = require('./system');
const {file} = require("googleapis/build/src/apis/file");
const { Mutex } = require('async-mutex');

const STORE_NAME = 'kv2-user-knowledge';
const GENERAL_FILE_NAME = 'general';

// Create a static mutex for synchronizing access to general file operations
// This ensures operations on the general file are serialized
const generalFileMutex = new Mutex();

class UserKnowledgeService {
  /**
   * Creates a new UserKnowledgeService instance for a specific user
   * @param {string} userId - The user ID for all operations in this instance
   * @throws {Error} If userId is missing
   */
  constructor(userId) {
    if (!userId) {
      throw system.mkError('Required parameter missing: userId', { method: 'UserKnowledgeService.constructor' });
    }
    this.userId = userId;
  }

  /**
   * Creates a document key from a user ID and file ID
   * @param {string} fileId - The file ID
   * @returns {string} The document key
   * @private
   */
  _makeKey(fileId) {
    if (!this.userId) {
      throw system.mkError('Required parameter missing: userId', { method: 'UserKnowledgeService._makeKey' });
    }
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', { method: 'UserKnowledgeService._makeKey' });
    }
    const user = this.userId.substring(0, 8);
    return `user#${user}#file#${fileId}`;
  }

  // ====================================================
  // FILE OPERATIONS
  // ====================================================

  /**
   * Creates a new knowledge file for a user
   * @param {string} fileName - The name of the file
   * @returns {Promise<Object>} The created file object
   * @throws {Error} If fileName is missing
   */
  async createFile(fileName) {
    if (!fileName) {
      throw system.mkError('Required parameter missing: fileName', { method: 'UserKnowledgeService.createFile' });
    }

    const docKey = this._makeKey(system.mkShortUUID());

    const fileData = {
      _id: docKey,
      userId: this.userId,
      name: fileName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      records: {}
    };

    return firestore.write(STORE_NAME, docKey, fileData)
      .then(() => fileData);
  }

  /**
   * Gets a knowledge file by ID
   * @param {string} fileId - The file ID
   * @returns {Promise<Object>} The file data
   * @throws {Error} If fileId is missing, or if file is not found
   */
  getFile(fileId) {
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', { method: 'UserKnowledgeService.getFile' });
    }

    return firestore.read(STORE_NAME, fileId)
      .then(fileData => {
        if (!fileData) {
          throw system.mkError('File not found', { userId: this.userId, fileId, method: 'UserKnowledgeService.getFile' });
        }
        return fileData;
      });
  }
  
  /**
   * Checks if a file exists
   * @param {string} fileId - The file ID to check
   * @returns {Promise<boolean>} True if the file exists
   * @throws {Error} If fileId is missing
   */
  async exists(fileId) {
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', {method: 'UserKnowledgeService.exists'});
    }
    
    return firestore.read(STORE_NAME, fileId)
      .then(fileData => !!fileData);
  }
  
  /**
   * Lists all knowledge files for a user
   * @returns {Promise<Array>} Array of file objects
   */
  listFiles() {
    return firestore.query(STORE_NAME, 'userId', this.userId);
  }

  /**
   * Updates a knowledge file's metadata
   * @param {string} fileId - The file ID
   * @param {Object} metadata - The metadata to update (name, etc.)
   * @returns {Promise<Object>} The updated file data
   * @throws {Error} If fileId or metadata is missing, or if file is not found
   */
  updateFile(fileId, metadata) {
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', { method: 'UserKnowledgeService.updateFile' });
    }
    if (!metadata) {
      throw system.mkError('Required parameter missing: metadata', { method: 'UserKnowledgeService.updateFile' });
    }

    const docKey = this._makeKey(fileId);
    return firestore.read(STORE_NAME, docKey)
      .then(fileData => {
        if (!fileData) {
          throw system.mkError('File not found', { userId: this.userId, fileId, method: 'UserKnowledgeService.updateFile' });
        }

        const updatedData = {
          ...fileData,
          ...metadata,
          updatedAt: Date.now()
        };

        return firestore.write(STORE_NAME, docKey, updatedData)
          .then(() => updatedData);
      });
  }

  /**
   * Deletes a knowledge file
   * @param {string} fileId - The file ID to delete
   * @returns {Promise<boolean>} True if the file was deleted
   * @throws {Error} If fileId is missing, if file is the general file, or if file is not found
   */
  deleteFile(fileId) {
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', { method: 'UserKnowledgeService.deleteFile' });
    }

    // Don't allow deletion of the general file
    if (fileId === GENERAL_FILE_NAME) {
      throw system.mkError('Cannot delete the general file', { userId: this.userId, fileId, method: 'UserKnowledgeService.deleteFile' });
    }

    const docKey = this._makeKey(fileId);
    return firestore.read(STORE_NAME, docKey)
      .then(fileData => {
        if (!fileData) {
          throw system.mkError('File not found', { userId: this.userId, fileId, method: 'UserKnowledgeService.deleteFile' });
        }

        // Delete the document from Firestore
        // We're using a mock delete operation here as Firestore.delete is not implemented
        return firestore.write(STORE_NAME, docKey, null)
          .then(() => true);
      });
  }

  // ====================================================
  // RECORD OPERATIONS
  // ====================================================

  /**
   * Adds a record to a file
   * @param {string} fileId - The file ID
   * @param {string} content - The record content
   * @returns {Promise<Object>} The created record
   * @throws {Error} If fileId or content is missing, or if file is not found
   */
  addRecord(fileId, content) {
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', { method: 'UserKnowledgeService.addRecord' });
    }
    if (!content) {
      throw system.mkError('Required parameter missing: content', { method: 'UserKnowledgeService.addRecord' });
    }

    return firestore.read(STORE_NAME, fileId)
      .then(async fileData => {
        if (!fileData) {
          throw system.mkError('File not found', {
            userId: this.userId,
            fileId,
            method: 'UserKnowledgeService.addRecord'
          });
        }

        const recordId = system.mkShortUUID();
        
        const record = {
          _id: recordId,
          content,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        const records = fileData.records || {};
        records[recordId] = record;

        const updatedData = {
          ...fileData,
          records,
          updatedAt: Date.now()
        };

        return firestore.write(STORE_NAME, fileId, updatedData)
          .then(() => record);
      });
  }

  /**
   * Gets a record from a file
   * @param {string} fileId - The file ID
   * @param {string} recordId - The record ID
   * @returns {Promise<Object>} The record data
   * @throws {Error} If fileId or recordId is missing, or if file or record is not found
   */
  getRecord(fileId, recordId) {
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', { method: 'UserKnowledgeService.getRecord' });
    }
    if (!recordId) {
      throw system.mkError('Required parameter missing: recordId', { method: 'UserKnowledgeService.getRecord' });
    }

    return firestore.read(STORE_NAME, fileId)
      .then(fileData => {
        if (!fileData) {
          throw system.mkError('File not found', { userId: this.userId, fileId, method: 'UserKnowledgeService.getRecord' });
        }

        const records = fileData.records || {};
        const record = records[recordId];

        if (!record) {
          throw system.mkError('Record not found', { userId: this.userId, fileId, recordId, method: 'UserKnowledgeService.getRecord' });
        }

        return record;
      });
  }

  /**
   * Updates a record in a file
   * @param {string} fileId - The file ID
   * @param {string} recordId - The record ID
   * @param {string} content - The new record content
   * @returns {Promise<Object>} The updated record
   * @throws {Error} If fileId, recordId or content is missing, or if file or record is not found
   */
  updateRecord(fileId, recordId, content) {
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', { method: 'UserKnowledgeService.updateRecord' });
    }
    if (!recordId) {
      throw system.mkError('Required parameter missing: recordId', { method: 'UserKnowledgeService.updateRecord' });
    }
    if (!content) {
      throw system.mkError('Required parameter missing: content', { method: 'UserKnowledgeService.updateRecord' });
    }

    return firestore.read(STORE_NAME, fileId)
      .then(fileData => {
        if (!fileData) {
          throw system.mkError('File not found', { userId: this.userId, fileId, method: 'UserKnowledgeService.updateRecord' });
        }

        const records = fileData.records || {};
        const record = records[recordId];

        if (!record) {
          throw system.mkError('Record not found', { userId: this.userId, fileId, recordId, method: 'UserKnowledgeService.updateRecord' });
        }

        // Update the record
        const updatedRecord = {
          ...record,
          content,
          updatedAt: Date.now()
        };

        records[recordId] = updatedRecord;

        const updatedData = {
          ...fileData,
          records,
          updatedAt: Date.now()
        };

        return firestore.write(STORE_NAME, docKey, updatedData)
          .then(() => {
            console.log(updatedRecord);
            return updatedRecord
          });
      });
  }

  /**
   * Deletes a record from a file
   * @param {string} fileId - The file ID
   * @param {string} recordId - The record ID to delete
   * @returns {Promise<boolean>} True if the record was deleted
   * @throws {Error} If fileId or recordId is missing, or if file or record is not found
   */
  deleteRecord(fileId, recordId) {
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', { method: 'UserKnowledgeService.deleteRecord' });
    }
    if (!recordId) {
      throw system.mkError('Required parameter missing: recordId', { method: 'UserKnowledgeService.deleteRecord' });
    }

    return firestore.read(STORE_NAME, fileId)
      .then(fileData => {
        if (!fileData) {
          throw system.mkError('File not found', { userId: this.userId, fileId, method: 'UserKnowledgeService.deleteRecord' });
        }

        const records = fileData.records || {};
        if (!records[recordId]) {
          throw system.mkError('Record not found', { userId: this.userId, fileId, recordId, method: 'UserKnowledgeService.deleteRecord' });
        }

        // Delete the record
        delete records[recordId];

        const updatedData = {
          ...fileData,
          records,
          updatedAt: Date.now()
        };

        return firestore.write(STORE_NAME, fileId, updatedData)
          .then(() => true);
      });
  }

  /**
   * Lists all records in a file
   * @param {string} fileId - The file ID
   * @returns {Promise<Array>} Array of record objects
   * @throws {Error} If fileId is missing, or if file is not found
   */
  listRecords(fileId) {
    if (!fileId) {
      throw system.mkError('Required parameter missing: fileId', { method: 'UserKnowledgeService.listRecords' });
    }

    return firestore.read(STORE_NAME, fileId)
      .then(fileData => {
        if (!fileData) {
          throw system.mkError('File not found', { userId: this.userId, fileId, method: 'UserKnowledgeService.listRecords' });
        }

        const records = fileData.records || {};
        return Object.values(records).sort((a, b) => b.updatedAt - a.updatedAt);
      });
  }

  // ====================================================
  // GENERAL FILE OPERATIONS
  // ====================================================

  /**
   * Ensures the general file exists for a user
   * @returns {Promise<Object>} The general file data
   * @private
   */
  async _ensureGeneralFile() {
    const docKey = this._makeKey(GENERAL_FILE_NAME);
    const fileData = await firestore.read(STORE_NAME, docKey);

    if (!fileData) {
      // Create the general file if it doesn't exist
      const newFileData = {
        _id: docKey,
        userId: this.userId,
        name: 'General Knowledge',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        records: {}
      };

      await firestore.write(STORE_NAME, docKey, newFileData);
      return newFileData;
    }

    return fileData;
  }

  /**
   * Adds a record to the general file
   * @param {string} content - The record content
   * @returns {Promise<Object>} The created record
   * @throws {Error} If content is missing
   */
  async addGeneralRecord(content) {
    if (!content) {
      throw system.mkError('Required parameter missing: content', { method: 'UserKnowledgeService.addGeneralRecord' });
    }

    // Use mutex to ensure only one operation can access this critical section at a time
    return generalFileMutex.runExclusive(async () => {
      // Inside this function, we have exclusive access
      await this._ensureGeneralFile();
      return this.addRecord(this._makeKey(GENERAL_FILE_NAME), content);
    });
  }

  /**
   * Gets a record from the general file
   * @param {string} recordId - The record ID
   * @returns {Promise<Object>} The record data
   * @throws {Error} If recordId is missing
   */
  getGeneralRecord(recordId) {
    if (!recordId) {
      throw system.mkError('Required parameter missing: recordId', { method: 'UserKnowledgeService.getGeneralRecord' });
    }

    return this.getRecord(this._makeKey(GENERAL_FILE_NAME), recordId);
  }

  /**
   * Updates a record in the general file
   * @param {string} recordId - The record ID
   * @param {string} content - The new record content
   * @returns {Promise<Object>} The updated record
   * @throws {Error} If recordId or content is missing
   */
  updateGeneralRecord(recordId, content) {
    if (!recordId) {
      throw system.mkError('Required parameter missing: recordId', { method: 'UserKnowledgeService.updateGeneralRecord' });
    }
    if (!content) {
      throw system.mkError('Required parameter missing: content', { method: 'UserKnowledgeService.updateGeneralRecord' });
    }

    return this.updateRecord(this._makeKey(GENERAL_FILE_NAME), recordId, content);
  }

  /**
   * Deletes a record from the general file
   * @param {string} recordId - The record ID to delete
   * @returns {Promise<boolean>} True if the record was deleted
   * @throws {Error} If recordId is missing
   */
  deleteGeneralRecord(recordId) {
    if (!recordId) {
      throw system.mkError('Required parameter missing: recordId', { method: 'UserKnowledgeService.deleteGeneralRecord' });
    }

    return this.deleteRecord(this._makeKey(GENERAL_FILE_NAME), recordId);
  }

  /**
   * Lists all records in the general file
   * @returns {Promise<Array>} Array of record objects
   */
  async listGeneralRecords() {
    // Use mutex to ensure consistency with other general file operations
    return generalFileMutex.runExclusive(async () => {
      // Ensure the general file exists
      await this._ensureGeneralFile();
      return this.listRecords(this._makeKey(GENERAL_FILE_NAME));
    });
  }

  /**
   * Static factory method to create a new UserKnowledgeService instance
   * @param {string} userId - The user ID for all operations
   * @returns {UserKnowledgeService} A new instance for the specified user
   */
  static forUser(userId) {
    return new UserKnowledgeService(userId);
  }
}


module.exports = UserKnowledgeService;