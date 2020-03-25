import os from "os";
import path from "path";

const awsDir = path.join(os.homedir(), ".aws");

export const paths: {
  awsDir: string;
  config: string;
  credentials: string;
  chromium: string;
  [key: string]: string;
} = {
  awsDir,
  config: process.env.AWS_CONFIG_FILE || path.join(awsDir, "config"),
  credentials:
    process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(awsDir, "credentials"),
  chromium: path.join(awsDir, "chromium"),
};
