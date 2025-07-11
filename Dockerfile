# Base image
FROM node:24

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY logic/package*.json ./
RUN npm install

# Copy app source
COPY logic/src/ .

# Expose the app port
EXPOSE 8080

# Start the app
CMD ["node", "index.js"]