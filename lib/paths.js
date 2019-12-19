"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const awsDir = path_1.default.join(os_1.default.homedir(), ".aws");
exports.paths = {
    awsDir,
    config: process.env.AWS_CONFIG_FILE || path_1.default.join(awsDir, "config"),
    credentials: process.env.AWS_SHARED_CREDENTIALS_FILE || path_1.default.join(awsDir, "credentials"),
    chromium: path_1.default.join(awsDir, "chromium"),
};
