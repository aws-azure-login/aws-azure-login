import shell from "shelljs";
import path from "path";
import { paths } from "./paths";

import _debug from "debug";
const debug = _debug("aws-azure-login");

const usernameScriptPath: string =
  process.env.AWS_LOGIN_SCRIPT_USERNAME ??
  path.join(paths.awsDir, ".aws-azure-login.username.sh");
const passwordScriptPath: string =
  process.env.AWS_LOGIN_SCRIPT_PASSWORD ??
  path.join(paths.awsDir, ".aws-azure-login.password.sh");
const staticChallengeScriptPath: string =
  process.env.AWS_LOGIN_SCRIPT_MFA ??
  path.join(paths.awsDir, ".aws-azure-login.static-challenge.sh");

const trim = (str: string): string => (str ? str.trim() : str);
const execSh = (path: string): string | undefined => {
  if (shell.test("-e", path)) {
    debug(`Executing ${path}`);
    return trim(shell.exec(path, { silent: true }).stdout);
  } else {
    debug(`Script ${path} does not exist`);
  }
};

export const getUsernameSh = (): string | undefined =>
  execSh(usernameScriptPath);
export const getPasswordSh = (): string | undefined =>
  execSh(passwordScriptPath);
export const getVerificationCodeSh = (): string | undefined =>
  execSh(staticChallengeScriptPath);
