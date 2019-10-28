import os from "os";
import path from "path";
import ini from "ini";
import _debug from "debug";
import fs from "fs";
import mkdirp from "mkdirp";
import util from "util";

const debug = _debug('aws-azure-login');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const mkdirpPromise = util.promisify(mkdirp);

const awsDir = path.join(os.homedir(), ".aws");
const paths: { [key: string]: string } = {
    config: process.env.AWS_CONFIG_FILE || path.join(awsDir, "config"),
    credentials: process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(awsDir, "credentials")
};

export interface ProfileConfig {
    azure_tenant_id: string;
    azure_app_id_uri: string;
    azure_default_username: string;
    azure_default_role_arn: string;
    azure_default_duration_hours: string;
    [key: string]: string;
}

interface ProfileCredentials {
    aws_access_key_id: string;
    aws_secret_access_key: string;
    aws_session_token: string;
    aws_session_expiration: string;
}

export const awsConfig = {
    async setProfileConfigValuesAsync(profileName: string, values: ProfileConfig): Promise<void> {
        const sectionName = profileName === "default" ? "default" : `profile ${profileName}`;
        debug(`Setting config for profile '${profileName}' in section '${sectionName}'`);
        const config = await this._loadAsync<{ [key: string]: ProfileConfig }>("config");

        if (!config) {
            return;
        }

        config[sectionName] = {
            ...config[sectionName],
            ...values
        };

        await this._saveAsync("config", config);
    },

    async getProfileConfigAsync(profileName: string): Promise<ProfileConfig | undefined> {
        const sectionName = profileName === "default" ? "default" : `profile ${profileName}`;
        debug(`Getting config for profile '${profileName}' in section '${sectionName}'`);
        const config = await this._loadAsync<{ [key: string]: ProfileConfig }>("config");

        if (!config) {
            return;
        }

        return config[sectionName];
    },

    async setProfileCredentialsAsync(profileName: string, values: ProfileCredentials): Promise<void> {
        const credentials = await this._loadAsync<{ [key: string]: ProfileCredentials }>("credentials");

        if (!credentials) {
            return;
        }

        debug(`Setting credentials for profile '${profileName}'`);
        credentials[profileName] = values;
        await this._saveAsync("credentials", credentials);
    },

    async _loadAsync<T>(type: string): Promise<T | undefined> {
        if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);

        let data;
        try {
            debug(`Loading '${type}' file at '${paths[type]}'`);
            data = await readFile(paths[type], "utf8");
        } catch (err) {
            if (err.code === "ENOENT") {
                debug(`File not found. Returning empty object.`);
                return undefined;
            } else {
                throw err;
            }
        }

        debug(`Parsing data`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsedIni: any = ini.parse(data);
        return parsedIni;
    },

    async _saveAsync(type: string, data: unknown): Promise<void> {
        if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);
        if (!data) throw new Error(`You must provide data for saving.`);

        debug(`Stringifying ${type} INI data`);
        const text = ini.stringify(data);

        debug(`Creating AWS config directory '${awsDir}' if not exists.`);
        await mkdirpPromise(awsDir);

        debug(`Writing '${type}' INI to file '${paths[type]}'`);
        await writeFile(paths[type], text);
    }
};
