import ini from "ini";
import _debug from "debug";
import { paths } from "./paths";
import mkdirp from "mkdirp";
import fs from "fs";
import util from "util";

const debug = _debug("aws-azure-login");

const writeFile = util.promisify(fs.writeFile);

// Autorefresh credential time limit in milliseconds
const refreshLimitInMs = 11 * 60 * 1000;

export interface ProfileConfig {
  azure_tenant_id: string;
  azure_app_id_uri: string;
  azure_default_username: string;
  azure_default_password?: string;
  azure_default_role_arn: string;
  azure_default_duration_hours: string;
  region: string;
  azure_default_remember_me: boolean;
  [key: string]: unknown;
}

interface ProfileCredentials {
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_session_token: string;
  aws_expiration: string;
}

interface SaveData {
  [key: string]: ProfileConfig | ProfileCredentials;
}

export const awsConfig = {
  async setProfileConfigValuesAsync(
    profileName: string,
    values: ProfileConfig
  ): Promise<void> {
    const sectionName =
      profileName === "default" ? "default" : `profile ${profileName}`;
    debug(
      `Setting config for profile '${profileName}' in section '${sectionName}'`
    );
    const config =
      (await this._loadAsync<{ [key: string]: ProfileConfig }>("config")) || {};

    config[sectionName] = {
      ...config[sectionName],
      ...values,
    };

    await this._saveAsync("config", config);
  },

  async getProfileConfigAsync(
    profileName: string
  ): Promise<ProfileConfig | undefined> {
    const sectionName =
      profileName === "default" ? "default" : `profile ${profileName}`;
    debug(
      `Getting config for profile '${profileName}' in section '${sectionName}'`
    );
    const config = await this._loadAsync<{ [key: string]: ProfileConfig }>(
      "config"
    );

    if (!config) {
      return undefined;
    }

    return config[sectionName];
  },

  async isProfileAboutToExpireAsync(profileName: string): Promise<boolean> {
    debug(`Getting credentials for profile '${profileName}'`);
    const config = await this._loadAsync<{ [key: string]: ProfileCredentials }>(
      "credentials"
    );

    let expirationDate;

    if (
      !config ||
      config[profileName] === undefined ||
      config[profileName].aws_expiration === undefined
    ) {
      expirationDate = new Date();
    } else {
      expirationDate = new Date(config[profileName].aws_expiration);
    }

    const timeDifference = expirationDate.getTime() - new Date().getTime();
    debug(
      `Remaining time till credential expiration: ${
        timeDifference / 1000
      }s, refresh due if time lower than: ${refreshLimitInMs / 1000}s`
    );
    return timeDifference < refreshLimitInMs;
  },

  async setProfileCredentialsAsync(
    profileName: string,
    values: ProfileCredentials
  ): Promise<void> {
    const credentials =
      (await this._loadAsync<{
        [key: string]: ProfileCredentials;
      }>("credentials")) || {};

    debug(`Setting credentials for profile '${profileName}'`);
    credentials[profileName] = values;
    await this._saveAsync("credentials", credentials);
  },

  async getAllProfileNames(): Promise<string[] | undefined> {
    debug(`Getting all configured profiles from config.`);
    const config =
      (await this._loadAsync<{ [key: string]: ProfileConfig }>("config")) || {};

    const profiles = Object.keys(config).map(function (e) {
      return e.replace("profile ", "");
    });
    debug(`Received profiles: ${profiles.toString()}`);
    return profiles;
  },

  async _loadAsync<T>(type: string): Promise<T | undefined> {
    if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);

    return new Promise<T | undefined>((resolve, reject) => {
      debug(`Loading '${type}' file at '${paths[type]}'`);
      fs.readFile(paths[type], "utf8", (err, data) => {
        if (err) {
          if (err.code === "ENOENT") {
            debug(`File not found. Returning undefined.`);
            return resolve(undefined);
          } else {
            return reject(err);
          }
        }

        debug("Parsing data");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsedIni: any = ini.parse(data);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        return resolve(parsedIni);
      });
    });
  },

  async _saveAsync(type: string, data: SaveData): Promise<void> {
    if (!paths[type]) throw new Error(`Unknown config type: '${type}'`);
    if (!data) throw new Error(`You must provide data for saving.`);

    debug(`Stringifying ${type} INI data`);
    const text = ini.stringify(data);

    debug(`Creating AWS config directory '${paths.awsDir}' if not exists.`);
    await mkdirp(paths.awsDir);

    debug(`Writing '${type}' INI to file '${paths[type]}'`);
    await writeFile(paths[type], text);
  },
};
