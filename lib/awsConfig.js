"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ini_1 = __importDefault(require("ini"));
const debug_1 = __importDefault(require("debug"));
const paths_1 = require("./paths");
const mkdirp_1 = __importDefault(require("mkdirp"));
const fs_1 = __importDefault(require("fs"));
const util_1 = __importDefault(require("util"));
const debug = debug_1.default('aws-azure-login');
const readFile = util_1.default.promisify(fs_1.default.readFile);
const writeFile = util_1.default.promisify(fs_1.default.writeFile);
const mkdirpPromise = util_1.default.promisify(mkdirp_1.default);
// Autorefresh credential time limit in milliseconds
const refreshLimitInMs = 11 * 60 * 1000;
exports.awsConfig = {
    async setProfileConfigValuesAsync(profileName, values) {
        const sectionName = profileName === "default" ? "default" : `profile ${profileName}`;
        debug(`Setting config for profile '${profileName}' in section '${sectionName}'`);
        const config = await this._loadAsync("config");
        if (!config) {
            debug(`Unable to find config in setProfileConfigValuesAsync`);
            return;
        }
        config[sectionName] = {
            ...config[sectionName],
            ...values
        };
        await this._saveAsync("config", config);
    },
    async getProfileConfigAsync(profileName) {
        const sectionName = profileName === "default" ? "default" : `profile ${profileName}`;
        debug(`Getting config for profile '${profileName}' in section '${sectionName}'`);
        const config = await this._loadAsync("config");
        if (!config) {
            debug(`Unable to find config in getProfileConfigAsync`);
            return;
        }
        return config[sectionName];
    },
    async isProfileAboutToExpireAsync(profileName) {
        debug(`Getting credentials for profile '${profileName}'`);
        const config = await this._loadAsync("credentials");
        let expirationDate;
        if (!config || config[profileName] === undefined || config[profileName].aws_expiration === undefined) {
            expirationDate = new Date();
        }
        else {
            expirationDate = new Date(config[profileName].aws_expiration);
        }
        const timeDifference = expirationDate.getTime() - new Date().getTime();
        debug(`Remaining time till credential expiration: ${timeDifference / 1000}s, refresh due if time lower than: ${refreshLimitInMs / 1000}s`);
        return (timeDifference < refreshLimitInMs);
    },
    async setProfileCredentialsAsync(profileName, values) {
        const credentials = await this._loadAsync("credentials");
        if (!credentials) {
            debug(`Unable to find credentials in setProfileCredentialsAsync`);
            return;
        }
        debug(`Setting credentials for profile '${profileName}'`);
        credentials[profileName] = values;
        await this._saveAsync("credentials", credentials);
    },
    async getAllProfileNames() {
        debug(`Getting all configured profiles from config.`);
        const config = await this._loadAsync("config");
        if (!config) {
            debug(`Unable to find config in getAllProfileNames`);
            return;
        }
        const profiles = Object.keys(config).map(function (e) {
            return e.replace("profile ", "");
        });
        debug(`Received profiles: ${profiles.toString()}`);
        return profiles;
    },
    async _loadAsync(type) {
        if (!paths_1.paths[type])
            throw new Error(`Unknown config type: '${type}'`);
        let data;
        try {
            debug(`Loading '${type}' file at '${paths_1.paths[type]}'`);
            data = await readFile(paths_1.paths[type], "utf8");
        }
        catch (err) {
            if (err.code === "ENOENT") {
                debug(`File not found. Returning undefined.`);
                return undefined;
            }
            else {
                throw err;
            }
        }
        debug(`Parsing data`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsedIni = ini_1.default.parse(data);
        return parsedIni;
    },
    async _saveAsync(type, data) {
        if (!paths_1.paths[type])
            throw new Error(`Unknown config type: '${type}'`);
        if (!data)
            throw new Error(`You must provide data for saving.`);
        debug(`Stringifying ${type} INI data`);
        const text = ini_1.default.stringify(data);
        debug(`Creating AWS config directory '${paths_1.paths.awsDir}' if not exists.`);
        await mkdirpPromise(paths_1.paths.awsDir);
        debug(`Writing '${type}' INI to file '${paths_1.paths[type]}'`);
        await writeFile(paths_1.paths[type], text);
    }
};
