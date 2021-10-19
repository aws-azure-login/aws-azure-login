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
  region?: string;
  azure_default_remember_me: boolean;
  [key: string]: unknown;
}

interface ProfileCredentials {
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_session_token: string;
  aws_expiration: string;
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
    const envConfig = this._loadFromEnv();

    if (!config) {
      if (this._isConfigProfileComplete(envConfig)) {
        return envConfig;
      }
      return undefined;
    }

    return { ...config[sectionName], ...envConfig };
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

  _isConfigProfileComplete(
    config: Partial<ProfileConfig>
  ): config is ProfileConfig {
    return (
      config.azure_tenant_id != null &&
      config.azure_app_id_uri != null &&
      config.azure_default_username != null &&
      config.azure_default_role_arn != null &&
      config.azure_default_duration_hours != null &&
      config.azure_default_remember_me != null
    );
  },

  _loadFromEnv(): Partial<ProfileConfig> {
    const env = process.env;
    return {
      azure_tenant_id: env.AZURE_TENANT_ID,
      azure_app_id_uri: env.AZURE_APP_ID_URI,
      azure_default_username: env.AZURE_DEFAULT_USERNAME,
      azure_default_password: env.AZURE_DEFAULT_PASSWORD,
      azure_default_role_arn: env.AZURE_DEFAULT_ROLE_ARN,
      azure_default_duration_hours: env.AZURE_DEFAULT_DURATION_HOURS,
      azure_default_remember_me: env.AZURE_DEFAULT_REMEMBER_ME === "true",
    };
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
        return resolve(parsedIni);
      });
    });
  },

  async _saveAsync(type: string, data: unknown): Promise<void> {
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
