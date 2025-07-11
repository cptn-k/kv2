# KV2 Project Coding Conventions

## 1. Project Structure

```
logic/
  ├── src/
  │   ├── handler/      # Express route handlers
  │   ├── shared/       # Services, drivers, and utilities
  │   └── index.js      # Main app entry point
  └── ...               # Other project files
```

## 2. File Naming & Organization

- **Naming Pattern:** `kebab-case.js` for all files
  - Handlers: `feature-handler.js` (e.g., `slack-handler.js`)
  - Drivers: `service-driver.js` (e.g., `google-driver.js`)
  - Services: `feature-service.js` (e.g., `user-service.js`)

- **Module Organization:**
  - Group related functionality in dedicated modules
  - Separate core logic from API interactions
  - Use driver pattern for external services

## 3. Code Style

### General

- **Indentation:** 2 spaces (no tabs)
- **Line Length:** ~80-100 characters
- **Semicolons:** Required
- **Quotes:** Single quotes for strings, backticks for templates
- **Trailing Commas:** Used in multiline objects/arrays
- **Empty Lines:** 
  - 2 lines between functions/methods
  - 1 line between logical sections within functions

### Variables & Functions

- **Variables:** `camelCase`
- **Constants:** `camelCase` (function level), `UPPER_CASE` (module level) 
- **Classes:** `PascalCase`
- **Private Properties:** _startsWithUnderscore
- **Boolean Variables:** Start with `is`, `has`, or `should`

### Imports & Exports

- **Import Style:** CommonJS (`require`/`module.exports`)
- **Import Order:**
  1. Node.js built-in modules
  2. External dependencies
  3. Project modules (using relative paths)
- **Separation:** One blank line between import groups

Example:
```javascript
const fs = require('fs');
const https = require('https');

const express = require('express');
const bodyParser = require('body-parser');

const system = require('../shared/system');
const userService = require('../shared/user-service');
```

### Module Structure

Modules should follow this structure with appropriate spacing:

1. File header JSDoc comment
2. 3 blank lines
3. Imports (system > external > internal)
4. 3 blank lines
5. Constants
6. 3 blank lines
7. Functions
8. 3 blank lines
9. Classes (with 3 blank lines between each class)
10. Module exports at the bottom

Example:
```javascript
/**
 * @fileoverview Module Name - Brief description
 * 
 * Detailed explanation about the module.
 * 
 * @module module-name
 * @author K2O Development Team
 * @version 1.0.0
 */



const fs = require('fs');

const axios = require('axios');

const system = require('../shared/system');



const API_VERSION = 'v1';
const DEFAULT_TIMEOUT = 30000;



/**
 * Handles data processing
 * @param {Object} data - The data to process
 * @returns {Object} Processed data
 */
function processData(data) {
  // Implementation
  return data;
}



class ServiceClass {
  // Class implementation
}



module.exports = ServiceClass;
```

## 4. Asynchronous Code

- **Preference:** Promise chains
- **Error Handling:** Let errors be passed on to the caller


## 5. Documentation

### 5.1. Comments

- **No inline comments:** Don't use inline `//` comments unless explaining a formula that is hard to understand.

### 5.2. JSDoc Comments

- **JSDoc:** Required for all:
  - Public functions/methods
  - Classes
  - Non-obvious parameters/return values
- **Format:** Include:
  - Description
  - @param tags with types and descriptions
  - @returns tag with type and description
  - @throws tag when applicable

Example:
```javascript
/**
 * Generates authorization URL for OAuth flow
 * @param {Object} options - Additional authorization options
 * @param {string} options.scope - OAuth scopes (defaults to 'mail-r mail-w')
 * @param {string} options.state - State parameter for CSRF protection
 * @returns {string} Authorization URL
 */
```
- **File Headers:** 
  - **@fileoverview**: Brief but informative overview of what the file/module does
  - **Detailed Description**: 2-3 sentences explaining the module's purpose and main functionality
  - **@module**: Name matching the file name without extension
  - **@author**: Team or individual responsible for the code
  - **@version**: Following semantic versioning (major.minor.patch)
  - **@license**: Licensing information
  - **@copyright**: Year and organization
  - **Technical Debt Notes**: Optional section listing known issues and future improvements
  - **Version History**: Chronological list of versions with dates and key changes
  - 
Example:
```javascript
/**
 * @fileoverview [Module Name] - [Brief description of functionality]
 *
 * [Detailed explanation about the module, listing its primary functionality and goals.]
 *
 * @module [module-name]
 * @author K2O Development Team
 * @version [semantic version number]
 *
 * @license MIT
 * @copyright (c) 2025 K2O Development Team
 *
 * NOTE: Areas for improvement (technical debt):
 * - [List known issues or technical debt items]
 * - [Additional improvement needed]
 * 
 * Version History:
 * - [version] ([date]): [Brief description]
 *   - [Feature or change 1]
 *   - [Feature or change 2]
 */
```


## 6. Error Handling

### 6.2. General Principles

- **Error Propagation:** Services, drivers, and utilities never catch errors unless explicitly required
- **Strategic Error Handling:** Handle errors in entry points such as endpoint handlers
- **No Silent Failures:** Never catch and swallow errors without proper handling
- **Targeted Try/Catch:** Never surround an entire function body with try/catch; place them strategically where needed

### 6.2. Error Creation and Throwing

- **System Error Objects:** Always use `system.mkError()` with message and context instead of the built-in `Error` constructor
- **Required Parameters:** When a required input value or function return is missing, throw an explicit error using `system.mkError()` 
- **No Default Values:** Never fall back to default values for required parameters
- **Contextual Information:** Always include method name and relevant data in error context

### 6.3. Error Handling

- **Route Handlers:** Use `system.handleError()` to format, log, and respond to clients
- **Appropriate Logging:** Use correct level (`logInfo`, `logError`) for different situations
- **Debugging Context:** Always include relevant data for debugging (userId, requestId, etc.)
- **API Responses:** Return consistent error formats with appropriate HTTP status codes

### 6.4. Example

```javascript
// Error creation
if (!userId) {
  throw system.mkError('Required parameter missing: userId');
}

// Error handling in route handlers
try {
  const result = await processData(input);
  res.json(result);
} catch (error) {
  return system.handleError(res, 500, error, { userId, input });
}
```

## 7. Object-Oriented Patterns

- **Class Pattern:** ES6 class syntax
- **Constructor Validation:** Check required parameters
- **Methods:** Prefer instance methods over static when appropriate
- **Factories:** Use static factory methods when applicable
- **Async Initialization:** When class initialization requires async operations, implement and use async factory static `create()` method. No async operations should be in the class constructor.
- **Input Immutability:** Never modify input arguments. Create clones if modification is needed.
- **Class Structure:** Follow this order for class members:
  1. Static fields (class constants)
  2. Static methods
  3. Instance fields
  4. Constructors
  5. Instance methods

Example:
```javascript
class ServiceDriver {
  // 1. Static fields (class constants)
  static DEFAULT_TIMEOUT = 30000;
  static API_VERSION = 'v1';

  // 2. Static methods
  static async create(token, clientId, clientSecret) {
    // Perform async/blocking operations here instead of in constructor
    const secret = await secretService.getClientSecret();
    return new ServiceDriver(clientId, secret);
  }

  // 3. Instance fields
  _clientId = null;
  _clientSecret = null;
  _client = null;

  // 4. Constructors
  constructor(clientId, clientSecret) {
    // Always validate required parameters and throw explicit errors using system.mkError
    if (!clientId) {
      throw system.mkError('Required parameter missing: clientId', { method: 'ServiceDriver.constructor' });
    }
    if (!clientSecret) {
      throw system.mkError('Required parameter missing: clientSecret', { method: 'ServiceDriver.constructor' });
    }

    // Never use default values for required parameters:
    // BAD: this.clientId = clientId || DEFAULT_CLIENT_ID;

    this._clientId = clientId;
    this._clientSecret = clientSecret;
    this._client = this._createClient();
  }

  // 5. Instance methods
  _createClient() {
    // Internal implementation
    return new ApiClient(this._clientId, this._clientSecret, ServiceDriver.DEFAULT_TIMEOUT);
  }

  async getResources() {
    // Implementation
  }
}
```

## 8. Testing (TBD)

/section placeholder/

## 9. Security Practices

- Store secrets using `secret-service.js`
- Never hard-code credentials
- Validate all user inputs
- Follow OAuth best practices

## 11. Deployment & Environment

/section placeholder/