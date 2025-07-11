/**
 * @fileoverview ClickUp Driver - Handles interactions with the ClickUp API
 *
 * Provides methods for interacting with the ClickUp API v2, including task management,
 * workspace hierarchy navigation, status operations, and webhook management.
 * Implements proper error handling and follows project conventions for external service integrations.
 *
 * @module clickup-driver
 * @author K2O Development Team
 * @version 1.1.0
 *
 * @license MIT
 * @copyright (c) 2025 K2O Development Team
 *
 * NOTE: Areas for improvement (technical debt):
 * - Add pagination support for listing methods
 * - Implement more comprehensive rate limiting handling
 * - Add webhook payload validation and signature verification
 * 
 * Version History:
 * - 1.1.0 (2025-06-29): Added webhook management
 *   - Methods to create, list, update and delete webhooks
 * - 1.0.0 (2025-06-29): Initial implementation
 *   - Basic task management (get, delete, tags)
 *   - Workspace hierarchy navigation
 *   - Status change operations
 */

const axios = require('axios');
const system = require('./system');

/**
 * Handles interactions with the ClickUp API v2 for task management and workspace operations.
 */
class ClickUpDriver {

  
  /**
   * Creates a new ClickUp driver instance
   * @param {string} accessToken - ClickUp API access token
   */
  constructor(accessToken) {
    if (!accessToken) {
      throw system.mkError('Required parameter missing: accessToken', { method: 'ClickUpDriver.constructor' });
    }
    
    this._accessToken = accessToken;
    this._baseUrl = 'https://api.clickup.com/api/v2';
    this._client = axios.create({
      baseURL: this._baseUrl
    });
    this._user = null;
  }

  /**
   * Creates a new ClickUp driver instance with the given access token
   * @param {string} accessToken - ClickUp API access token
   * @returns {ClickUpDriver} A new ClickUp driver instance
   * @throws {Error} If accessToken is missing
   */
  static create(accessToken) {
    if (!accessToken) {
      throw system.mkError('Required parameter missing: accessToken', { method: 'ClickUpDriver.create' });
    }

    return new ClickUpDriver(accessToken);
  }

  /**
   * Makes a request to the ClickUp API
   * @param {string} method - HTTP method (get, post, put, delete)
   * @param {string} endpoint - API endpoint
   * @param {Object} [data] - Request body for POST/PUT requests
   * @param {Object} [params] - Query parameters for GET requests
   * @returns {Promise<Object>} API response
   * @private
   */
  async _request(method, endpoint, data = null, params = null) {
    if (!method) {
      throw system.mkError('Required parameter missing: method', { method: 'ClickUpDriver._request' });
    }

    if (!endpoint) {
      throw system.mkError('Required parameter missing: endpoint', { method: 'ClickUpDriver._request' });
    }

      const config = {};
      if (params) {
        config.params = params;
      }

      // Ensure authorization header is set for every request
      config.headers = {
        'Authorization': this._accessToken,
        'Content-Type': 'application/json'
      };

    let response;
    try {
      switch (method.toLowerCase()) {
        case 'get':
          response = await this._client.get(endpoint, config);
          break;
        case 'post':
          response = await this._client.post(endpoint, data, config);
          break;
        case 'put':
          response = await this._client.put(endpoint, data, config);
          break;
        case 'delete':
          response = await this._client.delete(endpoint, config);
          break;
        default:
          throw system.mkError(`Unsupported HTTP method: ${method}`, {
            method: 'ClickUpDriver._request',
            httpMethod: method,
            endpoint
          });
      }
    } catch (e) {
      throw system.mkError(
        `Failed to make API request: ${e.message} (${JSON.stringify(e.response?.data)})`,
        {
          status: e.response?.status,
          body: e.response?.data,
          data, params, config
        });
    }
    
    return response.data;
  }

  /**
   * Gets tasks by assignee and label
   * @param {string} listId - ClickUp list ID
   * @param {string[]} [assignees] - Array of assignee user IDs
   * @param {string[]} [tags] - Array of tag names
   * @param {boolean} [includeSubtasks=false] - Whether to include subtasks
   * @param {number} [page=0] - Page number for pagination
   * @returns {Promise<Object[]>} Tasks matching the criteria
   * @throws {Error} If listId is missing or API request fails
   */
  async getTasksByAssigneeAndLabel(listId, assignees = [], tags = [], includeSubtasks = false, page = 0) {
    if (!listId) {
      throw system.mkError('Required parameter missing: listId', { method: 'ClickUpDriver.getTasksByAssigneeAndLabel' });
    }

    const filters = {};

    if (assignees.length > 0) {
      filters.assignees = assignees.join(',');
    }

    if (tags.length > 0) {
      filters.tags = tags.join(',');
    }

    try {
      return await this._getTasks(listId, includeSubtasks, page, filters);
    } catch (error) {
      throw system.mkError(`Failed to retrieve tasks by assignee and label for list: ${listId}`, {
        method: 'ClickUpDriver.getTasksByAssigneeAndLabel',
        listId,
        assignees,
        tags,
        includeSubtasks,
        page,
        originalError: error.message
      });
    }
  }

  /**
   * Deletes a task
   * @param {string} taskId - ClickUp task ID
   * @returns {Promise<Object>} API response
   * @throws {Error} If taskId is missing or API request fails
   */
  async deleteTask(taskId) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', { method: 'ClickUpDriver.deleteTask' });
    }

    return this._request('delete', `/task/${taskId}`);
  }

  /**
   * Gets task details in batch
   * @param {string[]} taskIds - Array of ClickUp task IDs
   * @param {number} [concurrency=5] - Number of concurrent requests to make
   * @returns {Promise<Object[]>} Array of task details
   * @throws {Error} If API requests fail
   */
  async getTaskDetailsBatch(taskIds, concurrency = 5) {
    if (!taskIds) {
      throw system.mkError('Required parameter missing: taskIds', { method: 'ClickUpDriver.getTaskDetailsBatch' });
    }

    if (taskIds.length === 0) {
      return [];
    }

    const results = [];

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < taskIds.length; i += concurrency) {
      const batch = taskIds.slice(i, i + concurrency);
      const batchPromises = batch.map(taskId => {
        return this.getTaskDetails(taskId);
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Small delay between batches to be nice to the API
      if (i + concurrency < taskIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Gets details for a single task
   * @param {string} taskId - ClickUp task ID
   * @returns {Promise<Object>} Task details
   * @throws {Error} If taskId is missing or API request fails
   */
  async getTaskDetails(taskId) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', { method: 'ClickUpDriver.getTaskDetails' });
    }

    return this._request('get', `/task/${taskId}`)
      .then(r => this._normalizeTask(r));
  }
  
  /**
   * Normalizes a ClickUp task into a standard format
   * @param {Object} clickupTask - Raw ClickUp task object
   * @returns {Object} Normalized task object containing standard fields
   * @private
   */
  
  _normalizeTask(clickupTask) {
    return {
      id: clickupTask.id,
      name: clickupTask.name,
      text_content: clickupTask.text_content,
      description: clickupTask.description,
      status: clickupTask.status?.status,
      date_created: clickupTask.date_created,
      date_updated: clickupTask.date_updated,
      date_closed: clickupTask.date_closed,
      start_date: clickupTask.start_date,
      due_date: clickupTask.due_date,
      assignees: (clickupTask.assignees || []).map(a => ({
        id: a.id,
        username: a.username,
        email: a.email
      })),
      priority: clickupTask.priority?.priority,
      team_id: clickupTask.team_id,
      project: clickupTask.project,
      space: clickupTask.space,
      folder: clickupTask.folder,
      list: clickupTask.list,
      url: clickupTask.url
    };
  }
  
  
  /**
   * Adds a tag to a task
   * @param {string} taskId - ClickUp task ID
   * @param {string} tag - Tag name to add
   * @returns {Promise<Object>} Updated task
   * @throws {Error} If taskId or tag is missing, or API request fails
   */
  async addTagToTask(taskId, tag) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', { method: 'ClickUpDriver.addTagToTask' });
    }

    if (!tag) {
      throw system.mkError('Required parameter missing: tag', { method: 'ClickUpDriver.addTagToTask' });
    }

    // First get current tags
    const task = await this.getTaskDetails(taskId);
    const currentTags = task.tags || [];

    // Check if tag already exists
    if (currentTags.some(t => t.name === tag)) {
      return task; // Tag already exists, return current task
    }

    // Add the new tag
    const tags = [...currentTags.map(t => t.name), tag];

    return this._request('put', `/task/${taskId}`, {
      tags
    });
  }

  /**
   * Removes a tag from a task
   * @param {string} taskId - ClickUp task ID
   * @param {string} tag - Tag name to remove
   * @returns {Promise<Object>} Updated task
   * @throws {Error} If taskId or tag is missing, or API request fails
   */
  async removeTagFromTask(taskId, tag) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', { method: 'ClickUpDriver.removeTagFromTask' });
    }

    if (!tag) {
      throw system.mkError('Required parameter missing: tag', { method: 'ClickUpDriver.removeTagFromTask' });
    }

    // First get current tags
    const task = await this.getTaskDetails(taskId);
    const currentTags = task.tags || [];

    // Filter out the tag to remove
    const tags = currentTags
      .filter(t => t.name !== tag)
      .map(t => t.name);

    return this._request('put', `/task/${taskId}`, {
      tags
    });
  }

  /**
   * Moves a task to a different list
   * @param {string} taskId - ClickUp task ID
   * @param {string} listId - Destination list ID
   * @returns {Promise<Object>} Updated task
   * @throws {Error} If taskId or listId is missing, or API request fails
   */
  async moveTaskToList(taskId, listId) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', { method: 'ClickUpDriver.moveTaskToList' });
    }

    if (!listId) {
      throw system.mkError('Required parameter missing: listId', { method: 'ClickUpDriver.moveTaskToList' });
    }

    return this._request('post', `/task/${taskId}`, {
      list: {
        id: listId
      }
    });
  }

  /**
   * Gets all spaces in the user's workspace
   * @param {string} workspaceId - ClickUp workspace ID
   * @returns {Promise<Object>} Spaces in the workspace
   * @throws {Error} If workspaceId is missing or API request fails
   */
  async getSpaces(workspaceId) {
    if (!workspaceId) {
      throw system.mkError('Required parameter missing: workspaceId', { method: 'ClickUpDriver.getSpaces' });
    }

    return this._request('get', `/team/${workspaceId}/space`).then(r => r.spaces || []);
  }

  /**
   * Gets all folders in a space
   * @param {string} spaceId - ClickUp space ID
   * @returns {Promise<Object>} Folders in the space
   * @throws {Error} If spaceId is missing or API request fails
   */
  async getFolders(spaceId) {
    if (!spaceId) {
      throw system.mkError('Required parameter missing: spaceId', { method: 'ClickUpDriver.getFolders' });
    }

    return this._request('get', `/space/${spaceId}/folder`).then(r => r.folders || []);
  }

  /**
   * Retrieves all lists in a folder
   * @param {string} folderId - Folder ID
   * @returns {Promise<Object>} Lists in the folder
   * @throws {Error} If folderId is missing or API request fails
   */
  async getLists(folderId) {
    if (!folderId) {
      throw system.mkError('Required parameter missing: folderId', { method: 'ClickUpDriver.getLists' });
    }

    return this._request('get', `/folder/${folderId}/list`).then(r => r.lists || []);
  }
  
  /**
   * Retrieves all lists in a space that are not in any folder
   * @param {string} spaceId - Space ID
   * @returns {Promise<Object>} Lists in the space not belonging to any folder
   * @throws {Error} If spaceId is missing or API request fails
   */
  async getFolderlessLists(spaceId) {
    if (!spaceId) {
      throw system.mkError('Required parameter missing: spaceId', {method: 'ClickUpDriver.getFolderlessLists'});
    }
    
    return this._request('get', `/space/${spaceId}/list`).then(r => r.lists || []);
  }

  
  
  /**
   * Retrieves all tasks in a list
   * @param {string} listId - List ID
   * @param {boolean} [includeSubtasks=false] - Whether to include subtasks
   * @param {number} [page=0] - Page number for pagination
   * @param filters
   * @returns {Promise<Object[]>} Tasks in the list
   * @throws {Error} If listId is missing or API request fails
   */
  /**
   * Retrieves all tasks in a list
   * @param {string} listId - List ID
   * @param {boolean} [includeSubtasks=false] - Whether to include subtasks
   * @param {number} [page=0] - Page number for pagination
   * @returns {Promise<Object[]>} Tasks in the list
   * @throws {Error} If listId is missing or API request fails
   */
  async getTasks(listId, includeSubtasks = false, page = 0) {
    return this._getTasks(listId, includeSubtasks, page);
  }
  
  
  async _getTasks(listId, includeSubtasks = false, page = 0, filters = {}) {
    if (!listId) {
      throw system.mkError('Required parameter missing: listId', { method: 'ClickUpDriver.getTasks' });
    }
    
    const params = {
      subtasks: includeSubtasks,
      page: page,
      ...filters
    };

    try {
      const response = await this._request('get', `/list/${listId}/task`, null, params);
      return response.tasks || [];
    } catch (error) {
      throw system.mkError(`Failed to retrieve tasks for list: ${listId}`, { 
        method: 'ClickUpDriver.getTasks',
        listId,
        includeSubtasks,
        page,
        filters,
        originalError: error.message 
      });
    }
  }

  /**
   * Gets all lists in a folder
   * @param {string} folderId - ClickUp folder ID
   * @returns {Promise<Object>} Lists in the folder
   * @throws {Error} If folderId is missing or API request fails
   */
  async getListsInFolder(folderId) {
    if (!folderId) {
      throw system.mkError('Required parameter missing: folderId', { method: 'ClickUpDriver.getListsInFolder' });
    }

    return this._request('get', `/folder/${folderId}/list`);
  }

  /**
   * Gets all lists in a space (folderless lists)
   * @param {string} spaceId - ClickUp space ID
   * @returns {Promise<Object>} Lists in the space
   * @throws {Error} If spaceId is missing or API request fails
   */
  async getListsInSpace(spaceId) {
    if (!spaceId) {
      throw system.mkError('Required parameter missing: spaceId', { method: 'ClickUpDriver.getListsInSpace' });
    }

    return this._request('get', `/space/${spaceId}/list`);
  }

  /**
   * Gets all workspaces for the user
   * @returns {Promise<Object>} User's workspaces
   */
  async getWorkspaces() {
    return this._request('get', '/team').then(r => r.teams || []);
  }

  /**
   * Gets all statuses for a list
   * @param {string} listId - ClickUp list ID
   * @returns {Promise<Object>} Statuses for the list
   * @throws {Error} If listId is missing or API request fails
   */
  async getStatuses(listId) {
    if (!listId) {
      throw system.mkError('Required parameter missing: listId', {method: 'ClickUpDriver.getStatuses'});
    }
    
    const list = await this._request('get', `/list/${listId}`);
    return list.statuses || [];
  }

  /**
   * Changes a task's status
   * @param {string} taskId - ClickUp task ID
   * @param {string} statusId - Status ID to set
   * @returns {Promise<Object>} Updated task
   * @throws {Error} If taskId or statusId is missing, or API request fails
   */
  async changeTaskStatus(taskId, statusId) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', { method: 'ClickUpDriver.changeTaskStatus' });
    }

    if (!statusId) {
      throw system.mkError('Required parameter missing: statusId', { method: 'ClickUpDriver.changeTaskStatus' });
    }

    return this._request('put', `/task/${taskId}`, {
      status: statusId
    });
  }

  /**
   * Helper method to set task status by matching against common status names
   * @param {string} taskId - ClickUp task ID
   * @param {string} listId - List ID to get the correct status ID
   * @param {string[]} statusOptions - Array of possible status name matches (lowercase)
   * @param {string} statusType - Human-readable status type for error messages
   * @returns {Promise<Object>} Updated task
   * @throws {Error} If taskId or listId is missing, status not found, or API request fails
   * @private
   */
  async _setTaskStatusByType(taskId, statusOptions, statusType) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', { method: 'ClickUpDriver._setTaskStatusByType' });
    }
    
    if (!statusOptions || !statusOptions.length) {
      throw system.mkError('Required parameter missing: statusOptions', {method: 'ClickUpDriver._setTaskStatusByType'});
    }
    
    if (!statusType) {
      throw system.mkError('Required parameter missing: statusType', {method: 'ClickUpDriver._setTaskStatusByType'});
    }
    
    // Get task details to extract list ID
    const task = await this.getTaskDetails(taskId);
    const listId = task.list.id;
    
    const statuses = await this.getStatuses(listId);
    
    // Try to find a matching status
    const matchedStatus = statuses.find(s => {
      const statusName = s.status.toLowerCase();
      return statusOptions.some(option => statusName.includes(option));
    });

    if (!matchedStatus) {
      // If no match found, get the available statuses for the error message
      const availableStatuses = statuses.map(s => s.status).join(', ');
      throw system.mkError(
        `${statusType} status not found for this list. Available statuses: ${availableStatuses}`,
        { method: 'ClickUpDriver._setTaskStatusByType', listId, taskId, statusOptions }
      );
    }

    return this.changeTaskStatus(taskId, matchedStatus.status);
  }

  /**
   * Changes a task's status to "To Do"
   * @param {string} taskId - ClickUp task ID
   * @param {string} listId - List ID to get the correct status ID
   * @returns {Promise<Object>} Updated task
   * @throws {Error} If taskId or listId is missing, status not found, or API request fails
   */
  async setTaskStatusTodo(taskId) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', {method: 'ClickUpDriver.setTaskStatusTodo'});
    }
    
    return this._setTaskStatusByType(taskId, ['to do', 'todo', 'backlog', 'open'], 'To Do');
  }
  
  /**
   * Changes a task's status to "Doing"
   * @param {string} taskId - ClickUp task ID
   * @param {string} listId - List ID to get the correct status ID
   * @returns {Promise<Object>} Updated task
   * @throws {Error} If taskId or listId is missing, status not found, or API request fails
   */
  async setTaskStatusDoing(taskId) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', {method: 'ClickUpDriver.setTaskStatusDoing'});
    }
    
    return this._setTaskStatusByType(taskId, ['in progress', 'doing', 'in work', 'started', 'working'], 'Doing/In Progress');
  }
  
  /**
   * Changes a task's status to "Done"
   * @param {string} taskId - ClickUp task ID
   * @param {string} listId - List ID to get the correct status ID
   * @returns {Promise<Object>} Updated task
   * @throws {Error} If taskId or listId is missing, status not found, or API request fails
   */
  async setTaskStatusDone(taskId) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', {method: 'ClickUpDriver.setTaskStatusDone'});
    }
    
    return this._setTaskStatusByType(taskId, ['done', 'complete', 'completed', 'finished', 'closed'], 'Done');
  }
  
  /**
   * Gets a hierarchical view of all spaces, folders, and lists
   * @param {string} workspaceId - ClickUp workspace ID
   * @returns {Promise<Object>} Hierarchical structure of spaces, folders, and lists
   * @throws {Error} If workspaceId is missing or API requests fail
   */
  async getFullHierarchy(workspaceId) {
    if (!workspaceId) {
      throw system.mkError('Required parameter missing: workspaceId', { method: 'ClickUpDriver.getFullHierarchy' });
    }
  }
  
  /**
   * Retrieves all tasks from a single list with pagination support
   * @param {string} listId - List ID
   * @param {boolean} [includeSubtasks=false] - Whether to include subtasks
   * @returns {Promise<Object[]>} Array of tasks from the list
   * @private
   */
  async _getAllTasksFromList(listId, includeSubtasks = false) {
    if (!listId) {
      throw system.mkError('Required parameter missing: listId', { method: 'ClickUpDriver._getAllTasksFromList' });
    }

    const tasks = [];
    let page = 0;
    let hasMore = true;

    try {
      while (hasMore) {
        const pageTasks = await this._getTasks(listId, includeSubtasks, page);

        if (pageTasks && pageTasks.length > 0) {
          tasks.push(...pageTasks);
          page++;
        } else {
          hasMore = false;
        }
      }

      return tasks;
    } catch (error) {
      throw system.mkError(`Failed to retrieve all tasks from list: ${listId}`, {
        method: 'ClickUpDriver._getAllTasksFromList',
        listId,
        includeSubtasks,
        originalError: error.message
      });
    }
  }
  
  /**
   * Gets all tasks from a workspace using team-level API endpoint
   * @param {string} teamId - ClickUp team (workspace) ID
   * @param {boolean} [includeSubtasks=false] - Whether to include subtasks
   * @returns {Promise<Object[]>} Array of all tasks in the workspace
   * @throws {Error} If teamId is missing or API request fails
   */
  async getAllTasks(teamId, includeSubtasks = false) {
    if (!teamId) {
      throw system.mkError('Required parameter missing: teamId', {method: 'ClickUpDriver.getAllTasks'});
    }

    const tasks = [];
    let page = 0;
    let hasMore = true;

    const params = {
      subtasks: includeSubtasks
    };

    while (hasMore) {
      params.page = page;

      // Request tasks directly from the team-level endpoint
      const response = await this._request('get', `/team/${teamId}/task`, null, params);

      if (response.tasks && response.tasks.length > 0) {
        const normalizedTasks = response.tasks.map(task => this._normalizeTask(task));
        tasks.push(...normalizedTasks);
        page++;
      } else {
        hasMore = false;
      }
    }

    return tasks;
  }
  
  /**
   * Creates a webhook subscription for specific events in a workspace
   * @param {string} teamId - ClickUp team (workspace) ID
   * @param {string} endpoint - The URL that will receive the webhook events
   * @param {string[]} [events=['*']] - Array of event names to subscribe to
   * @param {string} [spaceId] - Space ID to limit webhook events (optional)
   * @param {string} [listId] - List ID to limit webhook events (optional)
   * @param {string} [folderId] - Folder ID to limit webhook events (optional)
   * @param {string} [taskId] - Task ID to limit webhook events (optional)
   * @returns {Promise<Object>} Created webhook details
   * @throws {Error} If teamId or endpoint is missing, or API request fails
   */
  async createWebhook(teamId, endpoint, events = ['*'], spaceId = null, listId = null, folderId = null, taskId = null) {
    if (!teamId) {
      throw system.mkError('Required parameter missing: teamId', { method: 'ClickUpDriver.createWebhook' });
    }

    if (!endpoint) {
      throw system.mkError('Required parameter missing: endpoint', { method: 'ClickUpDriver.createWebhook' });
    }

    const payload = {
      endpoint,
      events
    };

    // Add optional filters
    if (spaceId) payload.space_id = spaceId;
    if (listId) payload.list_id = listId;
    if (folderId) payload.folder_id = folderId;
    if (taskId) payload.task_id = taskId;

    return this._request('post', `/team/${teamId}/webhook`, payload);
  }
  

  /**
   * Gets all webhooks for a workspace
   * @param {string} teamId - ClickUp team (workspace) ID
   * @returns {Promise<Object>} List of webhooks
   * @throws {Error} If teamId is missing or API request fails
   */
  async getWebhooks(teamId) {
    if (!teamId) {
      throw system.mkError('Required parameter missing: teamId', { method: 'ClickUpDriver.getWebhooks' });
    }

    return this._request('get', `/team/${teamId}/webhook`);
  }

  /**
   * Gets a specific webhook by ID
   * @param {string} webhookId - ClickUp webhook ID
   * @returns {Promise<Object>} Webhook details
   * @throws {Error} If webhookId is missing or API request fails
   */
  async getWebhook(webhookId) {
    if (!webhookId) {
      throw system.mkError('Required parameter missing: webhookId', { method: 'ClickUpDriver.getWebhook' });
    }

    return this._request('get', `/webhook/${webhookId}`);
  }

  /**
   * Updates an existing webhook configuration
   * @param {string} webhookId - ClickUp webhook ID
   * @param {string[]} [events=null] - Array of event names to subscribe to (null means don't update)
   * @param {boolean} [status=null] - Webhook status (true for active, false for inactive, null means don't update)
   * @returns {Promise<Object>} Updated webhook details
   * @throws {Error} If webhookId is missing or API request fails
   */
  async updateWebhook(webhookId, events = null, status = null) {
    if (!webhookId) {
      throw system.mkError('Required parameter missing: webhookId', { method: 'ClickUpDriver.updateWebhook' });
    }

    const payload = {};

    if (events !== null) payload.events = events;
    if (status !== null) payload.status = status ? 'active' : 'inactive';

    return this._request('put', `/webhook/${webhookId}`, payload);
  }

  /**
   * Deletes a webhook subscription
   * @param {string} webhookId - ClickUp webhook ID
   * @returns {Promise<Object>} API response
   * @throws {Error} If webhookId is missing or API request fails
   */
  async deleteWebhook(webhookId) {
    if (!webhookId) {
      throw system.mkError('Required parameter missing: webhookId', { method: 'ClickUpDriver.deleteWebhook' });
    }

    return this._request('delete', `/webhook/${webhookId}`);
  }

  /**
   * Gets authenticated user information
   * @returns {Promise<Object>} User details
   * @throws {Error} If API request fails
   */
  async getUser() {
    if (!this._user) {
      const response = await this._request('get', '/user');
      this._user = response.user;
      system.logInfo("ClickUp User", {user: this._user});
    }
    return this._user;
  }
  
  
  /**
   * Creates a new task
   * @param {Object} taskData - Task data
   * @param {string} taskData.list_id - List ID to create the task in
   * @param {string} taskData.name - Task name/title
   * @param {string} [taskData.description] - Task description
   * @param {number} [taskData.priority] - Task priority (1-4, where 1 is urgent)
   * @param {string[]} [taskData.tags] - Array of tag names
   * @returns {Promise<Object>} Created task object
   * @throws {Error} If required parameters are missing or API request fails
   */
  async createTask(taskData) {
    if (!taskData.list_id) {
      throw system.mkError('Required parameter missing: list_id', { method: 'ClickUpDriver.createTask' });
    }

    if (!taskData.name) {
      throw system.mkError('Required parameter missing: name', { method: 'ClickUpDriver.createTask' });
    }

    const listId = taskData.list_id;
    delete taskData.list_id; // Remove list_id from payload as it's part of the URL

    return this._request('post', `/list/${listId}/task`, taskData);
  }
  
  /**
   * Retrieves all tasks across the workspace that are assigned to the owner of `_accessToken`
   * @param {string} teamId - The ID of the workspace (team)
   * @returns {Promise<Object[]>} List of tasks assigned to the token owner
   * @throws {Error} If teamId is missing or API request fails
   */
  async getOwnTasks(teamId) {
    if (!teamId) {
      throw system.mkError('Required parameter missing: teamId', { method: 'ClickUpDriver.getOwnTasks' });
    }

    const tasks = [];
    let page = 0;
    let hasMore = true;
    
    // Clone filters to avoid modifying the input object
    const params = { };
    const user = await this.getUser();
    // Set assignees filter to use the authenticated user
    params['assignees[]'] = [user.id];

    while (hasMore) {
      params.page = page;

      // Request tasks from the ClickUp API
      const response = await this._request('get', `/team/${teamId}/task`, null, params);

      if (response.tasks && response.tasks.length > 0) {
        const normalized = response.tasks.map(t => this._normalizeTask(t));
        tasks.push(...normalized);
        page++;
      } else {
        hasMore = false;
      }
    }

    return tasks;
  }
  
  /**
   * Updates an existing task with new data
   * @param {string} taskId - ClickUp task ID
   * @param {Object} taskData - Task data to update
   * @param {string} [taskData.name] - Task name/title
   * @param {string} [taskData.description] - Task description
   * @param {number} [taskData.priority] - Task priority (1-4, where 1 is urgent)
   * @param {string[]} [taskData.tags] - Array of tag names
   * @param {string} [taskData.status] - Task status
   * @param {number} [taskData.due_date] - Due date timestamp
   * @returns {Promise<Object>} Updated task object
   * @throws {Error} If taskId is missing or API request fails
   */
  async updateTask(taskId, taskData) {
    if (!taskId) {
      throw system.mkError('Required parameter missing: taskId', {method: 'ClickUpDriver.updateTask'});
    }
    
    if (!taskData || Object.keys(taskData).length === 0) {
      throw system.mkError('Required parameter missing: taskData must contain at least one field to update',
        {method: 'ClickUpDriver.updateTask'});
    }
    
    try {
      const response = await this._request('put', `/task/${taskId}`, taskData);
      return this._normalizeTask(response);
    } catch (error) {
      throw system.mkError(`Failed to update task: ${taskId}`, {
        method: 'ClickUpDriver.updateTask',
        taskId,
        taskData,
        originalError: error.message
      });
    }
  }
}


module.exports = ClickUpDriver;