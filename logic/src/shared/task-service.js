const userService = require('./user-service');
const NodeCache = require('node-cache');
const ClickUpDriver = require('./clickup-driver');
const system = require("./system");
const firestore = require('./firestore');

class TaskService {
  /**
   * Constructor for TaskService
   * @param {Object} driver - ClickUp driver instance
   */
  constructor(driver, userId) {
    this._clickUpDriver = driver;
    this._cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // Cache expires in 5 minutes (300 seconds)
    this._userId = userId;
  }

  /**
   * Creates a new TaskService instance
   * @param {string} userId - User ID to get ClickUp token for
   * @returns {Promise<TaskService>} - New TaskService instance
   */
  static async create(userId) {
    const clickupToken = await userService.getClickUpToken(userId);
    const driver = new ClickUpDriver(clickupToken);
    return new TaskService(driver, userId);
  }

  // ===== Workspace and Space Methods =====

  /**
   * Gets all workspaces
   * @returns {Promise<Array>} List of workspaces
   */
  async getWorkspaces() {
    const cachedWorkspaces = this._cache.get('workspaces');
    if (cachedWorkspaces) {
      return cachedWorkspaces;
    }

    const workspaces = await this._clickUpDriver.getWorkspaces();
    if (workspaces) {
      this._cache.set('workspaces', workspaces);
    }
    return workspaces;
  }

  /**
   * Gets spaces in a workspace
   * @param {string} workspaceId - Workspace ID
   * @returns {Promise<Array>} List of spaces
   */
  async getSpaces(workspaceId) {
    const cacheKey = `spaces_${workspaceId}`;
    const cachedSpaces = this._cache.get(cacheKey);
    if (cachedSpaces) {
      return cachedSpaces;
    }

    const spaces = await this._clickUpDriver.getSpaces(workspaceId);
    if (spaces) {
      this._cache.set(cacheKey, spaces);
    }
    return spaces;
  }

  // ===== Folder and List Methods =====

  /**
   * Gets folders in a space
   * @param {string} spaceId - Space ID
   * @returns {Promise<Array>} List of folders
   */
  async getFolders(spaceId) {
    const cacheKey = `folders_${spaceId}`;
    const cachedFolders = this._cache.get(cacheKey);
    if (cachedFolders) {
      return cachedFolders;
    }

    const folders = await this._clickUpDriver.getFolders(spaceId);
    if (folders) {
      this._cache.set(cacheKey, folders);
    }
    return folders;
  }

  /**
   * Gets lists in a folder
   * @param {string} folderId - Folder ID
   * @returns {Promise<Array>} List of lists
   */
  async getLists(folderId) {
    const cacheKey = `lists_${folderId}`;
    const cachedLists = this._cache.get(cacheKey);
    if (cachedLists) {
      return cachedLists;
    }

    const lists = await this._clickUpDriver.getLists(folderId);
    if (lists) {
      this._cache.set(cacheKey, lists);
    }
    return lists;
  }

  /**
   * Gets lists that are not in any folder
   * @param {string} spaceId - Space ID
   * @returns {Promise<Array>} List of folderless lists
   */
  async getFolderlessLists(spaceId) {
    const cacheKey = `folderless_lists_${spaceId}`;
    const cachedFolderlessLists = this._cache.get(cacheKey);
    if (cachedFolderlessLists) {
      return cachedFolderlessLists;
    }

    const folderlessLists = await this._clickUpDriver.getFolderlessLists(spaceId);
    if (folderlessLists) {
      this._cache.set(cacheKey, folderlessLists);
    }
    return folderlessLists;
  }

  // ===== Task CRUD Operations =====

  /**
   * Creates a new task
   * @param {string} listId - List ID to create task in
   * @param {Object} task - Task data
   * @returns {Promise<Object>} Created task
   */
  async createTask(listId, task) {
    const user = await this._clickUpDriver.getUser();
    const newTask = await this._clickUpDriver.createTask({
      ... task,
      assignees: [String(user.id)],
      list_id: listId});
    this._cache.del(`tasks_${listId}`); // Invalidate the list cache
    return newTask;
  }

  /**
   * Updates a task
   * @param {string} taskId - Task ID to update
   * @param {Object} task - Updated task data
   * @returns {Promise<Object>} Updated task
   */
  async updateTask(taskId, task) {
    return this._clickUpDriver.updateTask(taskId, task);
  }

  /**
   * Deletes a task
   * @param {string} taskId - Task ID to delete
   * @returns {Promise<Object>} Result of delete operation
   */
  async deleteTask(taskId) {
    return this._clickUpDriver.deleteTask(taskId);
  }

  // ===== Task Actions =====

  /**
   * Closes a task
   * @param {string} taskId - Task ID to close
   * @returns {Promise<Object>} Closed task
   */
  async closeTask(taskId) {
    return this._clickUpDriver.closeTask(taskId);
  }

  /**
   * Reopens a task
   * @param {string} taskId - Task ID to reopen
   * @returns {Promise<Object>} Reopened task
   */
  async reopenTask(taskId) {
    return this._clickUpDriver.reopenTask(taskId);
  }

  /**
   * Adds a comment to a task
   * @param {string} taskId - Task ID
   * @param {string} comment - Comment text
   * @returns {Promise<Object>} Updated task
   */
  async addComment(taskId, comment) {
    return this._clickUpDriver.addComment(taskId, comment);
  }

  /**
   * Sets a custom field value on a task
   * @param {string} taskId - Task ID
   * @param {string} fieldId - Custom field ID
   * @param {*} value - New field value
   * @returns {Promise<Object>} Updated task
   */
  async setCustomField(taskId, fieldId, value) {
    return this._clickUpDriver.setCustomField(taskId, fieldId, value);
  }

  // ===== Task Queries =====

  /**
   * Gets a single task by ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Task data
   */
  async getTask(taskId) {
    return this._clickUpDriver.getTaskDetails(taskId);
  }

  /**
   * Gets detailed information about a task
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Detailed task data
   */
  async getTaskDetails(taskId) {
    return this._clickUpDriver.getTaskDetails(taskId);
  }

  /**
   * Gets all tasks in a list
   * @param {string} listId - List ID
   * @returns {Promise<Array>} List of tasks
   */
  async getTasks(listId) {
    const cachedTasks = this._cache.get(`tasks_${listId}`);

    if (cachedTasks) {
      return cachedTasks; // Return from cache if available
    }

    const tasks = await this._clickUpDriver.getTasks(listId);
    this._cache.set(`tasks_${listId}`, tasks);

    return tasks;
  }

  /**
   * Gets tasks assigned to the current user
   * @param {string} workspaceId - Workspace ID
   * @returns {Promise<Array>} List of user's tasks
   */
  async getOwnTasks(workspaceId) {
    const cacheKey = `own_tasks_${workspaceId}`;
    const cachedTasks = this._cache.get(cacheKey);
    if (cachedTasks) {
      return cachedTasks;
    }

    const tasks = await this._clickUpDriver.getOwnTasks(workspaceId);
    if (tasks) {
      this._cache.set(cacheKey, tasks);
    }
    return tasks;
  }

  /**
   * Gets all tasks in a workspace
   * @param {string} workspaceId - Workspace ID
   * @returns {Promise<Array>} List of all tasks
   */
  async getAllTasks(workspaceId) {
    return this._clickUpDriver.getAllTasks(workspaceId);
  }
  
  /**
   * Sets task status to "To Do"
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Updated task
   */
  async setTaskStatusTodo(taskId) {
    return this._clickUpDriver.setTaskStatusTodo(taskId);
  }
  
  /**
   * Sets task status to "Doing"
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Updated task
   */
  async setTaskStatusDoing(taskId) {
    return this._clickUpDriver.setTaskStatusDoing(taskId);
  }
  
  /**
   * Sets task status to "Done"
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Updated task
   */
  async setTaskStatusDone(taskId) {
    return this._clickUpDriver.setTaskStatusDone(taskId);
  }
  
  /**
   * Gets all task lists for a user
   * @returns {Promise<Object>} List of task lists
   * @param forceRefresh
   */
  async getTaskLists(forceRefresh=false) {
    const userId = this._clickUpDriver.userId;
    const cacheKey = `user#${this._userId}#tasklists`;
    const cachedLists = await firestore.read('k2o-user', cacheKey);
    if (cachedLists && !forceRefresh) {
      return cachedLists.data;
    }
    
    const lists = await this._getTaskLists(userId);
    if (lists && lists.length > 0) {
      await firestore.write('k2o-user', cacheKey, {data: lists});
    }
    return lists;
  }
  
  async _getTaskLists(userId) {
    const teams = await this.getWorkspaces();
    
    if (!teams || teams.length === 0) {
      system.logInfo("User has not assigned task workspaces.")
      return []
    }
    
    const lists = [];
    
    const spaces = await this.getSpaces(teams[0].id);
    for (const space of spaces) {
      const folders = await this.getFolders(space.id);
      for (const folder of folders) {
        const tasklists = await this.getLists(folder.id);
        lists.push(...tasklists.map(list => ({
          id: list.id,
          name: list.name
        })));
      }
      
      const folderlessLists = await this.getFolderlessLists(space.id);
      lists.push(...folderlessLists.map(list => ({
        id: list.id,
        name: list.name
      })));
    }
    
    return lists;
  }

}

module.exports = TaskService;