"use strict";

const os = require("os");
const path = require("path");

const awsDir = path.join(os.homedir(), ".aws");

module.exports = {
    awsDir,
    config: process.env.AWS_CONFIG_FILE || path.join(awsDir, "config"),
    credentials: process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(awsDir, "credentials"),
    chromium: path.join(awsDir, "chromium")
};
