# K2O - AI Assistant Platform

K2O is an intelligent assistant platform that integrates with Slack, email services, task management, and calendars to provide a comprehensive productivity solution. It leverages OpenAI's language models to understand and respond to user requests through natural language.

## Overview

K2O acts as a bridge between users and their digital tools, allowing them to manage emails, tasks, calendar events, and more through conversational interactions in Slack. The assistant can process text and image inputs, maintain context across conversations, and perform actions on behalf of users.

## Architecture

The system is built with a modular architecture consisting of:

1. **Core Server**: A Node.js Express application that handles HTTP requests and routes them to appropriate handlers
2. **Service Layer**: A collection of services that encapsulate business logic and interact with external APIs
3. **Driver Layer**: Low-level components that directly interface with external services (Slack, Gmail, OpenAI, etc.)
4. **Infrastructure**: Google Cloud Platform resources managed through Terraform

### Infrastructure Components
- **Google Cloud Run**: Hosts the application server
  - Configured with 2 CPU and 2GB memory limits
  - Container concurrency set to 160
  - Auto-scaling configured from 0 to 1 instances
  - CPU throttling disabled for consistent performance
  - 300-second timeout for long-running operations
- **Google Cloud Firestore**: Stores conversation context, user data, and application state
  - Native mode database located in the same region as other resources
  - Used for persistent caching of emails, contacts, and tasks
- **Google Cloud Storage**: Stores uploaded images and other files
  - Dedicated bucket for input images with uniform bucket level access
- **Google Cloud Secret Manager**: Manages API keys and other sensitive information
  - Service accounts configured with least-privilege access to secrets
- **Google Cloud Scheduler**: Runs scheduled jobs
  - Configured to call the backend service every 15 minutes for cache refreshing
- **Service Accounts and IAM**:
  - Dedicated service account for the backend service
  - IAM permissions for Secret Manager access and Firestore operations
- **Enabled APIs**:
  - Secret Manager API
  - Artifact Registry API
  - Cloud Run API
  - Firestore API
  - Gmail API
  - People API
  - Calendar API
  - Cloud Scheduler API
- **Terraform Backend**:
  - State stored in Google Cloud Storage bucket for team collaboration and state locking

## Project Structure

```
kv2/
├── logic/                  # Main application code
│   ├── src/                # Source code
│   │   ├── handler/        # Request handlers for different endpoints
│   │   ├── shared/         # Shared services and utilities
│   │   └── index.js        # Application entry point
│   ├── tests/              # Test files
│   └── package.json        # Node.js dependencies
├── terraform/              # Infrastructure as code
│   ├── params/             # Terraform configuration
│   └── preform/            # Terraform scripts
├── Dockerfile              # Container definition
├── deploy.sh               # Deployment script
└── README.md               # This file
```

## Features

K2O offers a wide range of features:

### Email Management
- View inbox and email details
- Send, archive, and delete emails
- Create email rules

### Task Management
- Create, list, update, and delete tasks
- Mark tasks as in-progress or done
- Organize tasks in different lists

### Calendar Management
- Create and view calendar events
- Schedule meetings with context-aware suggestions

### Knowledge Management
- Memorize and recall facts about topics
- Maintain user-specific knowledge base

### Image Processing
- Analyze images for content
- Extract text from images
- Log food and weight from images
- Create events from image content

### Briefings
- Provide summaries of emails, tasks, and events
- Highlight important items
- Offer context-aware suggestions

### Checklists
- Create and maintain checklists in conversation
- Update checklist items based on user input

## Dependencies

The project relies on several key technologies:

- **Node.js**: JavaScript runtime (v18+)
- **Express**: Web framework
- **OpenAI API**: Language model integration
- **Google Cloud Platform**: Infrastructure and services
- **Slack API**: Messaging integration
- **Gmail API**: Email integration
- **Various NPM packages**: For utility functions and integrations

## Setup and Installation

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd kv2
   ```

2. **Install dependencies**
   ```bash
   cd logic
   npm install
   ```

3. **Set up environment variables**
   - Create a `.env` file in the `logic` directory with necessary API keys and configuration

4. **Run the application locally**
   ```bash
   npm start
   ```

   For HTTPS development:
   ```bash
   DEPLOYMENT=local npm start
   ```

### Deployment

The project uses a deployment script (`deploy.sh`) that handles:
- Building the Docker container
- Pushing to Google Cloud Artifact Registry
- Deploying to Google Cloud Run
- Setting up necessary infrastructure via Terraform

Follow the prerequisites section before running the deployment script.

## Usage

### Slack Integration

1. **Add the K2O bot to your Slack workspace**
   - Use the `/google/auth` endpoint to authenticate with Google services
   - Use the `/slack/auth` endpoint to authenticate with Slack

2. **Interact with K2O in Slack**
   - Mention the bot in a channel: `@K2O what's in my inbox?`
   - Start a thread and the bot will maintain context
   - Upload images for analysis
   - Use reactions (👍) to confirm actions

### API Endpoints

The application exposes several endpoints:

- **Slack Integration**: `/slack/webhook`, `/slack/auth`, `/slack/auth/callback`
- **Google Integration**: `/google/auth`, `/google/auth/callback`
- **ClickUp Integration**: `/clickup/auth/callback`
- **Image Handling**: `/image`, `/image/:key`
- **Chat**: `/chat`
- **System**: `/system/refresh`
- **Backdoor Interface**: Various `/backdoor/*` endpoints (see Backdoor Interface section)

### Backdoor Interface

The backdoor interface provides direct web-based access to system functionality and data outside of the normal Slack interface. It's primarily used for administrative purposes, debugging, and direct data manipulation.

#### Features

- **Account Management**: View and manage user accounts
  - `/backdoor/accounts`: List all accounts
  - `/backdoor/delete-account`: Delete an account

- **Email Management**: Access and manipulate emails
  - `/backdoor/mailbox`: View mailboxes
  - `/backdoor/mail`: View all emails
  - `/backdoor/delete-email`, `/backdoor/junk-email`, `/backdoor/archive-email`: Perform actions on emails

- **Task Management**: View and create tasks
  - `/backdoor/task`: View all tasks
  - `/backdoor/new-task`: Create a new task

- **Rules Management**: Manage email rules
  - `/backdoor/rule`: View all rules
  - `/backdoor/new-rule`: Create a new rule
  - `/backdoor/delete-rule`: Delete a rule

- **Knowledge Management**: Manage user knowledge base
  - `/backdoor/knowledge`: View knowledge base
  - `/backdoor/create-file`, `/backdoor/delete-file`: Manage knowledge files
  - `/backdoor/new-record`, `/backdoor/delete-record`: Manage knowledge records

### Internal Solutions

K2O implements several internal solutions to optimize performance and enhance user experience:

#### Caching Mechanisms

The system uses a multi-layered caching approach:

1. **In-Memory Caching**: Uses Node-Cache for temporary storage with configurable TTL (Time To Live)
   - Language model instances are cached for 30 minutes
   - Task data is cached for 5 minutes
   - Recent event timestamps are cached for 5 minutes to prevent duplicate processing

2. **Persistent Caching**: Uses Firestore for longer-term storage
   - **Mail Cache Service**: Stores email data, headers, and content
   - **Contacts Cache Service**: Stores contact information from Google accounts
   - **Task Cache**: Stores task lists and task data

3. **Cache Coordination**: The Cache Service orchestrates refreshing of various caches
   - Can be triggered manually by users
   - Automatically refreshed on certain events
   - Accessible via `/system/refresh` endpoint

#### Code Organization

The codebase is organized into several layers that work together:

1. **Handlers**: Entry points for HTTP requests
   - **Slack Handler**: Processes Slack events and webhooks
   - **Google Handler**: Manages Google authentication and callbacks
   - **Image Handler**: Handles image uploads and retrieval
   - **Backdoor Handlers**: Provide direct access to system functionality
   - **System Handler**: Manages system-level operations like cache refreshing

2. **Services**: Business logic layer
   - **Chat Service**: Coordinates message processing and responses
   - **Language Model Service**: Interfaces with OpenAI for natural language processing
   - **Mail Service**: Manages email operations
   - **Task Service**: Manages task operations
   - **Calendar Service**: Manages calendar operations
   - **Cache Services**: Handle data caching for performance optimization
   - **User Service**: Manages user data and authentication

3. **Drivers**: Low-level interfaces to external APIs
   - **Slack Driver**: Direct interface to Slack API
   - **Gmail Driver**: Direct interface to Gmail API
   - **OpenAI Driver**: Direct interface to OpenAI API
   - **ClickUp Driver**: Direct interface to ClickUp API

#### Data Flow

1. **Request Flow**:
   - HTTP request → Handler → Service → Driver → External API
   - Example: Slack message → Slack Handler → Chat Service → Language Model Service → OpenAI Driver → OpenAI API

2. **Response Flow**:
   - External API → Driver → Service → Handler → HTTP response
   - Example: OpenAI API → OpenAI Driver → Language Model Service → Chat Service → Slack Handler → Slack API

3. **Caching Flow**:
   - Service requests data → Check cache → If missing, fetch from Driver → Store in cache
   - Example: Mail Service needs email → Check Mail Cache → If missing, fetch from Gmail Driver → Store in Mail Cache

This layered architecture promotes separation of concerns, making the codebase more maintainable and testable. Each component has a specific responsibility and interfaces with other components through well-defined APIs.

## Prerequisites for Running deploy.sh

Ensure the following are complete before executing the deployment script:

- [ ] **Authenticate GCP**
  - Run: `gcloud auth login`
  - Run: `gcloud auth application-default login`

- [ ] **Enable Required APIs**
  - Cloud Storage API  
  - Artifact Registry API
  - Cloud Run API
  - People API (for contacts access)
  - Confirm service account key creation policy is disabled (no constraint on iam.disableServiceAccountKeyCreation)

- [ ] **Terraform Backend Bucket**
  - Confirm k-v2-cloud-functions bucket is created and accessible

Get credentials via

gcloud iam service-accounts keys create sa-key.json \
  --iam-account=kv2-backend-sa@k2o-dev.iam.gserviceaccount.com

## Technical Debt

The following technical debt has been identified in the codebase:

### General Issues
- Hard-coded values (timezone, TTL, model names, etc.) throughout the codebase
- Inconsistent error handling patterns
- Lack of comprehensive test coverage
- Incomplete JSDoc documentation in many files
- Potential security issues with logging sensitive information
- Lack of proper input validation in many functions
- Inconsistent coding style and patterns
- Missing development dependencies and scripts in package.json
- Future-dated copyright notices (2025) in file headers
- Lack of proper pagination in many list operations

### File-Specific Issues

#### logic/src/index.js
- TODOs in the code (lines 53 and 60)
- No error handling for the server startup
- Backdoor routes might be a security concern if not properly secured
- No middleware for security headers, CORS, etc.

#### logic/src/shared/chat-service.js
- TODO comment on line 130: "todo add other params"
- TODO comment on line 257: "TODO move out of this scope"
- Hard-coded values like TTL (line 23) and time zone (line 72)
- Global variables for caching (lines 34, 37)
- Lack of proper error handling in some places
- Some functions are quite long and could be refactored for better maintainability
- The Callbacks class has methods that could be moved to more appropriate service classes

#### logic/src/shared/language-model-service.js
- Duplicate function definitions for 'move-to-junk', 'move-to-trash', and 'get-spams' (lines 868-896 and 968-996)
- Hard-coded values like MAX_RESPONSE_WORDS (line 12)
- Hard-coded timezone 'America/Los_Angeles' in multiple places (lines 479, 1068)
- Long function definitions with many parameters
- Very long file (1086 lines) that could be split into multiple files
- Lack of proper error handling in some places
- Some functions are quite long and could be refactored for better maintainability

#### logic/src/shared/openai-driver.js
- Improve error handling in API calls
- Handle potential issues in token truncation for multibyte characters
- Validate Firestore document initialization to handle missing documents gracefully
- Optimize performance and memory usage in conversation trimming logic
- Handle concurrent Firestore operations safely
- Introduce validation for function definitions and parameters
- Extend cleanup to manage other active resources like timers or listeners
- Allow configuration of constants like message length limits
- Avoid logging sensitive information in debug logs
- Hard-coded model name in offerUserImage (line 369)
- Inconsistent error handling (some using system.mkError, others using new Error)
- Potential bug in setContext (line 492) where there's an extra quote in the template string

#### logic/src/shared/system.js
- Hard-coded timezone 'America/Los_Angeles' (lines 145, 157)
- Inconsistent error handling (some using JSON.stringify for errors, others using direct error messages)
- Potential security issue with logging sensitive information (line 105)
- Missing JSDoc parameter types and return types in some functions
- Unused import of SecretManagerServiceClient (line 4)
- Potential issue with parsing GCP_CREDENTIALS if the environment variable is not set (line 7)
- No validation for the parsed credentials (line 7)

#### logic/src/populate-cache.js
- No proper error handling for the TaskService.create call (lines 27-31)
- No proper exit code when errors occur
- No logging of progress or completion of the entire process
- Hard-coded console.log/console.error instead of using the system logging functions
- No validation of the userId parameter beyond checking if it exists

#### logic/src/shared/mail-cache-service.js
- Very large file (1692 lines) that should be split into multiple modules
- Incomplete JSDoc for constructor parameters (missing type and description for 'knowledge' parameter)
- Hard-coded values for collection names, label IDs, and batch sizes
- Already documented technical debt in file header:
  - Add support for bulk operations
  - Implement TTL (time-to-live) for cached data
  - Add pagination support for list operations
  - Add error recovery for failed summarization jobs
  - Implement priority-based queue processing

#### logic/src/shared/gmail-driver.js
- Hard-coded values like maxResults (400 in _getAllMessageIds, 20 in search)
- Hard-coded label IDs ('SPAM', 'INBOX')
- No try/catch blocks for API calls
- No retry logic for failed API calls
- No handling for rate limiting or quota exceeded errors
- Incomplete JSDoc comments for several methods
- getAll method uses Promise.all which could cause issues with large numbers of IDs (no batching)
- Logging of potentially sensitive information in email content
- No pagination support in search method
- No validation for input parameters
- No handling for expired tokens

#### logic/src/shared/clickup-driver.js
- getFullHierarchy method (line 636) is defined but has no implementation
- Inconsistencies in JSDoc comments (some methods have @throws documentation while others don't)
- Hard-coded delay between batches (line 217)
- _getAllTasksFromList method implements pagination but doesn't have a limit on the number of pages
- Already documented technical debt in file header:
  - Add pagination support for listing methods
  - Implement more comprehensive rate limiting handling
  - Add webhook payload validation and signature verification

#### logic/src/shared/contacts-service.js
- Typo in import: 'sercretService' instead of 'secretService' (line 5)
- Unused constant STORE_NAME defined but never used (line 7)
- Unused import: 'google' from 'googleapis' (line 2)
- Limited functionality - only has a find method, no methods for creating, updating, or deleting contacts
- No error handling for Promise.all calls
- No pagination or limits on the number of results returned

#### logic/src/shared/contacts-cache-service.js
- Hard-coded collection name (line 21)
- No error handling in getContacts method for the firestore.query call
- Sequential processing of accounts in updateContacts method instead of parallel processing
- No pagination or limit handling for potentially large contact lists
- No TTL (time-to-live) mechanism for cached contacts
- Limited error handling that doesn't account for API rate limits or network issues
- No mechanism to handle duplicate contacts across different accounts

#### logic/src/shared/google-contacts-driver.js
- Inconsistent error handling: uses 'new Error()' instead of 'system.mkError()'
- Hard-coded values for pageSize (30) and field lists
- No pagination support in getAllContacts - only fetches first 30 contacts
- No pagination support in find - only fetches first 30 search results
- No try/catch block in the find method, unlike getAllContacts method
- No handling for token expiration or refresh
- Limited functionality - no methods for creating, updating, or deleting contacts

### Recommendations
1. Create a configuration service to centralize all configuration values
2. Standardize error handling across the codebase
3. Implement comprehensive input validation
4. Break down large files into smaller, more focused modules
5. Add comprehensive test coverage
6. Implement proper logging that doesn't expose sensitive information
7. Address all TODOs in the codebase
8. Implement proper security measures for backdoor routes
9. Refactor long functions into smaller, more maintainable ones
10. Standardize coding patterns and styles across the codebase
11. Add development dependencies and scripts to package.json
12. Implement proper pagination with limits for all list operations
13. Add retry logic for external API calls
14. Complete all unfinished method implementations
15. Fix future-dated copyright notices
